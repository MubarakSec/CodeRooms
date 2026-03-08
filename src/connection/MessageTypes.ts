// Re-export shared protocol types — single source of truth in shared/protocol.ts
export {
  Role,
  RoomMode,
  Participant,
  Position,
  TextPatch,
  Suggestion,
  SuggestionReviewAction,
  ClientToServerMessage,
  ServerToClientMessage
} from '../../shared/protocol';

export interface EncryptedPayload {
  iv: string;
  data: string;
  authTag: string;
}
