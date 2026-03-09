import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

var visibleTextEditors: any[];
var createDecorationTypeSpy: ReturnType<typeof vi.fn>;

vi.mock('vscode', () => {
  visibleTextEditors = [];
  createDecorationTypeSpy = vi.fn(() => ({ dispose: vi.fn() }));

  class EventEmitter<T> {
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
  }

  class Disposable {
    constructor(private readonly disposeFn?: () => void) {}
    dispose() {
      this.disposeFn?.();
    }
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
    DecorationRangeBehavior: {
      ClosedClosed: 0
    },
    window: {
      visibleTextEditors,
      createTextEditorDecorationType: createDecorationTypeSpy
    }
  };
});

import { CursorManager } from '../src/core/CursorManager';

describe('CursorManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibleTextEditors.length = 0;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    visibleTextEditors.length = 0;
  });

  it('adds and retrieves cursors', () => {
    const manager = new CursorManager();
    manager.updateCursor('u1', 'Alice', 'file:///test.ts', { line: 0, character: 5 });
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
    manager.updateCursor('u1', 'Alice', 'file:///a.ts', { line: 0, character: 0 });
    manager.updateCursor('u1', 'Alice', 'file:///b.ts', { line: 1, character: 1 });
    expect(() => manager.refreshDecorations()).not.toThrow();
  });

  it('does not repaint identical cursor decorations repeatedly', () => {
    const setDecorations = vi.fn();
    visibleTextEditors.push({
      document: {
        uri: { toString: () => 'file:///test.ts' },
        lineCount: 1,
        lineAt: () => ({ text: 'hello world' })
      },
      setDecorations
    });

    const manager = new CursorManager();
    manager.updateCursor('u1', 'Alice', 'file:///test.ts', { line: 0, character: 5 });
    vi.runAllTimers();

    expect(setDecorations).toHaveBeenCalledTimes(2);

    manager.updateCursor('u1', 'Alice', 'file:///test.ts', { line: 0, character: 5 });
    vi.runAllTimers();

    expect(setDecorations).toHaveBeenCalledTimes(2);

    manager.updateCursor('u1', 'Alice', 'file:///test.ts', { line: 0, character: 6 });
    vi.runAllTimers();

    expect(setDecorations).toHaveBeenCalledTimes(3);
  });
});
