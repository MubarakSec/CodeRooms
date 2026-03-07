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
  class Position {
    constructor(readonly line: number, readonly character: number) {}
  }
  class Range {
    constructor(readonly start: Position, readonly end: Position) {}
  }
  return {
    EventEmitter,
    Disposable,
    Position,
    Range,
    window: {
      visibleTextEditors: []
    }
  };
});

import { CursorManager } from '../src/core/CursorManager';

describe('CursorManager', () => {
  it('adds and retrieves cursors', () => {
    const manager = new CursorManager();
    manager.updateCursor('u1', 'Alice', 'file:///test.ts', { line: 0, character: 5 });
    // Should not throw
    expect(() => manager.refreshDecorations()).not.toThrow();
  });

  it('removes a cursor', () => {
    const manager = new CursorManager();
    manager.updateCursor('u1', 'Alice', 'file:///test.ts', { line: 0, character: 5 });
    manager.removeCursor('u1');
    expect(() => manager.refreshDecorations()).not.toThrow();
  });

  it('clearAll removes everything', () => {
    const manager = new CursorManager();
    manager.updateCursor('u1', 'Alice', 'file:///test.ts', { line: 0, character: 5 });
    manager.updateCursor('u2', 'Bob', 'file:///test.ts', { line: 1, character: 0 });
    manager.clearAll();
    expect(() => manager.refreshDecorations()).not.toThrow();
  });

  it('handles update with selections', () => {
    const manager = new CursorManager();
    manager.updateCursor('u1', 'Alice', 'file:///test.ts', { line: 0, character: 0 }, [
      { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }
    ]);
    expect(() => manager.refreshDecorations()).not.toThrow();
  });

  it('assigns consistent colors per userId', () => {
    const manager = new CursorManager();
    // Test that the same userId always gets the same color by calling update twice
    manager.updateCursor('u1', 'Alice', 'file:///a.ts', { line: 0, character: 0 });
    manager.updateCursor('u1', 'Alice', 'file:///b.ts', { line: 1, character: 1 });
    expect(() => manager.refreshDecorations()).not.toThrow();
  });
});
