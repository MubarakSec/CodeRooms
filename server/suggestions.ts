import { applyPatch } from './patch';
import { VersionedPatch } from './ot';
import { ClientToServerMessage, Participant, Role, Suggestion, SuggestionReviewAction, TextPatch } from './types';

export interface SuggestionParticipant extends Participant {
  isDirectEditMode?: boolean;
}

type SuggestionMessage = Extract<ClientToServerMessage, { type: 'suggestion' }>;

export function canSubmitSuggestion(participant: SuggestionParticipant | undefined): participant is SuggestionParticipant {
  return Boolean(participant && participant.role === 'collaborator' && !participant.isDirectEditMode);
}

export function createPendingSuggestion(message: SuggestionMessage, participant: SuggestionParticipant): Suggestion {
  return {
    suggestionId: message.suggestionId,
    roomId: message.roomId,
    docId: message.docId,
    authorId: participant.userId,
    authorName: participant.displayName,
    patches: message.patches,
    createdAt: message.createdAt,
    status: 'pending'
  };
}

export function isIdempotentSuggestionReplay(
  existing: Suggestion,
  message: SuggestionMessage,
  participant: SuggestionParticipant
): boolean {
  return existing.status === 'pending'
    && existing.roomId === message.roomId
    && existing.docId === message.docId
    && existing.authorId === participant.userId
    && existing.authorName === participant.displayName
    && existing.createdAt === message.createdAt
    && JSON.stringify(existing.patches) === JSON.stringify(message.patches);
}

export function transitionSuggestionStatus(
  suggestion: Suggestion,
  action: SuggestionReviewAction,
  reviewedById: string,
  reviewedAt = Date.now()
): Suggestion {
  return {
    ...suggestion,
    status: action === 'accept' ? 'accepted' : 'rejected',
    reviewedById,
    reviewedAt
  };
}

export function pruneReviewedSuggestions(
  suggestions: Map<string, Suggestion>,
  maxReviewedSuggestions: number
): void {
  const reviewed = Array.from(suggestions.values())
    .filter(suggestion => suggestion.status !== 'pending')
    .sort((left, right) => (left.reviewedAt ?? left.createdAt) - (right.reviewedAt ?? right.createdAt));

  if (reviewed.length <= maxReviewedSuggestions) {
    return;
  }

  for (const suggestion of reviewed.slice(0, reviewed.length - maxReviewedSuggestions)) {
    suggestions.delete(suggestion.suggestionId);
  }
}

export function applySuggestionPatches(
  initialText: string,
  initialVersion: number,
  patches: TextPatch[],
  authorId: string
): { text: string; version: number; history: VersionedPatch[] } | undefined {
  let currentText = initialText;
  let currentVersion = initialVersion;
  const history: VersionedPatch[] = [];

  for (const patch of patches) {
    const nextText = applyPatch(currentText, patch);
    if (!nextText) {
      return undefined;
    }

    currentVersion += 1;
    history.push({
      patch,
      authorId,
      version: currentVersion,
      baseText: currentText
    });
    currentText = nextText;
  }

  return { text: currentText, version: currentVersion, history };
}

export function getPendingSuggestionsForRole(
  suggestions: Iterable<Suggestion>,
  role: Role | undefined
): Suggestion[] {
  if (role !== 'root') {
    return [];
  }

  return Array.from(suggestions).filter(suggestion => suggestion.status === 'pending');
}
