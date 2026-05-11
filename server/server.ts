import { randomBytes, pbkdf2, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const pbkdf2Async = promisify(pbkdf2);
import fs from 'fs';
import https from 'https';
import minimist from 'minimist';
import { v4 as uuidv4 } from 'uuid';
import { WebSocket, WebSocketServer } from 'ws';
import {
  ClientToServerMessage,
  Role,
  RoomMode,
  ServerToClientMessage,
  Suggestion,
  SuggestionReviewAction
} from './types';
import { log } from './logger';
import { applyPatch } from './patch';
import { transformPatch, VersionedPatch } from './ot';
import { RateLimiter } from './rateLimiter';
import path from 'path';
import { pack, unpack } from 'msgpackr';
import { getClientMessageAckKey } from '../shared/ackKeys';
import { getNextTotalDocBytes } from './accounting';
import {
  canChangeEditMode,
  canEditSharedDocument,
  canPerformOwnerAction,
  canSendChat
} from './authorization';
import { prepareRoomClosure } from './roomClosure';
import { type PersistedRoomState } from './backupPersistence';
import {
  MAX_INVITE_LABEL_LENGTH,
  validateClientMessage
} from './protocolValidation';
import {
  createOwnerParticipant,
  getRestoredOwnerId,
  ParticipantState,
  resolveJoinParticipant,
  restoreSessionState,
  toPublicParticipant,
  toRecoverableParticipant,
  type RecoverableParticipantState
} from './roomSessions';
import { getRoomInvariantViolations } from './roomInvariants';
import { createRoomOperationGuards, getJoinClaimKey } from './roomOperationGuards';
import {
  applySuggestionPatches,
  canSubmitSuggestion,
  createPendingSuggestion,
  getPendingSuggestionsForRole,
  isIdempotentSuggestionReplay,
  pruneReviewedSuggestions,
  transitionSuggestionStatus
} from './suggestions';
import { createSerialTaskRunner } from './serialTaskRunner';
import { validateJoinAccess } from './joinAccess';
import { buildTrackedErrorResponses } from './trackedResponses';
import { getJoinFailureResponse, JOIN_FAILURE_DELAY_MS, type JoinFailureReason } from './joinSecurity';
import { buildRecoveryMetrics } from './recoveryState';

const MAX_PATCH_HISTORY = 200;

interface DocumentState {
  docId: string;
  text: string;
  version: number;
  originalUri: string;
  fileName: string;
  languageId?: string;
  patchHistory: VersionedPatch[];
  yjsState?: Uint8Array;
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
  ownerSessionToken: string;
  ownerIp?: string;
  participants: Map<string, ParticipantState>;
  recoverableSessions: Map<string, RecoverableParticipantState>;
  connections: Map<string, ConnectionContext>;
  documents: Map<string, DocumentState>;
  suggestions: Map<string, Suggestion>;
  mode: RoomMode;
  secretHash?: string;
  chat: RoomChatMessage[];
}

export interface StartCodeRoomsServerOptions {
  port?: number;
  host?: string;
  certPath?: string;
  keyPath?: string;
  backupDir?: string;
  persistRooms?: boolean;
  loadPersistedRooms?: boolean;
  enableBackgroundTasks?: boolean;
  installProcessHandlers?: boolean;
  logToConsole?: boolean;
}

export interface StartedCodeRoomsServer {
  host: string;
  port: number;
  tls: boolean;
  close(): Promise<void>;
}

const rooms = new Map<string, RoomState>();
let joinLimiter = new RateLimiter(60_000, 20, 3 * 60_000);
// Per-user rate limiters for chat and suggestions (10 messages per 10s, block 30s)
let chatLimiter = new RateLimiter(10_000, 10, 30_000);
let suggestionLimiter = new RateLimiter(30_000, 5, 60_000);
let cursorLimiter = new RateLimiter(1_000, 120, 5_000);
let activityLimiter = new RateLimiter(5_000, 20, 10_000);
const MAX_CHAT_MESSAGES = 500;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const inviteTokens = new Map<string, { roomId: string; label?: string; createdAt: number }>();
const DEFAULT_BACKUP_DIR = path.join(__dirname, '..', 'backups');
const MAX_MESSAGE_BYTES = 512 * 1024; // 512 KB hard limit per message
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024; // 2 MB limit for shared documents
const MAX_ROOMS_GLOBAL = 500;
const MAX_ROOMS_PER_IP = 10;
const MAX_CONNECTIONS_PER_IP = 20;
const MAX_DOCUMENTS_PER_ROOM = 50;
const MAX_SUGGESTIONS_PER_ROOM = 100;
const MAX_REVIEWED_SUGGESTIONS = 200;
const MAX_TOTAL_DOC_BYTES = 256 * 1024 * 1024; // 256 MB total memory budget for document text
let totalDocBytes = 0;
const roomCountByIp = new Map<string, number>();
const connectionsPerIp = new Map<string, number>();
let roomOperationGuards = createRoomOperationGuards();
const roomLastActivity = new Map<string, number>();
let backupDir = DEFAULT_BACKUP_DIR;
let persistRoomsEnabled = true;
let loadPersistedRoomsEnabled = true;
let activeWss: WebSocketServer | undefined;
let activeHttpsServer: https.Server | undefined;
let autoSaveTimer: NodeJS.Timeout | undefined;
let cleanupTimer: NodeJS.Timeout | undefined;
let queueRoomSave: (() => Promise<void>) | undefined;
let sigtermHandler: (() => void) | undefined;
let sigintHandler: (() => void) | undefined;

import { loadRoomsFromDb, saveRoomToDb, deleteRoomFromDb } from './db';

function buildPersistedRoomsSnapshot(): Record<string, PersistedRoomState> {
  const data: Record<string, PersistedRoomState> = {};
  for (const [roomId, room] of rooms.entries()) {
    data[roomId] = {
      roomId: room.roomId,
      ownerId: room.ownerId,
      ownerSessionToken: room.ownerSessionToken,
      ownerIp: room.ownerIp,
      recoverableSessions: Array.from(room.recoverableSessions.entries()),
      documents: Array.from(room.documents.entries()).map(([docId, doc]) => [
        docId,
        {
          docId: doc.docId,
          text: doc.text,
          version: doc.version,
          originalUri: doc.originalUri,
          fileName: doc.fileName,
          languageId: doc.languageId,
          yjsState: doc.yjsState ? Buffer.from(doc.yjsState).toString('base64') : undefined
        }
      ]),
      suggestions: Array.from(room.suggestions.entries()),
      mode: room.mode,
      secretHash: room.secretHash,
      chat: room.chat
    };
  }
  return data;
}

function buildCurrentRecoveryMetrics() {
  return buildRecoveryMetrics(Array.from(rooms.values(), room => ({
    ownerIp: room.ownerIp,
    documents: room.documents.values(),
    suggestions: room.suggestions.values(),
    recoverableSessions: room.recoverableSessions.values(),
    chat: room.chat
  })));
}

async function saveRooms(): Promise<void> {
  if (!persistRoomsEnabled) {
    return;
  }
  const data = buildPersistedRoomsSnapshot();
  const savedAt = Date.now();
  const metrics = buildCurrentRecoveryMetrics();
  
  for (const [roomId, state] of Object.entries(data)) {
    saveRoomToDb(roomId, state);
  }

  log('rooms_saved', {
    roomCount: metrics.roomCount,
    documentCount: metrics.documentCount,
    suggestionCount: metrics.suggestionCount,
    recoverableSessionCount: metrics.recoverableSessionCount,
    chatMessageCount: metrics.chatMessageCount,
    totalDocBytes: metrics.totalDocBytes,
    savedAt
  });
}

function loadRooms(): void {
  if (!loadPersistedRoomsEnabled) {
    log('rooms_restore_skipped', { reason: 'no_backup' });
    return;
  }

  log('rooms_restore_started', { backend: 'sqlite' });

  try {
    const loadedRooms = loadRoomsFromDb();
    let skippedRooms = 0;
    
    for (const roomId in loadedRooms) {
      const d = loadedRooms[roomId];
      const restoredDocs = new Map<string, DocumentState>(
        d.documents.map(([docId, doc]) => [
          docId,
          {
            ...doc,
            yjsState: doc.yjsState ? Uint8Array.from(Buffer.from(doc.yjsState, 'base64')) : undefined,
            patchHistory: []
          }
        ])
      );
      const restoredSessionState = restoreSessionState({
        ownerSessionToken: d.ownerSessionToken,
        legacyOwnerId: d.ownerId,
        recoverableSessions: d.recoverableSessions,
        legacyParticipants: d.participants
      });
      rooms.set(roomId, {
        roomId: d.roomId,
        ownerId: restoredSessionState.ownerId,
        ownerSessionToken: restoredSessionState.ownerSessionToken,
        ownerIp: d.ownerIp,
        participants: new Map(),
        recoverableSessions: restoredSessionState.recoverableSessions,
        connections: new Map(),
        documents: restoredDocs,
        suggestions: new Map(d.suggestions),
        mode: d.mode,
        secretHash: d.secretHash,
        chat: d.chat || []
      });
      joinRoomPubSub(roomId);
      roomLastActivity.set(roomId, Date.now());
    }
    const recovered = buildRecoveryMetrics(Array.from(rooms.values(), room => ({
      ownerIp: room.ownerIp,
      documents: room.documents.values(),
      suggestions: room.suggestions.values(),
      recoverableSessions: room.recoverableSessions.values(),
      chat: room.chat
    })));
    totalDocBytes = recovered.totalDocBytes;
    roomCountByIp.clear();
    for (const [ip, count] of recovered.roomCountByIp) {
      roomCountByIp.set(ip, count);
    }
    log('rooms_restore_complete', {
      backend: 'sqlite',
      skippedRooms: skippedRooms,
      roomCount: recovered.roomCount,
      documentCount: recovered.documentCount,
      suggestionCount: recovered.suggestionCount,
      recoverableSessionCount: recovered.recoverableSessionCount,
      chatMessageCount: recovered.chatMessageCount,
      totalDocBytes: recovered.totalDocBytes,
      ownerIpBuckets: recovered.roomCountByIp.size
    });
  } catch (e) {
    log('error', { message: 'Failed to load rooms backup from sqlite', error: String(e) });
  }
}

const DEFAULT_AUTO_SAVE_INTERVAL_MS = 30_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_IDLE_ROOM_TIMEOUT_MS = 10 * 60 * 1000;

function resetInMemoryState(): void {
  rooms.clear();
  inviteTokens.clear();
  roomCountByIp.clear();
  connectionsPerIp.clear();
  roomLastActivity.clear();
  totalDocBytes = 0;
  joinLimiter = new RateLimiter(60_000, 20, 3 * 60_000);
  chatLimiter = new RateLimiter(10_000, 10, 30_000);
  suggestionLimiter = new RateLimiter(30_000, 5, 60_000);
  cursorLimiter = new RateLimiter(1_000, 120, 5_000);
  activityLimiter = new RateLimiter(5_000, 20, 10_000);
  roomOperationGuards = createRoomOperationGuards();
}

function ensureBackupDirectory(): void {
  if (!persistRoomsEnabled && !loadPersistedRoomsEnabled) {
    return;
  }
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
}

function createQueueRoomSave(): () => Promise<void> {
  return createSerialTaskRunner(
    async () => {
      if (rooms.size === 0) {
        return;
      }
      await saveRooms();
    },
    error => {
      log('rooms_save_error', { error: error instanceof Error ? error.message : String(error) });
    }
  );
}

function clearBackgroundTasks(): void {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
    autoSaveTimer = undefined;
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
}

function saveRoomsSync(): void {
  if (!persistRoomsEnabled) {
    return;
  }
  const data = buildPersistedRoomsSnapshot();
  const metrics = buildCurrentRecoveryMetrics();
  const savedAt = Date.now();
  
  for (const [roomId, state] of Object.entries(data)) {
    saveRoomToDb(roomId, state);
  }

  log('rooms_saved_sync', {
    roomCount: metrics.roomCount,
    documentCount: metrics.documentCount,
    suggestionCount: metrics.suggestionCount,
    recoverableSessionCount: metrics.recoverableSessionCount,
    chatMessageCount: metrics.chatMessageCount,
    totalDocBytes: metrics.totalDocBytes,
    savedAt
  });
}

function installShutdownHandlers(): void {
  if (sigtermHandler || sigintHandler) {
    return;
  }

  sigtermHandler = () => {
    log('server_shutdown', { reason: 'SIGTERM' });
    saveRoomsSync();
    process.exit(0);
  };
  sigintHandler = () => {
    log('server_shutdown', { reason: 'SIGINT' });
    saveRoomsSync();
    process.exit(0);
  };

  process.on('SIGTERM', sigtermHandler);
  process.on('SIGINT', sigintHandler);
}

function uninstallShutdownHandlers(): void {
  if (sigtermHandler) {
    process.off('SIGTERM', sigtermHandler);
    sigtermHandler = undefined;
  }
  if (sigintHandler) {
    process.off('SIGINT', sigintHandler);
    sigintHandler = undefined;
  }
}

function startBackgroundTasks(idleRoomTimeoutMs: number): void {
  clearBackgroundTasks();
  autoSaveTimer = setInterval(() => {
    void queueRoomSave?.();
  }, DEFAULT_AUTO_SAVE_INTERVAL_MS);

  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms) {
      if (room.connections.size === 0) {
        const lastActive = roomLastActivity.get(roomId) ?? now;
        if (now - lastActive > idleRoomTimeoutMs) {
          deleteRoom(roomId);
          log('room_idle_cleanup', { roomId });
        }
      } else {
        roomLastActivity.set(roomId, now);
      }
    }
    for (const [token, data] of inviteTokens) {
      if (now - data.createdAt > TOKEN_TTL_MS) {
        inviteTokens.delete(token);
      }
    }
    joinLimiter.cleanup();
    chatLimiter.cleanup();
    suggestionLimiter.cleanup();
    cursorLimiter.cleanup();
    activityLimiter.cleanup();
  }, DEFAULT_CLEANUP_INTERVAL_MS);
}

function attachConnectionHandlers(wss: WebSocketServer): void {
  wss.on('connection', (ws, request) => {
    const ip = request.socket.remoteAddress ?? 'unknown';

    const ipConns = connectionsPerIp.get(ip) ?? 0;
    if (ipConns >= MAX_CONNECTIONS_PER_IP) {
      ws.close(1008, 'Too many connections from this IP');
      return;
    }
    connectionsPerIp.set(ip, ipConns + 1);

    const context: ConnectionContext = { ws, userId: uuidv4(), ip };

    ws.on('message', payload => {
      try {
        const byteLength = Buffer.isBuffer(payload)
          ? payload.byteLength
          : Array.isArray(payload)
            ? payload.reduce((acc, b) => acc + b.byteLength, 0)
            : Buffer.byteLength(payload.toString());

        if (byteLength > MAX_MESSAGE_BYTES) {
          sendError(ws, 'Payload too large', 'PAYLOAD_TOO_LARGE');
          return;
        }

        let message: unknown;
        if (Buffer.isBuffer(payload) || payload instanceof Uint8Array || Array.isArray(payload)) {
          message = unpack(payload as Buffer) as unknown;
        } else {
          message = JSON.parse(payload.toString()) as unknown;
        }
        handleMessage(context, message);
      } catch (error) {
        sendError(ws, 'Invalid payload received', 'PAYLOAD_INVALID');
      }
    });

    ws.on('close', () => {
      const conns = connectionsPerIp.get(ip) ?? 1;
      if (conns <= 1) { connectionsPerIp.delete(ip); }
      else { connectionsPerIp.set(ip, conns - 1); }
      cleanupConnection(context);
    });

    const pingTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.ping();
      } else {
        clearInterval(pingTimer);
      }
    }, 30_000);

    ws.on('close', () => clearInterval(pingTimer));
  });
}

function waitForListening(target: WebSocketServer | http.Server | https.Server): Promise<void> {
  const address = 'address' in target ? target.address() : undefined;
  if (address) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onListening = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      target.off('listening', onListening);
      target.off('error', onError);
    };

    target.on('listening', onListening);
    target.on('error', onError);
  });
}

function getResolvedPort(wss: WebSocketServer, fallbackPort: number): number {
  const address = wss.address();
  return typeof address === 'object' && address ? address.port : fallbackPort;
}

function closeWebSocketServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    wss.close(error => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function closeHttpsServer(server: https.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function stopCodeRoomsServer(): Promise<void> {
  if (!activeWss) {
    return;
  }

  clearBackgroundTasks();
  uninstallShutdownHandlers();

  if (persistRoomsEnabled && rooms.size > 0) {
    await saveRooms();
  }

  for (const client of activeWss.clients) {
    client.terminate();
  }

  const currentWss = activeWss;
  const currentHttpsServer = activeHttpsServer;
  activeWss = undefined;
  activeHttpsServer = undefined;

  await closeWebSocketServer(currentWss);
  if (currentHttpsServer) {
    await closeHttpsServer(currentHttpsServer);
  }

  queueRoomSave = undefined;
  resetInMemoryState();
}

import { initRedis, subscribeToRoomBroadcasts, joinRoomPubSub, leaveRoomPubSub, broadcastToRoomPubSub } from './redis';

import http from 'http';

function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url || '/';
  if (url.startsWith('/voice/')) {
    const roomId = url.split('/')[2];
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderVoiceBridgeHtml(roomId));
    return;
  }
  res.writeHead(404);
  res.end('Not Found');
}

function renderVoiceBridgeHtml(roomId: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>CodeRooms Voice - ${roomId}</title>
  <style>
    body { background: #1e1e1e; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .status { font-size: 24px; margin-bottom: 20px; }
    .mic { width: 100px; height: 100px; border-radius: 50%; background: #007acc; display: flex; align-items: center; justify-content: center; margin-bottom: 20px; box-shadow: 0 0 20px rgba(0,122,204,0.5); }
    .mic svg { width: 50px; height: 50px; fill: #fff; }
    .room { color: #888; }
  </style>
</head>
<body>
  <div class="mic"><svg viewBox="0 0 16 16"><path d="M8 11a3 3 0 0 0 3-3V3a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z"/><path d="M13 8a5 5 0 0 1-10 0H2a6 6 0 0 0 12 0h-1z"/><path d="M8 14a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/></svg></div>
  <div class="status" id="status">Connecting to Room...</div>
  <div class="room">CodeRoom ID: <b>${roomId}</b></div>
  <script>
    const status = document.getElementById('status');
    setTimeout(() => { status.innerText = 'Voice Connected (P2P Handshake Ready)'; }, 1000);
  </script>
</body>
</html>
  `;
}

export async function startCodeRoomsServer(options: StartCodeRoomsServerOptions = {}): Promise<StartedCodeRoomsServer> {
  if (activeWss) {
    throw new Error('CodeRooms server is already running in this process.');
  }

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    initRedis(redisUrl);
    subscribeToRoomBroadcasts((roomId, message) => {
      const room = rooms.get(roomId);
      if (room) {
        broadcast(room, message, undefined, true);
      }
    });
    log('redis_initialized', { url: redisUrl });
  }

  resetInMemoryState();
  backupDir = options.backupDir ?? DEFAULT_BACKUP_DIR;
  persistRoomsEnabled = options.persistRooms ?? true;
  loadPersistedRoomsEnabled = options.loadPersistedRooms ?? persistRoomsEnabled;
  ensureBackupDirectory();
  if (loadPersistedRoomsEnabled) {
    loadRooms();
  }
  queueRoomSave = createQueueRoomSave();

  const requestedPort = options.port ?? 5171;
  const requestedHost = options.host ?? '127.0.0.1';
  const tls = Boolean(options.certPath && options.keyPath);

  if (tls) {
    const httpsServer = https.createServer({
      cert: fs.readFileSync(options.certPath!, 'utf-8'),
      key: fs.readFileSync(options.keyPath!, 'utf-8')
    }, handleHttpRequest);
    activeHttpsServer = httpsServer;
    activeWss = new WebSocketServer({ server: httpsServer, maxPayload: MAX_MESSAGE_BYTES });
    attachConnectionHandlers(activeWss);
    httpsServer.listen(requestedPort, requestedHost);
    await waitForListening(httpsServer);
  } else {
    const httpServer = http.createServer(handleHttpRequest);
    activeWss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES });
    attachConnectionHandlers(activeWss);
    httpServer.listen(requestedPort, requestedHost);
    await waitForListening(httpServer);
  }

  if (options.enableBackgroundTasks ?? true) {
    startBackgroundTasks(DEFAULT_IDLE_ROOM_TIMEOUT_MS);
  }
  if (options.installProcessHandlers ?? true) {
    installShutdownHandlers();
  }

  const resolvedPort = getResolvedPort(activeWss, requestedPort);
  log('server_listening', { host: requestedHost, port: resolvedPort, tls });
  if (options.logToConsole) {
    console.log(`CodeRooms server listening on ${tls ? 'wss' : 'ws'}://${requestedHost}:${resolvedPort}`);
  }

  return {
    host: requestedHost,
    port: resolvedPort,
    tls,
    close: () => stopCodeRoomsServer()
  };
}

function handleMessage(context: ConnectionContext, message: unknown): void {
  if (!validateClientMessage(message)) {
    sendError(context.ws, 'Invalid message format', 'PAYLOAD_INVALID');
    return;
  }

  switch (message.type) {
    case 'createRoom':
      void createRoom(context, message.displayName, message.mode, message.secret);
      break;
    case 'joinRoom':
      void joinRoom(context, message.roomId, message.displayName, message.secret, message.token, message.sessionToken);
      break;
    case 'leaveRoom':
      cleanupRoomMembership(context);
      break;
    case 'removeParticipant':
      removeParticipant(context, message.userId);
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
    case 'reviewSuggestions':
      handleReviewSuggestions(context, message);
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
      handleCursorUpdate(context, message);
      break;
    case 'rootCursor':
      handleRootCursor(context, message);
      break;
    case 'participantActivity':
      handleParticipantActivity(context, message);
      break;
    case 'awarenessUpdate':
      handleAwarenessUpdate(context, message);
      break;
    case 'voiceSignal':
      handleVoiceSignal(context, message);
      break;
    case 'chatSend':
      handleChatSend(context, message);
      break;
    case 'createToken':
      handleCreateToken(context, message.label);
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

async function createRoom(context: ConnectionContext, displayName: string, mode: RoomMode = 'team', secret?: string): Promise<void> {
  if (!roomOperationGuards.beginConnectionOperation(context.userId)) {
    sendError(context.ws, 'Please wait for your previous request to complete.', 'BUSY');
    return;
  }
  try {
    await createRoomInner(context, displayName, mode, secret);
  } finally {
    roomOperationGuards.endConnectionOperation(context.userId);
  }
}

async function createRoomInner(context: ConnectionContext, displayName: string, mode: RoomMode = 'team', secret?: string): Promise<void> {
  // Enforce global and per-IP room limits
  if (rooms.size >= MAX_ROOMS_GLOBAL) {
    sendError(context.ws, 'Server room limit reached. Try again later.', 'ROOM_LIMIT');
    return;
  }
  const ipKey = context.ip ?? 'unknown';
  const ipRoomCount = roomCountByIp.get(ipKey) ?? 0;
  if (ipRoomCount >= MAX_ROOMS_PER_IP) {
    sendError(context.ws, 'You have too many active rooms.', 'ROOM_LIMIT');
    return;
  }

  const roomId = generateRoomId();
  const ownerParticipant = createOwnerParticipant(context.userId, displayName);
  const room: RoomState = {
    roomId,
    ownerId: context.userId,
    ownerSessionToken: ownerParticipant.sessionToken,
    ownerIp: context.ip,
    participants: new Map(),
    recoverableSessions: new Map(),
    connections: new Map(),
    documents: new Map(),
    suggestions: new Map(),
    mode: mode ?? 'team',
    secretHash: secret ? await hashSecret(secret, roomId) : undefined,
    chat: []
  };

  rooms.set(roomId, room);
  joinRoomPubSub(roomId);
  roomCountByIp.set(ipKey, ipRoomCount + 1);
  if (context.roomId) {
    cleanupRoomMembership(context, 'switch');
  }
  context.roomId = roomId;
  context.role = 'root';
  context.displayName = displayName;

  room.participants.set(ownerParticipant.userId, ownerParticipant);
  room.recoverableSessions.set(ownerParticipant.sessionToken, toRecoverableParticipant(ownerParticipant));
  room.connections.set(context.userId, context);
  auditRoomInvariants(room, 'create_room');

  send(context.ws, {
    type: 'roomCreated',
    roomId,
    userId: context.userId,
    mode: room.mode,
    sessionToken: ownerParticipant.sessionToken
  });
  send(context.ws, {
    type: 'joinedRoom',
    roomId,
    userId: context.userId,
    role: 'root',
    participants: Array.from(room.participants.values(), toPublicParticipant),
    mode: room.mode,
    sessionToken: ownerParticipant.sessionToken
  });
  log('room_created', { roomId, ownerId: context.userId, mode: room.mode, hasSecret: Boolean(room.secretHash) });
}

async function joinRoom(
  context: ConnectionContext,
  roomId: string,
  displayName: string,
  secret?: string,
  token?: string,
  sessionToken?: string
): Promise<void> {
  if (!roomOperationGuards.beginConnectionOperation(context.userId)) {
    sendError(context.ws, 'Please wait for your previous request to complete.', 'BUSY');
    return;
  }
  const joinClaimKey = getJoinClaimKey({
    token,
    sessionToken,
    connectionId: context.userId
  });
  if (!roomOperationGuards.beginJoinClaim(roomId, joinClaimKey)) {
    roomOperationGuards.endConnectionOperation(context.userId);
    sendError(context.ws, 'A matching join request is already being processed for this room.', 'BUSY');
    return;
  }
  try {
    await joinRoomInner(context, roomId, displayName, secret, token, sessionToken);
  } finally {
    roomOperationGuards.endJoinClaim(roomId, joinClaimKey);
    roomOperationGuards.endConnectionOperation(context.userId);
  }
}

async function joinRoomInner(
  context: ConnectionContext,
  roomId: string,
  displayName: string,
  secret?: string,
  token?: string,
  sessionToken?: string
): Promise<void> {
  if (isJoinBlocked(context)) {
    return;
  }
  if (context.roomId === roomId) {
    sendError(context.ws, 'You are already connected to that room.', 'ALREADY_IN_ROOM');
    return;
  }
  const room = rooms.get(roomId);
  if (!room) {
    await denyJoinAttempt(context, roomId, 'ROOM_NOT_FOUND');
    return;
  }

  const joinAccess = await validateJoinAccess({
    roomId,
    roomSecretHash: room.secretHash,
    secret,
    token,
    tokenRecord: token ? inviteTokens.get(token) : undefined,
    now: Date.now(),
    tokenTtlMs: TOKEN_TTL_MS,
    verifySecret
  });
  if (!joinAccess.ok) {
    await denyJoinAttempt(context, roomId, joinAccess.code);
    return;
  }
  if (token && joinAccess.consumeToken) {
    inviteTokens.delete(token);
  }

  resetFailedJoin(context);

  if (context.roomId) {
    cleanupRoomMembership(context, 'switch');
  }

  context.roomId = roomId;
  context.displayName = displayName;

  const resolvedJoin = resolveJoinParticipant({
    userId: context.userId,
    displayName,
    mode: room.mode,
    activeParticipantCount: room.participants.size,
    ownerSessionToken: room.ownerSessionToken,
    activeParticipants: room.participants.values(),
    recoverableSessions: room.recoverableSessions,
    requestedSessionToken: sessionToken
  });
  const participant = resolvedJoin.participant;

  if (resolvedJoin.previousUserId) {
    const previousConnection = room.connections.get(resolvedJoin.previousUserId);
    if (previousConnection && previousConnection.ws !== context.ws) {
      previousConnection.roomId = undefined;
      previousConnection.role = undefined;
      send(previousConnection.ws, { type: 'error', message: 'Your session was resumed on another connection.' });
      previousConnection.ws.close();
    }
    room.participants.delete(resolvedJoin.previousUserId);
    room.connections.delete(resolvedJoin.previousUserId);
  }

  if (participant.sessionToken === room.ownerSessionToken) {
    room.ownerId = context.userId;
  }

  room.participants.set(participant.userId, participant);
  room.recoverableSessions.set(participant.sessionToken, toRecoverableParticipant(participant));
  room.connections.set(participant.userId, context);
  context.role = participant.role;
  auditRoomInvariants(room, 'join_room');

  send(context.ws, {
    type: 'joinedRoom',
    roomId,
    userId: context.userId,
    role: participant.role,
    participants: Array.from(room.participants.values(), toPublicParticipant),
    mode: room.mode,
    sessionToken: participant.sessionToken
  });

  broadcast(room, { type: 'participantJoined', participant: toPublicParticipant(participant) }, context.ws);
  replayDocumentsToConnection(room, context);
  log('room_joined', {
    roomId,
    userId: context.userId,
    role: participant.role,
    mode: room.mode,
    ip: context.ip,
    reclaimedSession: resolvedJoin.reclaimedSession
  });
}

async function denyJoinAttempt(
  context: ConnectionContext,
  roomId: string,
  reason: JoinFailureReason
): Promise<void> {
  const blocked = recordFailedJoin(context);
  log('join_denied', { ip: context.ip, roomId, reason, blocked });
  if (blocked) {
    return;
  }
  await new Promise(resolve => setTimeout(resolve, JOIN_FAILURE_DELAY_MS));
  const response = getJoinFailureResponse(reason);
  sendError(context.ws, response.message, response.code);
}

function cleanupConnection(context: ConnectionContext): void {
  cleanupRoomMembership(context, 'disconnect');
}

function deleteRoom(roomId: string): void {
  const room = rooms.get(roomId);
  if (!room) { return; }
  // Reclaim memory budget for all documents in this room
  for (const doc of room.documents.values()) {
    totalDocBytes -= Buffer.byteLength(doc.text, 'utf8');
  }
  if (totalDocBytes < 0) { totalDocBytes = 0; }
  // Decrement per-IP room counter using the owner's connection IP
  if (room.ownerIp) {
    const count = roomCountByIp.get(room.ownerIp) ?? 1;
    if (count <= 1) { roomCountByIp.delete(room.ownerIp); }
    else { roomCountByIp.set(room.ownerIp, count - 1); }
  }
  rooms.delete(roomId);
  leaveRoomPubSub(roomId);
  deleteRoomFromDb(roomId);
  roomLastActivity.delete(roomId);
}

function syncRecoverableParticipant(room: RoomState, participant: ParticipantState): void {
  room.recoverableSessions.set(participant.sessionToken, toRecoverableParticipant(participant));
}

function auditRoomInvariants(room: RoomState, source: string): void {
  const issues = getRoomInvariantViolations(room);
  if (issues.length === 0) {
    return;
  }
  log('room_invariant_violation', {
    roomId: room.roomId,
    source,
    issues
  });
}

function cleanupRoomMembership(
  context: ConnectionContext,
  reason: 'disconnect' | 'leave' | 'switch' = 'leave'
): void {
  if (!context.roomId) {
    return;
  }

  const room = rooms.get(context.roomId);
  if (!room) {
    context.roomId = undefined;
    context.role = undefined;
    return;
  }

  const participant = room.participants.get(context.userId);
  room.participants.delete(context.userId);
  room.connections.delete(context.userId);
  if (participant) {
    broadcast(room, { type: 'participantLeft', userId: context.userId }, context.ws);
    if (reason !== 'disconnect') {
      room.recoverableSessions.delete(participant.sessionToken);
    }
  }

  if (room.ownerId === context.userId) {
    if (reason === 'disconnect') {
      room.ownerId = getRestoredOwnerId(room.ownerSessionToken);
      log('room_owner_disconnected', { roomId: room.roomId });
    } else {
      const peersToNotify = prepareRoomClosure(room.connections.values(), context.userId);
      room.connections.clear();
      room.participants.clear();
      room.recoverableSessions.clear();
      for (const connection of peersToNotify) {
        send(connection.ws as WebSocket, { type: 'error', message: 'Room closed by root user.', code: 'ROOM_CLOSED' });
        connection.ws.close();
      }
      deleteRoom(room.roomId);
      log('room_closed', { roomId: room.roomId, reason });
    }
  }

  if (rooms.has(room.roomId)) {
    auditRoomInvariants(room, `cleanup:${reason}`);
  }

  context.roomId = undefined;
  context.role = undefined;
}

function updateRole(context: ConnectionContext, userId: string, role: Role): void {
  const room = getRoomForContext(context);
  if (!room) {
    sendError(context.ws, 'Join a room before changing roles.', 'ROOM_STATE_INVALID');
    return;
  }
  if (!canPerformOwnerAction(context.userId, room.ownerId)) {
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
  syncRecoverableParticipant(room, participant);

  const targetConnection = room.connections.get(userId);
  if (targetConnection) {
    targetConnection.role = role;
  }

  auditRoomInvariants(room, 'update_role');
  broadcast(room, { type: 'roleUpdated', userId, role });
}

function removeParticipant(context: ConnectionContext, userId: string): void {
  const room = getRoomForContext(context);
  if (!room) {
    sendError(context.ws, 'Join a room before removing participants.', 'ROOM_STATE_INVALID');
    return;
  }
  if (!canPerformOwnerAction(context.userId, room.ownerId)) {
    sendError(context.ws, 'Only the room owner can remove participants.', 'FORBIDDEN');
    return;
  }
  if (userId === room.ownerId) {
    sendError(context.ws, 'The room owner cannot be removed.', 'FORBIDDEN');
    return;
  }

  const participant = room.participants.get(userId);
  if (!participant) {
    sendError(context.ws, 'Participant not found.', 'TARGET_NOT_FOUND');
    return;
  }

  room.participants.delete(userId);
  room.recoverableSessions.delete(participant.sessionToken);

  const targetConnection = room.connections.get(userId);
  room.connections.delete(userId);
  if (targetConnection) {
    targetConnection.roomId = undefined;
    targetConnection.role = undefined;
    sendError(targetConnection.ws, 'You were removed from the room by the owner.', 'REMOVED_FROM_ROOM');
  }

  auditRoomInvariants(room, 'remove_participant');
  broadcast(room, { type: 'participantLeft', userId });
}

function setEditMode(context: ConnectionContext, userId: string, direct: boolean): void {
  const room = getRoomForContext(context);
  if (!room) {
    sendError(context.ws, 'Join a room before changing edit mode.', 'ROOM_STATE_INVALID');
    return;
  }
  if (!canChangeEditMode(context.userId, room.ownerId, userId)) {
    sendError(context.ws, 'Only the room owner or the target participant can change edit mode.', 'FORBIDDEN');
    return;
  }
  const participant = room.participants.get(userId);
  if (!participant || participant.role !== 'collaborator') {
    sendError(context.ws, 'Target collaborator not found.', 'TARGET_NOT_FOUND');
    return;
  }
  participant.isDirectEditMode = direct;
  syncRecoverableParticipant(room, participant);
  broadcast(room, { type: 'editModeUpdated', userId, isDirectEditMode: direct });
}

function handleShareDocument(context: ConnectionContext, message: Extract<ClientToServerMessage, { type: 'shareDocument' }>): void {
  const room = getRoomForContext(context);
  if (!room) {
    rejectTrackedMessage(context.ws, message, 'Join a room before sharing documents.', 'ROOM_STATE_INVALID');
    return;
  }
  if (room.roomId !== message.roomId) {
    rejectTrackedMessage(context.ws, message, 'Document share does not match your active room.', 'ROOM_STATE_INVALID');
    return;
  }
  if (!canPerformOwnerAction(context.userId, room.ownerId)) {
    rejectTrackedMessage(context.ws, message, 'Only the room owner can share documents.', 'FORBIDDEN');
    return;
  }

  if (Buffer.byteLength(message.text, 'utf8') > MAX_DOCUMENT_BYTES) {
    rejectTrackedMessage(context.ws, message, 'Document is too large to share (max 2 MB).', 'DOCUMENT_TOO_LARGE');
    return;
  }

  if (!room.documents.has(message.docId) && room.documents.size >= MAX_DOCUMENTS_PER_ROOM) {
    rejectTrackedMessage(context.ws, message, `Room document limit reached (max ${MAX_DOCUMENTS_PER_ROOM}).`, 'DOCUMENT_LIMIT');
    return;
  }

  const existing = room.documents.get(message.docId);
  if (
    existing
    && existing.text === message.text
    && existing.version === message.version
    && existing.originalUri === message.originalUri
    && existing.fileName === message.fileName
    && existing.languageId === message.languageId
  ) {
    sendAckForMessage(context.ws, message);
    return;
  }
  const nextTotalDocBytes = getNextTotalDocBytes(totalDocBytes, existing?.text ?? '', message.text);
  if (nextTotalDocBytes > MAX_TOTAL_DOC_BYTES) {
    rejectTrackedMessage(context.ws, message, 'Server memory limit reached. Cannot share more documents.', 'MEMORY_LIMIT');
    return;
  }
  totalDocBytes = nextTotalDocBytes;

  const doc: DocumentState = {
    docId: message.docId,
    text: message.text,
    version: message.version,
    originalUri: message.originalUri,
    fileName: message.fileName,
    languageId: message.languageId,
    patchHistory: [],
    yjsState: message.yjsState
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
  });
  sendAckForMessage(context.ws, message);

  log('doc_shared', { roomId: room.roomId, docId: message.docId, ownerId: room.ownerId, fileName: message.fileName });
}

function handleUnshareDocument(context: ConnectionContext, documentId: string): void {
  const room = getRoomForContext(context);
  const message: Extract<ClientToServerMessage, { type: 'unshareDocument' }> = {
    type: 'unshareDocument',
    roomId: context.roomId ?? '',
    documentId
  };
  if (!room) {
    rejectTrackedMessage(context.ws, message, 'Join a room before unsharing documents.', 'ROOM_STATE_INVALID');
    return;
  }
  if (room.roomId !== message.roomId) {
    rejectTrackedMessage(context.ws, { ...message, roomId: room.roomId }, 'Document unshare does not match your active room.', 'ROOM_STATE_INVALID');
    return;
  }
  if (!canPerformOwnerAction(context.userId, room.ownerId)) {
    rejectTrackedMessage(context.ws, message, 'Only the room owner can unshare documents.', 'FORBIDDEN');
    return;
  }
  const removed = room.documents.get(documentId);
  if (!removed) {
    sendAckForMessage(context.ws, { ...message, roomId: room.roomId });
    return;
  }
  totalDocBytes -= Buffer.byteLength(removed.text, 'utf8');
  room.documents.delete(documentId);
  broadcast(room, { type: 'documentUnshared', roomId: room.roomId, documentId });
  sendAckForMessage(context.ws, { type: 'unshareDocument', roomId: room.roomId, documentId });
  log('doc_unshared', { roomId: room.roomId, docId: documentId, ownerId: room.ownerId });
}

function handleDocChange(context: ConnectionContext, message: Extract<ClientToServerMessage, { type: 'docChange' }>): void {
  const room = getRoomForContext(context);
  if (!room || !context.role) {
    rejectTrackedMessage(context.ws, message, 'Join a room before editing shared documents.', 'ROOM_STATE_INVALID');
    return;
  }
  const participant = room.participants.get(context.userId);
  if (!canEditSharedDocument(context.role, participant)) {
    if (context.role === 'viewer') {
      rejectTrackedMessage(context.ws, message, 'Viewers are read-only.', 'FORBIDDEN');
      return;
    }
    if (context.role === 'collaborator') {
      rejectTrackedMessage(context.ws, message, 'Collaborator is in suggestion mode.', 'FORBIDDEN');
      return;
    }
    rejectTrackedMessage(context.ws, message, 'Editing is not allowed in the current room state.', 'FORBIDDEN');
    return;
  }

  const doc = room.documents.get(message.docId);
  if (!doc) {
    rejectTrackedMessage(context.ws, message, 'Document not found.', 'TARGET_NOT_FOUND');
    return;
  }

  // OT: if the client's version is behind, transform the patch against
  // all patches applied since the client's base version.
  let patchToApply = message.patch;
  if (message.version <= doc.version && doc.patchHistory.length > 0) {
    // Check for replay of an already applied patch (e.g. dropped ACK)
    const isDuplicate = doc.patchHistory.some(
      h => h.authorId === context.userId &&
           h.version > message.version &&
           h.patch.text === message.patch.text &&
           h.patch.range.start.line === message.patch.range.start.line &&
           h.patch.range.start.character === message.patch.range.start.character &&
           h.patch.range.end.line === message.patch.range.end.line &&
           h.patch.range.end.character === message.patch.range.end.character
    );

    if (isDuplicate) {
      sendAckForMessage(context.ws, message);
      return;
    }

    const transformed = transformPatch(
      doc.text,
      message.patch,
      message.version - 1, // client authored against version-1
      doc.patchHistory,
    );
    if (!transformed) {
      // Patch fully subsumed by concurrent edits — acknowledge it so reconnect queues do not replay forever.
      sendAckForMessage(context.ws, message);
      return;
    }
    patchToApply = transformed;
  }

  const baseText = doc.text;
  const updatedText = applyPatch(doc.text, patchToApply);
  if (!updatedText) {
    rejectTrackedMessage(context.ws, message, 'Invalid patch payload', 'PATCH_INVALID');
    return;
  }

  const nextTotalDocBytes = getNextTotalDocBytes(totalDocBytes, baseText, updatedText);
  if (nextTotalDocBytes > MAX_TOTAL_DOC_BYTES) {
    rejectTrackedMessage(context.ws, message, 'Server memory limit reached. Cannot apply document change.', 'MEMORY_LIMIT');
    return;
  }
  totalDocBytes = nextTotalDocBytes;
  doc.version += 1;
  const newVersion = doc.version;

  // Record in history for future OT transforms
  doc.patchHistory.push({
    patch: patchToApply,
    authorId: context.userId,
    version: newVersion,
    baseText,
  });
  // Trim history to bounded size
  if (doc.patchHistory.length > MAX_PATCH_HISTORY) {
    doc.patchHistory.splice(0, doc.patchHistory.length - MAX_PATCH_HISTORY);
  }

  doc.text = updatedText;
  room.documents.set(message.docId, doc);

  broadcast(room, {
    type: 'docChangeBroadcast',
    docId: message.docId,
    version: newVersion,
    patch: patchToApply,
    authorId: context.userId
  }, context.ws);
  sendAckForMessage(context.ws, message);
}

function handleSuggestion(
  context: ConnectionContext,
  message: Extract<ClientToServerMessage, { type: 'suggestion' }>
): void {
  const room = getRoomForContext(context);
  if (!room) {
    rejectTrackedMessage(context.ws, message, 'Join a room before sending suggestions.', 'ROOM_STATE_INVALID');
    return;
  }
  if (room.roomId !== message.roomId) {
    rejectTrackedMessage(context.ws, message, 'Suggestion room does not match your active room.', 'ROOM_STATE_INVALID');
    return;
  }

  const suggestKey = context.ip ?? context.userId;
  if (suggestionLimiter.isBlocked(suggestKey)) {
    rejectTrackedMessage(context.ws, message, 'Too many suggestions. Please wait.', 'RATE_LIMITED');
    return;
  }
  suggestionLimiter.recordFailure(suggestKey);

  const pendingSuggestionCount = Array.from(room.suggestions.values()).filter(suggestion => suggestion.status === 'pending').length;
  if (pendingSuggestionCount >= MAX_SUGGESTIONS_PER_ROOM) {
    rejectTrackedMessage(context.ws, message, `Suggestion limit reached (max ${MAX_SUGGESTIONS_PER_ROOM}).`, 'SUGGESTION_LIMIT');
    return;
  }

  const participant = room.participants.get(context.userId);
  if (!canSubmitSuggestion(participant)) {
    rejectTrackedMessage(context.ws, message, 'Only collaborators in suggestion mode can submit suggestions.', 'FORBIDDEN');
    return;
  }
  if (!room.documents.has(message.docId)) {
    rejectTrackedMessage(context.ws, message, 'Document not found.', 'TARGET_NOT_FOUND');
    return;
  }

  const existing = room.suggestions.get(message.suggestionId);
  if (existing) {
    if (isIdempotentSuggestionReplay(existing, message, participant)) {
      sendAckForMessage(context.ws, message);
      return;
    }
    rejectTrackedMessage(context.ws, message, 'Suggestion id already exists for a different review payload.', 'CONFLICT');
    return;
  }

  const suggestion = createPendingSuggestion(message, participant);
  room.suggestions.set(message.suggestionId, suggestion);

  broadcast(room, {
    type: 'newSuggestion',
    suggestion
  }, undefined);
  sendAckForMessage(context.ws, message);

  log('suggestion_created', { roomId: room.roomId, docId: message.docId, suggestionId: message.suggestionId, authorId: suggestion.authorId });
}

function handleSuggestionDecision(context: ConnectionContext, suggestionId: string, accepted: boolean): void {
  const room = getRoomForContext(context);
  if (!room) {
    sendError(context.ws, 'Join a room before reviewing suggestions.', 'ROOM_STATE_INVALID');
    sendAckKey(context.ws, `suggest:${suggestionId}`);
    return;
  }
  if (!canPerformOwnerAction(context.userId, room.ownerId)) {
    sendError(context.ws, 'Only the room owner can review suggestions.', 'FORBIDDEN');
    sendAckKey(context.ws, `suggest:${suggestionId}`);
    return;
  }

  const result = reviewSuggestion(room, context.userId, suggestionId, accepted ? 'accept' : 'reject');
  if (result.outcome === 'missing' || result.outcome === 'already-reviewed') {
    sendAckKey(context.ws, `suggest:${suggestionId}`);
    return;
  }
  if (result.outcome === 'error') {
    rejectTrackedMessage(
      context.ws,
      accepted
        ? { type: 'acceptSuggestion', roomId: room.roomId, suggestionId }
        : { type: 'rejectSuggestion', roomId: room.roomId, suggestionId },
      result.message,
      result.code
    );
    return;
  }

  sendAckKey(context.ws, `suggest:${suggestionId}`);
}

function handleReviewSuggestions(
  context: ConnectionContext,
  message: Extract<ClientToServerMessage, { type: 'reviewSuggestions' }>
): void {
  const room = getRoomForContext(context);
  if (!room || room.roomId !== message.roomId) {
    sendError(context.ws, 'Join the target room before reviewing suggestions.', 'ROOM_STATE_INVALID');
    return;
  }
  if (!canPerformOwnerAction(context.userId, room.ownerId)) {
    sendError(context.ws, 'Only the room owner can review suggestions.', 'FORBIDDEN');
    return;
  }

  const suggestionIds = Array.from(new Set(message.suggestionIds));
  let reviewedCount = 0;
  let alreadyReviewedCount = 0;
  let conflictCount = 0;
  let missingCount = 0;

  for (const suggestionId of suggestionIds) {
    const result = reviewSuggestion(room, context.userId, suggestionId, message.action);
    switch (result.outcome) {
      case 'reviewed':
        reviewedCount += 1;
        break;
      case 'already-reviewed':
        alreadyReviewedCount += 1;
        break;
      case 'error':
        conflictCount += 1;
        break;
      case 'missing':
        missingCount += 1;
        break;
    }
  }

  send(context.ws, {
    type: 'suggestionsReviewed',
    roomId: room.roomId,
    action: message.action,
    requestedCount: suggestionIds.length,
    reviewedCount,
    alreadyReviewedCount,
    conflictCount,
    missingCount
  });
}

function reviewSuggestion(
  room: RoomState,
  reviewerId: string,
  suggestionId: string,
  action: SuggestionReviewAction
):
  | { outcome: 'reviewed' | 'already-reviewed' | 'missing' }
  | { outcome: 'error'; code: string; message: string } {
  const suggestion = room.suggestions.get(suggestionId);
  if (!suggestion) {
    return { outcome: 'missing' };
  }

  if (suggestion.status !== 'pending') {
    if (
      (action === 'accept' && suggestion.status === 'accepted')
      || (action === 'reject' && suggestion.status === 'rejected')
    ) {
      return { outcome: 'already-reviewed' };
    }
    return {
      outcome: 'error',
      code: 'SUGGESTION_ALREADY_REVIEWED',
      message: `Suggestion already ${suggestion.status}.`
    };
  }

  if (action === 'accept') {
    const doc = room.documents.get(suggestion.docId);
    if (!doc) {
      return {
        outcome: 'error',
        code: 'TARGET_NOT_FOUND',
        message: 'Document not found.'
      };
    }

    const appliedSuggestion = applySuggestionPatches(doc.text, doc.version, suggestion.patches, suggestion.authorId);
    if (!appliedSuggestion) {
      return {
        outcome: 'error',
        code: 'PATCH_INVALID',
        message: 'Invalid suggestion payload'
      };
    }

    const nextTotalDocBytes = getNextTotalDocBytes(totalDocBytes, doc.text, appliedSuggestion.text);
    if (nextTotalDocBytes > MAX_TOTAL_DOC_BYTES) {
      return {
        outcome: 'error',
        code: 'MEMORY_LIMIT',
        message: 'Server memory limit reached. Cannot accept suggestion.'
      };
    }

    totalDocBytes = nextTotalDocBytes;
    doc.text = appliedSuggestion.text;
    doc.version = appliedSuggestion.version;
    doc.patchHistory.push(...appliedSuggestion.history);
    if (doc.patchHistory.length > MAX_PATCH_HISTORY) {
      doc.patchHistory.splice(0, doc.patchHistory.length - MAX_PATCH_HISTORY);
    }
    for (const entry of appliedSuggestion.history) {
      broadcast(room, {
        type: 'docChangeBroadcast',
        docId: suggestion.docId,
        version: entry.version,
        patch: entry.patch,
        authorId: suggestion.authorId
      });
    }
    room.documents.set(suggestion.docId, doc);
  }

  const reviewed = transitionSuggestionStatus(suggestion, action, reviewerId);
  room.suggestions.set(suggestionId, reviewed);
  pruneReviewedSuggestions(room.suggestions, MAX_REVIEWED_SUGGESTIONS);
  broadcast(room, {
    type: action === 'accept' ? 'suggestionAccepted' : 'suggestionRejected',
    suggestionId,
    docId: suggestion.docId
  });

  log(action === 'accept' ? 'suggestion_accepted' : 'suggestion_rejected', {
    roomId: room.roomId,
    suggestionId,
    docId: suggestion.docId,
    reviewedById: reviewerId
  });

  return { outcome: 'reviewed' };
}

function handleRequestFullSync(context: ConnectionContext, roomId: string, docId: string): void {
  const room = getRoomForContext(context);
  if (!room || room.roomId !== roomId) {
    rejectTrackedMessage(context.ws, { type: 'requestFullSync', roomId, docId }, 'Room does not match your active session.', 'ROOM_STATE_INVALID');
    return;
  }
  const ownerConnection = room.connections.get(room.ownerId);
  if (!ownerConnection) {
    rejectTrackedMessage(context.ws, { type: 'requestFullSync', roomId, docId }, 'Room owner is unavailable for full sync.', 'OWNER_UNAVAILABLE');
    return;
  }
  send(ownerConnection.ws, {
    type: 'requestFullSync',
    roomId,
    docId
  });
  sendAckForMessage(context.ws, { type: 'requestFullSync', roomId, docId });
}

function handleFullDocumentSync(
  context: ConnectionContext,
  message: Extract<ClientToServerMessage, { type: 'fullDocumentSync' }>
): void {
  const room = getRoomForContext(context);
  if (!room || room.roomId !== message.roomId) {
    rejectTrackedMessage(context.ws, message, 'Room does not match your active session.', 'ROOM_STATE_INVALID');
    return;
  }
  if (!canPerformOwnerAction(context.userId, room.ownerId)) {
    rejectTrackedMessage(context.ws, message, 'Only the room owner can publish a full sync.', 'FORBIDDEN');
    return;
  }
  const doc = room.documents.get(message.docId);
  if (!doc) {
    rejectTrackedMessage(context.ws, message, 'Document not found.', 'TARGET_NOT_FOUND');
    return;
  }
  const nextTotalDocBytes = getNextTotalDocBytes(totalDocBytes, doc.text, message.text);
  if (nextTotalDocBytes > MAX_TOTAL_DOC_BYTES) {
    rejectTrackedMessage(context.ws, message, 'Server memory limit reached. Cannot apply full sync.', 'MEMORY_LIMIT');
    return;
  }
  totalDocBytes = nextTotalDocBytes;
  doc.text = message.text;
  doc.version = message.version;
  doc.yjsState = message.yjsState;
  doc.patchHistory = []; // reset history on full sync
  room.documents.set(message.docId, doc);

  broadcast(room, {
    type: 'fullDocumentSync',
    roomId: room.roomId,
    docId: message.docId,
    text: message.text,
    version: message.version,
    yjsState: message.yjsState
  }, context.ws);
  sendAckForMessage(context.ws, message);
}

function handleRootCursor(
  context: ConnectionContext,
  message: Extract<ClientToServerMessage, { type: 'rootCursor' }>
): void {
  const room = getRoomForContext(context);
  if (!room || room.roomId !== message.roomId) {
    sendError(context.ws, 'Room does not match your active session.', 'ROOM_STATE_INVALID');
    return;
  }
  if (!canPerformOwnerAction(context.userId, room.ownerId)) {
    sendError(context.ws, 'Only the room owner can broadcast the root cursor.', 'FORBIDDEN');
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

function handleAwarenessUpdate(
  context: ConnectionContext,
  message: Extract<ClientToServerMessage, { type: 'awarenessUpdate' }>
): void {
  const room = getRoomForContext(context);
  if (!room || room.roomId !== message.roomId) {
    return;
  }
  
  // Rate limit awareness updates per doc/user
  const cursorKey = `${room.roomId}:${context.userId}`;
  if (cursorLimiter.isBlocked(cursorKey)) {
    return;
  }
  cursorLimiter.recordFailure(cursorKey);

  broadcast(
    room,
    {
      type: 'awarenessUpdate',
      docId: message.docId,
      update: message.update
    },
    context.ws
  );
}

function handleVoiceSignal(
  context: ConnectionContext,
  message: Extract<ClientToServerMessage, { type: 'voiceSignal' }>
): void {
  const room = getRoomForContext(context);
  if (!room || room.roomId !== message.roomId) {
    return;
  }
  
  const target = room.connections.get(message.targetUserId);
  if (target && target.ws.readyState === WebSocket.OPEN) {
    send(target.ws, {
      type: 'voiceSignal',
      fromUserId: context.userId,
      signal: message.signal
    });
  }
}

function handleParticipantActivity(
  context: ConnectionContext,
  message: Extract<ClientToServerMessage, { type: 'participantActivity' }>
): void {
  const room = getRoomForContext(context);
  if (!room || room.roomId !== message.roomId) {
    return;
  }

  const activityKey = `${room.roomId}:${context.userId}`;
  if (activityLimiter.isBlocked(activityKey)) {
    return;
  }
  activityLimiter.recordFailure(activityKey);

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
    rejectTrackedMessage(context.ws, message, 'Room does not match your active session.', 'ROOM_STATE_INVALID');
    return;
  }

  const participant = room.participants.get(context.userId);
  if (!participant) {
    rejectTrackedMessage(context.ws, message, 'Participant is not active in this room.', 'ROOM_STATE_INVALID');
    return;
  }

  if (!canSendChat(participant)) {
    rejectTrackedMessage(context.ws, message, 'Viewers cannot send messages.', 'FORBIDDEN');
    return;
  }

  const chatKey = context.ip ?? context.userId;
  if (chatLimiter.isBlocked(chatKey)) {
    rejectTrackedMessage(context.ws, message, 'You are sending messages too fast. Please wait.', 'RATE_LIMITED');
    return;
  }
  chatLimiter.recordFailure(chatKey);

  const trimmed = message.content.trim();
  if (!trimmed) {
    rejectTrackedMessage(context.ws, message, 'Message cannot be empty.', 'MESSAGE_EMPTY');
    return;
  }
  if (trimmed.length > 4096) {
    rejectTrackedMessage(context.ws, message, 'Message is too long (max 4096 characters).', 'MESSAGE_TOO_LONG');
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
  sendAckForMessage(context.ws, message);
  log('chat_message', { roomId: room.roomId, userId: participant.userId, role: participant.role });
}

function handleCreateToken(context: ConnectionContext, label?: string): void {
  const room = getRoomForContext(context);
  if (!room) {
    sendError(context.ws, 'Join a room before generating invite tokens.', 'ROOM_STATE_INVALID');
    return;
  }
  if (!canPerformOwnerAction(context.userId, room.ownerId)) {
    sendError(context.ws, 'Only the room owner can generate invite tokens.', 'FORBIDDEN');
    return;
  }
  if (label && label.length > MAX_INVITE_LABEL_LENGTH) {
    sendError(context.ws, `Invite labels must be ${MAX_INVITE_LABEL_LENGTH} characters or fewer.`, 'LABEL_TOO_LONG');
    return;
  }
  const token = randomBytes(16).toString('hex');
  inviteTokens.set(token, { roomId: room.roomId, label, createdAt: Date.now() });
  send(context.ws, { type: 'tokenCreated', token, label });
  log('token_created', { roomId: room.roomId, label });
}

function broadcast(room: RoomState, message: ServerToClientMessage, except?: WebSocket, isFromRedis = false): void {
  if (!isFromRedis) {
    broadcastToRoomPubSub(room.roomId, message);
  }

  for (const connection of room.connections.values()) {
    if (connection.ws === except) {
      continue;
    }
    send(connection.ws, message);
  }
}

function send(ws: WebSocket, message: ServerToClientMessage): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(pack(message));
}

function sendAckForMessage(ws: WebSocket, message: ClientToServerMessage): void {
  const key = getClientMessageAckKey(message);
  if (!key) {
    return;
  }
  sendAckKey(ws, key);
}

function sendAckKey(ws: WebSocket, key: string): void {
  send(ws, { type: 'ack', key });
}

function sendError(ws: WebSocket, message: string, code?: string): void {
  send(ws, { type: 'error', message, code });
}

function rejectTrackedMessage(ws: WebSocket, message: ClientToServerMessage, errorMessage: string, code: string): void {
  for (const response of buildTrackedErrorResponses(message, errorMessage, code)) {
    send(ws, response);
  }
}

function replayDocumentsToConnection(room: RoomState, context: ConnectionContext): void {
  for (const doc of room.documents.values()) {
    send(context.ws, {
      type: 'shareDocument',
      roomId: room.roomId,
      docId: doc.docId,
      originalUri: doc.originalUri,
      fileName: doc.fileName,
      languageId: doc.languageId ?? 'text',
      text: doc.text,
      version: doc.version,
      yjsState: doc.yjsState
    });
  }
  replaySuggestionsToConnection(room, context);
}

function replaySuggestionsToConnection(room: RoomState, context: ConnectionContext): void {
  const suggestions = getPendingSuggestionsForRole(room.suggestions.values(), context.role);
  if (!suggestions.length) {
    return;
  }
  send(context.ws, { type: 'syncSuggestions', suggestions });
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
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  if (rooms.has(code)) {
    return generateRoomId();
  }
  return code;
}

async function hashSecret(secret: string, salt: string): Promise<string> {
  const derived = await pbkdf2Async(secret, salt, 100_000, 32, 'sha256');
  return 'pbkdf2:' + derived.toString('hex');
}

async function verifySecret(secret: string, roomId: string, storedHash: string): Promise<boolean> {
  if (!storedHash.startsWith('pbkdf2:')) {
    // Legacy rooms cannot be verified safely — reject and require re-creation
    return false;
  }
  const newHash = Buffer.from((await hashSecret(secret, roomId)).slice('pbkdf2:'.length), 'hex');
  const stored = Buffer.from(storedHash.slice('pbkdf2:'.length), 'hex');
  return newHash.length === stored.length && timingSafeEqual(newHash, stored);
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

function recordFailedJoin(context: ConnectionContext): boolean {
  const key = context.ip ?? 'unknown';
  const blocked = joinLimiter.recordFailure(key);
  if (blocked) {
    sendError(context.ws, 'Too many failed attempts. Try again later.', 'RATE_LIMITED');
    context.ws.close();
    log('join_blocked', { ip: key });
  }
  return blocked;
}

function resetFailedJoin(context: ConnectionContext): void {
  const key = context.ip ?? 'unknown';
  joinLimiter.reset(key);
}

function loadConfig(): { host?: string; port?: number; cert?: string; key?: string } {
  try {
    const path = `${process.cwd()}/coderooms.config.json`;
    if (!fs.existsSync(path)) {
      return {};
    }
    const raw = fs.readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as { host?: string; port?: number; cert?: string; key?: string };
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
  const participant = room.participants.get(context.userId);
  if (!participant) return;

  const cursorKey = `${room.roomId}:${context.userId}`;
  if (cursorLimiter.isBlocked(cursorKey)) {
    return;
  }
  cursorLimiter.recordFailure(cursorKey);

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
    context.ws
  );
}

if (!process.env.VITEST && require.main === module) {
  const args = minimist(process.argv.slice(2), {
    alias: { p: 'port', h: 'host' },
    string: ['port', 'host', 'cert', 'key']
  });
  const fileConfig = loadConfig();
  const port = Number(args.port ?? process.env.CODEROOMS_PORT ?? fileConfig.port ?? 5171);
  const host = (args.host ?? process.env.CODEROOMS_HOST ?? fileConfig.host ?? '127.0.0.1') as string;
  const certPath = args.cert ?? process.env.CODEROOMS_CERT ?? fileConfig.cert;
  const keyPath = args.key ?? process.env.CODEROOMS_KEY ?? fileConfig.key;

  void startCodeRoomsServer({
    port,
    host,
    certPath,
    keyPath,
    logToConsole: true
  }).catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    log('server_start_error', { error: message });
    console.error(`Failed to start CodeRooms server: ${message}`);
    process.exit(1);
  });
}
