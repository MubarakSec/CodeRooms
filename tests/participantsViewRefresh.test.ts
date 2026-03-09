import { describe, expect, it } from 'vitest';

import { buildParticipantsViewRefreshKey } from '../src/ui/participantsViewRefresh';
import type { Suggestion } from '../src/connection/MessageTypes';

function suggestion(text: string, line: number): Suggestion {
  return {
    suggestionId: `s-${line}`,
    roomId: 'room-1',
    docId: 'doc-1',
    authorId: 'u1',
    authorName: 'Casey',
    patches: [{
      range: {
        start: { line, character: 0 },
        end: { line, character: 1 }
      },
      text
    }],
    createdAt: line,
    status: 'pending'
  };
}

describe('participantsViewRefresh', () => {
  it('ignores patch text changes that do not affect the rendered review tree shape', () => {
    const baseState = {
      roomId: 'room-1',
      role: 'root',
      mode: 'team',
      collaboratorDirectMode: false,
      activeSharedDocLabel: 'main.ts',
      isFollowing: false,
      activePendingSuggestionCount: 0,
      participants: [],
      documents: [],
      suggestions: [suggestion('alpha', 1)]
    };

    const first = buildParticipantsViewRefreshKey(baseState);
    const second = buildParticipantsViewRefreshKey({
      ...baseState,
      suggestions: [suggestion('beta', 1)]
    });

    expect(first).toBe(second);
  });

  it('changes when the rendered suggestion location or count changes', () => {
    const baseState = {
      roomId: 'room-1',
      role: 'root',
      mode: 'team',
      collaboratorDirectMode: false,
      activeSharedDocLabel: 'main.ts',
      isFollowing: false,
      activePendingSuggestionCount: 0,
      participants: [],
      documents: [],
      suggestions: [suggestion('alpha', 1)]
    };

    const moved = buildParticipantsViewRefreshKey({
      ...baseState,
      suggestions: [suggestion('alpha', 2)]
    });
    const expanded = buildParticipantsViewRefreshKey({
      ...baseState,
      suggestions: [{
        ...suggestion('alpha', 1),
        patches: [
          suggestion('alpha', 1).patches[0],
          suggestion('beta', 2).patches[0]
        ]
      }]
    });

    expect(buildParticipantsViewRefreshKey(baseState)).not.toBe(moved);
    expect(buildParticipantsViewRefreshKey(baseState)).not.toBe(expanded);
  });
});
