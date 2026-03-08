import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROOM_STORAGE_TTL_MS,
  isStorageEntryStale,
  MAX_ROOM_EVENT_LOG_BYTES,
  trimEventLogContent
} from '../src/core/storageRetention';

describe('storage retention helpers', () => {
  it('marks room storage as stale once the ttl has elapsed', () => {
    expect(isStorageEntryStale(0, DEFAULT_ROOM_STORAGE_TTL_MS + 1, DEFAULT_ROOM_STORAGE_TTL_MS)).toBe(true);
    expect(isStorageEntryStale(100, 100 + DEFAULT_ROOM_STORAGE_TTL_MS, DEFAULT_ROOM_STORAGE_TTL_MS)).toBe(false);
  });

  it('trims oversized event logs from the front on line boundaries', () => {
    const raw = ['line-1', 'line-2', 'line-3', 'line-4'].join('\n') + '\n';
    const trimmed = trimEventLogContent(raw, Buffer.byteLength('line-3\nline-4\n', 'utf8'));

    expect(trimmed).toBe('line-3\nline-4\n');
  });

  it('leaves event logs untouched when they are within the configured size cap', () => {
    const raw = 'short log\n';
    expect(trimEventLogContent(raw, MAX_ROOM_EVENT_LOG_BYTES)).toBe(raw);
  });
});
