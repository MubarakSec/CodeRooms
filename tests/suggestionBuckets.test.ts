import { describe, expect, it } from 'vitest';

import { buildSuggestionChunks, buildSuggestionGroups } from '../src/ui/suggestionBuckets';
import type { Suggestion } from '../src/connection/MessageTypes';

function suggestion(docId: string, createdAt: number, suffix: string): Suggestion {
  return {
    suggestionId: `${docId}-${suffix}`,
    roomId: 'room-1',
    docId,
    authorId: 'u1',
    authorName: 'Casey',
    patches: [{
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 }
      },
      text: suffix
    }],
    createdAt,
    status: 'pending'
  };
}

describe('suggestionBuckets', () => {
  it('groups suggestions by document and sorts groups by latest activity', () => {
    const groups = buildSuggestionGroups([
      suggestion('doc-a', 10, 'a1'),
      suggestion('doc-b', 30, 'b1'),
      suggestion('doc-a', 20, 'a2')
    ]);

    expect(groups.map(group => group.docId)).toEqual(['doc-b', 'doc-a']);
    expect(groups[1]?.suggestions.map(entry => entry.createdAt)).toEqual([20, 10]);
  });

  it('chunks grouped suggestions into stable ranges', () => {
    const chunks = buildSuggestionChunks(Array.from({ length: 27 }, (_, index) => suggestion('doc-a', 100 - index, `s${index + 1}`)));

    expect(chunks.map(chunk => chunk.label)).toEqual(['Suggestions 1-25', 'Suggestions 26-27']);
    expect(chunks[0]?.suggestions).toHaveLength(25);
    expect(chunks[1]?.suggestions).toHaveLength(2);
  });
});
