export interface RoomAccountingSnapshot {
  ownerIp?: string;
  documents: Iterable<{ text: string }>;
}

export function getNextTotalDocBytes(currentTotalDocBytes: number, previousBytes: number, nextBytes: number): number {
  return currentTotalDocBytes + nextBytes - previousBytes;
}

export function rebuildAccountingFromRooms(
  rooms: Iterable<RoomAccountingSnapshot>
): { totalDocBytes: number; roomCountByIp: Map<string, number> } {
  let totalDocBytes = 0;
  const roomCountByIp = new Map<string, number>();

  for (const room of rooms) {
    for (const document of room.documents) {
      totalDocBytes += Buffer.byteLength(document.text, 'utf8');
    }

    if (room.ownerIp) {
      roomCountByIp.set(room.ownerIp, (roomCountByIp.get(room.ownerIp) ?? 0) + 1);
    }
  }

  return { totalDocBytes, roomCountByIp };
}
