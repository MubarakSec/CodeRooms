"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const WebSocketClient_1 = require("./connection/WebSocketClient");
const RoomState_1 = require("./core/RoomState");
const DocumentSync_1 = require("./core/DocumentSync");
const FollowController_1 = require("./core/FollowController");
const RoomStorage_1 = require("./core/RoomStorage");
const SuggestionManager_1 = require("./core/SuggestionManager");
const ChatManager_1 = require("./core/ChatManager");
const StatusBarManager_1 = require("./ui/StatusBarManager");
const ParticipantsView_1 = require("./ui/ParticipantsView");
const ChatView_1 = require("./ui/ChatView");
const config_1 = require("./util/config");
const logger_1 = require("./util/logger");
const uuid_1 = require("uuid");
const DISPLAY_NAME_KEY = 'coderooms.displayName';
const ROOM_MODE_SETTING_KEY = 'mode';
var ConnectionIntent;
(function (ConnectionIntent) {
    ConnectionIntent[ConnectionIntent["Automatic"] = 0] = "Automatic";
    ConnectionIntent[ConnectionIntent["ForceReconnect"] = 1] = "ForceReconnect";
})(ConnectionIntent || (ConnectionIntent = {}));
function activate(context) {
    const roomState = new RoomState_1.RoomState();
    const roomStorage = new RoomStorage_1.RoomStorage(context.globalStorageUri);
    const followController = new FollowController_1.FollowController();
    const statusBar = new StatusBarManager_1.StatusBarManager(roomState, followController);
    const webSocket = new WebSocketClient_1.WebSocketClient();
    let isConnected = false;
    let connectionPromise;
    const pendingOffline = [];
    const pendingAck = new Map();
    const pendingRoleUpdates = new Map();
    let lastRootCursorMessage;
    const messageKey = (message) => {
        switch (message.type) {
            case 'chatSend':
                return `chat:${message.messageId}`;
            case 'docChange':
                return `doc:${message.docId}:${message.version}`;
            case 'suggestion':
                return `suggest:${message.suggestionId}`;
            case 'acceptSuggestion':
            case 'rejectSuggestion':
                return `suggest:${message.suggestionId}`;
            case 'shareDocument':
                return `share:${message.docId}`;
            case 'unshareDocument':
                return `unshare:${message.documentId}`;
            case 'fullDocumentSync':
                return `full:${message.docId}:${message.version}`;
            case 'requestFullSync':
                return `reqfull:${message.docId}`;
            default:
                return undefined;
        }
    };
    const flushPending = () => {
        if (!isConnected) {
            return;
        }
        // Resend ack-waiting messages
        for (const [, msg] of pendingAck) {
            webSocket.send(msg);
        }
        // Send offline queued messages
        while (pendingOffline.length) {
            const next = pendingOffline.shift();
            if (next) {
                const key = messageKey(next);
                if (key && pendingAck.has(key)) {
                    continue;
                }
                if (key) {
                    pendingAck.set(key, next);
                }
                webSocket.send(next);
            }
        }
    };
    const sendClientMessage = (message) => {
        if (isConnected) {
            const key = messageKey(message);
            if (key) {
                pendingAck.set(key, message);
            }
            webSocket.send(message);
        }
        else {
            const key = messageKey(message);
            if (key) {
                pendingAck.set(key, message);
            }
            pendingOffline.push(message);
        }
    };
    const applyDebugConfig = () => {
        const enabled = vscode.workspace.getConfiguration('coderooms').get('debugLogging') ?? false;
        logger_1.logger.setDebugLogging(enabled);
    };
    applyDebugConfig();
    const configWatcher = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('coderooms.debugLogging')) {
            applyDebugConfig();
        }
    });
    const getConfiguredRoomMode = () => vscode.workspace.getConfiguration('coderooms').get(ROOM_MODE_SETTING_KEY) ?? 'team';
    const recordRoomInfo = async (roomId, mode) => {
        try {
            await roomStorage.recordRoomInfo(roomId, mode);
        }
        catch (error) {
            logger_1.logger.warn(`Unable to record room metadata for ${roomId}: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const logRoomEvent = async (event) => {
        const roomId = roomState.getRoomId();
        if (!roomId || !roomState.isRoot()) {
            return;
        }
        try {
            await roomStorage.appendEvent(roomId, { ...event, roomId, timestamp: Date.now() });
        }
        catch (error) {
            logger_1.logger.warn(`Failed to append room event: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const documentSync = new DocumentSync_1.DocumentSync(roomState, roomStorage, sendClientMessage);
    const suggestionManager = new SuggestionManager_1.SuggestionManager(roomState, documentSync);
    const participantsView = new ParticipantsView_1.ParticipantsView(roomState, documentSync, suggestionManager, followController);
    const chatManager = new ChatManager_1.ChatManager(context.globalState);
    const chatView = new ChatView_1.ChatView(chatManager);
    let lastJoinRoomId;
    let lastJoinDisplayName;
    let refreshTimer;
    const followDisposable = followController.onDidChange(async () => {
        statusBar.update();
        scheduleRefresh();
        if (followController.isFollowing() && lastRootCursorMessage) {
            await documentSync.revealRemoteCursor(lastRootCursorMessage.docId, lastRootCursorMessage.position, lastRootCursorMessage.uri);
        }
    });
    let pendingRootCursorEditor;
    let rootCursorTimer;
    const rootCursorDebounceMs = 150;
    const sendRootCursorUpdate = (editor) => {
        if (!roomState.isRoot()) {
            return;
        }
        const roomId = roomState.getRoomId();
        const docId = documentSync.getActiveDocumentId();
        const sharedUri = documentSync.getSharedDocumentUri();
        if (!roomId || !docId || !sharedUri) {
            return;
        }
        if (editor.document.uri.toString() !== sharedUri.toString()) {
            return;
        }
        const pos = editor.selection.active;
        sendClientMessage({
            type: 'rootCursor',
            roomId,
            docId,
            uri: sharedUri.toString(),
            position: { line: pos.line, character: pos.character }
        });
    };
    const scheduleRootCursorBroadcast = (editor) => {
        if (!editor) {
            return;
        }
        pendingRootCursorEditor = editor;
        if (rootCursorTimer) {
            return;
        }
        rootCursorTimer = setTimeout(() => {
            rootCursorTimer = undefined;
            const target = pendingRootCursorEditor;
            pendingRootCursorEditor = undefined;
            if (target) {
                sendRootCursorUpdate(target);
            }
        }, rootCursorDebounceMs);
    };
    suggestionManager.setHandlers(suggestion => documentSync.acceptSuggestion(suggestion), suggestion => documentSync.rejectSuggestion(suggestion));
    const explorerTree = vscode.window.createTreeView('coderoomsParticipants', {
        treeDataProvider: participantsView
    });
    participantsView.registerTreeView('coderoomsParticipants', explorerTree);
    const sessionTree = vscode.window.createTreeView('coderoomsPanel', {
        treeDataProvider: participantsView
    });
    participantsView.registerTreeView('coderoomsPanel', sessionTree);
    const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(editor => scheduleRootCursorBroadcast(editor));
    const selectionListener = vscode.window.onDidChangeTextEditorSelection(event => scheduleRootCursorBroadcast(event.textEditor));
    context.subscriptions.push(explorerTree, sessionTree, vscode.window.registerWebviewViewProvider('coderoomsChatView', chatView), activeEditorListener, selectionListener, followDisposable, { dispose: () => webSocket.disconnect() }, { dispose: () => suggestionManager.dispose() }, { dispose: () => documentSync.dispose() }, { dispose: () => statusBar.dispose() });
    suggestionManager.onDidChange(() => participantsView.refresh());
    documentSync.onDidChangeSharedDocument(() => participantsView.refresh());
    const scheduleRefresh = () => {
        if (refreshTimer) {
            return;
        }
        const debounceMs = 180;
        refreshTimer = setTimeout(() => {
            refreshTimer = undefined;
            participantsView.refresh();
        }, debounceMs);
    };
    webSocket.on('message', message => {
        void handleServerMessage(message);
    });
    webSocket.on('close', () => {
        isConnected = false;
        statusBar.setConnectionState('disconnected', 'Connection closed');
        void vscode.window.showWarningMessage('Disconnected from CodeRooms server.');
        resetState();
    });
    function resetState() {
        roomState.reset();
        documentSync.reset();
        suggestionManager.reset();
        followController.reset();
        chatManager.clear();
        chatManager.setRoom(undefined);
        pendingOffline.splice(0, pendingOffline.length);
        pendingAck.clear();
        pendingRoleUpdates.forEach(timer => clearTimeout(timer));
        pendingRoleUpdates.clear();
        lastRootCursorMessage = undefined;
        statusBar.update();
        scheduleRefresh();
    }
    async function ensureConnection(intent = ConnectionIntent.Automatic) {
        if (intent === ConnectionIntent.ForceReconnect && isConnected) {
            webSocket.disconnect();
            isConnected = false;
        }
        if (isConnected) {
            return true;
        }
        if (connectionPromise) {
            await connectionPromise;
            return isConnected;
        }
        const serverUrl = vscode.workspace.getConfiguration('coderooms').get('serverUrl') ?? config_1.DEFAULT_SERVER_URL;
        statusBar.setConnectionState('connecting', serverUrl);
        connectionPromise = webSocket
            .connect(serverUrl)
            .then(() => {
            isConnected = true;
            connectionPromise = undefined;
            statusBar.setConnectionState('connected');
            flushPending();
        })
            .catch(error => {
            isConnected = false;
            connectionPromise = undefined;
            const detail = `Unable to reach ${serverUrl}`;
            logger_1.logger.error(`Unable to connect: ${error instanceof Error ? error.message : String(error)}`);
            statusBar.setConnectionState('error', detail);
            vscode.window.showErrorMessage(`${detail}. Make sure the CodeRooms server is running.`);
        });
        await connectionPromise;
        return isConnected;
    }
    async function handleServerMessage(message) {
        switch (message.type) {
            case 'roomCreated': {
                resetState();
                const displayName = await getStoredDisplayName(context);
                roomState.setSelfInfo(message.userId, 'root', message.roomId, displayName);
                roomState.setMode(message.mode);
                await recordRoomInfo(message.roomId, message.mode);
                chatManager.setRoom(message.roomId);
                await logRoomEvent({ type: 'joined', userId: message.userId });
                statusBar.update();
                scheduleRefresh();
                const action = await vscode.window.showInformationMessage(`CodeRoom ready: ${message.roomId}`, 'Copy invite code');
                if (action) {
                    await vscode.env.clipboard.writeText(message.roomId);
                    void vscode.window.showInformationMessage('Room ID copied to clipboard.');
                }
                break;
            }
            case 'joinedRoom': {
                if (roomState.getRoomId() !== message.roomId) {
                    resetState();
                }
                const displayName = await getStoredDisplayName(context);
                roomState.setSelfInfo(message.userId, message.role, message.roomId, displayName);
                roomState.setMode(message.mode);
                await recordRoomInfo(message.roomId, message.mode);
                roomState.setParticipants(message.participants);
                chatManager.setRoom(message.roomId);
                statusBar.update();
                scheduleRefresh();
                break;
            }
            case 'participantJoined': {
                roomState.addParticipant(message.participant);
                await logRoomEvent({ type: 'joined', userId: message.participant.userId });
                scheduleRefresh();
                if (roomState.getRoomId()) {
                    chatManager.addMessage({
                        messageId: (0, uuid_1.v4)(),
                        fromUserId: message.participant.userId,
                        fromName: message.participant.displayName,
                        role: message.participant.role,
                        content: `${message.participant.displayName} joined the room`,
                        timestamp: Date.now(),
                        isSystem: true
                    });
                }
                break;
            }
            case 'participantLeft': {
                roomState.removeParticipant(message.userId);
                await logRoomEvent({ type: 'left', userId: message.userId });
                scheduleRefresh();
                const pendingTimer = pendingRoleUpdates.get(message.userId);
                if (pendingTimer) {
                    clearTimeout(pendingTimer);
                    pendingRoleUpdates.delete(message.userId);
                }
                if (roomState.getRoomId()) {
                    chatManager.addMessage({
                        messageId: (0, uuid_1.v4)(),
                        fromUserId: message.userId,
                        fromName: 'System',
                        role: 'viewer',
                        content: `Participant left (${message.userId})`,
                        timestamp: Date.now(),
                        isSystem: true
                    });
                }
                break;
            }
            case 'roleUpdated': {
                const previous = roomState.getParticipants().find(p => p.userId === message.userId)?.role;
                roomState.updateParticipantRole(message.userId, message.role);
                statusBar.update();
                await logRoomEvent({ type: 'roleChanged', userId: message.userId, fromRole: previous, toRole: message.role });
                scheduleRefresh();
                if (roomState.isRoot()) {
                    const target = roomState.getParticipants().find(p => p.userId === message.userId);
                    if (target) {
                        void vscode.window.showInformationMessage(`${target.displayName} is now ${message.role}.`);
                    }
                }
                const pendingTimer = pendingRoleUpdates.get(message.userId);
                if (pendingTimer) {
                    clearTimeout(pendingTimer);
                    pendingRoleUpdates.delete(message.userId);
                }
                break;
            }
            case 'editModeUpdated': {
                roomState.updateParticipantMode(message.userId, message.isDirectEditMode);
                statusBar.update();
                scheduleRefresh();
                break;
            }
            case 'docChangeBroadcast': {
                await documentSync.applyRemoteChange(message.docId, message.patch, message.version);
                pendingAck.delete(`doc:${message.docId}:${message.version}`);
                break;
            }
            case 'shareDocument': {
                await documentSync.handleShareDocument(message);
                pendingAck.delete(`share:${message.docId}`);
                break;
            }
            case 'documentUnshared': {
                await documentSync.handleDocumentUnshared(message);
                scheduleRefresh();
                pendingAck.delete(`unshare:${message.documentId}`);
                break;
            }
            case 'fullDocumentSync': {
                await documentSync.handleFullDocumentSync(message);
                pendingAck.delete(`full:${message.docId}:${message.version}`);
                break;
            }
            case 'requestFullSync': {
                await documentSync.handleRequestFullSync(message);
                pendingAck.delete(`reqfull:${message.docId}`);
                break;
            }
            case 'rootCursor': {
                lastRootCursorMessage = message;
                if (followController.isFollowing()) {
                    await documentSync.revealRemoteCursor(message.docId, message.position, message.uri);
                }
                break;
            }
            case 'participantActivity': {
                roomState.setParticipantActivity(message.userId, message.at);
                scheduleRefresh();
                setTimeout(() => scheduleRefresh(), 2200);
                break;
            }
            case 'newSuggestion': {
                suggestionManager.handleSuggestion(message.suggestion);
                await logRoomEvent({
                    type: 'suggestionCreated',
                    suggestionId: message.suggestion.suggestionId,
                    docId: message.suggestion.docId,
                    userId: message.suggestion.authorId
                });
                pendingAck.delete(`suggest:${message.suggestion.suggestionId}`);
                break;
            }
            case 'suggestionAccepted': {
                suggestionManager.handleSuggestionAccepted(message.suggestionId);
                await logRoomEvent({
                    type: 'suggestionAccepted',
                    suggestionId: message.suggestionId,
                    docId: message.docId
                });
                pendingAck.delete(`suggest:${message.suggestionId}`);
                break;
            }
            case 'suggestionRejected': {
                suggestionManager.handleSuggestionRejected(message.suggestionId);
                await logRoomEvent({
                    type: 'suggestionRejected',
                    suggestionId: message.suggestionId,
                    docId: message.docId
                });
                pendingAck.delete(`suggest:${message.suggestionId}`);
                break;
            }
            case 'chatMessage': {
                chatManager.addMessage({
                    messageId: message.messageId,
                    fromUserId: message.fromUserId,
                    fromName: message.fromName,
                    role: message.role,
                    content: message.content,
                    timestamp: message.timestamp,
                    isSystem: message.isSystem
                });
                pendingAck.delete(`chat:${message.messageId}`);
                break;
            }
            case 'error': {
                const payload = message.message || 'Unknown error';
                switch (message.code) {
                    case 'ROOM_SECRET_REQUIRED':
                        await retryJoinWithSecret('This room requires a secret. Please enter the secret and try again.');
                        break;
                    case 'ROOM_SECRET_INVALID':
                        await retryJoinWithSecret('Invalid room secret. Check the invite and try again.');
                        break;
                    case 'RATE_LIMITED':
                        void vscode.window.showErrorMessage('Too many failed join attempts. Please wait a few minutes and retry.');
                        break;
                    case 'ROOM_NOT_FOUND':
                        void vscode.window.showErrorMessage('Room not found. Double-check the invite code.');
                        break;
                    default:
                        if (payload.toLowerCase().includes('room not found')) {
                            void vscode.window.showErrorMessage('Room not found. Double-check the invite code.');
                        }
                        else {
                            void vscode.window.showErrorMessage(payload);
                        }
                }
                statusBar.setConnectionState('error', payload);
                void vscode.window.showWarningMessage(`CodeRooms error: ${payload}`);
                // On server error, drop any matching pending ack for safety.
                if (message.code === 'ROOM_NOT_FOUND' && roomState.getRoomId()) {
                    pendingAck.clear();
                }
                break;
            }
        }
    }
    async function startRoom() {
        if (!(await ensureConnection())) {
            return;
        }
        const displayName = await promptForDisplayName(context);
        if (!displayName) {
            return;
        }
        const mode = getConfiguredRoomMode();
        const secretInput = await vscode.window.showInputBox({
            prompt: 'Optional room secret (leave blank for none)',
            ignoreFocusOut: true,
            password: true
        });
        const secret = secretInput?.trim() ? secretInput.trim() : undefined;
        webSocket.send({ type: 'createRoom', displayName, mode, secret });
    }
    async function joinRoom() {
        if (!(await ensureConnection())) {
            return;
        }
        const roomId = await vscode.window.showInputBox({ prompt: 'Enter CodeRoom ID', ignoreFocusOut: true });
        if (!roomId) {
            return;
        }
        const displayName = await promptForDisplayName(context);
        if (!displayName) {
            return;
        }
        const secretInput = await vscode.window.showInputBox({
            prompt: 'Enter room secret if required (leave blank otherwise)',
            ignoreFocusOut: true,
            password: true
        });
        const secret = secretInput?.trim() ? secretInput.trim() : undefined;
        lastJoinRoomId = roomId.trim();
        lastJoinDisplayName = displayName;
        webSocket.send({ type: 'joinRoom', roomId: roomId.trim(), displayName, secret });
    }
    function leaveRoom() {
        if (!roomState.getRoomId()) {
            void vscode.window.showInformationMessage('You are not connected to a CodeRoom.');
            return;
        }
        webSocket.send({ type: 'leaveRoom' });
        resetState();
    }
    function shareCurrentFile() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            void vscode.window.showWarningMessage('Open a file before sharing it.', 'Retry').then(action => {
                if (action === 'Retry') {
                    shareCurrentFile();
                }
            });
            return;
        }
        if (!roomState.isRoot()) {
            void vscode.window.showWarningMessage('Only the room owner can share files.');
            return;
        }
        documentSync.shareDocument(editor.document);
        scheduleRootCursorBroadcast(editor);
    }
    function toggleFollowRoot() {
        if (!roomState.isCollaborator()) {
            void vscode.window.showInformationMessage('Follow mode is available for collaborators.');
            return;
        }
        if (!roomState.getRoomId()) {
            void vscode.window.showWarningMessage('Join a CodeRoom before following the root.');
            return;
        }
        followController.toggle();
    }
    function toggleCollaboratorMode() {
        if (!roomState.isCollaborator()) {
            void vscode.window.showInformationMessage('Only collaborators can toggle edit mode.');
            return;
        }
        const userId = roomState.getUserId();
        if (!userId) {
            return;
        }
        const direct = !roomState.isCollaboratorInDirectMode();
        roomState.setCollaboratorMode(direct);
        statusBar.update();
        webSocket.send({ type: 'setEditMode', userId, direct });
        scheduleRefresh();
        if (direct) {
            void vscode.window.showInformationMessage('Direct edit mode ON. Your edits go live immediately.');
        }
        else {
            void vscode.window.showInformationMessage('Suggestion mode ON. Your edits will be sent as suggestions.');
        }
    }
    async function sendPendingSuggestion(docId) {
        if (!roomState.isCollaborator() || roomState.isCollaboratorInDirectMode()) {
            void vscode.window.showInformationMessage('Switch to suggestion mode to send changes.');
            return;
        }
        const success = await documentSync.sendPendingSuggestion(docId);
        if (!success) {
            void vscode.window.showWarningMessage('No pending suggestion to send.', 'Retry').then(action => {
                if (action === 'Retry') {
                    void sendPendingSuggestion(docId);
                }
            });
        }
        else {
            void vscode.window.showInformationMessage('Suggestion sent to room owner.');
        }
    }
    async function exportRoom() {
        const roomId = roomState.getRoomId();
        if (!roomId) {
            void vscode.window.showWarningMessage('Join a CodeRoom before exporting.');
            return;
        }
        if (!roomState.isRoot()) {
            void vscode.window.showWarningMessage('Only the room owner can export the session.');
            return;
        }
        const defaultUri = vscode.Uri.file(path.join(roomStorage.getRoomFolder(roomId), `coderoom-${roomId}.zip`));
        const target = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { 'Zip file': ['zip'] },
            saveLabel: 'Export'
        });
        if (!target) {
            return;
        }
        try {
            const folder = roomStorage.getRoomFolder(roomId);
            const zip = new adm_zip_1.default();
            zip.addLocalFolder(folder);
            zip.writeZip(target.fsPath);
            void vscode.window.showInformationMessage(`Exported CodeRoom ${roomId} to ${target.fsPath}`);
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            logger_1.logger.error(`Unable to export room: ${detail}`);
            void vscode.window.showErrorMessage('Failed to export CodeRoom. See logs for details.');
        }
    }
    function openParticipantsView() {
        void participantsView.reveal('coderoomsPanel');
    }
    async function quickSettings() {
        const options = [
            { label: '$(server) Change server URL', description: vscode.workspace.getConfiguration('coderooms').get('serverUrl') },
            { label: '$(settings) Default room mode', description: getConfiguredRoomMode() },
            {
                label: (vscode.workspace.getConfiguration('coderooms').get('debugLogging') ? '$(debug-pause)' : '$(debug-start)') + ' Toggle debug logging',
                description: `Current: ${vscode.workspace.getConfiguration('coderooms').get('debugLogging') ? 'ON' : 'OFF'}`
            },
            { label: '$(info) Show status', description: 'Connection, room, doc, follow' }
        ];
        if (roomState.isCollaborator()) {
            const followLabel = followController.isFollowing() ? '$(eye-closed) Stop follow root' : '$(eye) Start follow root';
            options.push({ label: followLabel, description: 'Current: ' + (followController.isFollowing() ? 'ON' : 'OFF') });
        }
        const pick = await vscode.window.showQuickPick(options, { placeHolder: 'Quick settings' });
        if (!pick) {
            return;
        }
        if (pick.label.includes('Change server URL')) {
            const current = vscode.workspace.getConfiguration('coderooms').get('serverUrl');
            const value = await vscode.window.showInputBox({
                prompt: 'Server URL (WebSocket)',
                value: current ?? config_1.DEFAULT_SERVER_URL,
                ignoreFocusOut: true
            });
            if (value) {
                await vscode.workspace.getConfiguration('coderooms').update('serverUrl', value.trim(), vscode.ConfigurationTarget.Global);
                void vscode.window.showInformationMessage('CodeRooms server URL updated.');
            }
            return;
        }
        if (pick.label.includes('Default room mode')) {
            const modePick = await vscode.window.showQuickPick(['team', 'classroom'], { placeHolder: 'Default room mode' });
            if (modePick === 'team' || modePick === 'classroom') {
                await vscode.workspace.getConfiguration('coderooms').update('mode', modePick, vscode.ConfigurationTarget.Global);
                void vscode.window.showInformationMessage(`Default room mode set to ${modePick}.`);
            }
            return;
        }
        if (pick.label.includes('follow root')) {
            toggleFollowRoot();
            return;
        }
        if (pick.label.includes('Toggle debug logging')) {
            const current = vscode.workspace.getConfiguration('coderooms').get('debugLogging') ?? false;
            await vscode.workspace.getConfiguration('coderooms').update('debugLogging', !current, vscode.ConfigurationTarget.Global);
            applyDebugConfig();
            void vscode.window.showInformationMessage(`Debug logging ${!current ? 'enabled' : 'disabled'}.`);
            return;
        }
        if (pick.label.includes('Show status')) {
            await showStatus();
        }
    }
    async function changeParticipantRole(participant) {
        if (!roomState.isRoot()) {
            void vscode.window.showWarningMessage('Only the room owner can change roles.');
            return;
        }
        if (!roomState.getRoomId()) {
            void vscode.window.showWarningMessage('Join or start a room first.');
            return;
        }
        const role = (await vscode.window.showQuickPick(['collaborator', 'viewer'], {
            title: `Update role for ${participant.displayName}`
        }));
        if (!role) {
            return;
        }
        const timer = setTimeout(() => {
            pendingRoleUpdates.delete(participant.userId);
            void vscode.window.showWarningMessage(`Role change for ${participant.displayName} not confirmed. The user may be offline or permissions blocked.`);
        }, 5000);
        const existing = pendingRoleUpdates.get(participant.userId);
        if (existing) {
            clearTimeout(existing);
        }
        pendingRoleUpdates.set(participant.userId, timer);
        webSocket.send({ type: 'updateRole', userId: participant.userId, role });
        void vscode.window.showInformationMessage(`Requested ${participant.displayName} to switch to ${role}.`);
    }
    async function copyRoomId(roomIdArg) {
        const roomId = roomIdArg ?? roomState.getRoomId();
        if (!roomId) {
            void vscode.window.showWarningMessage('No active room to copy.');
            return;
        }
        await vscode.env.clipboard.writeText(roomId);
        void vscode.window.showInformationMessage('Room ID copied to clipboard.');
    }
    function stopRoom() {
        if (!roomState.isRoot()) {
            void vscode.window.showWarningMessage('Only the room owner can stop the session.');
            return;
        }
        leaveRoom();
    }
    function handleSetParticipantRole(target, role) {
        if (!roomState.isRoot()) {
            return;
        }
        const participant = extractParticipant(target);
        if (!participant) {
            return;
        }
        if (role === 'root') {
            void vscode.window.showWarningMessage('Transferring ownership is not supported in this version.');
            return;
        }
        webSocket.send({ type: 'updateRole', userId: participant.userId, role });
    }
    function handleKickParticipant(target) {
        if (!roomState.isRoot()) {
            void vscode.window.showWarningMessage('Only the room owner can manage participants.');
            return;
        }
        const participant = extractParticipant(target);
        if (!participant) {
            return;
        }
        if (participant.role === 'viewer') {
            void vscode.window.showInformationMessage(`${participant.displayName} is already a viewer.`);
            return;
        }
        const timer = setTimeout(() => {
            pendingRoleUpdates.delete(participant.userId);
            void vscode.window.showWarningMessage(`Viewer request for ${participant.displayName} not confirmed. The user may be offline or permissions blocked.`);
        }, 5000);
        const existing = pendingRoleUpdates.get(participant.userId);
        if (existing) {
            clearTimeout(existing);
        }
        pendingRoleUpdates.set(participant.userId, timer);
        webSocket.send({ type: 'updateRole', userId: participant.userId, role: 'viewer' });
        void vscode.window.showInformationMessage(`Requested ${participant.displayName} to switch to viewer mode.`);
    }
    async function handleSuggestionAction(target, action) {
        if (!roomState.isRoot()) {
            void vscode.window.showInformationMessage('Only the room owner can manage suggestions.');
            return;
        }
        const suggestion = extractSuggestion(target);
        if (!suggestion) {
            return;
        }
        if (action === 'accept') {
            await documentSync.acceptSuggestion(suggestion);
        }
        else {
            documentSync.rejectSuggestion(suggestion);
        }
    }
    function unshareCurrentFile() {
        if (!roomState.isRoot()) {
            void vscode.window.showWarningMessage('Only the room owner can stop sharing.');
            return;
        }
        documentSync.unshareDocument();
    }
    async function setActiveSharedDocument(docId) {
        if (!docId) {
            return;
        }
        await documentSync.setActiveDocument(docId, true);
        scheduleRefresh();
    }
    async function reconnect() {
        await ensureConnection(ConnectionIntent.ForceReconnect);
    }
    async function showStatus() {
        const roomId = roomState.getRoomId() ?? 'none';
        const role = roomState.getRole() ?? 'guest';
        const mode = roomState.getRoomMode() ?? 'unknown';
        const activeDoc = roomState.getActiveSharedDocLabel() ?? 'no shared doc';
        const follow = followController.isFollowing() ? 'ON' : 'OFF';
        const conn = isConnected ? 'connected' : 'disconnected';
        const message = `Status: ${conn}\nRoom: ${roomId}\nRole: ${role}\nMode: ${mode}\nActive doc: ${activeDoc}\nFollow: ${follow}`;
        await vscode.window.showInformationMessage(message, { modal: false });
    }
    async function sendChatMessage(contentArg) {
        const roomId = roomState.getRoomId();
        if (!roomId) {
            void vscode.window.showInformationMessage('You are not in a CodeRoom.');
            return;
        }
        const content = contentArg ?? await vscode.window.showInputBox({
            prompt: 'Send a chat message to the room',
            placeHolder: 'Type your message...',
            ignoreFocusOut: true
        });
        if (!content || !content.trim()) {
            return;
        }
        const messageId = (0, uuid_1.v4)();
        const timestamp = Date.now();
        webSocket.send({ type: 'chatSend', roomId, messageId, content, timestamp });
    }
    function openChat() {
        void vscode.commands.executeCommand('workbench.view.extension.coderooms');
        void vscode.commands.executeCommand('coderoomsChatView.focus');
    }
    function focusChatInput() {
        openChat();
        chatView.focusInput();
    }
    function clearPendingSuggestions() {
        if (!roomState.isRoot()) {
            void vscode.window.showInformationMessage('Only the room owner can clear suggestions.');
            return;
        }
        suggestionManager.clearAll();
        void vscode.window.showInformationMessage('Cleared pending suggestions.');
    }
    async function retryJoinWithSecret(message) {
        if (!lastJoinRoomId || !lastJoinDisplayName) {
            void vscode.window.showErrorMessage(message);
            return;
        }
        const secretInput = await vscode.window.showInputBox({
            prompt: message,
            ignoreFocusOut: true,
            password: true
        });
        const secret = secretInput?.trim() ? secretInput.trim() : undefined;
        if (!secret) {
            return;
        }
        webSocket.send({ type: 'joinRoom', roomId: lastJoinRoomId, displayName: lastJoinDisplayName, secret });
    }
    context.subscriptions.push(vscode.commands.registerCommand('coderooms.startAsRoot', startRoom), vscode.commands.registerCommand('coderooms.joinRoom', joinRoom), vscode.commands.registerCommand('coderooms.leaveRoom', leaveRoom), vscode.commands.registerCommand('coderooms.shareCurrentFile', shareCurrentFile), vscode.commands.registerCommand('coderooms.toggleCollaboratorMode', toggleCollaboratorMode), vscode.commands.registerCommand('coderooms.toggleFollowRoot', toggleFollowRoot), vscode.commands.registerCommand('coderooms.exportRoom', exportRoom), vscode.commands.registerCommand('coderooms.openParticipantsView', openParticipantsView), vscode.commands.registerCommand('coderooms.changeParticipantRole', changeParticipantRole), vscode.commands.registerCommand('coderooms.copyRoomId', (arg, roomIdArg) => copyRoomId(typeof arg === 'string' ? arg : roomIdArg)), vscode.commands.registerCommand('coderooms.stopRoom', stopRoom), vscode.commands.registerCommand('coderooms.setParticipantRoleRoot', item => handleSetParticipantRole(item, 'root')), vscode.commands.registerCommand('coderooms.setParticipantRoleCollaborator', item => handleSetParticipantRole(item, 'collaborator')), vscode.commands.registerCommand('coderooms.setParticipantRoleViewer', item => handleSetParticipantRole(item, 'viewer')), vscode.commands.registerCommand('coderooms.kickParticipant', handleKickParticipant), vscode.commands.registerCommand('coderooms.acceptSuggestion', item => handleSuggestionAction(item, 'accept')), vscode.commands.registerCommand('coderooms.rejectSuggestion', item => handleSuggestionAction(item, 'reject')), vscode.commands.registerCommand('coderooms.clearPendingSuggestions', clearPendingSuggestions), vscode.commands.registerCommand('coderooms.unshareCurrentFile', unshareCurrentFile), vscode.commands.registerCommand('coderooms.setActiveDocument', setActiveSharedDocument), vscode.commands.registerCommand('coderooms.sendPendingSuggestion', (docId) => void sendPendingSuggestion(docId)), vscode.commands.registerCommand('coderooms.quickSettings', quickSettings), vscode.commands.registerCommand('coderooms.sendChatMessage', sendChatMessage), vscode.commands.registerCommand('coderooms.openChat', openChat), vscode.commands.registerCommand('coderooms.focusChatInput', focusChatInput), vscode.commands.registerCommand('coderooms.ownerActionInfo', () => {
        void vscode.window.showWarningMessage('Only the room owner can perform this action.');
    }), vscode.commands.registerCommand('coderooms.showStatus', showStatus), vscode.commands.registerCommand('coderooms.reconnect', reconnect), configWatcher);
}
function deactivate() {
    // cleanup handled via disposables registered on activate
}
async function promptForDisplayName(context) {
    const existing = context.globalState.get(DISPLAY_NAME_KEY);
    const value = await vscode.window.showInputBox({
        prompt: 'Enter your display name for CodeRooms',
        value: existing,
        ignoreFocusOut: true
    });
    if (value) {
        const trimmed = value.trim();
        await context.globalState.update(DISPLAY_NAME_KEY, trimmed);
        return trimmed;
    }
    return existing;
}
async function getStoredDisplayName(context) {
    return context.globalState.get(DISPLAY_NAME_KEY);
}
function extractParticipant(target) {
    if (!target) {
        return undefined;
    }
    if (target.userId) {
        return target;
    }
    if (typeof target === 'object' && 'participant' in target && target.participant) {
        return target.participant;
    }
    return undefined;
}
function extractSuggestion(target) {
    if (!target) {
        return undefined;
    }
    if (target.suggestionId) {
        return target;
    }
    if (typeof target === 'object' && 'suggestion' in target && target.suggestion) {
        return target.suggestion;
    }
    return undefined;
}
//# sourceMappingURL=extension.js.map