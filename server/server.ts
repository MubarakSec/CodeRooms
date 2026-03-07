import { createHash } from 'crypto';
import fs from 'fs';
import minimist from 'minimist';
import { v4 as uuidv4 } from 'uuid';
import { WebSocket, WebSocketServer } from 'ws';
import {
  ClientToServerMessage,
  Participant,
  Role,
  RoomMode,
  ServerToClientMessage,
  Suggestion
} from './types';
import { log } from './logger';
import { applyPatch, applyPatches } from './patch';
import { RateLimiter } from './rateLimiter';
import path from 'path';
import { pack, unpack } from 'msgpackr';

type ParticipantState = Participant & { isDirectEditMode?: boolean };

interface DocumentState {
  docId: string;
  text: string;
  version: number;
  originalUri: string;
  fileName: string;
  languageId: string;
}

interface ConnectionContext {
  ws: WebSocket;
  userId: string;
  displayName?: string;
  role?: Role;
  roomId?: string;
  ip?: string;
}

interface RoomState {
  roomId: string;
  ownerId: string;
  participants: Map<string, ParticipantState>;
  connections: Map<string, ConnectionContext>;
  documents: Map<string, DocumentState>;
  suggestions: Map<string, Suggestion>;
  mode: RoomMode;
  secretHash?: string;
  chat: RoomChatMessage[];
}

const rooms = new Map<string, RoomState>();
const joinLimiter = new RateLimiter(60_000, 20, 3 * 60_000);
const MAX_CHAT_MESSAGES = 500;
const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const BACKUP_FILE = path.join(BACKUP_DIR, 'rooms-backup.json');

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function saveRooms(): void {
  const data: Record<string, any> = {};
  for (const [roomId, room] of rooms.entries()) {
    data[roomId] = {
      roomId: room.roomId,
      ownerId: room.ownerId,
      participants: Array.from(room.participants.entries()),
      documents: Array.from(room.documents.entries()),
      suggestions: Array.from(room.suggestions.entries()),
      mode: room.mode,
      secretHash: room.secretHash,
      chat: room.chat
    };
  }
  
  // Write main backup
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(data, null, 2));
  
  // Create timestamped backup (keep last 10)
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const archivedFile = path.join(BACKUP_DIR, `rooms-${timestamp}.json`);
  fs.writeFileSync(archivedFile, JSON.stringify(data, null, 2));
  
  // Cleanup old backups (keep last 10)
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('rooms-') && f.endsWith('.json') && f !== 'rooms-backup.json')
      .sort()
      .reverse();
    
    if (files.length > 10) {
      for (let i = 10; i < files.length; i++) {
        fs.unlinkSync(path.join(BACKUP_DIR, files[i]));
      }
    }
  } catch (e) {
    log('backup_cleanup_error', { error: String(e) });
  }
}

function loadRooms(): void {
  if (fs.existsSync(BACKUP_FILE)) {
    try {
      const raw = fs.readFileSync(BACKUP_FILE, 'utf-8');
      const data = JSON.parse(raw);
      for (const roomId in data) {
        const d = data[roomId];
        rooms.set(roomId, {
          roomId: d.roomId,
          ownerId: d.ownerId,
          participants: new Map(d.participants),
          connections: new Map(),
          documents: new Map(d.documents),
          suggestions: new Map(d.suggestions),
          mode: d.mode,
          secretHash: d.secretHash,
          chat: d.chat || []
        });
        roomLastActivity.set(roomId, Date.now());
      }
      log('server_start', { message: `Restored ${rooms.size} rooms from backup` });
    } catch (e) {
      log('error', { message: 'Failed to load rooms backup', error: String(e) });
    }
  }
}


const args = minimist(process.argv.slice(2), {
  alias: { p: 'port', h: 'host' },
  string: ['port', 'host']
});
const fileConfig = loadConfig();
const port = Number(args.port ?? process.env.CODEROOMS_PORT ?? fileConfig.port ?? 5171);
const host = (args.host ?? process.env.CODEROOMS_HOST ?? fileConfig.host ?? '127.0.0.1') as string;

const wss = new WebSocketServer({ port, host });

log('server_listening', { host, port });
console.log(`CodeRooms server listening on ws://${host}:${port}`);

// Load rooms from backup on startup
loadRooms();

// Auto-save rooms every 30 seconds
setInterval(() => {
  if (rooms.size > 0) {
    saveRooms();
  }
}, 30_000);

// Save rooms on shutdown
process.on('SIGTERM', () => {
  log('server_shutdown', { reason: 'SIGTERM' });
  saveRooms();
  process.exit(0);
});

process.on('SIGINT', () => {
  log('server_shutdown', { reason: 'SIGINT' });
  saveRooms();
  process.exit(0);
});

// Idle room cleanup: remove rooms with no connections every 5 minutes
const IDLE_ROOM_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const roomLastActivity = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (room.connections.size === 0) {
      const lastActive = roomLastActivity.get(roomId) ?? now;
      if (now - lastActive > IDLE_ROOM_TIMEOUT_MS) {
        rooms.delete(roomId);
        roomLastActivity.delete(roomId);
        log('room_idle_cleanup', { roomId });
      }
    } else {
      roomLastActivity.set(roomId, now);
    }
  }
}, 5 * 60 * 1000);

wss.on('connection', (ws, request) => {
  const ip = request.socket.remoteAddress ?? 'unknown';
  const context: ConnectionContext = { ws, userId: uuidv4(), ip };

  ws.on('message', payload => {
    try {
      let message: ClientToServerMessage;
      if (Buffer.isBuffer(payload) || payload instanceof Uint8Array || Array.isArray(payload)) {
        message = unpack(payload as Buffer);
      } else {
        message = JSON.parse(payload.toString()) as ClientToServerMessage;
      }
      handleMessage(context, message);
    } catch (error) {
      sendError(ws, 'Invalid payload received', 'PAYLOAD_INVALID');
    }
  });

  ws.on('close', () => {
    cleanupConnection(context);
  });

  // Server-side ping to detect dead connections
  const pingTimer = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingTimer);
    }
  }, 30_000);

  ws.on('close', () => clearInterval(pingTimer));
});

function handleMessage(context: ConnectionContext, message: ClientToServerMessage): void {
  switch (message.type) {
    case 'createRoom':
      createRoom(context, message.displayName, message.mode, message.secret);
      break;
    case 'joinRoom':
      joinRoom(context, message.roomId, message.displayName, message.secret);
      break;
    case 'leaveRoom':
      cleanupRoomMembership(context);
      break;
    case 'updateRole':
      updateRole(context, message.userId, message.role);
      break;
    case 'shareDocument':
      handleShareDocument(context, message);
      break;
    case 'unshareDocument':
      handleUnshareDocument(context, message.documentId);
      break;
    case 'docChange':
      handleDocChange(context, message);
      break;
    case 'suggestion':
      handleSuggestion(context, message);
      break;
    case 'acceptSuggestion':
      handleSuggestionDecision(context, message.suggestionId, true);
      break;
    case 'rejectSuggestion':
      handleSuggestionDecision(context, message.suggestionId, false);
      break;
    case 'setEditMode':
      setEditMode(context, message.userId, message.direct);
      break;
    case 'requestFullSync':
      handleRequestFullSync(context, message.roomId, message.docId);
      break;
    case 'fullDocumentSync':
      handleFullDocumentSync(context, message);
      break;
    case 'cursorUpdate':
      handleCursorUpdate(context, message as any);
      break;
    case 'rootCursor':
      handleRootCursor(context, message);
      break;
    case 'participantActivity':
      handleParticipantActivity(context, message);
      break;
    case 'chatSend':
      handleChatSend(context, message);
      break;
  }
}

type RoomChatMessage = {
  messageId: string;
  userId: string;
  name: string;
  role: Role;
  content: string;
  timestamp: number;
  isSystem?: boolean;
};

function createRoom(context: ConnectionContext, displayName: string, mode: RoomMode = 'team', secret?: string): void {
  const roomId = generateRoomId();
  const room: RoomState = {
    roomId,
    ownerId: context.userId,
    participants: new Map(),
    connections: new Map(),
    documents: new Map(),
    suggestions: new Map(),
    mode: mode ?? 'team',
    secretHash: secret ? hashSecret(secret) : undefined,
    chat: []
  };

  rooms.set(roomId, room);
  context.roomId = roomId;
  context.role = 'root';
  context.displayName = displayName;

  const participant: ParticipantState = {
    userId: context.userId,
    displayName,
    role: 'root',
    isDirectEditMode: true
  };

  room.participants.set(participant.userId, participant);
  room.connections.set(context.userId, context);

  send(context.ws, { type: 'roomCreated', roomId, userId: context.userId, mode: room.mode });
  send(context.ws, {
    type: 'joinedRoom',
    roomId,
    userId: context.userId,
    role: 'root',
    participants: Array.from(room.participants.values()),
    mode: room.mode
  });
  log('room_created', { roomId, ownerId: context.userId, mode: room.mode, hasSecret: Boolean(room.secretHash) });
}

function joinRoom(context: ConnectionContext, roomId: string, displayName: string, secret?: string): void {
  if (isJoinBlocked(context)) {
    return;
  }
  const room = rooms.get(roomId);
  if (!room) {
    recordFailedJoin(context);
    sendError(context.ws, 'Room not found', 'ROOM_NOT_FOUND');
    return;
  }

  if (room.secretHash) {
    if (!secret) {
      recordFailedJoin(context);
      sendError(context.ws, 'Room requires a secret', 'ROOM_SECRET_REQUIRED');
      return;
    }
    if (hashSecret(secret) !== room.secretHash) {
      recordFailedJoin(context);
      sendError(context.ws, 'Room secret is invalid', 'ROOM_SECRET_INVALID');
      return;
    }
  }

  resetFailedJoin(context);

  context.roomId = roomId;
  // Auto-assign viewer role for large rooms (40+ participants) or classroom mode
  const participantCount = room.participants.size;
  const isLargeRoom = participantCount >= 40;
  const defaultRole: Role = room.mode === 'classroom' || isLargeRoom ? 'viewer' : 'collaborator';
  context.role = defaultRole;
  context.displayName = displayName;

  const participant: ParticipantState = {
    userId: context.userId,
    displayName,
    role: defaultRole,
    isDirectEditMode: defaultRole === 'collaborator' ? false : undefined
  };

  room.participants.set(participant.userId, participant);
  room.connections.set(participant.userId, context);

  send(context.ws, {
    type: 'joinedRoom',
    roomId,
    userId: context.userId,
    role: defaultRole,
    participants: Array.from(room.participants.values()),
    mode: room.mode
  });

  broadcast(room, { type: 'participantJoined', participant }, context.ws);
  replayDocumentsToConnection(room, context);
  log('room_joined', { roomId, userId: context.userId, role: defaultRole, mode: room.mode, ip: context.ip });
}

function cleanupConnection(context: ConnectionContext): void {
  cleanupRoomMembership(context);
}

function cleanupRoomMembership(context: ConnectionContext): void {
  if (!context.roomId) {
    return;
  }

  const room = rooms.get(context.roomId);
  if (!room) {
    context.roomId = undefined;
    return;
  }

  room.participants.delete(context.userId);
  room.connections.delete(context.userId);
  broadcast(room, { type: 'participantLeft', userId: context.userId }, context.ws);

  if (room.ownerId === context.userId) {
    for (const connection of room.connections.values()) {
      send(connection.ws, { type: 'error', message: 'Room closed by root user.' });
      connection.ws.close();
    }
    rooms.delete(room.roomId);
    log('room_closed', { roomId: room.roomId });
  }

  context.roomId = undefined;
  context.role = undefined;
}

function updateRole(context: ConnectionContext, userId: string, role: Role): void {
  const room = getRoomForContext(context);
  if (!room) {
    return;
  }
  if (room.ownerId !== context.userId) {
    sendError(context.ws, 'Only the room owner can change roles.', 'FORBIDDEN');
    return;
  }

  const participant = room.participants.get(userId);
  if (!participant) {
    sendError(context.ws, 'Participant not found.', 'TARGET_NOT_FOUND');
    return;
  }

  participant.role = role;
  participant.isDirectEditMode = role === 'collaborator' ? participant.isDirectEditMode ?? false : false;

  const targetConnection = room.connections.get(userId);
  if (targetConnection) {
    targetConnection.role = role;
  }

  broadcast(room, { type: 'roleUpdated', userId, role });
}

function setEditMode(context: ConnectionContext, userId: string, direct: boolean): void {
  const room = getRoomForContext(context);
  if (!room) {
    return;
  }
  if (context.userId !== room.ownerId && context.userId !== userId) {
    return;
  }
  const participant = room.participants.get(userId);
  if (!participant || participant.role !== 'collaborator') {
    return;
  }
  participant.isDirectEditMode = direct;
  broadcast(room, { type: 'editModeUpdated', userId, isDirectEditMode: direct });
}

function handleShareDocument(context: ConnectionContext, message: Extract<ClientToServerMessage, { type: 'shareDocument' }>): void {
  const room = getRoomForContext(context);
  if (!room || context.userId !== room.ownerId) {
    return;
  }

  const doc: DocumentState = {
    docId: message.docId,
    text: message.text,
    version: message.version,
    originalUri: message.originalUri,
    fileName: message.fileName,
    languageId: message.languageId
  };

  room.documents.set(message.docId, doc);

  broadcast(room, {
    type: 'shareDocument',
    roomId: message.roomId,
    docId: message.docId,
    originalUri: message.originalUri,
    fileName: message.fileName,
    languageId: message.languageId,
    text: message.text,
    version: message.version
  }, context.ws);

  log('doc_shared', { roomId: room.roomId, docId: message.docId, ownerId: room.ownerId, fileName: message.fileName });
}

function handleUnshareDocument(context: ConnectionContext, documentId: string): void {
  const room = getRoomForContext(context);
  if (!room || context.userId !== room.ownerId) {
    return;
  }
  const removed = room.documents.get(documentId);
  if (!removed) {
    return;
  }
  room.documents.delete(documentId);
  broadcast(room, { type: 'documentUnshared', roomId: room.roomId, documentId }, context.ws);
  log('doc_unshared', { roomId: room.roomId, docId: documentId, ownerId: room.ownerId });
}

function handleDocChange(context: ConnectionContext, message: Extract<ClientToServerMessage, { type: 'docChange' }>): void {
  const room = getRoomForContext(context);
  if (!room || !context.role) {
    return;
  }

  if (context.role === 'viewer') {
    sendError(context.ws, 'Viewers are read-only.', 'FORBIDDEN');
    return;
  }

  if (context.role === 'collaborator') {
    const participant = room.participants.get(context.userId);
    if (!participant?.isDirectEditMode) {
      sendError(context.ws, 'Collaborator is in suggestion mode.', 'FORBIDDEN');
      return;
    }
  }

  const doc = room.documents.get(message.docId);
  if (!doc) {
    return;
  }

  const updatedText = applyPatch(doc.text, message.patch);
  if (!updatedText) {
    sendError(context.ws, 'Invalid patch payload', 'PATCH_INVALID');
    return;
  }

  doc.text = updatedText;
  doc.version = message.version;
  room.documents.set(message.docId, doc);

  broadcast(room, {
    type: 'docChangeBroadcast',
    docId: message.docId,
    version: doc.version,
    patch: message.patch,
    authorId: context.userId
  }, context.ws);
}

function handleSuggestion(
  context: ConnectionContext,
  message: Extract<ClientToServerMessage, { type: 'suggestion' }>
): void {
  const room = getRoomForContext(context);
  if (!room) {
    return;
  }

  room.suggestions.set(message.suggestionId, {
    suggestionId: message.suggestionId,
    roomId: message.roomId,
    docId: message.docId,
    authorId: message.authorId,
    authorName: message.authorName,
    patches: message.patches,
    createdAt: message.createdAt,
    status: 'pending'
  });

  broadcast(room, {
    type: 'newSuggestion',
    suggestion: {
      suggestionId: message.suggestionId,
      roomId: message.roomId,
      docId: message.docId,
      authorId: message.authorId,
      authorName: message.authorName,
      patches: message.patches,
      createdAt: message.createdAt,
      status: 'pending'
    }
  }, undefined);

  log('suggestion_created', { roomId: room.roomId, docId: message.docId, suggestionId: message.suggestionId, authorId: message.authorId });
}

function handleSuggestionDecision(context: ConnectionContext, suggestionId: string, accepted: boolean): void {
  const room = getRoomForContext(context);
  if (!room || context.userId !== room.ownerId) {
    return;
  }

  const suggestion = room.suggestions.get(suggestionId);
  if (!suggestion) {
    return;
  }

  if (accepted) {
    const doc = room.documents.get(suggestion.docId);
    if (!doc) {
      return;
    }

    const updatedText = applyPatches(doc.text, suggestion.patches);
    if (!updatedText) {
      sendError(context.ws, 'Invalid suggestion payload', 'PATCH_INVALID');
      return;
    }

    doc.text = updatedText;
    let version = doc.version;
    for (const patch of suggestion.patches) {
      version += 1;
      broadcast(room, {
        type: 'docChangeBroadcast',
        docId: suggestion.docId,
        version,
        patch,
        authorId: context.userId
      }, context.ws);
    }
    doc.version = version;
    room.documents.set(suggestion.docId, doc);
  }

  room.suggestions.delete(suggestionId);
  broadcast(room, {
    type: accepted ? 'suggestionAccepted' : 'suggestionRejected',
    suggestionId,
    docId: suggestion.docId
  });

  log(accepted ? 'suggestion_accepted' : 'suggestion_rejected', {
    roomId: room.roomId,
    suggestionId,
    docId: suggestion.docId
  });
}

function handleRequestFullSync(context: ConnectionContext, roomId: string, docId: string): void {
  const room = getRoomForContext(context);
  if (!room || room.roomId !== roomId) {
    return;
  }
  const ownerConnection = room.connections.get(room.ownerId);
  if (!ownerConnection) {
    return;
  }
  send(ownerConnection.ws, {
    type: 'requestFullSync',
    roomId,
    docId
  });
}

function handleFullDocumentSync(
  context: ConnectionContext,
  message: Extract<ClientToServerMessage, { type: 'fullDocumentSync' }>
): void {
  const room = getRoomForContext(context);
  if (!room || context.userId !== room.ownerId || room.roomId !== message.roomId) {
    return;
  }
  const doc = room.documents.get(message.docId);
  if (!doc) {
    return;
  }
  doc.text = message.text;
  doc.version = message.version;
  room.documents.set(message.docId, doc);

  broadcast(room, {
    type: 'fullDocumentSync',
    roomId: room.roomId,
    docId: message.docId,
    text: message.text,
    version: message.version
  }, context.ws);
}

function handleRootCursor(
  context: ConnectionContext,
  message: Extract<ClientToServerMessage, { type: 'rootCursor' }>
): void {
  const room = getRoomForContext(context);
  if (!room || context.userId !== room.ownerId || room.roomId !== message.roomId) {
    return;
  }

  broadcast(room, {
    type: 'rootCursor',
    roomId: room.roomId,
    docId: message.docId,
    uri: message.uri,
    position: message.position
  }, context.ws);
}

function handleParticipantActivity(
  context: ConnectionContext,
  message: Extract<ClientToServerMessage, { type: 'participantActivity' }>
): void {
  const room = getRoomForContext(context);
  if (!room || room.roomId !== message.roomId) {
    return;
  }

  broadcast(room, {
    type: 'participantActivity',
    roomId: room.roomId,
    userId: context.userId,
    activity: message.activity,
    at: message.at
  });
}

function handleChatSend(context: ConnectionContext, message: Extract<ClientToServerMessage, { type: 'chatSend' }>): void {
  const room = getRoomForContext(context);
  if (!room || room.roomId !== message.roomId) {
    return;
  }

  const participant = room.participants.get(context.userId);
  if (!participant) {
    return;
  }

  if (participant.role === 'viewer') {
    sendError(context.ws, 'Viewers cannot send messages.', 'FORBIDDEN');
    return;
  }

  const trimmed = message.content.trim();
  if (!trimmed) {
    return;
  }
  if (trimmed.length > 2000) {
    sendError(context.ws, 'Message is too long (max 2000 characters).', 'MESSAGE_TOO_LONG');
    return;
  }

  const chatMsg: RoomChatMessage = {
    messageId: message.messageId,
    userId: participant.userId,
    name: participant.displayName,
    role: participant.role,
    content: trimmed,
    timestamp: Date.now()
  };

  room.chat.push(chatMsg);
  if (room.chat.length > MAX_CHAT_MESSAGES) {
    room.chat.splice(0, room.chat.length - MAX_CHAT_MESSAGES);
  }

  const broadcastMsg: ServerToClientMessage = {
    type: 'chatMessage',
    roomId: room.roomId,
    messageId: chatMsg.messageId,
    fromUserId: chatMsg.userId,
    fromName: chatMsg.name,
    role: chatMsg.role,
    content: chatMsg.content,
    timestamp: chatMsg.timestamp,
    isSystem: chatMsg.isSystem
  };

  broadcast(room, broadcastMsg);
  log('chat_message', { roomId: room.roomId, userId: participant.userId, role: participant.role });
}

function broadcast(room: RoomState, message: ServerToClientMessage, except?: WebSocket): void {
  for (const connection of room.connections.values()) {
    if (connection.ws === except) {
      continue;
    }
    send(connection.ws, message);
  }
}

function send(ws: WebSocket, message: ServerToClientMessage): void {
  ws.send(pack(message));
}

function sendError(ws: WebSocket, message: string, code?: string): void {
  send(ws, { type: 'error', message, code });
}

function replayDocumentsToConnection(room: RoomState, context: ConnectionContext): void {
  for (const doc of room.documents.values()) {
    send(context.ws, {
      type: 'shareDocument',
      roomId: room.roomId,
      docId: doc.docId,
      originalUri: doc.originalUri,
      fileName: doc.fileName,
      languageId: doc.languageId,
      text: doc.text,
      version: doc.version
    });
  }
}

function getRoomForContext(context: ConnectionContext): RoomState | undefined {
  if (!context.roomId) {
    return undefined;
  }
  return rooms.get(context.roomId);
}

function generateRoomId(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  if (rooms.has(code)) {
    return generateRoomId();
  }
  return code;
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function isJoinBlocked(context: ConnectionContext): boolean {
  const key = context.ip ?? 'unknown';
  if (joinLimiter.isBlocked(key)) {
    sendError(context.ws, 'Too many failed attempts. Try again later.', 'RATE_LIMITED');
    context.ws.close();
    log('join_blocked', { ip: key });
    return true;
  }
  return false;
}

function recordFailedJoin(context: ConnectionContext): void {
  const key = context.ip ?? 'unknown';
  const blocked = joinLimiter.recordFailure(key);
  if (blocked) {
    sendError(context.ws, 'Too many failed attempts. Try again later.', 'RATE_LIMITED');
    context.ws.close();
    log('join_blocked', { ip: key });
  }
}

function resetFailedJoin(context: ConnectionContext): void {
  const key = context.ip ?? 'unknown';
  joinLimiter.reset(key);
}

function loadConfig(): { host?: string; port?: number } {
  try {
    const path = `${process.cwd()}/coderooms.config.json`;
    if (!fs.existsSync(path)) {
      return {};
    }
    const raw = fs.readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as { host?: string; port?: number };
    return parsed ?? {};
  } catch (error) {
    log('config_error', { error: error instanceof Error ? error.message : String(error) });
    return {};
  }
}


function handleCursorUpdate(
  context: ConnectionContext,
  message: Extract<ClientToServerMessage, { type: 'cursorUpdate' }>
): void {
  const room = getRoomForContext(context);
  if (!room || room.roomId !== message.roomId) {
    return;
  }
  const participant = room.participants.find((p) => p.userId === context.userId);
  if (!participant) return;

  broadcast(
    room,
    {
      type: 'cursorUpdate',
      roomId: room.roomId,
      userId: context.userId,
      userName: participant.displayName,
      docId: message.docId,
      uri: message.uri,
      position: message.position,
      selections: message.selections,
    },
    context.userId
  );
}
