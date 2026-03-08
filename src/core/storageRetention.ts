export const DEFAULT_ROOM_STORAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_ROOM_EVENT_LOG_BYTES = 256 * 1024;

export function isStorageEntryStale(lastUpdatedAt: number, now: number, ttlMs: number): boolean {
  return now - lastUpdatedAt > ttlMs;
}

export function trimEventLogContent(raw: string, maxBytes: number): string {
  const rawBytes = Buffer.byteLength(raw, 'utf8');
  if (rawBytes <= maxBytes) {
    return raw;
  }

  const buffer = Buffer.from(raw, 'utf8');
  const start = rawBytes - maxBytes;
  const tail = buffer.subarray(start).toString('utf8');
  if (start === 0 || buffer[start - 1] === 0x0a) {
    return tail;
  }
  const firstNewline = tail.indexOf('\n');
  if (firstNewline === -1) {
    return tail;
  }
  return tail.slice(firstNewline + 1);
}
