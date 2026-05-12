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
const sendSpy: any[] = [];

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
import * as Y from 'yjs';

const fakeRoomState = {
  getRoomId: () => 'room1',
  setActiveSharedDocLabel: () => {},
  isRoot: () => false,
  isCollaborator: () => true,
  isCollaboratorInDirectMode: () => true,
  getE2EKey: () => undefined
} as any;

const fakeStorage = {
  updateVersion: async () => {},
  prepare: async () => {}
} as any;

const fakeDoc = {
  uri: { toString: () => 'file:///tmp/doc', fsPath: '/tmp/doc' },
  getText: () => 'text',
  languageId: 'plaintext'
} as any;

const patch = {
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  text: 'x'
};

describe('DocumentSync fallback behavior', () => {
  it('requests full sync when Yjs update is missing instead of applying raw patch', async () => {
    const sync = new DocumentSync(fakeRoomState, fakeStorage, (msg) => sendSpy.push(msg as any));
    const yDoc = new Y.Doc();
    yDoc.getText('text').insert(0, 'text');
    (sync as any).documents.set('d1', {
      docId: 'd1',
      sharedDocument: fakeDoc,
      uri: { toString: () => 'file:///tmp/doc' },
      version: 1,
      lastSyncedText: 'text',
      pendingSnapshot: false,
      yDoc
    });
    (sync as any).activeDocumentId = 'd1';

    applyResult = true;
    await sync.applyRemoteChange('d1', patch, 3);

    expect(sendSpy.length).toBe(1);
    expect(sendSpy[0].type).toBe('requestFullSync');
    const tracked = (sync as any).documents.get('d1');
    expect(tracked.version).toBe(1);
  });
});
