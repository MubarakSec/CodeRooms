import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/util/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    setDebugLogging: () => {}
  }
}));

var warnSpy: ReturnType<typeof vi.fn>;

vi.mock('vscode', () => {
  warnSpy = warnSpy ?? vi.fn();

  class Uri {
    constructor(
      readonly scheme: string,
      readonly fsPath: string,
      private readonly value: string
    ) {}
    toString() {
      return this.value;
    }
    static file(value: string) {
      return new Uri('file', value, `file://${value}`);
    }
  }

  class Position {
    constructor(public line: number, public character: number) {}
  }

  class Range {
    start: Position;
    end: Position;
    constructor(sl: number, sc: number, el: number, ec: number) {
      this.start = new Position(sl, sc);
      this.end = new Position(el, ec);
    }
  }

  class WorkspaceEdit {
    replace() {}
  }

  const workspace = {
    applyEdit: () => Promise.resolve(true),
    onDidChangeTextDocument: () => ({ dispose: () => {} }),
    onDidCloseTextDocument: () => ({ dispose: () => {} })
  };

  const window = {
    showWarningMessage: (...args: any[]) => {
      warnSpy(...args);
      return Promise.resolve(undefined);
    }
  };

  const EventEmitter = class<T> {
    private listeners: Array<(event: T) => void> = [];
    event = (listener: (event: T) => void) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
    fire(event?: T) {
      for (const listener of this.listeners) {
        listener(event as T);
      }
    }
    dispose() {
      this.listeners = [];
    }
  };

  const Disposable = class {
    dispose() {}
  };

  return { Uri, Position, Range, WorkspaceEdit, workspace, window, EventEmitter, Disposable };
});

import * as vscode from 'vscode';
import { DocumentSync } from '../src/core/DocumentSync';

function createFakeDocument(filePath: string, text: string) {
  const uri = vscode.Uri.file(filePath);
  return {
    uri,
    getText: () => text,
    languageId: 'plaintext'
  } as any;
}

function createFakeChangeEvent(document: any) {
  return {
    document,
    contentChanges: [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 }
        },
        text: 'X'
      }
    ]
  } as any;
}

describe('DocumentSync active document tracking', () => {
  it('switches the active shared document when the active editor changes to another shared file', () => {
    const roomState = {
      setActiveSharedDocLabel: vi.fn(),
      getRoomId: () => 'room-1',
      isCollaborator: () => true,
      isCollaboratorInDirectMode: () => true,
      isViewer: () => false,
      getUserId: () => 'user-1'
    } as any;

    const sync = new DocumentSync(roomState, { updateVersion: async () => {}, prepare: async () => {} } as any, () => {});
    const doc1 = createFakeDocument('/tmp/shared-a.ts', 'a');
    const doc2 = createFakeDocument('/tmp/shared-b.ts', 'b');

    (sync as any).documents.set('doc-1', { docId: 'doc-1', uri: doc1.uri, fileName: 'shared-a.ts', version: 1, lastSyncedText: 'a', pendingSnapshot: false });
    (sync as any).documents.set('doc-2', { docId: 'doc-2', uri: doc2.uri, fileName: 'shared-b.ts', version: 1, lastSyncedText: 'b', pendingSnapshot: false });
    (sync as any).registerLocalMapping('doc-1', doc1.uri);
    (sync as any).registerLocalMapping('doc-2', doc2.uri);
    (sync as any).activeDocumentId = 'doc-1';

    sync.syncActiveEditor({ document: doc2 } as any);

    expect((sync as any).activeDocumentId).toBe('doc-2');
    expect(roomState.setActiveSharedDocLabel).toHaveBeenLastCalledWith('shared-b.ts');
  });

  it('processes edits for a shared document even when activeDocumentId was stale', async () => {
    const sent: any[] = [];
    const roomState = {
      setActiveSharedDocLabel: vi.fn(),
      getRoomId: () => 'room-1',
      isCollaborator: () => true,
      isCollaboratorInDirectMode: () => true,
      isViewer: () => false,
      getUserId: () => 'user-1'
    } as any;

    const sync = new DocumentSync(roomState, { updateVersion: async () => {}, prepare: async () => {} } as any, message => {
      sent.push(message);
    });
    const doc1 = createFakeDocument('/tmp/shared-a.ts', 'a');
    const doc2 = createFakeDocument('/tmp/shared-b.ts', 'b');

    (sync as any).documents.set('doc-1', { docId: 'doc-1', uri: doc1.uri, fileName: 'shared-a.ts', version: 1, lastSyncedText: 'a', pendingSnapshot: false });
    (sync as any).documents.set('doc-2', {
      docId: 'doc-2',
      uri: doc2.uri,
      sharedDocument: doc2,
      fileName: 'shared-b.ts',
      version: 1,
      lastSyncedText: 'b',
      pendingSnapshot: false
    });
    (sync as any).registerLocalMapping('doc-1', doc1.uri);
    (sync as any).registerLocalMapping('doc-2', doc2.uri);
    (sync as any).activeDocumentId = 'doc-1';
    (sync as any).scheduleFlush = vi.fn();

    await (sync as any).onDidChangeTextDocument(createFakeChangeEvent(doc2));

    expect((sync as any).activeDocumentId).toBe('doc-2');
    expect((sync as any).scheduleFlush).toHaveBeenCalledWith('doc-2');
    expect((sync as any).pendingDocChanges.get('doc-2')).toHaveLength(1);
    expect(sent).toEqual([
      {
        type: 'participantActivity',
        roomId: 'room-1',
        userId: 'user-1',
        activity: 'typing',
        at: expect.any(Number)
      }
    ]);
  });

  it('falls back to the remaining shared document when the old active document was removed', () => {
    const roomState = {
      setActiveSharedDocLabel: vi.fn(),
      getRoomId: () => 'room-1',
      isCollaborator: () => false,
      isCollaboratorInDirectMode: () => false,
      isViewer: () => false,
      getUserId: () => 'user-1'
    } as any;

    const sync = new DocumentSync(roomState, { updateVersion: async () => {}, prepare: async () => {} } as any, () => {});
    const doc1 = createFakeDocument('/tmp/shared-a.ts', 'a');
    const doc2 = createFakeDocument('/tmp/shared-b.ts', 'b');

    (sync as any).documents.set('doc-1', { docId: 'doc-1', uri: doc1.uri, fileName: 'shared-a.ts', version: 1, lastSyncedText: 'a', pendingSnapshot: false });
    (sync as any).documents.set('doc-2', { docId: 'doc-2', uri: doc2.uri, fileName: 'shared-b.ts', version: 1, lastSyncedText: 'b', pendingSnapshot: false });
    (sync as any).registerLocalMapping('doc-1', doc1.uri);
    (sync as any).registerLocalMapping('doc-2', doc2.uri);
    (sync as any).activeDocumentId = 'doc-1';

    (sync as any).removeTrackedDocument('doc-1');

    expect(sync.getActiveDocumentId()).toBe('doc-2');
    expect(roomState.setActiveSharedDocLabel).toHaveBeenLastCalledWith('shared-b.ts');
  });
});
