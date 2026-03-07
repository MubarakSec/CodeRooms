"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const fs_1 = __importDefault(require("fs"));
const minimist_1 = __importDefault(require("minimist"));
const uuid_1 = require("uuid");
const ws_1 = require("ws");
const logger_1 = require("./logger");
const patch_1 = require("./patch");
const rateLimiter_1 = require("./rateLimiter");
const path_1 = __importDefault(require("path"));
const msgpackr_1 = require("msgpackr");
const rooms = new Map();
const joinLimiter = new rateLimiter_1.RateLimiter(60000, 20, 3 * 60000);
const MAX_CHAT_MESSAGES = 500;
const BACKUP_DIR = path_1.default.join(__dirname, '..', 'backups');
const BACKUP_FILE = path_1.default.join(BACKUP_DIR, 'rooms-backup.json');
// Ensure backup directory exists
if (!fs_1.default.existsSync(BACKUP_DIR)) {
    fs_1.default.mkdirSync(BACKUP_DIR, { recursive: true });
}
function saveRooms() {
    const data = {};
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
    fs_1.default.writeFileSync(BACKUP_FILE, JSON.stringify(data, null, 2));
    // Create timestamped backup (keep last 10)
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const archivedFile = path_1.default.join(BACKUP_DIR, `rooms-${timestamp}.json`);
    fs_1.default.writeFileSync(archivedFile, JSON.stringify(data, null, 2));
    // Cleanup old backups (keep last 10)
    try {
        const files = fs_1.default.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('rooms-') && f.endsWith('.json') && f !== 'rooms-backup.json')
            .sort()
            .reverse();
        if (files.length > 10) {
            for (let i = 10; i < files.length; i++) {
                fs_1.default.unlinkSync(path_1.default.join(BACKUP_DIR, files[i]));
            }
        }
    }
    catch (e) {
        (0, logger_1.log)('backup_cleanup_error', { error: String(e) });
    }
}
function loadRooms() {
    if (fs_1.default.existsSync(BACKUP_FILE)) {
        try {
            const raw = fs_1.default.readFileSync(BACKUP_FILE, 'utf-8');
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
            (0, logger_1.log)('server_start', { message: `Restored ${rooms.size} rooms from backup` });
        }
        catch (e) {
            (0, logger_1.log)('error', { message: 'Failed to load rooms backup', error: String(e) });
        }
    }
}
const args = (0, minimist_1.default)(process.argv.slice(2), {
    alias: { p: 'port', h: 'host' },
    string: ['port', 'host']
});
const fileConfig = loadConfig();
const port = Number(args.port ?? process.env.CODEROOMS_PORT ?? fileConfig.port ?? 5171);
const host = (args.host ?? process.env.CODEROOMS_HOST ?? fileConfig.host ?? '127.0.0.1');
const wss = new ws_1.WebSocketServer({ port, host });
(0, logger_1.log)('server_listening', { host, port });
console.log(`CodeRooms server listening on ws://${host}:${port}`);
// Load rooms from backup on startup
loadRooms();
// Auto-save rooms every 30 seconds
setInterval(() => {
    if (rooms.size > 0) {
        saveRooms();
    }
}, 30000);
// Save rooms on shutdown
process.on('SIGTERM', () => {
    (0, logger_1.log)('server_shutdown', { reason: 'SIGTERM' });
    saveRooms();
    process.exit(0);
});
process.on('SIGINT', () => {
    (0, logger_1.log)('server_shutdown', { reason: 'SIGINT' });
    saveRooms();
    process.exit(0);
});
// Idle room cleanup: remove rooms with no connections every 5 minutes
const IDLE_ROOM_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const roomLastActivity = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms) {
        if (room.connections.size === 0) {
            const lastActive = roomLastActivity.get(roomId) ?? now;
            if (now - lastActive > IDLE_ROOM_TIMEOUT_MS) {
                rooms.delete(roomId);
                roomLastActivity.delete(roomId);
                (0, logger_1.log)('room_idle_cleanup', { roomId });
            }
        }
        else {
            roomLastActivity.set(roomId, now);
        }
    }
}, 5 * 60 * 1000);
wss.on('connection', (ws, request) => {
    const ip = request.socket.remoteAddress ?? 'unknown';
    const context = { ws, userId: (0, uuid_1.v4)(), ip };
    ws.on('message', payload => {
        try {
            let message;
            if (Buffer.isBuffer(payload) || payload instanceof Uint8Array || Array.isArray(payload)) {
                message = (0, msgpackr_1.unpack)(payload);
            }
            else {
                message = JSON.parse(payload.toString());
            }
            handleMessage(context, message);
        }
        catch (error) {
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
        }
        else {
            clearInterval(pingTimer);
        }
    }, 30000);
    ws.on('close', () => clearInterval(pingTimer));
});
function handleMessage(context, message) {
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
            handleCursorUpdate(context, message);
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
function createRoom(context, displayName, mode = 'team', secret) {
    const roomId = generateRoomId();
    const room = {
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
    const participant = {
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
    (0, logger_1.log)('room_created', { roomId, ownerId: context.userId, mode: room.mode, hasSecret: Boolean(room.secretHash) });
}
function joinRoom(context, roomId, displayName, secret) {
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
    const defaultRole = room.mode === 'classroom' || isLargeRoom ? 'viewer' : 'collaborator';
    context.role = defaultRole;
    context.displayName = displayName;
    const participant = {
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
    (0, logger_1.log)('room_joined', { roomId, userId: context.userId, role: defaultRole, mode: room.mode, ip: context.ip });
}
function cleanupConnection(context) {
    cleanupRoomMembership(context);
}
function cleanupRoomMembership(context) {
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
        (0, logger_1.log)('room_closed', { roomId: room.roomId });
    }
    context.roomId = undefined;
    context.role = undefined;
}
function updateRole(context, userId, role) {
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
function setEditMode(context, userId, direct) {
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
function handleShareDocument(context, message) {
    const room = getRoomForContext(context);
    if (!room || context.userId !== room.ownerId) {
        return;
    }
    const doc = {
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
    (0, logger_1.log)('doc_shared', { roomId: room.roomId, docId: message.docId, ownerId: room.ownerId, fileName: message.fileName });
}
function handleUnshareDocument(context, documentId) {
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
    (0, logger_1.log)('doc_unshared', { roomId: room.roomId, docId: documentId, ownerId: room.ownerId });
}
function handleDocChange(context, message) {
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
    const updatedText = (0, patch_1.applyPatch)(doc.text, message.patch);
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
function handleSuggestion(context, message) {
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
    (0, logger_1.log)('suggestion_created', { roomId: room.roomId, docId: message.docId, suggestionId: message.suggestionId, authorId: message.authorId });
}
function handleSuggestionDecision(context, suggestionId, accepted) {
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
        const updatedText = (0, patch_1.applyPatches)(doc.text, suggestion.patches);
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
    (0, logger_1.log)(accepted ? 'suggestion_accepted' : 'suggestion_rejected', {
        roomId: room.roomId,
        suggestionId,
        docId: suggestion.docId
    });
}
function handleRequestFullSync(context, roomId, docId) {
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
function handleFullDocumentSync(context, message) {
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
function handleRootCursor(context, message) {
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
function handleParticipantActivity(context, message) {
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
function handleChatSend(context, message) {
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
    const chatMsg = {
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
    const broadcastMsg = {
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
    (0, logger_1.log)('chat_message', { roomId: room.roomId, userId: participant.userId, role: participant.role });
}
function broadcast(room, message, except) {
    for (const connection of room.connections.values()) {
        if (connection.ws === except) {
            continue;
        }
        send(connection.ws, message);
    }
}
function send(ws, message) {
    ws.send((0, msgpackr_1.pack)(message));
}
function sendError(ws, message, code) {
    send(ws, { type: 'error', message, code });
}
function replayDocumentsToConnection(room, context) {
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
function getRoomForContext(context) {
    if (!context.roomId) {
        return undefined;
    }
    return rooms.get(context.roomId);
}
function generateRoomId() {
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
function hashSecret(secret) {
    return (0, crypto_1.createHash)('sha256').update(secret).digest('hex');
}
function isJoinBlocked(context) {
    const key = context.ip ?? 'unknown';
    if (joinLimiter.isBlocked(key)) {
        sendError(context.ws, 'Too many failed attempts. Try again later.', 'RATE_LIMITED');
        context.ws.close();
        (0, logger_1.log)('join_blocked', { ip: key });
        return true;
    }
    return false;
}
function recordFailedJoin(context) {
    const key = context.ip ?? 'unknown';
    const blocked = joinLimiter.recordFailure(key);
    if (blocked) {
        sendError(context.ws, 'Too many failed attempts. Try again later.', 'RATE_LIMITED');
        context.ws.close();
        (0, logger_1.log)('join_blocked', { ip: key });
    }
}
function resetFailedJoin(context) {
    const key = context.ip ?? 'unknown';
    joinLimiter.reset(key);
}
function loadConfig() {
    try {
        const path = `${process.cwd()}/coderooms.config.json`;
        if (!fs_1.default.existsSync(path)) {
            return {};
        }
        const raw = fs_1.default.readFileSync(path, 'utf-8');
        const parsed = JSON.parse(raw);
        return parsed ?? {};
    }
    catch (error) {
        (0, logger_1.log)('config_error', { error: error instanceof Error ? error.message : String(error) });
        return {};
    }
}
function handleCursorUpdate(context, message) {
    const room = getRoomForContext(context);
    if (!room || room.roomId !== message.roomId) {
        return;
    }
    const participant = room.participants.find((p) => p.userId === context.userId);
    if (!participant)
        return;
    broadcast(room, {
        type: 'cursorUpdate',
        roomId: room.roomId,
        userId: context.userId,
        userName: participant.displayName,
        docId: message.docId,
        uri: message.uri,
        position: message.position,
        selections: message.selections,
    }, context.userId);
}
