import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/util/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    setDebugLogging: () => {}
  }
}));

let openDocumentResult: any;
let applyEditResult = true;

vi.mock('vscode', () => {
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
    static parse(value: string) {
      return new Uri(value.startsWith('file://') ? 'file' : 'unknown', value.replace('file://', ''), value);
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
    applyEdit: () => Promise.resolve(applyEditResult),
    openTextDocument: () => Promise.resolve(openDocumentResult),
    onDidChangeTextDocument: () => ({ dispose: () => {} }),
    onDidCloseTextDocument: () => ({ dispose: () => {} })
  };

  const window = {
    showWarningMessage: () => Promise.resolve(undefined),
    showErrorMessage: () => Promise.resolve(undefined),
    showInformationMessage: () => Promise.resolve(undefined),
    showTextDocument: (document: any) => Promise.resolve({ document })
  };

  const languages = {
    setTextDocumentLanguage: (document: any) => Promise.resolve(document)
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

  return { Uri, Position, Range, WorkspaceEdit, workspace, window, languages, EventEmitter, Disposable };
});

import * as vscode from 'vscode';
import { DocumentSync } from '../src/core/DocumentSync';

function createFakeDocument(filePath: string, text: string) {
  const uri = vscode.Uri.file(filePath);
  return {
    uri,
    getText: () => text,
    languageId: 'plaintext',
    lineCount: 1,
    lineAt: () => ({ range: { end: { character: text.length } } })
  } as any;
}

describe('DocumentSync reconciliation', () => {
  it('keeps a newly shared root document pending until the server confirms it', async () => {
    const sent: any[] = [];
    const localDocument = createFakeDocument('/tmp/root.ts', 'const x = 1;');
    const sync = new DocumentSync(
      {
        getRoomId: () => 'room-1',
        setActiveSharedDocLabel: vi.fn(),
        isCollaborator: () => false,
        isCollaboratorInDirectMode: () => false,
        isViewer: () => false,
        isRoot: () => true,
        getUserId: () => 'root-1'
      } as any,
      {
        prepare: async () => {},
        registerDocument: async () => ({ uri: vscode.Uri.file('/tmp/storage-copy.ts') }),
        updateVersion: async () => {}
      } as any,
      message => sent.push(message)
    );

    sync.shareDocument(localDocument);

    expect((sync as any).documents.size).toBe(0);
    expect((sync as any).pendingShareDocs.has(sent[0].docId)).toBe(true);

    await sync.handleShareDocument({
      type: 'shareDocument',
      roomId: 'room-1',
      docId: sent[0].docId,
      originalUri: localDocument.uri.toString(),
      fileName: 'root.ts',
      languageId: 'plaintext',
      text: 'const x = 1;',
      version: 1
    });

    expect((sync as any).pendingShareDocs.size).toBe(0);
    expect(sync.getSharedDocuments()).toEqual([
      expect.objectContaining({
        docId: sent[0].docId,
        uri: localDocument.uri,
        fileName: 'root.ts'
      })
    ]);
  });

  it('waits for documentUnshared before removing a shared document locally', async () => {
    const sent: any[] = [];
    const sync = new DocumentSync(
      {
        getRoomId: () => 'room-1',
        setActiveSharedDocLabel: vi.fn(),
        isCollaborator: () => false,
        isCollaboratorInDirectMode: () => false,
        isViewer: () => false,
        getUserId: () => 'root-1'
      } as any,
      { updateVersion: async () => {}, prepare: async () => {} } as any,
      message => sent.push(message)
    );

    const document = createFakeDocument('/tmp/shared.ts', 'hello');
    (sync as any).documents.set('doc-1', {
      docId: 'doc-1',
      uri: document.uri,
      sharedDocument: document,
      version: 1,
      lastSyncedText: 'hello',
      pendingSnapshot: false,
      fileName: 'shared.ts'
    });
    (sync as any).registerLocalMapping('doc-1', document.uri);
    (sync as any).activeDocumentId = 'doc-1';

    sync.unshareDocument('doc-1');

    expect(sent).toEqual([{ type: 'unshareDocument', roomId: 'room-1', documentId: 'doc-1' }]);
    expect(sync.getSharedDocuments()).toHaveLength(1);

    await sync.handleDocumentUnshared({
      type: 'documentUnshared',
      roomId: 'room-1',
      documentId: 'doc-1'
    });

    expect(sync.getSharedDocuments()).toHaveLength(0);
  });

  it('queues a full sync until the document becomes available locally', async () => {
    const sync = new DocumentSync(
      {
        getRoomId: () => 'room-1',
        setActiveSharedDocLabel: vi.fn(),
        isCollaborator: () => false,
        isCollaboratorInDirectMode: () => false,
        isViewer: () => false,
        getUserId: () => 'root-1'
      } as any,
      { updateVersion: async () => {}, prepare: async () => {}, getEntry: async () => undefined } as any,
      () => {}
    );

    await sync.applyFullDocumentSync('doc-1', 'server text', 4);
    expect((sync as any).pendingFullSyncs.has('doc-1')).toBe(true);

    const document = createFakeDocument('/tmp/reconciled.ts', 'local text');
    openDocumentResult = document;
    (sync as any).documents.set('doc-1', {
      docId: 'doc-1',
      uri: document.uri,
      version: 1,
      lastSyncedText: 'local text',
      pendingSnapshot: false
    });
    (sync as any).remoteToLocal.set('doc-1', document.uri);

    await (sync as any).ensureDocumentIsOpen('doc-1', false);

    expect((sync as any).pendingFullSyncs.has('doc-1')).toBe(false);
    expect((sync as any).documents.get('doc-1').version).toBe(4);
  });
});
