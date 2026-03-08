import { describe, it, expect } from 'vitest';
import { getNextTotalDocBytes, rebuildAccountingFromRooms } from '../server/accounting';
import { applySuggestionPatches, canSubmitSuggestion, createPendingSuggestion, getPendingSuggestionsForRole } from '../server/suggestions';

describe('server accounting helpers', () => {
  it('rebuilds total document bytes and room counts from restored rooms', () => {
    const accounting = rebuildAccountingFromRooms([
      {
        ownerIp: '10.0.0.1',
        documents: [{ text: 'alpha' }, { text: 'beta' }]
      },
      {
        ownerIp: '10.0.0.1',
        documents: [{ text: 'gamma' }]
      },
      {
        ownerIp: '10.0.0.2',
        documents: []
      }
    ]);

    expect(accounting.totalDocBytes).toBe(
      Buffer.byteLength('alpha', 'utf8') +
      Buffer.byteLength('beta', 'utf8') +
      Buffer.byteLength('gamma', 'utf8')
    );
    expect(accounting.roomCountByIp.get('10.0.0.1')).toBe(2);
    expect(accounting.roomCountByIp.get('10.0.0.2')).toBe(1);
  });

  it('calculates total document byte deltas correctly', () => {
    const next = getNextTotalDocBytes(100, 'old', 'much newer text');
    expect(next).toBe(100 - Buffer.byteLength('old', 'utf8') + Buffer.byteLength('much newer text', 'utf8'));
  });
});

describe('server suggestion helpers', () => {
  it('only allows collaborators in suggestion mode to submit suggestions', () => {
    expect(canSubmitSuggestion(undefined)).toBe(false);
    expect(canSubmitSuggestion({ userId: 'v', displayName: 'Viewer', role: 'viewer' })).toBe(false);
    expect(canSubmitSuggestion({ userId: 'c', displayName: 'Direct', role: 'collaborator', isDirectEditMode: true })).toBe(false);
    expect(canSubmitSuggestion({ userId: 'c2', displayName: 'Suggest', role: 'collaborator', isDirectEditMode: false })).toBe(true);
  });

  it('uses the authenticated participant identity instead of trusting the wire payload', () => {
    const suggestion = createPendingSuggestion(
      {
        type: 'suggestion',
        roomId: 'room1',
        docId: 'doc1',
        suggestionId: 's1',
        patches: [],
        authorId: 'forged-user',
        authorName: 'forged-name',
        createdAt: 1
      },
      {
        userId: 'real-user',
        displayName: 'Real Name',
        role: 'collaborator',
        isDirectEditMode: false
      }
    );

    expect(suggestion.authorId).toBe('real-user');
    expect(suggestion.authorName).toBe('Real Name');
  });

  it('applies accepted suggestion patches sequentially', () => {
    const applied = applySuggestionPatches(
      'abc',
      1,
      [
        {
          range: { start: { line: 0, character: 3 }, end: { line: 0, character: 3 } },
          text: 'd'
        },
        {
          range: { start: { line: 0, character: 3 }, end: { line: 0, character: 4 } },
          text: 'D'
        }
      ],
      'collab-1'
    );

    expect(applied).toBeDefined();
    expect(applied?.text).toBe('abcD');
    expect(applied?.version).toBe(3);
    expect(applied?.history).toHaveLength(2);
    expect(applied?.history[0]?.baseText).toBe('abc');
    expect(applied?.history[1]?.baseText).toBe('abcd');
  });

  it('only replays pending suggestions to the room owner', () => {
    const suggestions = [
      {
        suggestionId: 's1',
        roomId: 'room1',
        docId: 'doc1',
        authorId: 'user1',
        authorName: 'Casey',
        patches: [],
        createdAt: 1,
        status: 'pending' as const
      },
      {
        suggestionId: 's2',
        roomId: 'room1',
        docId: 'doc1',
        authorId: 'user2',
        authorName: 'Taylor',
        patches: [],
        createdAt: 2,
        status: 'rejected' as const
      }
    ];

    expect(getPendingSuggestionsForRole(suggestions, 'root').map(suggestion => suggestion.suggestionId)).toEqual(['s1']);
    expect(getPendingSuggestionsForRole(suggestions, 'collaborator')).toEqual([]);
  });
});
