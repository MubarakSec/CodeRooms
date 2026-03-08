import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/util/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    setDebugLogging: () => {}
  }
}));

let applyResult = true;

vi.mock('vscode', () => {
  class Uri {
    constructor(readonly value: string) {}
    toString() {
      return this.value;
    }
    get fsPath() {
      return this.value.replace('file://', '');
    }
    static parse(value: string) {
      return new Uri(value);
    }
    static file(value: string) {
      return new Uri(`file://${value}`);
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
    applyEdit: () => Promise.resolve(applyResult),
    onDidChangeTextDocument: () => ({ dispose: () => {} }),
    onDidCloseTextDocument: () => ({ dispose: () => {} })
  };
  const window = {
    showWarningMessage: () => Promise.resolve(undefined)
  };
  const EventEmitter = class<T> {
    private listeners: Array<(e: T) => void> = [];
    event = (listener: (e: T) => void) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
    fire(data?: T) {
      this.listeners.forEach(fn => fn(data as T));
    }
    dispose() {
      this.listeners = [];
    }
  };
  const Disposable = class {
    constructor(private readonly _dispose?: () => void) {}
    dispose() {
      this._dispose?.();
    }
  };
  return { Uri, Position, Range, WorkspaceEdit, workspace, window, EventEmitter, Disposable };
});

import { DocumentSync } from '../src/core/DocumentSync';

describe('DocumentSync acceptSuggestion', () => {
  it('applies patches locally and only sends acceptSuggestion once', async () => {
    const sent: any[] = [];
    const sync = new DocumentSync(
      {
        getRoomId: () => 'room1',
        setActiveSharedDocLabel: () => {},
        isRoot: () => true,
        isCollaborator: () => false,
        isCollaboratorInDirectMode: () => false
      } as any,
      {
        updateVersion: async () => {},
        prepare: async () => {}
      } as any,
      (message) => sent.push(message)
    );

    (sync as any).documents.set('d1', {
      docId: 'd1',
      sharedDocument: {
        uri: { toString: () => 'file:///tmp/doc', fsPath: '/tmp/doc' },
        getText: () => 'updated text',
        languageId: 'plaintext'
      },
      version: 5,
      lastSyncedText: 'original',
      pendingSnapshot: false
    });
    (sync as any).setActiveDocument = vi.fn(async () => {});
    applyResult = true;

    await sync.acceptSuggestion({
      suggestionId: 's1',
      roomId: 'room1',
      docId: 'd1',
      authorId: 'u2',
      authorName: 'Collaborator',
      patches: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          text: 'a'
        },
        {
          range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } },
          text: 'b'
        }
      ],
      createdAt: 1,
      status: 'pending'
    });

    expect(sent).toEqual([
      { type: 'acceptSuggestion', roomId: 'room1', suggestionId: 's1' }
    ]);
    expect((sync as any).documents.get('d1').version).toBe(7);
  });
});
