import * as vscode from 'vscode';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { WebSocketClient } from './connection/WebSocketClient';
import { RoomState } from './core/RoomState';
import { DocumentSync } from './core/DocumentSync';
import { FollowController } from './core/FollowController';
import { RoomEvent, RoomStorage } from './core/RoomStorage';
import { SuggestionManager } from './core/SuggestionManager';
import { ChatManager } from './core/ChatManager';
import { CursorManager } from './core/CursorManager';
import { StatusBarManager } from './ui/StatusBarManager';
import { ParticipantsView } from './ui/ParticipantsView';
import { ChatView } from './ui/ChatView';
import { ClientToServerMessage, Participant, Role, RoomMode, ServerToClientMessage, Suggestion } from './connection/MessageTypes';
import { DEFAULT_SERVER_URL } from './util/config';
import { logger } from './util/logger';
import { deriveKey, encrypt, decrypt, type EncryptedPayload } from './util/crypto';
import { v4 as uuidv4 } from 'uuid';

const DISPLAY_NAME_KEY = 'coderooms.displayName';
const ROOM_MODE_SETTING_KEY = 'mode';

type ParticipantLike = Participant | { participant?: Participant } | undefined;
type SuggestionLike = Suggestion | { suggestion?: Suggestion } | undefined;

enum ConnectionIntent {
  Automatic,
  ForceReconnect
}

export function activate(context: vscode.ExtensionContext): void {
  const roomState = new RoomState();
  const roomStorage = new RoomStorage(context.globalStorageUri);
  const followController = new FollowController();
  const statusBar = new StatusBarManager(roomState, followController);
  const webSocket = new WebSocketClient();
  let isConnected = false;
  let connectionPromise: Promise<void> | undefined;
  const pendingOffline: ClientToServerMessage[] = [];
  const pendingAck = new Map<string, ClientToServerMessage>();
  const pendingRoleUpdates = new Map<string, NodeJS.Timeout>();
  let lastRootCursorMessage: Extract<ServerToClientMessage, { type: 'rootCursor' }> | undefined;
  let e2eKey: Buffer | undefined;     // AES-256-GCM key derived from room secret — null when no secret
  let pendingSecret: string | undefined; // secret held in memory until roomId is known for key derivation

  const messageKey = (message: ClientToServerMessage): string | undefined => {
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

  const flushPending = (): void => {
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

  const sendClientMessage = (message: ClientToServerMessage): void => {
    if (isConnected) {
      const key = messageKey(message);
      if (key) {
        pendingAck.set(key, message);
      }
      webSocket.send(message);
    } else {
      const key = messageKey(message);
      if (key) {
        pendingAck.set(key, message);
      }
      pendingOffline.push(message);
    }
  };

  const applyDebugConfig = () => {
    const enabled = vscode.workspace.getConfiguration('coderooms').get<boolean>('debugLogging') ?? false;
    logger.setDebugLogging(enabled);
  };
  applyDebugConfig();

  const configWatcher = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('coderooms.debugLogging')) {
      applyDebugConfig();
    }
  });

  const getConfiguredRoomMode = (): RoomMode =>
    vscode.workspace.getConfiguration('coderooms').get<RoomMode>(ROOM_MODE_SETTING_KEY) ?? 'team';

  const recordRoomInfo = async (roomId: string, mode: RoomMode): Promise<void> => {
    try {
      await roomStorage.recordRoomInfo(roomId, mode);
    } catch (error) {
      logger.warn(`Unable to record room metadata for ${roomId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const logRoomEvent = async (event: Omit<RoomEvent, 'roomId' | 'timestamp'>): Promise<void> => {
    const roomId = roomState.getRoomId();
    if (!roomId || !roomState.isRoot()) {
      return;
    }
    try {
      await roomStorage.appendEvent(roomId, { ...event, roomId, timestamp: Date.now() });
    } catch (error) {
      logger.warn(`Failed to append room event: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const documentSync = new DocumentSync(roomState, roomStorage, sendClientMessage);
  const suggestionManager = new SuggestionManager(roomState, documentSync);
  const participantsView = new ParticipantsView(roomState, documentSync, suggestionManager, followController);
  const chatManager = new ChatManager(context.globalState);
  const cursorManager = new CursorManager();
  const chatView = new ChatView(chatManager);
  let lastJoinRoomId: string | undefined;
  let lastJoinDisplayName: string | undefined;
  let refreshTimer: NodeJS.Timeout | undefined;

  const followDisposable = followController.onDidChange(async () => {
    statusBar.update();
    scheduleRefresh();
    if (followController.isFollowing() && lastRootCursorMessage) {
      await documentSync.revealRemoteCursor(
        lastRootCursorMessage.docId,
        lastRootCursorMessage.position,
        lastRootCursorMessage.uri
      );
    }
  });

  let pendingRootCursorEditor: vscode.TextEditor | undefined;
  let rootCursorTimer: NodeJS.Timeout | undefined;
  
  const getRootCursorDebounceMs = (): number => {
    const participants = roomState.getParticipants().length;
    return Math.min(150 + (participants * 30), 1000);
  };

  const sendRootCursorUpdate = (editor: vscode.TextEditor): void => {
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
    const position = { line: pos.line, character: pos.character };
    const selections = editor.selections.map(s => ({
      start: { line: s.start.line, character: s.start.character },
      end: { line: s.end.line, character: s.end.character }
    }));

    if (roomState.isRoot()) {
      sendClientMessage({
        type: 'rootCursor',
        roomId,
        docId,
        uri: sharedUri.toString(),
        position
      });
    }

    sendClientMessage({
      type: 'cursorUpdate',
      roomId,
      docId,
      uri: sharedUri.toString(),
      position,
      selections
    });
  };

  const scheduleRootCursorBroadcast = (editor?: vscode.TextEditor): void => {
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
    }, getRootCursorDebounceMs());
  };

  suggestionManager.setHandlers(
    suggestion => documentSync.acceptSuggestion(suggestion),
    suggestion => documentSync.rejectSuggestion(suggestion)
  );

  const explorerTree = vscode.window.createTreeView('coderoomsParticipants', {
    treeDataProvider: participantsView
  });
  participantsView.registerTreeView('coderoomsParticipants', explorerTree);

  const sessionTree = vscode.window.createTreeView('coderoomsPanel', {
    treeDataProvider: participantsView
  });
  participantsView.registerTreeView('coderoomsPanel', sessionTree);

  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(editor => scheduleRootCursorBroadcast(editor));
  const visibleEditorsListener = vscode.window.onDidChangeVisibleTextEditors(() => cursorManager.refreshDecorations());
  const selectionListener = vscode.window.onDidChangeTextEditorSelection(event => scheduleRootCursorBroadcast(event.textEditor));

  context.subscriptions.push(
    explorerTree,
    sessionTree,
    vscode.window.registerWebviewViewProvider('coderoomsChatView', chatView),
    activeEditorListener,
    visibleEditorsListener,
    selectionListener,
    followDisposable,
    { dispose: () => webSocket.disconnect() },
    { dispose: () => suggestionManager.dispose() },
    { dispose: () => documentSync.dispose() },
    { dispose: () => statusBar.dispose() }
  );

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

  webSocket.on('connected', () => {
    isConnected = true;
    statusBar.setConnectionState('connected');
    flushPending();
    // If we were in a room before disconnect, attempt to rejoin
    if (lastJoinRoomId && lastJoinDisplayName) {
      webSocket.send({ type: 'joinRoom', roomId: lastJoinRoomId, displayName: lastJoinDisplayName });
    }
  });

  webSocket.on('reconnecting', (info: { attempt: number; delayMs: number }) => {
    statusBar.setConnectionState('reconnecting', `Reconnecting in ${Math.round(info.delayMs / 1000)}s...`, info.attempt);
  });

  webSocket.on('reconnectFailed', () => {
    statusBar.setConnectionState('error', 'Could not reconnect after multiple attempts');
    void vscode.window.showErrorMessage(
      'CodeRooms: unable to reconnect to the server after multiple attempts.',
      'Retry'
    ).then(action => {
      if (action === 'Retry') {
        void ensureConnection(ConnectionIntent.ForceReconnect);
      }
    });
  });

  webSocket.on('close', () => {
    isConnected = false;
    statusBar.setConnectionState('disconnected', 'Connection closed');
    resetState();
  });

  function resetState(): void {
    roomState.reset();
    documentSync.reset();
    suggestionManager.reset();
    followController.reset();
    chatManager.clear();
    cursorManager.clearAll();
    chatManager.setRoom(undefined);
    pendingOffline.splice(0, pendingOffline.length);
    pendingAck.clear();
    pendingRoleUpdates.forEach(timer => clearTimeout(timer));
    pendingRoleUpdates.clear();
    lastRootCursorMessage = undefined;
    e2eKey = undefined;
    pendingSecret = undefined;
    statusBar.update();
    scheduleRefresh();
  }

  async function ensureConnection(intent: ConnectionIntent = ConnectionIntent.Automatic): Promise<boolean> {
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

    const serverUrl = vscode.workspace.getConfiguration('coderooms').get<string>('serverUrl') ?? DEFAULT_SERVER_URL;
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
        logger.error(`Unable to connect: ${error instanceof Error ? error.message : String(error)}`);
        statusBar.setConnectionState('error', detail);
        vscode.window.showErrorMessage(`${detail}. Make sure the CodeRooms server is running.`);
      });

    await connectionPromise;
    return isConnected;
  }

  async function handleServerMessage(message: ServerToClientMessage): Promise<void> {
    switch (message.type) {
      case 'roomCreated': {
        resetState();
        const displayName = await getStoredDisplayName(context);
        roomState.setSelfInfo(message.userId, 'root', message.roomId, displayName);
        roomState.setMode(message.mode);
        await recordRoomInfo(message.roomId, message.mode);
        chatManager.setRoom(message.roomId);
        await logRoomEvent({ type: 'joined', userId: message.userId });
        // Derive E2E key now that we have the roomId as salt
        if (pendingSecret) {
          e2eKey = deriveKey(pendingSecret, message.roomId);
          pendingSecret = undefined;
        }
        statusBar.update();
        scheduleRefresh();
        const action = await vscode.window.showInformationMessage(`CodeRoom ready: ${message.roomId}`, 'Copy invite code');
        if (action) {
          await vscode.env.clipboard.writeText(message.roomId);
          void vscode.window.showInformationMessage('Room ID copied to clipboard.');
        }
        if (e2eKey) {
          chatManager.addMessage({
            messageId: `sys-e2e-${Date.now()}`,
            fromUserId: 'system',
            fromName: 'System',
            role: 'root',
            content: '🔒 **E2E Encryption active.** Chat messages are end-to-end encrypted with your room secret. Share the Room ID and secret separately.',
            timestamp: Date.now(),
            isSystem: true
          });
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

        // Derive E2E key now that we have the roomId as salt
        if (pendingSecret) {
          e2eKey = deriveKey(pendingSecret, message.roomId);
          pendingSecret = undefined;
        }
        
        let welcomeText = `\`\`\n👋 Welcome to the CodeRoom! You joined as a ${message.role}.\n\`\`\n`;
        if (message.role === 'collaborator') {
          welcomeText += `✏️ **Suggest Mode:** By default, edits you make turn into inline suggestions for the room owner to approve!\n🖊️ **Direct Edit:** To bypass suggestions and type directly, click the pencil icon in the People panel or toggle the "Suggest" Status Bar item.`;
        } else if (message.role === 'viewer') {
          welcomeText += `👁️ **Read Only:** You are currently in read-only mode.`;
        } else {
          welcomeText += `🏠 **Owner:** You are the room owner. To share files, open a document and click the "Share Document" icon in the top right window menu, or right click it in the explorer!`;
        }
        if (e2eKey) {
          welcomeText += `\n🔒 **E2E Encryption active.** Chat is end-to-end encrypted with your room secret.`;
        }

        chatManager.addMessage({
          messageId: `sys-welcome-${Date.now()}`,
          fromUserId: 'system',
          fromName: 'System',
          role: 'root',
          content: welcomeText,
          timestamp: Date.now(),
          isSystem: true
        });

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
            messageId: uuidv4(),
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
        cursorManager.removeCursor(message.userId);
        await logRoomEvent({ type: 'left', userId: message.userId });
        scheduleRefresh();
        const pendingTimer = pendingRoleUpdates.get(message.userId);
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          pendingRoleUpdates.delete(message.userId);
        }
        if (roomState.getRoomId()) {
          chatManager.addMessage({
            messageId: uuidv4(),
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
      case 'cursorUpdate': {
        if (message.userId && message.userName) {
          cursorManager.updateCursor(message.userId, message.userName, message.uri, message.position, message.selections);
          const fileName = decodeURIComponent(message.uri.split("/").pop() || "Unknown");
          roomState.setParticipantFile(message.userId, fileName);
          scheduleRefresh();
        }
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
        let content = message.content;
        // Decrypt if E2E is active and content is an encrypted blob
        if (e2eKey && content.startsWith('e2e:')) {
          try {
            const payload = JSON.parse(content.slice(4)) as EncryptedPayload;
            content = decrypt(payload, e2eKey) ?? '🔒 [encrypted — wrong key or tampered data]';
          } catch {
            content = '🔒 [could not decrypt message]';
          }
        }
        chatManager.addMessage({
          messageId: message.messageId,
          fromUserId: message.fromUserId,
          fromName: message.fromName,
          role: message.role,
          content,
          timestamp: message.timestamp,
          isSystem: message.isSystem
        });
        pendingAck.delete(`chat:${message.messageId}`);
        break;
      }
      case 'tokenCreated': {
        const label = message.label ? ` for "${message.label}"` : '';
        await vscode.env.clipboard.writeText(message.token);
        void vscode.window.showInformationMessage(
          `Invite token${label} copied to clipboard. It's single-use and expires in 24h — send it directly to one participant.`
        );
        break;
      }
      case 'error': {
        const payload = message.message || 'Unknown error';
        switch (message.code) {
          case 'FORBIDDEN':
            void vscode.window.showErrorMessage('Action denied: only the room owner can perform this.');
            break;
          case 'TARGET_NOT_FOUND':
            void vscode.window.showErrorMessage('The participant was not found. They may have left the room.');
            break;
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
          case 'PATCH_INVALID':
            void vscode.window.showWarningMessage('A document change failed to apply on the server. The file will resync automatically.');
            break;
          case 'MESSAGE_TOO_LONG':
            void vscode.window.showWarningMessage('Message is too long (max 2000 characters).');
            break;
          case 'PAYLOAD_TOO_LARGE':
            void vscode.window.showWarningMessage('The file is too large to share (max 2 MB).');
            break;
          case 'DOCUMENT_TOO_LARGE':
            void vscode.window.showWarningMessage('The document is too large to share (max 2 MB).');
            break;
          case 'TOKEN_INVALID':
            void vscode.window.showErrorMessage('Invite token is invalid or has expired. Ask the room owner for a new one.');
            break;
          default:
            if (payload.toLowerCase().includes('room not found')) {
              void vscode.window.showErrorMessage('Room not found. Double-check the invite code.');
            } else if (payload.toLowerCase().includes('room closed')) {
              void vscode.window.showWarningMessage('The room has been closed by the owner.');
              resetState();
            } else {
              void vscode.window.showErrorMessage(`CodeRooms: ${payload}`);
            }
        }
        // Only set status bar to error for critical issues, not transient ones
        if (['ROOM_NOT_FOUND', 'RATE_LIMITED'].includes(message.code ?? '')) {
          statusBar.setConnectionState('error', payload);
        }
        // On server error, drop any matching pending ack for safety.
        if (message.code === 'ROOM_NOT_FOUND' && roomState.getRoomId()) {
          pendingAck.clear();
        }
        break;
      }
    }
  }

  async function startRoom(): Promise<void> {
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
    pendingSecret = secret; // stored for E2E key derivation once roomId is known
    webSocket.send({ type: 'createRoom', displayName, mode, secret });
  }

  async function joinRoom(): Promise<void> {
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
      prompt: 'Enter room secret or invite token (leave blank if not required)',
      ignoreFocusOut: true,
      password: true
    });
    const secretOrToken = secretInput?.trim();
    const isToken = Boolean(secretOrToken && /^[0-9a-f]{32}$/.test(secretOrToken));
    const secret = isToken ? undefined : (secretOrToken || undefined);
    const token = isToken ? secretOrToken : undefined;
    pendingSecret = secret; // only real passwords drive E2E; tokens don't carry a key
    lastJoinRoomId = roomId.trim();
    lastJoinDisplayName = displayName;
    webSocket.send({ type: 'joinRoom', roomId: roomId.trim(), displayName, secret, token });
  }

  function leaveRoom(): void {
    if (!roomState.getRoomId()) {
      void vscode.window.showInformationMessage('You are not connected to a CodeRoom.');
      return;
    }
    webSocket.send({ type: 'leaveRoom' });
    resetState();
  }

  function shareCurrentFile(): void {
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

  function toggleFollowRoot(): void {
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

  function toggleCollaboratorMode(): void {
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
    } else {
      void vscode.window.showInformationMessage('Suggestion mode ON. Your edits will be sent as suggestions.');
    }
  }

  async function sendPendingSuggestion(docId?: string): Promise<void> {
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
    } else {
      void vscode.window.showInformationMessage('Suggestion sent to room owner.');
    }
  }

  async function exportRoom(): Promise<void> {
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
      const zip = new AdmZip();
      zip.addLocalFolder(folder);
      zip.writeZip(target.fsPath);
      void vscode.window.showInformationMessage(`Exported CodeRoom ${roomId} to ${target.fsPath}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error(`Unable to export room: ${detail}`);
      void vscode.window.showErrorMessage('Failed to export CodeRoom. See logs for details.');
    }
  }

  function openParticipantsView(): void {
    void participantsView.reveal('coderoomsPanel');
  }

  async function quickSettings(): Promise<void> {
    const options: vscode.QuickPickItem[] = [
      { label: '$(server) Change server URL', description: vscode.workspace.getConfiguration('coderooms').get<string>('serverUrl') },
      { label: '$(settings) Default room mode', description: getConfiguredRoomMode() },
      {
        label: (vscode.workspace.getConfiguration('coderooms').get<boolean>('debugLogging') ? '$(debug-pause)' : '$(debug-start)') + ' Toggle debug logging',
        description: `Current: ${vscode.workspace.getConfiguration('coderooms').get<boolean>('debugLogging') ? 'ON' : 'OFF'}`
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
      const current = vscode.workspace.getConfiguration('coderooms').get<string>('serverUrl');
      const value = await vscode.window.showInputBox({
        prompt: 'Server URL (WebSocket)',
        value: current ?? DEFAULT_SERVER_URL,
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
      const current = vscode.workspace.getConfiguration('coderooms').get<boolean>('debugLogging') ?? false;
      await vscode.workspace.getConfiguration('coderooms').update('debugLogging', !current, vscode.ConfigurationTarget.Global);
      applyDebugConfig();
      void vscode.window.showInformationMessage(`Debug logging ${!current ? 'enabled' : 'disabled'}.`);
      return;
    }

    if (pick.label.includes('Show status')) {
      await showStatus();
    }
  }

  async function changeParticipantRole(participant: Participant): Promise<void> {
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
    })) as 'collaborator' | 'viewer' | undefined;
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

  async function copyRoomId(roomIdArg?: string): Promise<void> {
    const roomId = roomIdArg ?? roomState.getRoomId();
    if (!roomId) {
      void vscode.window.showWarningMessage('No active room to copy.');
      return;
    }
    await vscode.env.clipboard.writeText(roomId);
    void vscode.window.showInformationMessage('Room ID copied to clipboard.');
  }

  function stopRoom(): void {
    if (!roomState.isRoot()) {
      void vscode.window.showWarningMessage('Only the room owner can stop the session.');
      return;
    }
    leaveRoom();
  }

  function handleSetParticipantRole(target: ParticipantLike, role: Role): void {
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

  function handleKickParticipant(target: ParticipantLike): void {
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

  async function handleSuggestionAction(target: SuggestionLike, action: 'accept' | 'reject'): Promise<void> {
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
    } else {
      documentSync.rejectSuggestion(suggestion);
    }
  }

  function unshareCurrentFile(): void {
    if (!roomState.isRoot()) {
      void vscode.window.showWarningMessage('Only the room owner can stop sharing.');
      return;
    }
    documentSync.unshareDocument();
  }

  async function setActiveSharedDocument(docId?: string): Promise<void> {
    if (!docId) {
      return;
    }
    await documentSync.setActiveDocument(docId, true);
    scheduleRefresh();
  }

  async function generateInviteToken(): Promise<void> {
    if (!roomState.isRoot()) {
      void vscode.window.showWarningMessage('Only the room owner can generate invite tokens.');
      return;
    }
    if (!roomState.getRoomId()) {
      void vscode.window.showWarningMessage('Start or join a room first.');
      return;
    }
    const label = await vscode.window.showInputBox({
      prompt: 'Optional label for this token (e.g. participant name)',
      placeHolder: 'Leave blank for anonymous token',
      ignoreFocusOut: true
    });
    if (label === undefined) {
      return; // user cancelled
    }
    webSocket.send({ type: 'createToken', label: label.trim() || undefined });
  }

  async function reconnect(): Promise<void> {
    await ensureConnection(ConnectionIntent.ForceReconnect);
  }

  async function showStatus(): Promise<void> {
    const roomId = roomState.getRoomId() ?? 'none';
    const role = roomState.getRole() ?? 'guest';
    const mode = roomState.getRoomMode() ?? 'unknown';
    const activeDoc = roomState.getActiveSharedDocLabel() ?? 'no shared doc';
    const follow = followController.isFollowing() ? 'ON' : 'OFF';
    const conn = isConnected ? 'connected' : 'disconnected';
    const message = `Status: ${conn}\nRoom: ${roomId}\nRole: ${role}\nMode: ${mode}\nActive doc: ${activeDoc}\nFollow: ${follow}`;
    await vscode.window.showInformationMessage(message, { modal: false });
  }

  async function sendChatMessage(contentArg?: string): Promise<void> {
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
    const trimmed = content.trim();
    if (trimmed.length > 2000) {
      void vscode.window.showWarningMessage('Message is too long (max 2000 characters).');
      return;
    }
    const messageId = uuidv4();
    const timestamp = Date.now();
    // Encrypt if E2E is active — server relays ciphertext without seeing plaintext
    const finalContent = e2eKey
      ? `e2e:${JSON.stringify(encrypt(trimmed, e2eKey))}`
      : trimmed;
    webSocket.send({ type: 'chatSend', roomId, messageId, content: finalContent, timestamp });
  }

  function openChat(): void {
    void vscode.commands.executeCommand('workbench.view.extension.coderooms');
    void vscode.commands.executeCommand('coderoomsChatView.focus');
  }

  function focusChatInput(): void {
    openChat();
    chatView.focusInput();
  }

  function clearPendingSuggestions(): void {
    if (!roomState.isRoot()) {
      void vscode.window.showInformationMessage('Only the room owner can clear suggestions.');
      return;
    }
    suggestionManager.clearAll();
    void vscode.window.showInformationMessage('Cleared pending suggestions.');
  }

  async function retryJoinWithSecret(message: string): Promise<void> {
    if (!lastJoinRoomId || !lastJoinDisplayName) {
      void vscode.window.showErrorMessage(message);
      return;
    }
    const secretInput = await vscode.window.showInputBox({
      prompt: message,
      ignoreFocusOut: true,
      password: true
    });
    const secretOrToken = secretInput?.trim();
    const isToken = Boolean(secretOrToken && /^[0-9a-f]{32}$/.test(secretOrToken));
    const secret = isToken ? undefined : (secretOrToken || undefined);
    const token = isToken ? secretOrToken : undefined;
    if (!secret && !token) {
      return;
    }
    pendingSecret = secret;
    webSocket.send({ type: 'joinRoom', roomId: lastJoinRoomId, displayName: lastJoinDisplayName, secret, token });
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('coderooms.startAsRoot', startRoom),
    vscode.commands.registerCommand('coderooms.joinRoom', joinRoom),
    vscode.commands.registerCommand('coderooms.leaveRoom', leaveRoom),
    vscode.commands.registerCommand('coderooms.shareCurrentFile', shareCurrentFile),
    vscode.commands.registerCommand('coderooms.toggleCollaboratorMode', toggleCollaboratorMode),
    vscode.commands.registerCommand('coderooms.toggleFollowRoot', toggleFollowRoot),
    vscode.commands.registerCommand('coderooms.exportRoom', exportRoom),
    vscode.commands.registerCommand('coderooms.openParticipantsView', openParticipantsView),
    vscode.commands.registerCommand('coderooms.changeParticipantRole', changeParticipantRole),
    vscode.commands.registerCommand('coderooms.copyRoomId', (arg?: unknown, roomIdArg?: string) => copyRoomId(typeof arg === 'string' ? arg : roomIdArg)),
    vscode.commands.registerCommand('coderooms.stopRoom', stopRoom),
    vscode.commands.registerCommand('coderooms.setParticipantRoleRoot', item => handleSetParticipantRole(item, 'root')),
    vscode.commands.registerCommand('coderooms.setParticipantRoleCollaborator', item => handleSetParticipantRole(item, 'collaborator')),
    vscode.commands.registerCommand('coderooms.setParticipantRoleViewer', item => handleSetParticipantRole(item, 'viewer')),
    vscode.commands.registerCommand('coderooms.kickParticipant', handleKickParticipant),
    vscode.commands.registerCommand('coderooms.acceptSuggestion', item => handleSuggestionAction(item, 'accept')),
    vscode.commands.registerCommand('coderooms.rejectSuggestion', item => handleSuggestionAction(item, 'reject')),
    vscode.commands.registerCommand('coderooms.clearPendingSuggestions', clearPendingSuggestions),
    vscode.commands.registerCommand('coderooms.unshareCurrentFile', unshareCurrentFile),
    vscode.commands.registerCommand('coderooms.setActiveDocument', setActiveSharedDocument),
    vscode.commands.registerCommand('coderooms.sendPendingSuggestion', (docId?: string) => void sendPendingSuggestion(docId)),
    vscode.commands.registerCommand('coderooms.quickSettings', quickSettings),
    vscode.commands.registerCommand('coderooms.sendChatMessage', sendChatMessage),
    vscode.commands.registerCommand('coderooms.openChat', openChat),
    vscode.commands.registerCommand('coderooms.focusChatInput', focusChatInput),
    vscode.commands.registerCommand('coderooms.ownerActionInfo', () => {
      void vscode.window.showWarningMessage('Only the room owner can perform this action.');
    }),
    vscode.commands.registerCommand('coderooms.showStatus', showStatus),
    vscode.commands.registerCommand('coderooms.reconnect', reconnect),
    vscode.commands.registerCommand('coderooms.generateInviteToken', generateInviteToken),
    configWatcher
  );
}

export function deactivate(): void {
  // cleanup handled via disposables registered on activate
}

async function promptForDisplayName(context: vscode.ExtensionContext): Promise<string | undefined> {
  const existing = context.globalState.get<string>(DISPLAY_NAME_KEY);
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

async function getStoredDisplayName(context: vscode.ExtensionContext): Promise<string | undefined> {
  return context.globalState.get<string>(DISPLAY_NAME_KEY);
}

function extractParticipant(target: ParticipantLike): Participant | undefined {
  if (!target) {
    return undefined;
  }
  if ((target as Participant).userId) {
    return target as Participant;
  }
  if (typeof target === 'object' && 'participant' in target && target.participant) {
    return target.participant;
  }
  return undefined;
}

function extractSuggestion(target: SuggestionLike): Suggestion | undefined {
  if (!target) {
    return undefined;
  }
  if ((target as Suggestion).suggestionId) {
    return target as Suggestion;
  }
  if (typeof target === 'object' && 'suggestion' in target && target.suggestion) {
    return target.suggestion;
  }
  return undefined;
}

