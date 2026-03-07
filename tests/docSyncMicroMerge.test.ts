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

const fakeRoomState = {
  getRoomId: () => 'room1',
  setActiveSharedDocLabel: () => {},
  isRoot: () => false,
  isCollaborator: () => true,
  isCollaboratorInDirectMode: () => true
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

describe('DocumentSync micro-merge (gap 1 version)', () => {
  it('applies patch when version gap is 1 step and avoids full sync request', async () => {
    const sync = new DocumentSync(fakeRoomState, fakeStorage, (msg) => sendSpy.push(msg as any));
    (sync as any).documents.set('d1', {
      docId: 'd1',
      sharedDocument: fakeDoc,
      uri: { toString: () => 'file:///tmp/doc' },
      version: 1,
      lastSyncedText: 'text',
      pendingSnapshot: false
    });
    (sync as any).activeDocumentId = 'd1';

    applyResult = true;
    await sync.applyRemoteChange('d1', patch, 3); // gap = 2 versions (missing 1)

    expect(sendSpy.length).toBe(0); // no requestFullSync
    const tracked = (sync as any).documents.get('d1');
    expect(tracked.version).toBe(3);
  });
});
