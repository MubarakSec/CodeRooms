import { Suggestion } from '../connection/MessageTypes';

export const SUGGESTION_CHUNK_SIZE = 25;

export interface SuggestionGroupPlan {
  docId: string;
  suggestions: Suggestion[];
  latestCreatedAt: number;
}

export interface SuggestionChunkPlan {
  docId: string;
  suggestions: Suggestion[];
  start: number;
  end: number;
  label: string;
}

export function buildSuggestionGroups(suggestions: Suggestion[]): SuggestionGroupPlan[] {
  const grouped = new Map<string, Suggestion[]>();
  for (const suggestion of suggestions) {
    const existing = grouped.get(suggestion.docId);
    if (existing) {
      existing.push(suggestion);
    } else {
      grouped.set(suggestion.docId, [suggestion]);
    }
  }

  return Array.from(grouped.entries())
    .map(([docId, entries]) => {
      const sorted = [...entries].sort((left, right) => right.createdAt - left.createdAt);
      return {
        docId,
        suggestions: sorted,
        latestCreatedAt: sorted[0]?.createdAt ?? 0
      };
    })
    .sort((left, right) => right.latestCreatedAt - left.latestCreatedAt);
}

export function buildSuggestionChunks(
  suggestions: Suggestion[],
  chunkSize = SUGGESTION_CHUNK_SIZE
): SuggestionChunkPlan[] {
  if (chunkSize <= 0 || suggestions.length === 0) {
    return [{
      docId: suggestions[0]?.docId ?? '',
      suggestions,
      start: 1,
      end: suggestions.length,
      label: `Suggestions 1-${suggestions.length}`
    }];
  }

  const chunks: SuggestionChunkPlan[] = [];
  for (let start = 0; start < suggestions.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, suggestions.length);
    chunks.push({
      docId: suggestions[start]!.docId,
      suggestions: suggestions.slice(start, end),
      start: start + 1,
      end,
      label: `Suggestions ${start + 1}-${end}`
    });
  }
  return chunks;
}
