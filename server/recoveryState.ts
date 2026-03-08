import { rebuildAccountingFromRooms } from './accounting';

export interface RecoveryRoomSnapshot {
  ownerIp?: string;
  documents: Iterable<{ text: string }>;
  suggestions: Iterable<unknown>;
  recoverableSessions: Iterable<unknown>;
  chat: Iterable<unknown>;
}

export interface RecoveryMetrics {
  roomCount: number;
  documentCount: number;
  suggestionCount: number;
  recoverableSessionCount: number;
  chatMessageCount: number;
  totalDocBytes: number;
  roomCountByIp: Map<string, number>;
}

export function buildRecoveryMetrics(rooms: Iterable<RecoveryRoomSnapshot>): RecoveryMetrics {
  let roomCount = 0;
  let documentCount = 0;
  let suggestionCount = 0;
  let recoverableSessionCount = 0;
  let chatMessageCount = 0;
  const accountingInput: Array<{ ownerIp?: string; documents: Array<{ text: string }> }> = [];

  for (const room of rooms) {
    roomCount += 1;
    const documents = Array.from(room.documents);
    documentCount += documents.length;
    suggestionCount += Array.from(room.suggestions).length;
    recoverableSessionCount += Array.from(room.recoverableSessions).length;
    chatMessageCount += Array.from(room.chat).length;
    accountingInput.push({ ownerIp: room.ownerIp, documents });
  }

  const accounting = rebuildAccountingFromRooms(accountingInput);
  return {
    roomCount,
    documentCount,
    suggestionCount,
    recoverableSessionCount,
    chatMessageCount,
    totalDocBytes: accounting.totalDocBytes,
    roomCountByIp: accounting.roomCountByIp
  };
}
