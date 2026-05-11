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
import { OutboundMessageQueue } from './core/OutboundMessageQueue';
import { StatusBarManager } from './ui/StatusBarManager';
import { ParticipantsView } from './ui/ParticipantsView';
import { ChatView } from './ui/ChatView';
import { ClientToServerMessage, Participant, Role, RoomMode, ServerToClientMessage, Suggestion, SuggestionReviewAction } from './connection/MessageTypes';
import { DEFAULT_SERVER_URL } from './util/config';
import { logger } from './util/logger';
import { encrypt, decrypt, type EncryptedPayload } from './util/crypto';
import { NoticeCooldown } from './util/noticeCooldown';
import { consumePendingRoomSecret } from './util/roomSecrets';
import {
  buildSuggestionReviewSummary,
  buildWelcomeMessage,
  getDocumentResyncNotice,
  getEncryptionNotice,
  getJoinAccessDeniedNotice,
  getJoinAccessRetryActionLabel,
  getOwnerUnavailableNotice,
  getReconnectFailureNotice,
  getRoomClosedNotice,
  getRoomStateInvalidNotice
} from './util/roomNotices';
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
  const noticeCooldown = new NoticeCooldown();
  let isConnected = false;
  let connectionPromise: Promise<void> | undefined;
  const outboundQueue = new OutboundMessageQueue(message => webSocket.send(message));
  const pendingParticipantActions = new Map<string, NodeJS.Timeout>();
  let lastRootCursorMessage: Extract<ServerToClientMessage, { type: 'rootCursor' }> | undefined;
  let e2eKey: Buffer | undefined;     // AES-256-GCM key derived from room secret — null when no secret
  let pendingSecret: string | undefined; // secret held in memory until roomId is known for key derivation

  const flushPending = (): void => outboundQueue.flush(isConnected);
  const sendClientMessage = (message: ClientToServerMessage): void => outboundQueue.send(message, isConnected);
  const showInfoNotice = (key: string, message: string, cooldownMs = 0, ...actions: string[]) => {
    if (cooldownMs > 0 && !noticeCooldown.shouldShow(`info:${key}`, cooldownMs)) {
      return Promise.resolve(undefined);
    }
    return vscode.window.showInformationMessage(message, ...actions);
  };
  const showWarningNotice = (key: string, message: string, cooldownMs = 0, ...actions: string[]) => {
    if (cooldownMs > 0 && !noticeCooldown.shouldShow(`warning:${key}`, cooldownMs)) {
      return Promise.resolve(undefined);
    }
    return vscode.window.showWarningMessage(message, ...actions);
  };
  const showErrorNotice = (key: string, message: string, cooldownMs = 0, ...actions: string[]) => {
    if (cooldownMs > 0 && !noticeCooldown.shouldShow(`error:${key}`, cooldownMs)) {
      return Promise.resolve(undefined);
    }
    return vscode.window.showErrorMessage(message, ...actions);
  };

  const applyDebugConfig = () => {
    const enabled = vscode.workspace.getConfiguration('coderooms').get<boolean>('debugLogging') ?? false;
    logger.setDebugLogging(enabled);
  };
  applyDebugConfig();
  void roomStorage.prepare().then(() => roomStorage.pruneStaleRooms()).catch(error => {
    logger.warn(`Failed to prepare or prune room storage: ${error instanceof Error ? error.message : String(error)}`);
  });

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
  let lastJoinSecret: string | undefined; // preserved for auto-rejoin on reconnect
  let lastJoinSessionToken: string | undefined;
  let refreshTimer: NodeJS.Timeout | undefined;
  let participantActivityExpiryTimer: NodeJS.Timeout | undefined;
  const canFollowRoot = (): boolean => {
    const role = roomState.getRole();
    return role === 'collaborator' || role === 'viewer';
  };
  const clearJoinIntent = (): void => {
    lastJoinRoomId = undefined;
    lastJoinDisplayName = undefined;
    lastJoinSecret = undefined;
    lastJoinSessionToken = undefined;
  };

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
    const docId = documentSync.getFocusedDocumentId() ?? documentSync.getActiveDocumentId();
    const sharedUri = documentSync.getFocusedSharedDocumentUri() ?? documentSync.getSharedDocumentUri();
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

  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(editor => {
    documentSync.syncActiveEditor(editor);
    scheduleRootCursorBroadcast(editor);
  });
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

  const clearParticipantActivityExpiryTimer = () => {
    if (!participantActivityExpiryTimer) {
      return;
    }
    clearTimeout(participantActivityExpiryTimer);
    participantActivityExpiryTimer = undefined;
  };

  const scheduleParticipantActivityExpiryRefresh = () => {
    clearParticipantActivityExpiryTimer();
    const nextExpiry = roomState.getNextParticipantActivityExpiry();
    if (!nextExpiry) {
      return;
    }
    participantActivityExpiryTimer = setTimeout(() => {
      participantActivityExpiryTimer = undefined;
      const changed = roomState.pruneExpiredParticipantActivity();
      if (changed) {
        scheduleRefresh();
      }
      scheduleParticipantActivityExpiryRefresh();
    }, Math.max(25, nextExpiry - Date.now() + 25));
  };

  suggestionManager.onDidChange(() => scheduleRefresh());
  documentSync.onDidChangeSharedDocument(() => scheduleRefresh());

  webSocket.on('message', message => {
    void handleServerMessage(message);
  });

  webSocket.on('connected', () => {
    isConnected = true;
    statusBar.setConnectionState('connected');
    // If we were in a room before disconnect, attempt to rejoin
    if (lastJoinRoomId && lastJoinDisplayName) {
      pendingSecret = lastJoinSecret; // re-derive E2E key on rejoin
      webSocket.send({
        type: 'joinRoom',
        roomId: lastJoinRoomId,
        displayName: lastJoinDisplayName,
        secret: lastJoinSecret,
        sessionToken: lastJoinSessionToken
      });
      return;
    }
    flushPending();
  });

  webSocket.on('reconnecting', (info: { attempt: number; delayMs: number }) => {
    statusBar.setConnectionState('reconnecting', `Reconnecting in ${Math.round(info.delayMs / 1000)}s...`, info.attempt);
  });

  webSocket.on('reconnectFailed', () => {
    statusBar.setConnectionState('error', 'Could not reconnect after multiple attempts');
    resetState();
    void showErrorNotice('reconnect-failed', getReconnectFailureNotice(), 5000, 'Retry').then(action => {
      if (action === 'Retry') {
        void ensureConnection(ConnectionIntent.ForceReconnect);
      }
    });
  });

  webSocket.on('close', () => {
    isConnected = false;
    if (webSocket.isAutoReconnecting()) {
      // Preserve room/document/chat state during reconnect window
      statusBar.setConnectionState('reconnecting', 'Connection lost, reconnecting...');
      cursorManager.clearAll();
    } else {
      statusBar.setConnectionState('disconnected', 'Connection closed');
      resetState();
    }
  });

  function resetState(): void {
    roomState.reset();
    documentSync.reset();
    suggestionManager.reset();
    followController.reset();
    chatManager.clear();
    cursorManager.clearAll();
    chatManager.setRoom(undefined);
    outboundQueue.clear();
    pendingParticipantActions.forEach(timer => clearTimeout(timer));
    pendingParticipantActions.clear();
    clearParticipantActivityExpiryTimer();
    noticeCooldown.clear();
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
      case 'ack': {
        outboundQueue.acknowledge(message.key);
        break;
      }
      case 'roomCreated': {
        const roomSecret = pendingSecret;
        resetState();
        const displayName = await getStoredDisplayName(context);
        lastJoinRoomId = message.roomId;
        lastJoinDisplayName = displayName;
        lastJoinSessionToken = message.sessionToken;
        roomState.setSelfInfo(message.userId, 'root', message.roomId, displayName);
        roomState.setMode(message.mode);
        await recordRoomInfo(message.roomId, message.mode);
        chatManager.setRoom(message.roomId);
        await logRoomEvent({ type: 'joined', userId: message.userId });
        e2eKey = consumePendingRoomSecret(roomSecret, message.roomId);
        pendingSecret = undefined;
        flushPending();
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
            content: getEncryptionNotice(),
            timestamp: Date.now(),
            isSystem: true
          });
        }
        break;
      }
      case 'joinedRoom': {
        const roomSecret = pendingSecret;
        if (roomState.getRoomId() !== message.roomId) {
          resetState();
        }
        const displayName = await getStoredDisplayName(context);
        lastJoinRoomId = message.roomId;
        lastJoinDisplayName = displayName;
        lastJoinSessionToken = message.sessionToken;
        roomState.setSelfInfo(message.userId, message.role, message.roomId, displayName);
        roomState.setMode(message.mode);
        await recordRoomInfo(message.roomId, message.mode);
        roomState.setParticipants(message.participants);
        chatManager.setRoom(message.roomId);

        e2eKey = consumePendingRoomSecret(roomSecret, message.roomId);
        pendingSecret = undefined;
        flushPending();
        
        const welcomeText = buildWelcomeMessage(message.role, Boolean(e2eKey));

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
      case 'syncSuggestions': {
        suggestionManager.replaceAll(message.suggestions);
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
        const departingParticipant = roomState.getParticipants().find(p => p.userId === message.userId);
        const wasRemoved = pendingParticipantActions.has(message.userId);
        roomState.removeParticipant(message.userId);
        cursorManager.removeCursor(message.userId);
        await logRoomEvent({ type: 'left', userId: message.userId });
        scheduleRefresh();
        const pendingTimer = pendingParticipantActions.get(message.userId);
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          pendingParticipantActions.delete(message.userId);
        }
        if (roomState.getRoomId()) {
          chatManager.addMessage({
            messageId: uuidv4(),
            fromUserId: message.userId,
            fromName: departingParticipant?.displayName ?? 'System',
            role: 'viewer',
            content: departingParticipant
              ? `${departingParticipant.displayName} ${wasRemoved ? 'was removed from the room' : 'left the room'}`
              : `Participant left (${message.userId})`,
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
            void showInfoNotice(`role-updated:${message.userId}:${message.role}`, `${target.displayName} is now ${message.role}.`, 1500);
          }
        }
        const pendingTimer = pendingParticipantActions.get(message.userId);
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          pendingParticipantActions.delete(message.userId);
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
        break;
      }
      case 'shareDocument': {
        await documentSync.handleShareDocument(message);
        break;
      }
      case 'documentUnshared': {
        await documentSync.handleDocumentUnshared(message);
        scheduleRefresh();
        break;
      }
      case 'fullDocumentSync': {
        await documentSync.handleFullDocumentSync(message);
        break;
      }
      case 'requestFullSync': {
        await documentSync.handleRequestFullSync(message);
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
        scheduleParticipantActivityExpiryRefresh();
        break;
      }
      case 'newSuggestion': {
        const isNewSuggestion = suggestionManager.handleSuggestion(message.suggestion);
        await logRoomEvent({
          type: 'suggestionCreated',
          suggestionId: message.suggestion.suggestionId,
          docId: message.suggestion.docId,
          userId: message.suggestion.authorId
        });
        if (isNewSuggestion && roomState.isRoot()) {
          const pendingSuggestions = suggestionManager.getPendingSuggestionIds().length;
          const noticeMessage = pendingSuggestions > 1
            ? `${pendingSuggestions} suggestions are waiting for review.`
            : `${message.suggestion.authorName} sent a suggestion.`;
          void showInfoNotice('new-suggestion', noticeMessage, 2000, 'Open review queue').then(action => {
            if (action === 'Open review queue') {
              openParticipantsView();
            }
          });
        }
        break;
      }
      case 'suggestionAccepted': {
        suggestionManager.handleSuggestionAccepted(message.suggestionId);
        await logRoomEvent({
          type: 'suggestionAccepted',
          suggestionId: message.suggestionId,
          docId: message.docId
        });
        break;
      }
      case 'suggestionRejected': {
        suggestionManager.handleSuggestionRejected(message.suggestionId);
        await logRoomEvent({
          type: 'suggestionRejected',
          suggestionId: message.suggestionId,
          docId: message.docId
        });
        break;
      }
      case 'suggestionsReviewed': {
        void showInfoNotice(
          'suggestions-reviewed',
          buildSuggestionReviewSummary({
            action: message.action,
            reviewedCount: message.reviewedCount,
            alreadyReviewedCount: message.alreadyReviewedCount,
            conflictCount: message.conflictCount,
            missingCount: message.missingCount
          }),
          750
        );
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
            void vscode.window.showErrorMessage(payload);
            break;
          case 'TARGET_NOT_FOUND':
            void vscode.window.showErrorMessage(payload);
            break;
          case 'ROOM_SECRET_REQUIRED':
            await retryJoinWithSecret('This room requires a secret. Please enter the secret and try again.');
            break;
          case 'ROOM_SECRET_INVALID':
            await retryJoinWithSecret('Invalid room secret. Check the invite and try again.');
            break;
          case 'ROOM_ACCESS_DENIED': {
            const action = await vscode.window.showErrorMessage(
              getJoinAccessDeniedNotice(),
              getJoinAccessRetryActionLabel()
            );
            if (action === getJoinAccessRetryActionLabel()) {
              await retryJoinWithSecret('Enter the room secret or invite token and try again.');
            }
            break;
          }
          case 'RATE_LIMITED':
            void vscode.window.showErrorMessage('Too many failed join attempts. Please wait a few minutes and retry.');
            break;
          case 'ROOM_NOT_FOUND':
            void vscode.window.showErrorMessage('Room not found. Double-check the invite code.');
            break;
          case 'ROOM_CLOSED':
            clearJoinIntent();
            void showWarningNotice('room-closed', getRoomClosedNotice(), 3000);
            resetState();
            break;
          case 'PATCH_INVALID':
            void showWarningNotice('patch-invalid', getDocumentResyncNotice(), 3000);
            break;
          case 'MESSAGE_TOO_LONG':
            void showWarningNotice('message-too-long', 'Message is too long (max 2000 characters).', 3000);
            break;
          case 'MESSAGE_EMPTY':
            void showWarningNotice('message-empty', 'Message cannot be empty.', 3000);
            break;
          case 'PAYLOAD_TOO_LARGE':
            void showWarningNotice('payload-too-large', 'The file is too large to share (max 2 MB).', 3000);
            break;
          case 'DOCUMENT_TOO_LARGE':
            void showWarningNotice('document-too-large', 'The document is too large to share (max 2 MB).', 3000);
            break;
          case 'MEMORY_LIMIT':
            void showWarningNotice('memory-limit', 'The server document memory limit has been reached. Reduce shared document size and retry.', 3000);
            break;
          case 'TOKEN_INVALID':
            void vscode.window.showErrorMessage('Invite token is invalid or has expired. Ask the room owner for a new one.');
            break;
          case 'LABEL_TOO_LONG':
            void showWarningNotice('label-too-long', 'Invite labels must be 80 characters or fewer.', 3000);
            break;
          case 'OWNER_UNAVAILABLE':
            void showWarningNotice('owner-unavailable', getOwnerUnavailableNotice(), 3000);
            break;
          case 'ROOM_STATE_INVALID':
            void showWarningNotice('room-state-invalid', getRoomStateInvalidNotice(), 3000);
            break;
          case 'REMOVED_FROM_ROOM':
            clearJoinIntent();
            void showWarningNotice('removed-from-room', 'You were removed from the room by the owner.', 3000);
            resetState();
            break;
          case 'SUGGESTION_ALREADY_REVIEWED':
            void showWarningNotice('suggestion-reviewed', 'That suggestion has already been reviewed.', 3000);
            break;
          case 'CONFLICT':
            void showWarningNotice('state-conflict', 'This request conflicts with the current shared state. Refresh the session and retry.', 3000);
            break;
          default:
            if (payload.toLowerCase().includes('room not found')) {
              void vscode.window.showErrorMessage('Room not found. Double-check the invite code.');
            } else if (payload.toLowerCase().includes('room closed')) {
              clearJoinIntent();
              void showWarningNotice('room-closed', getRoomClosedNotice(), 3000);
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
          outboundQueue.clear();
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
    lastJoinDisplayName = displayName;
    lastJoinSecret = secret;
    lastJoinSessionToken = undefined;
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
    lastJoinSecret = secret;
    lastJoinRoomId = roomId.trim();
    lastJoinDisplayName = displayName;
    lastJoinSessionToken = undefined;
    webSocket.send({ type: 'joinRoom', roomId: roomId.trim(), displayName, secret, token });
  }

  function leaveRoom(): void {
    if (!roomState.getRoomId()) {
      void vscode.window.showInformationMessage('You are not connected to a CodeRoom.');
      return;
    }
    webSocket.send({ type: 'leaveRoom' });
    clearJoinIntent();
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
    if (!canFollowRoot()) {
      void vscode.window.showInformationMessage('Follow mode is available for collaborators and viewers.');
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

    if (canFollowRoot()) {
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
      pendingParticipantActions.delete(participant.userId);
      void vscode.window.showWarningMessage(`Role change for ${participant.displayName} not confirmed. The user may be offline or permissions blocked.`);
    }, 5000);
    const existing = pendingParticipantActions.get(participant.userId);
    if (existing) {
      clearTimeout(existing);
    }
    pendingParticipantActions.set(participant.userId, timer);
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

  function handleSetParticipantRole(target: ParticipantLike, role: Extract<Role, 'collaborator' | 'viewer'>): void {
    if (!roomState.isRoot()) {
      return;
    }
    if (!roomState.getRoomId()) {
      void vscode.window.showWarningMessage('Join or start a room first.');
      return;
    }
    const participant = extractParticipant(target);
    if (!participant) {
      return;
    }
    webSocket.send({ type: 'updateRole', userId: participant.userId, role });
  }

  function handleKickParticipant(target: ParticipantLike): void {
    if (!roomState.isRoot()) {
      void vscode.window.showWarningMessage('Only the room owner can manage participants.');
      return;
    }
    if (!roomState.getRoomId()) {
      void vscode.window.showWarningMessage('Join or start a room first.');
      return;
    }
    const participant = extractParticipant(target);
    if (!participant) {
      return;
    }
    const timer = setTimeout(() => {
      pendingParticipantActions.delete(participant.userId);
      void vscode.window.showWarningMessage(`Removal of ${participant.displayName} was not confirmed. The user may be offline or the server may have rejected the request.`);
    }, 5000);
    const existing = pendingParticipantActions.get(participant.userId);
    if (existing) {
      clearTimeout(existing);
    }
    pendingParticipantActions.set(participant.userId, timer);
    webSocket.send({ type: 'removeParticipant', userId: participant.userId });
    void vscode.window.showInformationMessage(`Requested removal of ${participant.displayName} from the room.`);
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

    // Optimistically add message to UI
    chatManager.addMessage({
      messageId,
      fromUserId: roomState.getUserId() ?? 'local',
      fromName: roomState.getDisplayName() ?? 'Me',
      role: roomState.getRole() ?? 'viewer',
      content: trimmed,
      timestamp,
      isSystem: false
    });

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

  async function clearPendingSuggestions(): Promise<void> {
    await reviewPendingSuggestions('reject');
  }

  async function acceptPendingSuggestions(): Promise<void> {
    await reviewPendingSuggestions('accept');
  }

  async function reviewPendingSuggestions(action: SuggestionReviewAction): Promise<void> {
    if (!roomState.isRoot()) {
      void vscode.window.showInformationMessage('Only the room owner can review suggestions.');
      return;
    }
    const roomId = roomState.getRoomId();
    const suggestionIds = suggestionManager.getPendingSuggestionIds();
    if (!roomId || suggestionIds.length === 0) {
      void vscode.window.showInformationMessage('No pending suggestions to review.');
      return;
    }
    sendClientMessage({
      type: 'reviewSuggestions',
      roomId,
      suggestionIds,
      action
    });
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
    lastJoinSecret = secret;
    webSocket.send({
      type: 'joinRoom',
      roomId: lastJoinRoomId,
      displayName: lastJoinDisplayName,
      secret,
      token,
      sessionToken: lastJoinSessionToken
    });
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
    vscode.commands.registerCommand('coderooms.setParticipantRoleCollaborator', item => handleSetParticipantRole(item, 'collaborator')),
    vscode.commands.registerCommand('coderooms.setParticipantRoleViewer', item => handleSetParticipantRole(item, 'viewer')),
    vscode.commands.registerCommand('coderooms.kickParticipant', handleKickParticipant),
    vscode.commands.registerCommand('coderooms.acceptSuggestion', item => handleSuggestionAction(item, 'accept')),
    vscode.commands.registerCommand('coderooms.rejectSuggestion', item => handleSuggestionAction(item, 'reject')),
    vscode.commands.registerCommand('coderooms.acceptPendingSuggestions', () => void acceptPendingSuggestions()),
    vscode.commands.registerCommand('coderooms.clearPendingSuggestions', () => void clearPendingSuggestions()),
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
