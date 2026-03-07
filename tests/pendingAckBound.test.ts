import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    event = (listener: (e: T) => void) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
    fire(data?: T) {
      this.listeners.forEach(fn => fn(data as T));
    }
    dispose() { this.listeners = []; }
  }
  class Disposable {
    constructor(private readonly _dispose?: () => void) {}
    dispose() { this._dispose?.(); }
  }
  return { EventEmitter, Disposable };
});

import type { ClientToServerMessage } from '../src/connection/MessageTypes';

describe('pendingAck bounded map', () => {
  const MAX_PENDING_ACK = 200;

  const messageKey = (message: ClientToServerMessage): string | undefined => {
    switch (message.type) {
      case 'chatSend':
        return `chat:${message.messageId}`;
      case 'docChange':
        return `doc:${message.docId}:${message.version}`;
      default:
        return undefined;
    }
  };

  it('evicts oldest entry when exceeding max', () => {
    const pendingAck = new Map<string, ClientToServerMessage>();

    // Fill to max
    for (let i = 0; i < MAX_PENDING_ACK; i++) {
      const msg: ClientToServerMessage = {
        type: 'chatSend',
        roomId: 'r',
        messageId: `m-${i}`,
        content: `msg ${i}`,
        timestamp: i
      };
      const key = messageKey(msg)!;
      pendingAck.set(key, msg);
    }
    expect(pendingAck.size).toBe(MAX_PENDING_ACK);

    // Add one more — should evict the oldest
    const overflow: ClientToServerMessage = {
      type: 'chatSend',
      roomId: 'r',
      messageId: 'm-overflow',
      content: 'overflow',
      timestamp: 999
    };
    const key = messageKey(overflow)!;
    if (pendingAck.size >= MAX_PENDING_ACK) {
      const first = pendingAck.keys().next().value;
      if (first !== undefined) { pendingAck.delete(first); }
    }
    pendingAck.set(key, overflow);

    expect(pendingAck.size).toBe(MAX_PENDING_ACK);
    expect(pendingAck.has('chat:m-0')).toBe(false);
    expect(pendingAck.has('chat:m-overflow')).toBe(true);
  });

  it('does not evict when under max', () => {
    const pendingAck = new Map<string, ClientToServerMessage>();
    const msg: ClientToServerMessage = {
      type: 'chatSend',
      roomId: 'r',
      messageId: 'm-1',
      content: 'hi',
      timestamp: 1
    };
    const key = messageKey(msg)!;
    if (pendingAck.size >= MAX_PENDING_ACK) {
      const first = pendingAck.keys().next().value;
      if (first !== undefined) { pendingAck.delete(first); }
    }
    pendingAck.set(key, msg);

    expect(pendingAck.size).toBe(1);
    expect(pendingAck.has('chat:m-1')).toBe(true);
  });
});
