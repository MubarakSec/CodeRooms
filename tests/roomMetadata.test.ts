import { describe, expect, it } from 'vitest';
import {
  createDefaultRoomMetadata,
  parseRoomMetadata,
  ROOM_METADATA_VERSION,
  serializeRoomMetadata
} from '../src/core/roomMetadata';

describe('room metadata helpers', () => {
  it('serializes and parses the current metadata envelope', () => {
    const metadata = {
      roomId: 'ROOM1',
      mode: 'team' as const,
      documents: [{
        docId: 'doc-1',
        originalUri: 'file:///original.ts',
        fileName: 'original.ts',
        localUri: 'file:///local.ts',
        lastVersion: 3
      }],
      createdAt: 100,
      lastUpdatedAt: 200
    };

    const raw = serializeRoomMetadata(metadata);
    const parsed = parseRoomMetadata(raw, 'ROOM1');

    expect(parsed).toEqual(metadata);
  });

  it('accepts legacy room metadata format', () => {
    const raw = JSON.stringify({
      roomId: 'ROOM1',
      mode: 'classroom',
      documents: [],
      createdAt: 10,
      lastUpdatedAt: 20
    });

    const parsed = parseRoomMetadata(raw, 'ROOM1');

    expect(parsed.mode).toBe('classroom');
    expect(parsed.documents).toEqual([]);
  });

  it('throws for unsupported metadata versions or malformed payloads', () => {
    expect(() => parseRoomMetadata(JSON.stringify({ version: 99, metadata: {} }), 'ROOM1')).toThrow(
      `Unsupported room metadata version: 99`
    );
    expect(() => parseRoomMetadata(JSON.stringify({ version: ROOM_METADATA_VERSION, metadata: { roomId: 'ROOM1' } }), 'ROOM1')).toThrow(
      'Invalid room metadata for ROOM1.'
    );
  });

  it('creates default metadata with current timestamps', () => {
    const metadata = createDefaultRoomMetadata('ROOM1', 123);
    expect(metadata).toEqual({
      roomId: 'ROOM1',
      mode: undefined,
      documents: [],
      createdAt: 123,
      lastUpdatedAt: 123
    });
  });
});
