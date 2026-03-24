import { RoomMode, Suggestion } from './types';

export const ROOMS_BACKUP_VERSION = 1;

export interface PersistedDocumentState {
  docId: string;
  text: string;
  version: number;
  originalUri: string;
  fileName: string;
  languageId: string;
}

export interface PersistedRecoverableParticipantState {
  sessionToken: string;
  displayName: string;
  role: 'root' | 'collaborator' | 'viewer';
  isDirectEditMode?: boolean;
}

export interface PersistedChatMessage {
  messageId: string;
  userId: string;
  name: string;
  role: 'root' | 'collaborator' | 'viewer';
  content: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface PersistedRoomState {
  roomId: string;
  ownerId: string;
  ownerSessionToken?: string;
  ownerIp?: string;
  recoverableSessions?: Array<[string, PersistedRecoverableParticipantState]>;
  participants?: Array<[string, PersistedRecoverableParticipantState]>;
  documents: Array<[string, PersistedDocumentState]>;
  suggestions: Array<[string, Suggestion]>;
  mode: RoomMode;
  secretHash?: string;
  chat?: PersistedChatMessage[];
}

interface RoomsBackupEnvelope {
  version: number;
  savedAt: number;
  rooms: Record<string, PersistedRoomState>;
}

export interface ParsedRoomsBackup {
  version: number | 'legacy';
  savedAt?: number;
  rooms: Record<string, PersistedRoomState>;
  skippedRooms: number;
}

export interface AtomicBackupWriter {
  writeFile(path: string, content: string): Promise<void>;
  rename(fromPath: string, toPath: string): Promise<void>;
}

export interface AtomicBackupWriterSync {
  writeFileSync(path: string, content: string): void;
  renameSync(fromPath: string, toPath: string): void;
}

export function serializeRoomsBackup(rooms: Record<string, PersistedRoomState>, savedAt = Date.now()): string {
  const payload: RoomsBackupEnvelope = {
    version: ROOMS_BACKUP_VERSION,
    savedAt,
    rooms
  };
  return JSON.stringify(payload, null, 2);
}

export function parseRoomsBackup(raw: string): ParsedRoomsBackup {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Backup payload must be a JSON object.');
  }

  const candidate = parsed as Record<string, unknown>;
  const hasEnvelope = candidate.version !== undefined || candidate.rooms !== undefined;
  const sourceRooms = hasEnvelope ? candidate.rooms : parsed;

  if (hasEnvelope && candidate.version !== ROOMS_BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${String(candidate.version)}`);
  }
  if (typeof sourceRooms !== 'object' || sourceRooms === null || Array.isArray(sourceRooms)) {
    throw new Error('Backup rooms payload must be an object.');
  }

  const rooms: Record<string, PersistedRoomState> = {};
  let skippedRooms = 0;
  for (const [roomId, room] of Object.entries(sourceRooms)) {
    if (!isPersistedRoomState(room, roomId)) {
      skippedRooms += 1;
      continue;
    }
    rooms[roomId] = room;
  }

  return {
    version: hasEnvelope ? ROOMS_BACKUP_VERSION : 'legacy',
    savedAt: hasEnvelope && typeof candidate.savedAt === 'number' ? candidate.savedAt : undefined,
    rooms,
    skippedRooms
  };
}

export function getCorruptBackupPath(backupFile: string, now = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `${backupFile}.corrupt-${timestamp}`;
}

export async function writeRoomsBackupAtomically(
  writer: AtomicBackupWriter,
  backupFile: string,
  serializedBackup: string
): Promise<void> {
  const tmpFile = `${backupFile}.tmp`;
  await writer.writeFile(tmpFile, serializedBackup);
  await writer.rename(tmpFile, backupFile);
}

export function writeRoomsBackupAtomicallySync(
  writer: AtomicBackupWriterSync,
  backupFile: string,
  serializedBackup: string
): void {
  const tmpFile = `${backupFile}.tmp`;
  writer.writeFileSync(tmpFile, serializedBackup);
  writer.renameSync(tmpFile, backupFile);
}

function isPersistedRoomState(value: unknown, roomId: string): value is PersistedRoomState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate.roomId === roomId
    && typeof candidate.ownerId === 'string'
    && (candidate.ownerSessionToken === undefined || typeof candidate.ownerSessionToken === 'string')
    && (candidate.ownerIp === undefined || typeof candidate.ownerIp === 'string')
    && Array.isArray(candidate.documents)
    && Array.isArray(candidate.suggestions)
    && (candidate.recoverableSessions === undefined || Array.isArray(candidate.recoverableSessions))
    && (candidate.participants === undefined || Array.isArray(candidate.participants))
    && (candidate.mode === 'team' || candidate.mode === 'classroom')
    && (candidate.secretHash === undefined || typeof candidate.secretHash === 'string')
    && (candidate.chat === undefined || Array.isArray(candidate.chat));
}
