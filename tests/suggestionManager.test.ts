import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  class Range {
    constructor(
      public startLine: number,
      public startCharacter: number,
      public endLine: number,
      public endCharacter: number
    ) {}
  }

  class MarkdownString {
    value = '';
    isTrusted = false;
    appendMarkdown(text: string) {
      this.value += text;
    }
    appendCodeblock(text: string) {
      this.value += text;
    }
  }

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
    constructor(private readonly onDispose?: () => void) {}
    dispose() {
      this.onDispose?.();
    }
  }

  return {
    Range,
    MarkdownString,
    EventEmitter,
    Disposable,
    OverviewRulerLane: { Left: 1 },
    window: {
      createTextEditorDecorationType: () => ({ dispose: () => {} }),
      onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
      activeTextEditor: undefined
    },
    workspace: {
      onDidChangeTextDocument: () => ({ dispose: () => {} })
    }
  };
});

import { SuggestionManager } from '../src/core/SuggestionManager';

const suggestion = {
  suggestionId: 'suggest-1',
  roomId: 'room-1',
  docId: 'doc-1',
  authorId: 'user-2',
  authorName: 'Casey',
  patches: [],
  createdAt: Date.now(),
  status: 'pending' as const
};

describe('SuggestionManager', () => {
  it('keeps a new suggestion pending without forcing an accept or reject prompt', async () => {
    const manager = new SuggestionManager({ isRoot: () => true } as any);
    const isNewSuggestion = manager.handleSuggestion(suggestion);
    await Promise.resolve();

    expect(isNewSuggestion).toBe(true);
    expect(manager.getSuggestions()).toHaveLength(1);
  });

  it('rejectAllPending routes every suggestion through the reject handler', async () => {
    const manager = new SuggestionManager({ isRoot: () => true } as any);
    const rejectSpy = vi.fn(async () => {});
    manager.setHandlers(async () => {}, rejectSpy);
    manager.replaceAll([
      suggestion,
      { ...suggestion, suggestionId: 'suggest-2', authorName: 'Taylor' }
    ]);

    const count = await manager.rejectAllPending();

    expect(count).toBe(2);
    expect(rejectSpy).toHaveBeenCalledTimes(2);
    expect(rejectSpy.mock.calls[0]?.[0].suggestionId).toBe('suggest-1');
    expect(rejectSpy.mock.calls[1]?.[0].suggestionId).toBe('suggest-2');
  });

  it('replaceAll refreshes suggestions without prompting for each replayed suggestion', () => {
    const manager = new SuggestionManager({ isRoot: () => true } as any);

    manager.replaceAll([suggestion]);

    expect(manager.getSuggestions()).toHaveLength(1);
  });

  it('ignores duplicate new-suggestion events after the first insert', () => {
    const manager = new SuggestionManager({ isRoot: () => true } as any);

    const first = manager.handleSuggestion(suggestion);
    const second = manager.handleSuggestion(suggestion);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(manager.getSuggestions()).toHaveLength(1);
  });
});
