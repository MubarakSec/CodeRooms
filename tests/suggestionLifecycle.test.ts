import { describe, expect, it } from 'vitest';
import {
  createPendingSuggestion,
  isIdempotentSuggestionReplay,
  pruneReviewedSuggestions,
  transitionSuggestionStatus
} from '../server/suggestions';

const baseMessage = {
  type: 'suggestion' as const,
  roomId: 'room-1',
  docId: 'doc-1',
  suggestionId: 'suggest-1',
  patches: [{
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 }
    },
    text: 'hello'
  }],
  authorId: 'forged-id',
  authorName: 'forged-name',
  createdAt: 1
};

const participant = {
  userId: 'real-user',
  displayName: 'Real User',
  role: 'collaborator' as const,
  isDirectEditMode: false
};

describe('suggestion lifecycle helpers', () => {
  it('treats exact replays as idempotent but rejects payload drift', () => {
    const pending = createPendingSuggestion(baseMessage, participant);

    expect(isIdempotentSuggestionReplay(pending, baseMessage, participant)).toBe(true);
    expect(isIdempotentSuggestionReplay(
      pending,
      { ...baseMessage, patches: [{ ...baseMessage.patches[0], text: 'different' }] },
      participant
    )).toBe(false);
  });

  it('records explicit reviewed status metadata', () => {
    const pending = createPendingSuggestion(baseMessage, participant);
    const reviewed = transitionSuggestionStatus(pending, 'accept', 'owner-1', 99);

    expect(reviewed.status).toBe('accepted');
    expect(reviewed.reviewedById).toBe('owner-1');
    expect(reviewed.reviewedAt).toBe(99);
  });

  it('prunes the oldest reviewed suggestions while keeping pending items', () => {
    const suggestions = new Map([
      ['pending-1', { ...createPendingSuggestion({ ...baseMessage, suggestionId: 'pending-1' }, participant) }],
      ['accepted-1', { ...createPendingSuggestion({ ...baseMessage, suggestionId: 'accepted-1' }, participant), status: 'accepted' as const, reviewedAt: 10 }],
      ['accepted-2', { ...createPendingSuggestion({ ...baseMessage, suggestionId: 'accepted-2' }, participant), status: 'accepted' as const, reviewedAt: 20 }],
      ['rejected-1', { ...createPendingSuggestion({ ...baseMessage, suggestionId: 'rejected-1' }, participant), status: 'rejected' as const, reviewedAt: 30 }]
    ]);

    pruneReviewedSuggestions(suggestions, 2);

    expect(Array.from(suggestions.keys())).toEqual(['pending-1', 'accepted-2', 'rejected-1']);
  });
});
