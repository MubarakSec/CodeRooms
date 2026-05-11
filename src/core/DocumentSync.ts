import * as path from 'path';
import * as vscode from 'vscode';
import { TextDocumentChangeEvent, workspace } from 'vscode';
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';
import { v4 as uuidv4 } from 'uuid';
import { ClientToServerMessage, Position, ServerToClientMessage, Suggestion, TextPatch } from '../connection/MessageTypes';
import { RoomState } from './RoomState';
import { RoomStorage } from './RoomStorage';
import { logger } from '../util/logger';
import { getDocumentResyncNotice } from '../util/roomNotices';
import { encryptBinary, decryptBinary } from '../util/crypto';

type ShareDocumentMessage = Extract<ServerToClientMessage, { type: 'shareDocument' }>;
type FullDocumentSyncMessage = Extract<ServerToClientMessage, { type: 'fullDocumentSync' }>;
type RequestFullSyncMessage = Extract<ServerToClientMessage, { type: 'requestFullSync' }>;
type DocumentUnsharedMessage = Extract<ServerToClientMessage, { type: 'documentUnshared' }>;

interface TrackedDocument {
  docId: string;
  uri?: vscode.Uri;
  version: number;
  lastSyncedText: string;
  pendingSnapshot: boolean;
  sharedDocument?: vscode.TextDocument;
  fileName?: string;
  languageId?: string;
  yDoc?: Y.Doc;
  awareness?: Awareness;
}

export class DocumentSync {
  private readonly documents = new Map<string, TrackedDocument>();
  private activeDocumentId?: string;
  private focusedDocumentId?: string;
  private suppressChanges = false;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly sharedDocEmitter = new vscode.EventEmitter<void>();
  private readonly remoteToLocal = new Map<string, vscode.Uri>();
  private readonly localToRemote = new Map<string, string>();
  private currentRoomId?: string;
  private lastActivitySent = 0;
  private readonly typingIntervalMs = 800;
  private readonly pendingSuggestionPatches = new Map<string, TextPatch[]>();
  private readonly pendingDocFlush = new Map<string, NodeJS.Timeout>();
  private readonly flushDelayMs = 45;
  private readonly pendingDocChanges = new Map<string, vscode.TextDocumentContentChangeEvent[]>();
  private readonly pendingShareDocs = new Map<string, {
    docId: string;
    uri: vscode.Uri;
    sharedDocument: vscode.TextDocument;
    fileName?: string;
    languageId?: string;
  }>();
  private readonly pendingFullSyncs = new Map<string, FullDocumentSyncMessage>();
  private readonly pendingSnapshotTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingUnshares = new Set<string>();
  private readonly pendingSnapshotTimeoutMs = 5000;
  private lastUnsharedEditWarning = 0;

  readonly onDidChangeSharedDocument = this.sharedDocEmitter.event;

  constructor(
    private readonly roomState: RoomState,
    private readonly storage: RoomStorage,
    private readonly sendMessage: (message: ClientToServerMessage) => void,
    private readonly onCursorUpdate?: (docId: string, userId: string, userName: string, uri: string, position: Position, selections?: { start: Position; end: Position }[]) => void
  ) {
    this.disposables.push(
      workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this),
      workspace.onDidCloseTextDocument(this.onDidCloseTextDocument, this),
      this.sharedDocEmitter
    );
  }

  applyAwarenessUpdate(docId: string, update: Uint8Array): void {
    const tracked = this.documents.get(docId);
    if (!tracked || !tracked.awareness) {
      return;
    }
    applyAwarenessUpdate(tracked.awareness, update, 'remote');
  }

  updateLocalAwareness(docId: string, position: Position, selections: { start: Position; end: Position }[]): void {
    const tracked = this.documents.get(docId);
    if (!tracked || !tracked.awareness || !tracked.sharedDocument) {
      return;
    }
    
    tracked.awareness.setLocalStateField('cursor', {
      position,
      selections,
      uri: tracked.sharedDocument.uri.toString(),
      userName: this.roomState.getDisplayName() ?? 'Unknown',
      userId: this.roomState.getUserId() ?? 'unknown'
    });
  }

  dispose(): void {
    this.disposables.forEach(disposable => disposable.dispose());
  }

  shareDocument(document: vscode.TextDocument): void {
    const roomId = this.roomState.getRoomId();
    if (!roomId) {
      void vscode.window.showWarningMessage('Join a CodeRoom before sharing a file.');
      return;
    }

    // Avoid sharing the same file multiple times; just activate it instead.
    const existingDocId = this.localToRemote.get(this.uriKey(document.uri));
    if (existingDocId && this.documents.has(existingDocId)) {
      this.activeDocumentId = existingDocId;
      const tracked = this.documents.get(existingDocId);
      this.roomState.setActiveSharedDocLabel(tracked?.fileName);
      void vscode.window.showTextDocument(document, { preview: false });
      this.emitSharedDocChanged();
      void vscode.window.showInformationMessage('This file is already shared. Switched to it.');
      return;
    }

    const existingPendingShare = Array.from(this.pendingShareDocs.values()).find(candidate => this.uriKey(candidate.uri) === this.uriKey(document.uri));
    if (existingPendingShare) {
      this.updateActiveDocumentState(existingPendingShare.docId);
      this.updateFocusedDocumentState(existingPendingShare.docId);
      this.emitSharedDocChanged();
      void vscode.window.showInformationMessage('This file is already waiting to be shared.');
      return;
    }

    const docId = uuidv4();
    const text = document.getText();
    
    // Initialize Yjs document
    const yDoc = new Y.Doc();
    const yText = yDoc.getText('text');
    yText.insert(0, text);

    const awareness = new Awareness(yDoc);
    awareness.on('update', ({ added, updated, removed }: any) => {
      const changedClients = added.concat(updated, removed);
      const update = encodeAwarenessUpdate(awareness, changedClients);
      const currentRoomId = this.getEffectiveRoomId();
      if (currentRoomId) {
        this.sendMessage({
          type: 'awarenessUpdate',
          roomId: currentRoomId,
          docId,
          update
        });
      }
    });

    awareness.on('change', () => {
      const state = awareness.getStates();
      for (const [clientId, userState] of state.entries()) {
        if (clientId !== awareness.clientID && userState.cursor && this.onCursorUpdate) {
          this.onCursorUpdate(
            docId,
            userState.cursor.userId,
            userState.cursor.userName,
            userState.cursor.uri,
            userState.cursor.position,
            userState.cursor.selections
          );
        }
      }
    });

    const tracked: TrackedDocument = {
      docId,
      uri: document.uri,
      version: 1,
      lastSyncedText: text,
      pendingSnapshot: false,
      sharedDocument: document,
      fileName: this.fileNameFromUri(document.uri),
      languageId: document.languageId,
      yDoc,
      awareness
    };

    this.pendingShareDocs.set(docId, {
      docId,
      uri: document.uri,
      sharedDocument: document,
      fileName: tracked.fileName,
      languageId: document.languageId
    });
    this.activeDocumentId = docId;
    this.focusedDocumentId = docId;
    this.currentRoomId = roomId;
    this.registerLocalMapping(docId, document.uri);
    this.roomState.setActiveSharedDocLabel(tracked.fileName);

    const yjsState = Y.encodeStateAsUpdate(yDoc);
    const e2eKey = this.roomState.getE2EKey();
    const encryptedYjsState = e2eKey ? encryptBinary(yjsState, e2eKey) : yjsState;

    this.sendMessage({
      type: 'shareDocument',
      roomId,
      docId,
      originalUri: document.uri.toString(),
      fileName: tracked.fileName ?? this.fileNameFromUri(document.uri),
      languageId: document.languageId,
      text,
      version: tracked.version,
      yjsState: encryptedYjsState
    });

    this.emitSharedDocChanged();
  }

  unshareDocument(targetDocId?: string): void {
    const roomId = this.roomState.getRoomId();
    const docId = targetDocId ?? this.getActiveDocumentId() ?? this.getFocusedDocumentId();
    if (!roomId || !docId) {
      void vscode.window.showWarningMessage('No shared document to unshare.');
      return;
    }
    if (this.pendingUnshares.has(docId)) {
      return;
    }
    this.pendingUnshares.add(docId);
    this.sendMessage({ type: 'unshareDocument', roomId, documentId: docId });
    this.emitSharedDocChanged();
  }

  stopSharing(): void {
    this.documents.clear();
    this.remoteToLocal.clear();
    this.localToRemote.clear();
    this.activeDocumentId = undefined;
    this.focusedDocumentId = undefined;
    this.currentRoomId = undefined;
    this.pendingDocChanges.clear();
    this.pendingDocFlush.forEach(timer => clearTimeout(timer));
    this.pendingDocFlush.clear();
    this.pendingShareDocs.clear();
    this.pendingFullSyncs.clear();
    this.pendingSnapshotTimers.forEach(timer => clearTimeout(timer));
    this.pendingSnapshotTimers.clear();
    this.pendingUnshares.clear();
    this.roomState.setActiveSharedDocLabel(undefined);
    this.emitSharedDocChanged();
  }

  getSharedDocumentUri(): vscode.Uri | undefined {
    return this.getFocusedSharedDocumentUri() ?? this.getActiveDocumentState()?.uri;
  }

  isSharing(): boolean {
    return this.documents.size > 0;
  }

  getActiveDocumentId(): string | undefined {
    if (this.activeDocumentId && this.documents.has(this.activeDocumentId)) {
      return this.activeDocumentId;
    }
    if (this.activeDocumentId && this.pendingShareDocs.has(this.activeDocumentId)) {
      return this.activeDocumentId;
    }
    this.activeDocumentId = undefined;
    const first = this.documents.values().next().value as TrackedDocument | undefined;
    if (first) {
      return first.docId;
    }
    return this.pendingShareDocs.values().next().value?.docId;
  }

  getFocusedDocumentId(): string | undefined {
    if (this.focusedDocumentId && (this.documents.has(this.focusedDocumentId) || this.pendingShareDocs.has(this.focusedDocumentId))) {
      return this.focusedDocumentId;
    }
    this.focusedDocumentId = undefined;
    return undefined;
  }

  getFocusedSharedDocumentUri(): vscode.Uri | undefined {
    const focusedId = this.getFocusedDocumentId();
    if (!focusedId) {
      return undefined;
    }
    return this.documents.get(focusedId)?.uri ?? this.pendingShareDocs.get(focusedId)?.uri;
  }

  getSharedDocuments(): Array<{ docId: string; uri?: vscode.Uri; fileName?: string; isActive: boolean; isPending?: boolean }> {
    const active = this.getActiveDocumentId();
    const shared = Array.from(this.documents.values()).map(doc => ({
      docId: doc.docId,
      uri: doc.uri,
      fileName: doc.fileName ?? (doc.uri ? this.fileNameFromUri(doc.uri) : undefined),
      isActive: doc.docId === active
    }));
    const pending = Array.from(this.pendingShareDocs.values())
      .filter(doc => !this.documents.has(doc.docId))
      .map(doc => ({
        docId: doc.docId,
        uri: doc.uri,
        fileName: doc.fileName ?? this.fileNameFromUri(doc.uri),
        isActive: doc.docId === active,
        isPending: true
      }));
    return shared.concat(pending);
  }

  async setActiveDocument(docId: string, reveal = true): Promise<vscode.TextEditor | undefined> {
    if (!this.documents.has(docId) && !this.pendingShareDocs.has(docId)) {
      return undefined;
    }
    this.updateActiveDocumentState(docId);
    if (this.pendingShareDocs.has(docId)) {
      if (reveal) {
        const editor = await this.revealDocumentIfNeeded(this.pendingShareDocs.get(docId)!.sharedDocument);
        this.emitSharedDocChanged();
        return editor;
      }
      this.emitSharedDocChanged();
      return this.findVisibleEditor(this.pendingShareDocs.get(docId)!.sharedDocument.uri);
    }
    const editor = await this.ensureDocumentIsOpen(docId, reveal);
    this.emitSharedDocChanged();
    return editor;
  }

  syncActiveEditor(editor?: vscode.TextEditor): void {
    if (!editor) {
      return;
    }
    const docId = this.localToRemote.get(this.uriKey(editor.document.uri));
    if (!docId || (!this.documents.has(docId) && !this.pendingShareDocs.has(docId))) {
      return;
    }
    this.updateFocusedDocumentState(docId, true);
  }

  hasPendingSuggestion(docId?: string): boolean {
    const target = docId ?? this.getActiveDocumentId();
    if (!target) {
      return false;
    }
    const patches = this.pendingSuggestionPatches.get(target);
    return Boolean(patches && patches.length > 0);
  }

  getPendingSuggestionCount(docId?: string): number {
    const target = docId ?? this.getActiveDocumentId();
    if (!target) {
      return 0;
    }
    return this.pendingSuggestionPatches.get(target)?.length ?? 0;
  }

  async sendPendingSuggestion(docId?: string): Promise<boolean> {
    const roomId = this.roomState.getRoomId();
    const userId = this.roomState.getUserId();
    const displayName = this.roomState.getDisplayName() ?? 'Collaborator';
    const targetDocId = docId ?? this.getActiveDocumentId();
    if (!roomId || !userId || !targetDocId) {
      return false;
    }
    const patches = this.pendingSuggestionPatches.get(targetDocId) ?? [];
    if (patches.length === 0) {
      return false;
    }

    const suggestion: Suggestion = {
      suggestionId: uuidv4(),
      roomId,
      docId: targetDocId,
      authorId: userId,
      authorName: displayName,
      patches,
      createdAt: Date.now(),
      status: 'pending'
    };

    this.sendMessage({
      type: 'suggestion',
      roomId,
      docId: targetDocId,
      suggestionId: suggestion.suggestionId,
      patches: suggestion.patches,
      authorId: suggestion.authorId,
      authorName: suggestion.authorName,
      createdAt: suggestion.createdAt
    });

    this.pendingSuggestionPatches.delete(targetDocId);
    await this.revertToSnapshot(targetDocId);
    this.emitSharedDocChanged();
    return true;
  }

  getDocumentUri(docId: string): vscode.Uri | undefined {
    const tracked = this.documents.get(docId);
    if (tracked?.uri) {
      return tracked.uri;
    }
    return this.remoteToLocal.get(docId);
  }

  async revealRemoteCursor(docId: string, position: Position, fallbackUri?: string): Promise<void> {
    let targetUri = this.remoteToLocal.get(docId);
    if (!targetUri && fallbackUri) {
      try {
        targetUri = vscode.Uri.parse(fallbackUri);
      } catch (error) {
        logger.warn(`Unable to parse fallback uri for docId=${docId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (!targetUri) {
      logger.warn(`Unable to follow root cursor for docId=${docId}: missing local uri mapping.`);
      return;
    }

    const editor = await this.setActiveDocument(docId, true);
    if (!editor) {
      logger.warn(`Unable to follow root cursor for docId=${docId}: editor is unavailable.`);
      return;
    }
    const pos = new vscode.Position(position.line, position.character);
    const selection = new vscode.Selection(pos, pos);
    editor.selection = selection;
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  async handleShareDocument(message: ShareDocumentMessage): Promise<void> {
    const isNewRoom = this.currentRoomId && this.currentRoomId !== message.roomId;
    if (isNewRoom) {
      // Clear any leftover state when a new room starts sharing to avoid cross-room collisions.
      this.reset();
    }
    this.currentRoomId = message.roomId;
    try {
      await this.storage.prepare();
      const pendingShare = this.pendingShareDocs.get(message.docId);
      const { uri: storageUri } = await this.storage.registerDocument(
        message.roomId,
        message.docId,
        message.fileName,
        message.originalUri,
        message.text,
        message.version
      );

      const yDoc = new Y.Doc();
      if (message.yjsState) {
        try {
          const e2eKey = this.roomState.getE2EKey();
          const yjsState = e2eKey ? decryptBinary(message.yjsState, e2eKey) : message.yjsState;
          if (yjsState) {
            Y.applyUpdate(yDoc, yjsState);
          }
        } catch (e) {
          logger.error(`Failed to restore Yjs state for docId=${message.docId}: ${String(e)}`);
          // Fallback to text if Yjs fails
          yDoc.getText('text').insert(0, message.text);
        }
      } else {
        yDoc.getText('text').insert(0, message.text);
      }

      const awareness = new Awareness(yDoc);
      awareness.on('update', ({ added, updated, removed }: any) => {
        const changedClients = added.concat(updated, removed);
        const update = encodeAwarenessUpdate(awareness, changedClients);
        const currentRoomId = this.getEffectiveRoomId();
        if (currentRoomId) {
          this.sendMessage({
            type: 'awarenessUpdate',
            roomId: currentRoomId,
            docId: message.docId,
            update
          });
        }
      });

      awareness.on('change', () => {
        const state = awareness.getStates();
        for (const [clientId, userState] of state.entries()) {
          if (clientId !== awareness.clientID && userState.cursor && this.onCursorUpdate) {
            this.onCursorUpdate(
              message.docId,
              userState.cursor.userId,
              userState.cursor.userName,
              userState.cursor.uri,
              userState.cursor.position,
              userState.cursor.selections
            );
          }
        }
      });

      const tracked: TrackedDocument = {
        docId: message.docId,
        uri: pendingShare?.uri ?? storageUri,
        version: message.version,
        lastSyncedText: message.text,
        pendingSnapshot: false,
        fileName: message.fileName,
        languageId: message.languageId,
        sharedDocument: pendingShare?.sharedDocument,
        yDoc,
        awareness
      };

      this.documents.set(message.docId, tracked);
      this.pendingShareDocs.delete(message.docId);
      this.pendingUnshares.delete(message.docId);
      this.registerLocalMapping(message.docId, tracked.uri ?? storageUri);

      const shouldReveal = !this.activeDocumentId || isNewRoom;
      if (!this.activeDocumentId) {
        this.activeDocumentId = message.docId;
      }
      if (shouldReveal && !pendingShare) {
        await this.setActiveDocument(message.docId, true);
      } else {
        this.updateRoomDocumentLabel();
      }

      await this.applyPendingFullSync(message.docId);
      if ((this.pendingDocChanges.get(message.docId)?.length ?? 0) > 0) {
        this.scheduleFlush(message.docId);
      }
      if (this.pendingUnshares.has(message.docId)) {
        this.unshareDocument(message.docId);
      }
      this.emitSharedDocChanged();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error(`Unable to open shared document: ${detail}`);
      void vscode.window.showErrorMessage('Unable to open shared CodeRoom document. Check storage permissions.');
    }
  }

  async handleFullDocumentSync(message: FullDocumentSyncMessage): Promise<void> {
    await this.applyFullDocumentSync(message.docId, message.text, message.version, message.yjsState);
  }

  async handleRequestFullSync(message: RequestFullSyncMessage): Promise<void> {
    if (!this.roomState.isRoot()) {
      logger.warn('Ignoring full sync request because the local client is not the room owner.');
      return;
    }
    const roomId = this.roomState.getRoomId();
    const tracked = this.documents.get(message.docId);
    if (!roomId || !tracked) {
      logger.warn(`Unable to fulfill full sync request for docId=${message.docId}: missing room or tracked document.`);
      return;
    }
    await this.ensureDocumentIsOpen(message.docId, false);
    const document = tracked.sharedDocument;
    if (!document) {
      logger.warn('Unable to fulfill full sync request because document is unavailable.');
      return;
    }
    const yjsState = Y.encodeStateAsUpdate(tracked.yDoc!);
    const e2eKey = this.roomState.getE2EKey();
    const encryptedYjsState = e2eKey ? encryptBinary(yjsState, e2eKey) : yjsState;

    this.sendMessage({
      type: 'fullDocumentSync',
      roomId,
      docId: message.docId,
      text: document.getText(),
      version: tracked.version,
      yjsState: encryptedYjsState
    });
  }

  async handleDocumentUnshared(message: DocumentUnsharedMessage): Promise<void> {
    this.pendingUnshares.delete(message.documentId);
    this.pendingShareDocs.delete(message.documentId);
    this.removeTrackedDocument(message.documentId);
  }

  async applyRemoteChange(docId: string, patch: TextPatch, version: number, yjsUpdate?: Uint8Array): Promise<void> {
    const tracked = this.documents.get(docId);
    if (!tracked) {
      logger.warn(`Received change for unknown document ${docId}`);
      this.requestFullSyncForDoc(docId);
      return;
    }

    await this.ensureDocumentIsOpen(docId, docId === this.activeDocumentId);
    const document = tracked.sharedDocument;
    if (!document || !tracked.yDoc) {
      logger.warn(`Unable to apply patch for docId=${docId}: document or yDoc not loaded.`);
      this.requestFullSyncForDoc(docId);
      return;
    }

    if (version <= tracked.version) {
      logger.info(`[CodeRooms] Ignoring stale patch for docId=${docId} at version=${version}`);
      return;
    }

    const roomId = this.getEffectiveRoomId();
    let applied = false;

    if (yjsUpdate && roomId) {
      try {
        const e2eKey = this.roomState.getE2EKey();
        const b64Update = e2eKey ? decryptBinary(yjsUpdate, e2eKey) : yjsUpdate;
        if (b64Update) {
          Y.applyUpdate(tracked.yDoc, b64Update);
          
          const newText = tracked.yDoc.getText('text').toString();
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, this.fullDocumentRange(document), newText);
          
          this.suppressChanges = true;
          applied = await workspace.applyEdit(edit);
          this.suppressChanges = false;
        }
      } catch (e) {
        logger.error(`Failed to apply Yjs update for docId=${docId}: ${String(e)}`);
      }
    }

    // Fallback to OT if Yjs failed or was missing
    if (!applied) {
      applied = await this.applyPatch(document, patch);
    }

    if (!applied) {
      this.requestFullSyncForDoc(docId);
      void vscode.window.showWarningMessage(getDocumentResyncNotice(), 'Retry now').then(action => {
        if (action === 'Retry now') {
          const roomId = this.getEffectiveRoomId();
          if (!roomId) {
            return;
          }
          this.sendMessage({
            type: 'requestFullSync',
            roomId,
            docId
          });
        }
      });
      return;
    }

    tracked.version = version;
    tracked.lastSyncedText = document.getText();
    tracked.pendingSnapshot = false;
    await this.persistVersion(docId, tracked.version);
  }

  async applyFullDocumentSync(docId: string, text: string, version: number, yjsState?: Uint8Array): Promise<void> {
    let tracked = this.documents.get(docId);
    if (!tracked) {
      tracked = { docId, version: 0, lastSyncedText: '', pendingSnapshot: false };
      this.documents.set(docId, tracked);
    }

    if (yjsState && !tracked.yDoc) {
      tracked.yDoc = new Y.Doc();
      tracked.awareness = new Awareness(tracked.yDoc);
      tracked.awareness.on('update', ({ added, updated, removed }: any) => {
        const changedClients = added.concat(updated, removed);
        const update = encodeAwarenessUpdate(tracked.awareness!, changedClients);
        const currentRoomId = this.getEffectiveRoomId();
        if (currentRoomId) {
          this.sendMessage({ type: 'awarenessUpdate', roomId: currentRoomId, docId, update });
        }
      });
      tracked.awareness.on('change', () => {
        const state = tracked.awareness!.getStates();
        for (const [clientId, userState] of state.entries()) {
          if (clientId !== tracked.awareness!.clientID && userState.cursor && this.onCursorUpdate) {
            this.onCursorUpdate(docId, userState.cursor.userId, userState.cursor.userName, userState.cursor.uri, userState.cursor.position, userState.cursor.selections);
          }
        }
      });
    }

    if (yjsState && tracked.yDoc) {
      try {
        const e2eKey = this.roomState.getE2EKey();
        const b64Update = e2eKey ? decryptBinary(yjsState, e2eKey) : yjsState;
        if (b64Update) {
          Y.applyUpdate(tracked.yDoc, b64Update);
        }
      } catch (e) {
        logger.error(`Failed to apply full Yjs sync for docId=${docId}: ${String(e)}`);
      }
    } else if (!tracked.yDoc) {
      tracked.yDoc = new Y.Doc();
      tracked.yDoc.getText('text').insert(0, text);
      tracked.awareness = new Awareness(tracked.yDoc);
      tracked.awareness.on('update', ({ added, updated, removed }: any) => {
        const changedClients = added.concat(updated, removed);
        const update = encodeAwarenessUpdate(tracked.awareness!, changedClients);
        const currentRoomId = this.getEffectiveRoomId();
        if (currentRoomId) {
          this.sendMessage({ type: 'awarenessUpdate', roomId: currentRoomId, docId, update });
        }
      });
      tracked.awareness.on('change', () => {
        const state = tracked.awareness!.getStates();
        for (const [clientId, userState] of state.entries()) {
          if (clientId !== tracked.awareness!.clientID && userState.cursor && this.onCursorUpdate) {
            this.onCursorUpdate(docId, userState.cursor.userId, userState.cursor.userName, userState.cursor.uri, userState.cursor.position, userState.cursor.selections);
          }
        }
      });
    }

    await this.ensureDocumentIsOpen(docId, docId === this.activeDocumentId);
    const document = tracked.sharedDocument;
    if (!document) {
      this.pendingFullSyncs.set(docId, { type: 'fullDocumentSync', roomId: this.getEffectiveRoomId() ?? '', docId, text, version, yjsState });
      logger.warn(`Queued full sync for docId=${docId} until the shared document is available locally.`);
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    const range = this.fullDocumentRange(document);
    edit.replace(document.uri, range, text);

    this.suppressChanges = true;
    await workspace.applyEdit(edit);
    this.suppressChanges = false;

    tracked.version = version;
    tracked.lastSyncedText = text;
    tracked.pendingSnapshot = false;
    this.clearPendingSnapshotTimer(docId);
    this.pendingFullSyncs.delete(docId);
    await this.persistVersion(docId, version);
    logger.info(`[CodeRooms] Full document sync applied for docId=${docId}, version=${version}`);
    this.emitSharedDocChanged();
  }

  async acceptSuggestion(suggestion: Suggestion): Promise<void> {
    const roomId = this.roomState.getRoomId();
    if (!roomId) {
      return;
    }

    await this.setActiveDocument(suggestion.docId, true);
    this.sendMessage({ type: 'acceptSuggestion', roomId, suggestionId: suggestion.suggestionId });
  }

  rejectSuggestion(suggestion: Suggestion): void {
    const roomId = this.roomState.getRoomId();
    if (!roomId) {
      return;
    }

    this.sendMessage({ type: 'rejectSuggestion', roomId, suggestionId: suggestion.suggestionId });
  }

  reset(): void {
    this.documents.clear();
    this.activeDocumentId = undefined;
    this.focusedDocumentId = undefined;
    this.currentRoomId = undefined;
    this.remoteToLocal.clear();
    this.localToRemote.clear();
    this.pendingSuggestionPatches.clear();
    this.pendingDocChanges.clear();
    this.pendingDocFlush.forEach(timer => clearTimeout(timer));
    this.pendingDocFlush.clear();
    this.pendingShareDocs.clear();
    this.pendingFullSyncs.clear();
    this.pendingSnapshotTimers.forEach(timer => clearTimeout(timer));
    this.pendingSnapshotTimers.clear();
    this.pendingUnshares.clear();
    this.roomState.setActiveSharedDocLabel(undefined);
    this.emitSharedDocChanged();
  }

  private async onDidChangeTextDocument(event: TextDocumentChangeEvent): Promise<void> {
    if (this.suppressChanges) {
      return;
    }
    const docId = this.localToRemote.get(this.uriKey(event.document.uri));
    if (!docId || (!this.documents.has(docId) && !this.pendingShareDocs.has(docId))) {
      if (this.roomState.isCollaborator() && this.roomState.getRoomId()) {
        const now = Date.now();
        if (now - this.lastUnsharedEditWarning > 2500) {
          this.lastUnsharedEditWarning = now;
          void vscode.window.showWarningMessage('This file is not shared in the CodeRoom. Open a shared file to collaborate.');
        }
      }
      return;
    }
    this.updateFocusedDocumentState(docId, docId !== this.focusedDocumentId);

    const tracked = this.documents.get(docId);
    if (tracked) {
      tracked.sharedDocument = event.document;
    }
    const pendingShare = this.pendingShareDocs.get(docId);
    if (pendingShare) {
      pendingShare.sharedDocument = event.document;
      this.sendTypingActivity();
      const queue = this.pendingDocChanges.get(docId) ?? [];
      queue.push(...event.contentChanges);
      this.pendingDocChanges.set(docId, queue);
      this.emitSharedDocChanged();
      return;
    }

    if (this.roomState.isViewer()) {
      await this.revertToSnapshot(docId);
      void vscode.window.showWarningMessage('Viewers cannot edit shared documents.');
      return;
    }

    if (this.roomState.isCollaborator() && !this.roomState.isCollaboratorInDirectMode()) {
      await this.handleSuggestionMode(docId, event);
      return;
    }

    await this.handleLiveUpdate(docId, event);
  }

  private async handleLiveUpdate(docId: string, event: TextDocumentChangeEvent): Promise<void> {
    const roomId = this.getEffectiveRoomId();
    const tracked = this.documents.get(docId);
    if (!roomId || !tracked) {
      return;
    }

    tracked.sharedDocument = event.document;
    this.scheduleFlush(docId);

    this.sendTypingActivity();
    const queue = this.pendingDocChanges.get(docId) ?? [];
    queue.push(...event.contentChanges);
    this.pendingDocChanges.set(docId, queue);
  }

  private async handleSuggestionMode(docId: string, event: TextDocumentChangeEvent): Promise<void> {
    const roomId = this.roomState.getRoomId();
    const userId = this.roomState.getUserId();
    const tracked = this.documents.get(docId);
    if (!roomId || !userId || !tracked) {
      return;
    }

    const patches = event.contentChanges.map(change => this.patchFromChange(change));
    if (patches.length === 0) {
      return;
    }

    this.sendTypingActivity();

    const existing = this.pendingSuggestionPatches.get(docId) ?? [];
    this.pendingSuggestionPatches.set(docId, existing.concat(patches));
    this.emitSharedDocChanged();
  }

  requestFullSyncForDoc(targetDocId: string): void {
    const roomId = this.roomState.getRoomId();
    if (!roomId) {
      return;
    }
    const tracked = this.documents.get(targetDocId) ?? { docId: targetDocId, version: 0, lastSyncedText: '', pendingSnapshot: false };
    if (!this.documents.has(targetDocId)) {
      this.documents.set(targetDocId, tracked);
    }
    if (tracked.pendingSnapshot) {
      return;
    }
    tracked.pendingSnapshot = true;
    this.clearPendingSnapshotTimer(targetDocId);
    const timer = setTimeout(() => {
      tracked.pendingSnapshot = false;
      this.pendingSnapshotTimers.delete(targetDocId);
    }, this.pendingSnapshotTimeoutMs);
    this.pendingSnapshotTimers.set(targetDocId, timer);
    this.sendMessage({ type: 'requestFullSync', roomId, docId: targetDocId });
  }

  private async revertToSnapshot(docId: string): Promise<void> {
    const tracked = this.documents.get(docId);
    if (!tracked?.sharedDocument) {
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    const range = this.fullDocumentRange(tracked.sharedDocument);
    edit.replace(tracked.sharedDocument.uri, range, tracked.lastSyncedText);

    this.suppressChanges = true;
    await workspace.applyEdit(edit);
    this.suppressChanges = false;
  }

  private sendTypingActivity(): void {
    const roomId = this.roomState.getRoomId();
    const userId = this.roomState.getUserId();
    if (!roomId || !userId) {
      return;
    }

    const now = Date.now();
    if (now - this.lastActivitySent < this.typingIntervalMs) {
      return;
    }
    this.lastActivitySent = now;

    this.sendMessage({
      type: 'participantActivity',
      roomId,
      userId,
      activity: 'typing',
      at: now
    });
  }

  private async ensureDocumentIsOpen(docId: string, reveal: boolean): Promise<vscode.TextEditor | undefined> {
    const tracked = this.documents.get(docId);
    if (!tracked) {
      return undefined;
    }
    let targetUri = tracked.uri ?? this.remoteToLocal.get(docId);
    if (!targetUri) {
      const roomId = this.getEffectiveRoomId();
      if (roomId && typeof this.storage.getEntry === 'function') {
        const entry = await this.storage.getEntry(roomId, docId).catch(() => undefined);
        if (entry) {
          targetUri = vscode.Uri.parse(entry.localUri);
        }
      }
    }
    if (!targetUri) {
      logger.warn(`No local mapping found for document ${docId}`);
      return undefined;
    }
    try {
      const visibleEditor = this.findVisibleEditor(targetUri);
      let document = tracked.sharedDocument;
      if (!document || this.uriKey(document.uri) !== this.uriKey(targetUri)) {
        document = visibleEditor?.document;
      }
      if (!document || this.uriKey(document.uri) !== this.uriKey(targetUri)) {
        document = await vscode.workspace.openTextDocument(targetUri);
      }
      if (tracked.languageId && tracked.languageId !== document.languageId) {
        try {
          document = await vscode.languages.setTextDocumentLanguage(document, tracked.languageId);
        } catch (error) {
          logger.warn(`Unable to set document language: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      tracked.sharedDocument = document;
      tracked.uri = document.uri;
      this.registerLocalMapping(docId, document.uri);
      await this.applyPendingFullSync(docId);
      tracked.lastSyncedText = document.getText();
      if (reveal) {
        return await this.revealDocumentIfNeeded(document, visibleEditor);
      }
      return visibleEditor;
    } catch (error) {
      logger.warn(`Unable to open shared document ${docId}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private async applyPatch(document: vscode.TextDocument, patch: TextPatch): Promise<boolean> {
    const edit = new vscode.WorkspaceEdit();
    const range = this.rangeFromPatch(patch);
    edit.replace(document.uri, range, patch.text);

    this.suppressChanges = true;
    const applied = await workspace.applyEdit(edit);
    this.suppressChanges = false;
    return applied;
  }

  private fullDocumentRange(document: vscode.TextDocument): vscode.Range {
    if (document.lineCount === 0) {
      return new vscode.Range(0, 0, 0, 0);
    }
    const endLine = document.lineCount - 1;
    const endCharacter = document.lineAt(endLine).range.end.character;
    return new vscode.Range(0, 0, endLine, endCharacter);
  }

  private patchFromChange(change: vscode.TextDocumentContentChangeEvent): TextPatch {
    return {
      range: {
        start: { line: change.range.start.line, character: change.range.start.character },
        end: { line: change.range.end.line, character: change.range.end.character }
      },
      text: change.text
    };
  }

  private rangeFromPatch(patch: TextPatch): vscode.Range {
    return new vscode.Range(
      patch.range.start.line,
      patch.range.start.character,
      patch.range.end.line,
      patch.range.end.character
    );
  }

  private onDidCloseTextDocument(document: vscode.TextDocument): void {
    const docId = this.localToRemote.get(this.uriKey(document.uri));
    const tracked = docId ? this.documents.get(docId) : undefined;
    if (!tracked) {
      return;
    }
    tracked.sharedDocument = undefined;
    tracked.pendingSnapshot = false;
    this.clearPendingSnapshotTimer(docId!);
    if (this.focusedDocumentId === docId) {
      this.focusedDocumentId = undefined;
      this.updateRoomDocumentLabel();
    }
    this.emitSharedDocChanged();
  }

  private emitSharedDocChanged(): void {
    this.sharedDocEmitter.fire();
  }

  private updateActiveDocumentState(docId: string, emit = false): void {
    if (!this.documents.has(docId) && !this.pendingShareDocs.has(docId)) {
      return;
    }
    const changed = this.activeDocumentId !== docId;
    this.activeDocumentId = docId;
    this.updateRoomDocumentLabel();
    if (emit && changed) {
      this.emitSharedDocChanged();
    }
  }

  private updateFocusedDocumentState(docId: string, emit = false): void {
    if (!this.documents.has(docId) && !this.pendingShareDocs.has(docId)) {
      return;
    }
    const changed = this.focusedDocumentId !== docId;
    this.focusedDocumentId = docId;
    this.updateRoomDocumentLabel();
    if (emit && changed) {
      this.emitSharedDocChanged();
    }
  }

  private registerLocalMapping(docId: string, uri: vscode.Uri): void {
    this.remoteToLocal.set(docId, uri);
    this.localToRemote.set(this.uriKey(uri), docId);
  }

  private fileNameFromUri(uri: vscode.Uri): string {
    if (uri.scheme === 'untitled') {
      return 'untitled';
    }
    const localName = path.basename(uri.fsPath);
    if (localName) {
      return localName;
    }
    const segments = uri.path.split('/');
    return segments[segments.length - 1] || 'shared-file';
  }

  private async persistVersion(docId: string, version: number): Promise<void> {
    const roomId = this.getEffectiveRoomId();
    if (!roomId) {
      return;
    }
    try {
      await this.storage.updateVersion(roomId, docId, version);
    } catch (error) {
      logger.warn(`Unable to update room metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getEffectiveRoomId(): string | undefined {
    const roomId = this.roomState.getRoomId();
    if (roomId) {
      this.currentRoomId = roomId;
    }
    return roomId ?? this.currentRoomId;
  }

  private removeTrackedDocument(docId: string): void {
    const tracked = this.documents.get(docId);
    if (tracked?.uri) {
      this.localToRemote.delete(this.uriKey(tracked.uri));
    }
    const pendingShare = this.pendingShareDocs.get(docId);
    if (pendingShare) {
      this.localToRemote.delete(this.uriKey(pendingShare.uri));
      this.pendingShareDocs.delete(docId);
    }
    this.remoteToLocal.delete(docId);
    this.documents.delete(docId);
    this.pendingSuggestionPatches.delete(docId);
    this.pendingDocChanges.delete(docId);
    this.pendingFullSyncs.delete(docId);
    this.pendingUnshares.delete(docId);
    this.clearPendingSnapshotTimer(docId);
    const pending = this.pendingDocFlush.get(docId);
    if (pending) {
      clearTimeout(pending);
      this.pendingDocFlush.delete(docId);
    }
    if (this.activeDocumentId === docId) {
      this.activeDocumentId = this.getActiveDocumentId();
    }
    if (this.focusedDocumentId === docId) {
      this.focusedDocumentId = undefined;
    }
    this.updateRoomDocumentLabel();
    this.emitSharedDocChanged();
  }

  private getActiveDocumentState(): TrackedDocument | undefined {
    const activeId = this.getActiveDocumentId();
    return activeId ? this.documents.get(activeId) : undefined;
  }

  private scheduleFlush(docId: string): void {
    // If a flush is already scheduled, extend the window so rapid-fire changes are coalesced
    const existingTimer = this.pendingDocFlush.get(docId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      this.pendingDocFlush.delete(docId);
      void this.flushDocumentChanges(docId);
    }, this.flushDelayMs);
    this.pendingDocFlush.set(docId, timer);
  }

  private async flushDocumentChanges(docId: string): Promise<void> {
    const roomId = this.getEffectiveRoomId();
    const tracked = this.documents.get(docId);
    if (!roomId || !tracked || !tracked.sharedDocument || !tracked.yDoc) {
      logger.warn(`Skipped flushing pending changes for docId=${docId}: missing room, tracked document, editor, or yDoc.`);
      return;
    }

    const changes = this.pendingDocChanges.get(docId) ?? [];
    if (changes.length === 0) {
      return;
    }

    const yText = tracked.yDoc.getText('text');
    let yUpdate: Uint8Array | undefined;

    tracked.yDoc.transact(() => {
      for (const change of changes) {
        const startOffset = tracked.sharedDocument!.offsetAt(change.range.start);
        const length = tracked.sharedDocument!.offsetAt(change.range.end) - startOffset;
        if (length > 0) {
          yText.delete(startOffset, length);
        }
        if (change.text.length > 0) {
          yText.insert(startOffset, change.text);
        }
      }
      yUpdate = Y.encodeStateAsUpdate(tracked.yDoc!);
    });

    if (yUpdate) {
      const e2eKey = this.roomState.getE2EKey();
      const encryptedUpdate = e2eKey ? encryptBinary(yUpdate, e2eKey) : yUpdate;

      tracked.version += 1;
      // Send a dummy patch for backward compatibility if needed, but primary is yjsUpdate
      const lastChange = changes[changes.length - 1];
      const patch = this.patchFromChange(lastChange);

      this.sendMessage({
        type: 'docChange',
        roomId,
        docId,
        version: tracked.version,
        patch,
        yjsUpdate: encryptedUpdate
      });
    }

    tracked.lastSyncedText = tracked.sharedDocument.getText();
    this.pendingDocChanges.set(docId, []);
    await this.persistVersion(docId, tracked.version);
  }

  private async applyPendingFullSync(docId: string): Promise<void> {
    const queued = this.pendingFullSyncs.get(docId);
    if (!queued) {
      return;
    }
    this.pendingFullSyncs.delete(docId);
    await this.applyFullDocumentSync(docId, queued.text, queued.version);
  }

  private clearPendingSnapshotTimer(docId: string): void {
    const timer = this.pendingSnapshotTimers.get(docId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.pendingSnapshotTimers.delete(docId);
  }

  private updateRoomDocumentLabel(): void {
    const preferredId = this.focusedDocumentId ?? this.activeDocumentId;
    const label = preferredId
      ? this.documents.get(preferredId)?.fileName ?? this.pendingShareDocs.get(preferredId)?.fileName
      : undefined;
    this.roomState.setActiveSharedDocLabel(label);
  }

  private uriKey(uri: vscode.Uri): string {
    if (uri.scheme === 'file') {
      const normalized = path.normalize(uri.fsPath);
      return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    }
    return uri.toString();
  }

  private findVisibleEditor(uri: vscode.Uri): vscode.TextEditor | undefined {
    const target = this.uriKey(uri);
    return vscode.window.visibleTextEditors.find(editor => this.uriKey(editor.document.uri) === target);
  }

  private async revealDocumentIfNeeded(
    document: vscode.TextDocument,
    preferredEditor?: vscode.TextEditor
  ): Promise<vscode.TextEditor | undefined> {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && this.uriKey(activeEditor.document.uri) === this.uriKey(document.uri)) {
      return activeEditor;
    }
    const existingEditor = preferredEditor ?? this.findVisibleEditor(document.uri);
    if (existingEditor && activeEditor === existingEditor) {
      return existingEditor;
    }
    return vscode.window.showTextDocument(existingEditor?.document ?? document, { preview: false });
  }
}
