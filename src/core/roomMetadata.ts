import { Role, RoomMode } from '../connection/MessageTypes';

export const ROOM_METADATA_VERSION = 1;

export interface RoomDocumentEntry {
  docId: string;
  originalUri: string;
  fileName: string;
  localUri: string;
  lastVersion: number;
}

export interface RoomEvent {
  type: 'joined' | 'left' | 'roleChanged' | 'suggestionCreated' | 'suggestionAccepted' | 'suggestionRejected';
  roomId: string;
  userId?: string;
  fromRole?: Role;
  toRole?: Role;
  suggestionId?: string;
  docId?: string;
  timestamp: number;
}

export interface RoomMetadata {
  roomId: string;
  mode?: RoomMode;
  documents: RoomDocumentEntry[];
  createdAt: number;
  lastUpdatedAt: number;
}

interface RoomMetadataEnvelope {
  version: number;
  metadata: RoomMetadata;
}

export function createDefaultRoomMetadata(roomId: string, now = Date.now()): RoomMetadata {
  return {
    roomId,
    mode: undefined,
    documents: [],
    createdAt: now,
    lastUpdatedAt: now
  };
}

export function serializeRoomMetadata(metadata: RoomMetadata): string {
  const payload: RoomMetadataEnvelope = {
    version: ROOM_METADATA_VERSION,
    metadata
  };
  return JSON.stringify(payload, null, 2);
}

export function parseRoomMetadata(raw: string, roomId: string, now = Date.now()): RoomMetadata {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Room metadata must be an object.');
  }

  const candidate = parsed as Record<string, unknown>;
  const hasEnvelope = candidate.version !== undefined || candidate.metadata !== undefined;
  if (hasEnvelope && candidate.version !== ROOM_METADATA_VERSION) {
    throw new Error(`Unsupported room metadata version: ${String(candidate.version)}`);
  }
  const metadata = hasEnvelope ? candidate.metadata : parsed;
  if (!isRoomMetadata(metadata, roomId)) {
    throw new Error(`Invalid room metadata for ${roomId}.`);
  }

  const normalized = metadata as RoomMetadata;
  return {
    roomId: normalized.roomId,
    mode: normalized.mode,
    documents: normalized.documents,
    createdAt: normalized.createdAt || now,
    lastUpdatedAt: normalized.lastUpdatedAt || now
  };
}

function isRoomMetadata(value: unknown, roomId: string): value is RoomMetadata {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.roomId === roomId
    && (candidate.mode === undefined || candidate.mode === 'team' || candidate.mode === 'classroom')
    && Array.isArray(candidate.documents)
    && candidate.documents.every(isRoomDocumentEntry)
    && typeof candidate.createdAt === 'number'
    && typeof candidate.lastUpdatedAt === 'number';
}

function isRoomDocumentEntry(value: unknown): value is RoomDocumentEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.docId === 'string'
    && typeof candidate.originalUri === 'string'
    && typeof candidate.fileName === 'string'
    && typeof candidate.localUri === 'string'
    && typeof candidate.lastVersion === 'number';
}
