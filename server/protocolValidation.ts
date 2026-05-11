import { ClientToServerMessage, Position, Role, RoomMode, SuggestionReviewAction, TextPatch } from './types';

export const MAX_CURSOR_SELECTIONS = 20;
export const MAX_DISPLAY_NAME_LENGTH = 50;
export const MAX_PATCH_BATCH_LENGTH = 500;
export const MAX_BULK_SUGGESTION_REVIEW_COUNT = 200;
export const MAX_INVITE_LABEL_LENGTH = 80;
export const MAX_LANGUAGE_ID_LENGTH = 128;
export const MAX_ROOM_ID_LENGTH = 64;
export const MAX_AUTH_FIELD_LENGTH = 128;
export const MAX_PATCH_TEXT_LENGTH = 128 * 1024;
export const MAX_SHARED_FILE_NAME_LENGTH = 255;
export const MAX_SIMPLE_ID_LENGTH = 128;
export const MAX_URI_LENGTH = 4096;

export function isRoomMode(value: unknown): value is RoomMode {
  return value === 'team' || value === 'classroom';
}

export function isParticipantActivity(value: unknown): value is 'typing' | 'idle' {
  return value === 'typing' || value === 'idle';
}

export function isRoleUpdateValue(value: unknown): value is Extract<Role, 'collaborator' | 'viewer'> {
  return value === 'collaborator' || value === 'viewer';
}

export function isSuggestionReviewAction(value: unknown): value is SuggestionReviewAction {
  return value === 'accept' || value === 'reject';
}

export function isPosition(value: unknown): value is Position {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return Number.isInteger(candidate.line)
    && Number.isInteger(candidate.character)
    && Number(candidate.line) >= 0
    && Number(candidate.character) >= 0;
}

function comparePositions(left: Position, right: Position): number {
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  return left.character - right.character;
}

function hasOrderedPositionRange(start: Position, end: Position): boolean {
  return comparePositions(start, end) <= 0;
}

export function isCursorSelections(
  value: unknown
): value is Array<{ start: Position; end: Position }> | undefined {
  if (value === undefined) {
    return true;
  }
  if (!Array.isArray(value) || value.length > MAX_CURSOR_SELECTIONS) {
    return false;
  }
  return value.every(selection => {
    if (typeof selection !== 'object' || selection === null) {
      return false;
    }
    const candidate = selection as Record<string, unknown>;
    return isPosition(candidate.start)
      && isPosition(candidate.end)
      && hasOrderedPositionRange(candidate.start, candidate.end);
  });
}

export function isBoundedOptionalString(value: unknown, maxLength: number): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength);
}

export function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

export function isNonEmptyBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

export function isSafeTimestamp(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number.isSafeInteger(value);
}

export function isPositiveVersion(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number.isSafeInteger(value);
}

export function isTextPatch(value: unknown): value is TextPatch {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.text !== 'string' || candidate.text.length > MAX_PATCH_TEXT_LENGTH) {
    return false;
  }
  if (typeof candidate.range !== 'object' || candidate.range === null) {
    return false;
  }
  const range = candidate.range as Record<string, unknown>;
  return isPosition(range.start)
    && isPosition(range.end)
    && hasOrderedPositionRange(range.start, range.end);
}

function isBoundedStringArray(value: unknown, maxItems: number, maxItemLength: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every(item => isNonEmptyBoundedString(item, maxItemLength));
}

export function isTextPatchArray(
  value: unknown,
  {
    allowEmpty = false,
    maxLength = MAX_PATCH_BATCH_LENGTH
  }: {
    allowEmpty?: boolean;
    maxLength?: number;
  } = {}
): value is TextPatch[] {
  if (!Array.isArray(value)) {
    return false;
  }
  if (value.length > maxLength) {
    return false;
  }
  if (!allowEmpty && value.length === 0) {
    return false;
  }
  return value.every(isTextPatch);
}

export function validateClientMessage(msg: unknown): msg is ClientToServerMessage {
  if (typeof msg !== 'object' || msg === null || !('type' in msg)) {
    return false;
  }

  const m = msg as Record<string, unknown>;
  const optionalId = (value: unknown): boolean => value === undefined || isNonEmptyBoundedString(value, MAX_SIMPLE_ID_LENGTH);
  const optionalDisplayName = (value: unknown): boolean => value === undefined || isNonEmptyBoundedString(value, MAX_DISPLAY_NAME_LENGTH);

  switch (m.type) {
    case 'createRoom':
      return isNonEmptyBoundedString(m.displayName, MAX_DISPLAY_NAME_LENGTH)
        && (m.mode === undefined || isRoomMode(m.mode))
        && isBoundedOptionalString(m.secret, MAX_AUTH_FIELD_LENGTH);
    case 'joinRoom':
      return isNonEmptyBoundedString(m.roomId, MAX_ROOM_ID_LENGTH)
        && isNonEmptyBoundedString(m.displayName, MAX_DISPLAY_NAME_LENGTH)
        && isBoundedOptionalString(m.secret, MAX_AUTH_FIELD_LENGTH)
        && isBoundedOptionalString(m.token, MAX_AUTH_FIELD_LENGTH)
        && isBoundedOptionalString(m.sessionToken, MAX_AUTH_FIELD_LENGTH);
    case 'leaveRoom':
      return true;
    case 'removeParticipant':
      return isNonEmptyBoundedString(m.userId, MAX_SIMPLE_ID_LENGTH);
    case 'updateRole':
      return isNonEmptyBoundedString(m.userId, MAX_SIMPLE_ID_LENGTH) && isRoleUpdateValue(m.role);
    case 'shareDocument':
      return isNonEmptyBoundedString(m.roomId, MAX_ROOM_ID_LENGTH)
        && isNonEmptyBoundedString(m.docId, MAX_SIMPLE_ID_LENGTH)
        && isNonEmptyBoundedString(m.originalUri, MAX_URI_LENGTH)
        && isNonEmptyBoundedString(m.fileName, MAX_SHARED_FILE_NAME_LENGTH)
        && isNonEmptyBoundedString(m.languageId, MAX_LANGUAGE_ID_LENGTH)
        && typeof m.text === 'string'
        && isPositiveVersion(m.version);
    case 'unshareDocument':
      return isNonEmptyBoundedString(m.roomId, MAX_ROOM_ID_LENGTH)
        && isNonEmptyBoundedString(m.documentId, MAX_SIMPLE_ID_LENGTH);
    case 'docChange':
      return isNonEmptyBoundedString(m.roomId, MAX_ROOM_ID_LENGTH)
        && isNonEmptyBoundedString(m.docId, MAX_SIMPLE_ID_LENGTH)
        && isPositiveVersion(m.version)
        && isTextPatch(m.patch);
    case 'suggestion':
      return isNonEmptyBoundedString(m.roomId, MAX_ROOM_ID_LENGTH)
        && isNonEmptyBoundedString(m.docId, MAX_SIMPLE_ID_LENGTH)
        && isNonEmptyBoundedString(m.suggestionId, MAX_SIMPLE_ID_LENGTH)
        && isTextPatchArray(m.patches, { maxLength: MAX_PATCH_BATCH_LENGTH })
        && isNonEmptyBoundedString(m.authorId, MAX_SIMPLE_ID_LENGTH)
        && isNonEmptyBoundedString(m.authorName, MAX_DISPLAY_NAME_LENGTH)
        && isSafeTimestamp(m.createdAt);
    case 'acceptSuggestion':
    case 'rejectSuggestion':
      return isNonEmptyBoundedString(m.roomId, MAX_ROOM_ID_LENGTH)
        && isNonEmptyBoundedString(m.suggestionId, MAX_SIMPLE_ID_LENGTH);
    case 'reviewSuggestions':
      return isNonEmptyBoundedString(m.roomId, MAX_ROOM_ID_LENGTH)
        && isBoundedStringArray(m.suggestionIds, MAX_BULK_SUGGESTION_REVIEW_COUNT, MAX_SIMPLE_ID_LENGTH)
        && isSuggestionReviewAction(m.action);
    case 'setEditMode':
      return isNonEmptyBoundedString(m.userId, MAX_SIMPLE_ID_LENGTH) && typeof m.direct === 'boolean';
    case 'requestFullSync':
      return isNonEmptyBoundedString(m.roomId, MAX_ROOM_ID_LENGTH)
        && isNonEmptyBoundedString(m.docId, MAX_SIMPLE_ID_LENGTH);
    case 'fullDocumentSync':
      return isNonEmptyBoundedString(m.roomId, MAX_ROOM_ID_LENGTH)
        && isNonEmptyBoundedString(m.docId, MAX_SIMPLE_ID_LENGTH)
        && typeof m.text === 'string'
        && isPositiveVersion(m.version);
    case 'rootCursor':
      return isNonEmptyBoundedString(m.roomId, MAX_ROOM_ID_LENGTH)
        && isNonEmptyBoundedString(m.docId, MAX_SIMPLE_ID_LENGTH)
        && isNonEmptyBoundedString(m.uri, MAX_URI_LENGTH)
        && isPosition(m.position);
    case 'cursorUpdate':
      return isNonEmptyBoundedString(m.roomId, MAX_ROOM_ID_LENGTH)
        && optionalId(m.userId)
        && optionalDisplayName(m.userName)
        && isNonEmptyBoundedString(m.docId, MAX_SIMPLE_ID_LENGTH)
        && isNonEmptyBoundedString(m.uri, MAX_URI_LENGTH)
        && isPosition(m.position)
        && isCursorSelections(m.selections);
    case 'participantActivity':
      return isNonEmptyBoundedString(m.roomId, MAX_ROOM_ID_LENGTH)
        && isNonEmptyBoundedString(m.userId, MAX_SIMPLE_ID_LENGTH)
        && isParticipantActivity(m.activity)
        && isSafeTimestamp(m.at);
    case 'awarenessUpdate':
      return isNonEmptyBoundedString(m.roomId, MAX_ROOM_ID_LENGTH)
        && isNonEmptyBoundedString(m.docId, MAX_SIMPLE_ID_LENGTH)
        && (m.update instanceof Uint8Array || Buffer.isBuffer(m.update));
    case 'voiceSignal':
      return isNonEmptyBoundedString(m.roomId, MAX_ROOM_ID_LENGTH)
        && isNonEmptyBoundedString(m.targetUserId, MAX_SIMPLE_ID_LENGTH)
        && m.signal !== undefined;
    case 'chatSend':
      return isNonEmptyBoundedString(m.roomId, MAX_ROOM_ID_LENGTH)
        && isNonEmptyBoundedString(m.messageId, MAX_SIMPLE_ID_LENGTH)
        && typeof m.content === 'string'
        && isSafeTimestamp(m.timestamp);
    case 'createToken':
      return isBoundedOptionalString(m.label, MAX_INVITE_LABEL_LENGTH);
    default:
      return false;
  }
}
