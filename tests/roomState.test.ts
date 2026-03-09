import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    event = (listener: (e: T) => void) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
    fire(data?: T) {
      this.listeners.forEach(fn => fn(data as T));
    }
    dispose() { this.listeners = []; }
  }
  class Disposable {
    constructor(private readonly _dispose?: () => void) {}
    dispose() { this._dispose?.(); }
  }
  return { EventEmitter, Disposable };
});

import { RoomState } from '../src/core/RoomState';
import type { Participant, Role } from '../src/connection/MessageTypes';

function makeParticipant(id: string, role: Role = 'collaborator'): Participant {
  return { userId: id, displayName: `User ${id}`, role };
}

describe('RoomState', () => {
  it('starts with no room/user info', () => {
    const state = new RoomState();
    expect(state.getRoomId()).toBeUndefined();
    expect(state.getUserId()).toBeUndefined();
    expect(state.getRole()).toBeUndefined();
  });

  it('setSelfInfo sets userId, role, roomId', () => {
    const state = new RoomState();
    state.setSelfInfo('u1', 'root', 'room1', 'Alice');
    expect(state.getUserId()).toBe('u1');
    expect(state.getRole()).toBe('root');
    expect(state.getRoomId()).toBe('room1');
    expect(state.getDisplayName()).toBe('Alice');
    expect(state.isRoot()).toBe(true);
  });

  it('reset clears everything', () => {
    const state = new RoomState();
    state.setSelfInfo('u1', 'root', 'room1');
    state.setParticipants([makeParticipant('u1', 'root'), makeParticipant('u2')]);
    state.setActiveSharedDocLabel('main.ts');
    state.reset();
    expect(state.getRoomId()).toBeUndefined();
    expect(state.getUserId()).toBeUndefined();
    expect(state.getParticipants()).toHaveLength(0);
    expect(state.getActiveSharedDocLabel()).toBeUndefined();
  });

  it('setParticipants replaces participant list', () => {
    const state = new RoomState();
    const list = [makeParticipant('a'), makeParticipant('b')];
    state.setParticipants(list);
    expect(state.getParticipants()).toHaveLength(2);
  });

  it('setParticipants cleans up stale activity and files', () => {
    const state = new RoomState();
    state.setParticipantActivity('old', Date.now());
    state.setParticipantFile('old', 'file.ts');
    state.setParticipants([makeParticipant('new')]);
    expect(state.getParticipantFile('old')).toBeUndefined();
  });

  it('addParticipant replaces existing by userId', () => {
    const state = new RoomState();
    state.setParticipants([makeParticipant('a', 'viewer')]);
    state.addParticipant(makeParticipant('a', 'collaborator'));
    const list = state.getParticipants();
    expect(list).toHaveLength(1);
    expect(list[0].role).toBe('collaborator');
  });

  it('removeParticipant removes by userId', () => {
    const state = new RoomState();
    state.setParticipants([makeParticipant('a'), makeParticipant('b')]);
    state.removeParticipant('a');
    expect(state.getParticipants()).toHaveLength(1);
    expect(state.getParticipants()[0].userId).toBe('b');
  });

  it('removeParticipant cleans up activity and files without duplicates', () => {
    const state = new RoomState();
    state.setParticipants([makeParticipant('a')]);
    state.setParticipantActivity('a', Date.now());
    state.setParticipantFile('a', 'test.ts');
    state.removeParticipant('a');
    expect(state.getParticipantFile('a')).toBeUndefined();
  });

  it('updateParticipantRole changes role', () => {
    const state = new RoomState();
    state.setParticipants([makeParticipant('a', 'viewer')]);
    state.updateParticipantRole('a', 'collaborator');
    expect(state.getParticipants()[0].role).toBe('collaborator');
  });

  it('updateParticipantRole on self updates local role', () => {
    const state = new RoomState();
    state.setSelfInfo('u1', 'viewer', 'room1');
    state.setParticipants([makeParticipant('u1', 'viewer')]);
    state.updateParticipantRole('u1', 'collaborator');
    expect(state.getRole()).toBe('collaborator');
  });

  it('isCollaborator and isViewer work', () => {
    const state = new RoomState();
    state.setSelfInfo('u1', 'collaborator', 'room1');
    expect(state.isCollaborator()).toBe(true);
    expect(state.isViewer()).toBe(false);
    expect(state.isRoot()).toBe(false);
  });

  it('collaborator direct mode tracking', () => {
    const state = new RoomState();
    state.setSelfInfo('u1', 'collaborator', 'room1');
    state.setParticipants([{ userId: 'u1', displayName: 'Me', role: 'collaborator', isDirectEditMode: true }]);
    expect(state.isCollaboratorInDirectMode()).toBe(true);

    state.setCollaboratorMode(false);
    expect(state.isCollaboratorInDirectMode()).toBe(false);
  });

  it('participantActivity typing detection', () => {
    const state = new RoomState();
    state.setParticipantActivity('a', Date.now());
    expect(state.isParticipantTyping('a')).toBe(true);
    expect(state.isParticipantTyping('b')).toBe(false);
  });

  it('tracks and prunes participant activity expirations', () => {
    const state = new RoomState();
    state.setParticipantActivity('a', 1_000);
    state.setParticipantActivity('b', 1_500);

    expect(state.getNextParticipantActivityExpiry(1_600)).toBe(3_000);
    expect(state.pruneExpiredParticipantActivity(3_100)).toBe(true);
    expect(state.getNextParticipantActivityExpiry(3_100)).toBe(3_500);
  });

  it('room mode set and get', () => {
    const state = new RoomState();
    state.setMode('classroom');
    expect(state.getRoomMode()).toBe('classroom');
    state.setMode(undefined);
    expect(state.getRoomMode()).toBeUndefined();
  });

  it('active shared doc label', () => {
    const state = new RoomState();
    state.setActiveSharedDocLabel('main.ts');
    expect(state.getActiveSharedDocLabel()).toBe('main.ts');
    state.setActiveSharedDocLabel(undefined);
    expect(state.getActiveSharedDocLabel()).toBeUndefined();
  });
});
