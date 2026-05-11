import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/util/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    setDebugLogging: () => {}
  }
}));

let applyResult = false;
// use var to avoid TDZ with vi.mock hoisting
var warnSpy: ReturnType<typeof vi.fn>;

vi.mock('vscode', () => {
  warnSpy = warnSpy ?? vi.fn();
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
    showWarningMessage: (...args: any[]) => {
      warnSpy(...args);
      return Promise.resolve(undefined);
    }
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

describe('DocumentSync applyRemoteChange fallback', () => {
  it('requests full sync after two failed patch applications and warns user', async () => {
    const sent: any[] = [];
    const sync = new DocumentSync(fakeRoomState, fakeStorage, (msg) => sent.push(msg as any));
    const yDoc = new Y.Doc();
    yDoc.getText('text').insert(0, 'text');
    (sync as any).documents.set('d1', {
      docId: 'd1',
      sharedDocument: fakeDoc,
      version: 1,
      lastSyncedText: 'text',
      pendingSnapshot: false,
      yDoc
    });
    (sync as any).activeDocumentId = 'd1';

    applyResult = false;
    await sync.applyRemoteChange('d1', patch, 2);

    expect(sent.length).toBe(1);
    expect(sent[0].type).toBe('requestFullSync');
    expect(warnSpy).toHaveBeenCalled();
  });
});
