import { describe, expect, it } from 'vitest';
import {
  canChangeEditMode,
  canEditSharedDocument,
  canPerformOwnerAction,
  canSendChat
} from '../server/authorization';
import { createPendingSuggestion } from '../server/suggestions';

describe('security authorization helpers', () => {
  it('allows owner-only actions only for the room owner', () => {
    expect(canPerformOwnerAction('owner-1', 'owner-1')).toBe(true);
    expect(canPerformOwnerAction('collab-1', 'owner-1')).toBe(false);
  });

  it('allows edit-mode changes only for the owner or the targeted participant', () => {
    expect(canChangeEditMode('owner-1', 'owner-1', 'collab-1')).toBe(true);
    expect(canChangeEditMode('collab-1', 'owner-1', 'collab-1')).toBe(true);
    expect(canChangeEditMode('collab-2', 'owner-1', 'collab-1')).toBe(false);
  });

  it('allows shared-document edits only for the owner or direct-mode collaborators', () => {
    expect(canEditSharedDocument('root')).toBe(true);
    expect(canEditSharedDocument('viewer')).toBe(false);
    expect(canEditSharedDocument('collaborator', { role: 'collaborator', isDirectEditMode: false })).toBe(false);
    expect(canEditSharedDocument('collaborator', { role: 'collaborator', isDirectEditMode: true })).toBe(true);
  });

  it('allows chat only for active non-viewer participants', () => {
    expect(canSendChat(undefined)).toBe(false);
    expect(canSendChat({ role: 'viewer' })).toBe(false);
    expect(canSendChat({ role: 'collaborator' })).toBe(true);
    expect(canSendChat({ role: 'root' })).toBe(true);
  });

  it('builds suggestions from the authenticated participant identity instead of forged wire fields', () => {
    const suggestion = createPendingSuggestion(
      {
        type: 'suggestion',
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
        authorId: 'forged-user',
        authorName: 'Forged Name',
        createdAt: 1
      },
      {
        userId: 'real-user',
        displayName: 'Real User',
        role: 'collaborator',
        isDirectEditMode: false
      }
    );

    expect(suggestion.authorId).toBe('real-user');
    expect(suggestion.authorName).toBe('Real User');
  });
});
