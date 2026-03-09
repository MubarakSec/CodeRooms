import { Suggestion } from '../connection/MessageTypes';

export interface ParticipantsViewRefreshParticipant {
  userId: string;
  displayName: string;
  role: string;
  isDirectEditMode?: boolean;
  isTyping: boolean;
  currentFile?: string;
}

export interface ParticipantsViewRefreshDocument {
  docId: string;
  uri?: string;
  fileName?: string;
  isActive: boolean;
  isPending?: boolean;
}

export interface ParticipantsViewRefreshState {
  roomId?: string;
  role?: string;
  mode?: string;
  collaboratorDirectMode: boolean;
  activeSharedDocLabel?: string;
  isFollowing: boolean;
  activePendingSuggestionCount: number;
  participants: ParticipantsViewRefreshParticipant[];
  documents: ParticipantsViewRefreshDocument[];
  suggestions: Suggestion[];
}

export function buildParticipantsViewRefreshKey(state: ParticipantsViewRefreshState): string {
  return JSON.stringify({
    roomId: state.roomId,
    role: state.role,
    mode: state.mode,
    collaboratorDirectMode: state.collaboratorDirectMode,
    activeSharedDocLabel: state.activeSharedDocLabel,
    isFollowing: state.isFollowing,
    activePendingSuggestionCount: state.activePendingSuggestionCount,
    participants: state.participants
      .map(participant => ({
        userId: participant.userId,
        displayName: participant.displayName,
        role: participant.role,
        isDirectEditMode: participant.isDirectEditMode,
        isTyping: participant.isTyping,
        currentFile: participant.currentFile
      }))
      .sort((left, right) => left.userId.localeCompare(right.userId)),
    documents: state.documents
      .map(document => ({
        docId: document.docId,
        uri: document.uri,
        fileName: document.fileName,
        isActive: document.isActive,
        isPending: Boolean(document.isPending)
      }))
      .sort((left, right) => left.docId.localeCompare(right.docId)),
    suggestions: state.suggestions
      .map(suggestion => ({
        suggestionId: suggestion.suggestionId,
        docId: suggestion.docId,
        authorId: suggestion.authorId,
        authorName: suggestion.authorName,
        createdAt: suggestion.createdAt,
        status: suggestion.status,
        reviewedAt: suggestion.reviewedAt,
        reviewedById: suggestion.reviewedById,
        patchCount: suggestion.patches.length,
        firstPatchRange: suggestion.patches[0]?.range
      }))
      .sort((left, right) => left.suggestionId.localeCompare(right.suggestionId))
  });
}
