import { describe, expect, it } from 'vitest';
import {
  isBoundedOptionalString,
  isBoundedString,
  isCursorSelections,
  isNonEmptyBoundedString,
  isParticipantActivity,
  isPositiveVersion,
  isPosition,
  isRoleUpdateValue,
  isRoomMode,
  isSafeTimestamp,
  isSuggestionReviewAction,
  isTextPatch,
  isTextPatchArray,
  validateClientMessage,
  MAX_PATCH_TEXT_LENGTH,
  MAX_CURSOR_SELECTIONS,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_AUTH_FIELD_LENGTH,
  MAX_INVITE_LABEL_LENGTH,
  MAX_ROOM_ID_LENGTH,
  MAX_SHARED_FILE_NAME_LENGTH
} from '../server/protocolValidation';

describe('protocol validation helpers', () => {
  it('accepts only supported room modes and role updates', () => {
    expect(isRoomMode('team')).toBe(true);
    expect(isRoomMode('classroom')).toBe(true);
    expect(isRoomMode('freeform')).toBe(false);

    expect(isRoleUpdateValue('collaborator')).toBe(true);
    expect(isRoleUpdateValue('viewer')).toBe(true);
    expect(isRoleUpdateValue('root')).toBe(false);
  });

  it('accepts only supported participant activities', () => {
    expect(isParticipantActivity('typing')).toBe(true);
    expect(isParticipantActivity('idle')).toBe(true);
    expect(isParticipantActivity('streaming')).toBe(false);
  });

  it('accepts only supported suggestion review actions', () => {
    expect(isSuggestionReviewAction('accept')).toBe(true);
    expect(isSuggestionReviewAction('reject')).toBe(true);
    expect(isSuggestionReviewAction('dismiss')).toBe(false);
  });

  it('validates positions, patch shapes, timestamps, and cursor selection caps', () => {
    expect(isPosition({ line: 2, character: 8 })).toBe(true);
    expect(isPosition({ line: -1, character: 0 })).toBe(false);
    expect(isPosition({ line: 0.5, character: 2 })).toBe(false);
    expect(isTextPatch({
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 }
      },
      text: 'X'
    })).toBe(true);
    expect(isTextPatch({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } })).toBe(false);
    expect(isTextPatch({
      range: {
        start: { line: 2, character: 0 },
        end: { line: 1, character: 5 }
      },
      text: 'X'
    })).toBe(false);
    expect(isTextPatch({
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 }
      },
      text: 'x'.repeat(MAX_PATCH_TEXT_LENGTH + 1)
    })).toBe(false);
    expect(isTextPatchArray([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, text: 'X' }])).toBe(true);
    expect(isTextPatchArray([])).toBe(false);
    expect(isSafeTimestamp(Date.now())).toBe(true);
    expect(isSafeTimestamp(-1)).toBe(false);
    expect(isPositiveVersion(1)).toBe(true);
    expect(isPositiveVersion(0)).toBe(false);

    const validSelections = Array.from({ length: MAX_CURSOR_SELECTIONS }, () => ({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 }
    }));
    const oversizedSelections = Array.from({ length: MAX_CURSOR_SELECTIONS + 1 }, () => ({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 }
    }));

    expect(isCursorSelections(validSelections)).toBe(true);
    expect(isCursorSelections(oversizedSelections)).toBe(false);
    expect(isCursorSelections([{ start: { line: 0, character: 0 }, end: { line: -1, character: 1 } }])).toBe(false);
  });

  it('enforces bounded invite labels and shared file names', () => {
    expect(isBoundedOptionalString('pairing-token', MAX_INVITE_LABEL_LENGTH)).toBe(true);
    expect(isBoundedOptionalString('x'.repeat(MAX_INVITE_LABEL_LENGTH + 1), MAX_INVITE_LABEL_LENGTH)).toBe(false);

    expect(isBoundedString('feature.ts', MAX_SHARED_FILE_NAME_LENGTH)).toBe(true);
    expect(isBoundedString('x'.repeat(MAX_SHARED_FILE_NAME_LENGTH + 1), MAX_SHARED_FILE_NAME_LENGTH)).toBe(false);
    expect(isNonEmptyBoundedString('Alice', MAX_DISPLAY_NAME_LENGTH)).toBe(true);
    expect(isNonEmptyBoundedString('   ', MAX_DISPLAY_NAME_LENGTH)).toBe(false);
  });

  it('accepts valid client message shapes', () => {
    expect(validateClientMessage({
      type: 'createRoom',
      displayName: 'Alice',
      mode: 'team',
      secret: 'shared-secret'
    })).toBe(true);

    expect(validateClientMessage({
      type: 'joinRoom',
      roomId: 'ROOM42',
      displayName: 'Bob',
      sessionToken: 'session-token'
    })).toBe(true);

    expect(validateClientMessage({
      type: 'removeParticipant',
      userId: 'user-2'
    })).toBe(true);

    expect(validateClientMessage({
      type: 'docChange',
      roomId: 'ROOM42',
      docId: 'doc-1',
      version: 3,
      patch: {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 }
        },
        text: 'hello'
      }
    })).toBe(true);

    expect(validateClientMessage({
      type: 'suggestion',
      roomId: 'ROOM42',
      docId: 'doc-1',
      suggestionId: 's-1',
      patches: [{
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 }
        },
        text: 'H'
      }],
      authorId: 'user-2',
      authorName: 'Bob',
      createdAt: Date.now()
    })).toBe(true);

    expect(validateClientMessage({
      type: 'reviewSuggestions',
      roomId: 'ROOM42',
      suggestionIds: ['s-1', 's-2'],
      action: 'reject'
    })).toBe(true);
  });

  it('rejects malformed or abusive client message shapes', () => {
    expect(validateClientMessage({
      type: 'joinRoom',
      roomId: 'x'.repeat(MAX_ROOM_ID_LENGTH + 1),
      displayName: 'Bob'
    })).toBe(false);

    expect(validateClientMessage({
      type: 'joinRoom',
      roomId: 'ROOM42',
      displayName: '   ',
      sessionToken: 'x'.repeat(MAX_AUTH_FIELD_LENGTH + 1)
    })).toBe(false);

    expect(validateClientMessage({
      type: 'docChange',
      roomId: 'ROOM42',
      docId: 'doc-1',
      version: 0,
      patch: {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 }
        },
        text: 'hello'
      }
    })).toBe(false);

    expect(validateClientMessage({
      type: 'suggestion',
      roomId: 'ROOM42',
      docId: 'doc-1',
      suggestionId: 's-1',
      patches: [],
      authorId: 'user-2',
      authorName: 'Bob',
      createdAt: Date.now()
    })).toBe(false);

    expect(validateClientMessage({
      type: 'docChange',
      roomId: 'ROOM42',
      docId: 'doc-1',
      version: 1,
      patch: {
        range: {
          start: { line: 2, character: 1 },
          end: { line: 1, character: 0 }
        },
        text: 'hello'
      }
    })).toBe(false);

    expect(validateClientMessage({
      type: 'cursorUpdate',
      roomId: 'ROOM42',
      userId: 'user-2',
      userName: '   ',
      docId: 'doc-1',
      uri: 'file:///tmp/doc.ts',
      position: { line: 0, character: 1 },
      selections: []
    })).toBe(false);

    expect(validateClientMessage({
      type: 'reviewSuggestions',
      roomId: 'ROOM42',
      suggestionIds: ['s-1', '   '],
      action: 'accept'
    })).toBe(false);

    expect(validateClientMessage({
      type: 'removeParticipant',
      userId: '   '
    })).toBe(false);
  });
});
