import { describe, expect, it } from 'vitest';
import { prepareRoomClosure } from '../server/roomClosure';

describe('room closure helpers', () => {
  it('clears room state from all live connections and returns peers to notify', () => {
    const owner = { userId: 'owner-1', roomId: 'ROOM1', role: 'root' as const, ws: { close() {} } };
    const collaborator = { userId: 'collab-1', roomId: 'ROOM1', role: 'collaborator' as const, ws: { close() {} } };
    const viewer = { userId: 'viewer-1', roomId: 'ROOM1', role: 'viewer' as const, ws: { close() {} } };

    const peers = prepareRoomClosure([owner, collaborator, viewer], 'owner-1');

    expect(owner.roomId).toBeUndefined();
    expect(owner.role).toBeUndefined();
    expect(collaborator.roomId).toBeUndefined();
    expect(collaborator.role).toBeUndefined();
    expect(viewer.roomId).toBeUndefined();
    expect(viewer.role).toBeUndefined();
    expect(peers).toEqual([collaborator, viewer]);
  });
});
