import { applyPatch } from './patch';
import { VersionedPatch } from './ot';
import { ClientToServerMessage, Participant, Role, Suggestion, TextPatch } from './types';

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
