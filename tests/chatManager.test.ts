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
    dispose() {
      this.listeners = [];
    }
  }
  class Disposable {
    constructor(private readonly _dispose?: () => void) {}
    dispose() {
      this._dispose?.();
    }
  }
  return { EventEmitter, Disposable };
});

import { ChatManager } from '../src/core/ChatManager';

class FakeMemento implements import('vscode').Memento {
  private store = new Map<string, any>();
  get<T>(key: string): T | undefined {
    return this.store.get(key);
  }
  update(key: string, value: any): Thenable<void> {
    this.store.set(key, value);
    return Promise.resolve();
  }
}

const fakeMessage = (id: number) => ({
  messageId: `m-${id}`,
  fromUserId: 'u',
  fromName: 'User',
  role: 'collaborator' as const,
  content: `msg ${id}`,
  timestamp: id
});

describe('ChatManager', () => {
  it('keeps only the last 200 messages in memory and persistence', async () => {
    const memento = new FakeMemento();
    const manager = new ChatManager(memento);
    manager.setRoom('r1');

    for (let i = 0; i < 250; i++) {
      manager.addMessage(fakeMessage(i));
    }

    const msgs = manager.getMessages();
    expect(msgs.length).toBe(200);
    expect(msgs[0].messageId).toBe('m-50');

    // ensure persisted slice is also capped
    const persisted = memento.get<any[]>('coderooms.chat.r1');
    expect(persisted?.length).toBe(200);
    expect(persisted?.[0]?.messageId).toBe('m-50');
  });

  it('restores only the latest messages up to the cap', () => {
    const memento = new FakeMemento();
    const stored = Array.from({ length: 300 }).map((_, i) => fakeMessage(i));
    void memento.update('coderooms.chat.r2', stored);

    const manager = new ChatManager(memento);
    manager.setRoom('r2');
    const msgs = manager.getMessages();

    expect(msgs.length).toBe(200);
    expect(msgs[0].messageId).toBe('m-100');
  });
});
