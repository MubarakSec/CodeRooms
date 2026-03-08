import { describe, it, expect, vi } from 'vitest';
import { getClientMessageAckKey } from '../shared/ackKeys';

vi.mock('vscode', () => {
  return {
    window: {},
    StatusBarAlignment: { Left: 0 },
    EventEmitter: class<T> {
      private listeners: Array<(e: T) => void> = [];
      event = (listener: (e: T) => void) => {
        this.listeners.push(listener);
        return { dispose: () => {} };
      };
      fire(data?: T) {
        this.listeners.forEach(fn => fn(data as T));
      }
    },
    Disposable: class {
      constructor(private readonly _dispose?: () => void) {}
      dispose() {
        this._dispose?.();
      }
    },
    workspace: {
      onDidChangeTextDocument: () => ({ dispose: () => {} }),
      onDidCloseTextDocument: () => ({ dispose: () => {} })
    }
  };
});

import type { ClientToServerMessage } from '../src/connection/MessageTypes';

class FakeSocket {
  sent: ClientToServerMessage[] = [];
  send(msg: ClientToServerMessage) {
    this.sent.push(msg);
  }
}

describe('Pending queue dedup', () => {
  it('deduplicates by message key when reconnecting', () => {
    const pendingAck = new Map<string, ClientToServerMessage>();
    const pendingOffline: ClientToServerMessage[] = [];
    const socket = new FakeSocket();
    const flushPending = () => {
      for (const [, msg] of pendingAck) {
        socket.send(msg);
      }
      while (pendingOffline.length) {
        const next = pendingOffline.shift();
        if (next) {
          const key = getClientMessageAckKey(next);
          if (key && pendingAck.has(key)) {
            continue;
          }
          if (key) {
            pendingAck.set(key, next);
          }
          socket.send(next);
        }
      }
    };

    // enqueue two chat messages with same id (duplicate)
    const msg: ClientToServerMessage = {
      type: 'chatSend',
      roomId: 'r',
      messageId: 'm1',
      content: 'hi',
      timestamp: Date.now()
    };
    pendingOffline.push(msg, msg);
    const key = getClientMessageAckKey(msg)!;
    pendingAck.set(key, msg);

    flushPending();

    expect(socket.sent.length).toBe(1);
    expect(pendingAck.has(key)).toBe(true);
  });

  it('clears pending state from explicit server acknowledgements', () => {
    const pendingAck = new Map<string, ClientToServerMessage>();
    const message: ClientToServerMessage = {
      type: 'docChange',
      roomId: 'room1',
      docId: 'doc1',
      version: 2,
      patch: {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        text: 'x'
      }
    };

    const key = getClientMessageAckKey(message)!;
    pendingAck.set(key, message);
    pendingAck.delete(key);

    expect(pendingAck.size).toBe(0);
  });
});
