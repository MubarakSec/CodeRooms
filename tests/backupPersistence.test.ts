import { describe, expect, it } from 'vitest';
import {
  getCorruptBackupPath,
  parseRoomsBackup,
  ROOMS_BACKUP_VERSION,
  serializeRoomsBackup
} from '../server/backupPersistence';

const persistedRoom = {
  roomId: 'ROOM1',
  ownerId: 'owner-1',
  ownerSessionToken: 'session-1',
  ownerIp: '127.0.0.1',
  recoverableSessions: [],
  documents: [],
  suggestions: [],
  mode: 'team' as const,
  secretHash: undefined,
  chat: []
};

describe('backup persistence helpers', () => {
  it('serializes and parses the current backup envelope', () => {
    const raw = serializeRoomsBackup({ ROOM1: persistedRoom }, 123);
    const parsed = parseRoomsBackup(raw);

    expect(parsed.version).toBe(ROOMS_BACKUP_VERSION);
    expect(parsed.savedAt).toBe(123);
    expect(parsed.skippedRooms).toBe(0);
    expect(parsed.rooms.ROOM1?.ownerSessionToken).toBe('session-1');
  });

  it('accepts the legacy room map format', () => {
    const raw = JSON.stringify({ ROOM1: persistedRoom });
    const parsed = parseRoomsBackup(raw);

    expect(parsed.version).toBe('legacy');
    expect(parsed.rooms.ROOM1?.roomId).toBe('ROOM1');
  });

  it('skips malformed room records instead of failing the whole backup', () => {
    const raw = JSON.stringify({
      version: ROOMS_BACKUP_VERSION,
      savedAt: 123,
      rooms: {
        ROOM1: persistedRoom,
        ROOM2: { roomId: 'ROOM2', ownerId: 'missing-fields' }
      }
    });

    const parsed = parseRoomsBackup(raw);

    expect(Object.keys(parsed.rooms)).toEqual(['ROOM1']);
    expect(parsed.skippedRooms).toBe(1);
  });

  it('builds a deterministic corrupt-backup quarantine path', () => {
    const corruptPath = getCorruptBackupPath('/tmp/rooms-backup.json', new Date('2026-03-08T11:10:00.000Z'));
    expect(corruptPath).toBe('/tmp/rooms-backup.json.corrupt-2026-03-08T11-10-00-000Z');
  });
});
