import * as path from 'path';
import * as vscode from 'vscode';
import { TextDocumentChangeEvent, workspace } from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { ClientToServerMessage, Position, ServerToClientMessage, Suggestion, TextPatch } from '../connection/MessageTypes';
import { RoomState } from './RoomState';
import { RoomStorage } from './RoomStorage';
import { logger } from '../util/logger';

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
}

export class DocumentSync {
  private readonly documents = new Map<string, TrackedDocument>();
  private activeDocumentId?: string;
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
  private lastUnsharedEditWarning = 0;

  readonly onDidChangeSharedDocument = this.sharedDocEmitter.event;

  constructor(
    private readonly roomState: RoomState,
    private readonly storage: RoomStorage,
    private readonly sendMessage: (message: ClientToServerMessage) => void
  ) {
    this.disposables.push(
      workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this),
      workspace.onDidCloseTextDocument(this.onDidCloseTextDocument, this),
      this.sharedDocEmitter
    );
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

    const docId = uuidv4();
    const text = document.getText();
    const tracked: TrackedDocument = {
      docId,
      uri: document.uri,
      version: 1,
      lastSyncedText: text,
      pendingSnapshot: false,
      sharedDocument: document,
      fileName: this.fileNameFromUri(document.uri),
      languageId: document.languageId
    };

    this.documents.set(docId, tracked);
    this.activeDocumentId = docId;
    this.currentRoomId = roomId;
    this.registerLocalMapping(docId, document.uri);

    this.sendMessage({
      type: 'shareDocument',
      roomId,
      docId,
      originalUri: document.uri.toString(),
      fileName: tracked.fileName ?? this.fileNameFromUri(document.uri),
      languageId: document.languageId,
      text,
      version: tracked.version
    });

    this.emitSharedDocChanged();
  }

  unshareDocument(targetDocId?: string): void {
    const roomId = this.roomState.getRoomId();
    const docId = targetDocId ?? this.getActiveDocumentId();
    if (!roomId || !docId) {
      void vscode.window.showWarningMessage('No shared document to unshare.');
      return;
    }
    this.sendMessage({ type: 'unshareDocument', roomId, documentId: docId });
    this.removeTrackedDocument(docId);
  }

  stopSharing(): void {
    this.documents.clear();
    this.remoteToLocal.clear();
    this.localToRemote.clear();
    this.activeDocumentId = undefined;
    this.currentRoomId = undefined;
    this.pendingDocChanges.clear();
    this.pendingDocFlush.forEach(timer => clearTimeout(timer));
    this.pendingDocFlush.clear();
    this.roomState.setActiveSharedDocLabel(undefined);
    this.emitSharedDocChanged();
  }

  getSharedDocumentUri(): vscode.Uri | undefined {
    const active = this.getActiveDocumentState();
    return active?.uri;
  }

  isSharing(): boolean {
    return this.documents.size > 0;
  }

  getActiveDocumentId(): string | undefined {
    if (this.activeDocumentId && this.documents.has(this.activeDocumentId)) {
      return this.activeDocumentId;
    }
    this.activeDocumentId = undefined;
    const first = this.documents.values().next().value as TrackedDocument | undefined;
    return first?.docId;
  }

  getSharedDocuments(): Array<{ docId: string; uri?: vscode.Uri; fileName?: string; isActive: boolean }> {
    const active = this.getActiveDocumentId();
    return Array.from(this.documents.values()).map(doc => ({
      docId: doc.docId,
      uri: doc.uri,
      fileName: doc.fileName ?? (doc.uri ? this.fileNameFromUri(doc.uri) : undefined),
      isActive: doc.docId === active
    }));
  }

  async setActiveDocument(docId: string, reveal = true): Promise<void> {
    if (!this.documents.has(docId)) {
      return;
    }
    this.updateActiveDocumentState(docId);
    await this.ensureDocumentIsOpen(docId, reveal);
    this.emitSharedDocChanged();
  }

  syncActiveEditor(editor?: vscode.TextEditor): void {
    if (!editor) {
      return;
    }
    const docId = this.localToRemote.get(this.uriKey(editor.document.uri));
    if (!docId || !this.documents.has(docId)) {
      return;
    }
    this.updateActiveDocumentState(docId, true);
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

    await this.setActiveDocument(docId, true);
    const document = await vscode.workspace.openTextDocument(targetUri);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
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
      const { uri } = await this.storage.registerDocument(
        message.roomId,
        message.docId,
        message.fileName,
        message.originalUri,
        message.text,
        message.version
      );

      const tracked: TrackedDocument = {
        docId: message.docId,
        uri,
        version: message.version,
        lastSyncedText: message.text,
        pendingSnapshot: false,
        fileName: message.fileName,
        languageId: message.languageId
      };

      this.documents.set(message.docId, tracked);
      this.registerLocalMapping(message.docId, uri);

      const shouldReveal = !this.activeDocumentId || isNewRoom;
      if (!this.activeDocumentId) {
        this.activeDocumentId = message.docId;
      }
      if (shouldReveal) {
        await this.setActiveDocument(message.docId, true);
      }

      this.emitSharedDocChanged();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error(`Unable to open shared document: ${detail}`);
      void vscode.window.showErrorMessage('Unable to open shared CodeRoom document. Check storage permissions.');
    }
  }

  async handleFullDocumentSync(message: FullDocumentSyncMessage): Promise<void> {
    await this.applyFullDocumentSync(message.docId, message.text, message.version);
  }

  async handleRequestFullSync(message: RequestFullSyncMessage): Promise<void> {
    if (!this.roomState.isRoot()) {
      return;
    }
    const roomId = this.roomState.getRoomId();
    const tracked = this.documents.get(message.docId);
    if (!roomId || !tracked) {
      return;
    }
    await this.ensureDocumentIsOpen(message.docId, false);
    const document = tracked.sharedDocument;
    if (!document) {
      logger.warn('Unable to fulfill full sync request because document is unavailable.');
      return;
    }
    this.sendMessage({
      type: 'fullDocumentSync',
      roomId,
      docId: message.docId,
      text: document.getText(),
      version: tracked.version
    });
  }

  async handleDocumentUnshared(message: DocumentUnsharedMessage): Promise<void> {
    this.removeTrackedDocument(message.documentId);
  }

  async applyRemoteChange(docId: string, patch: TextPatch, version: number): Promise<void> {
    const tracked = this.documents.get(docId);
    if (!tracked) {
      logger.warn(`Received change for unknown document ${docId}`);
      return;
    }

    await this.ensureDocumentIsOpen(docId, docId === this.activeDocumentId);
    const document = tracked.sharedDocument;
    if (!document) {
      logger.warn(`Unable to apply patch for docId=${docId}: document not loaded.`);
      return;
    }

    if (version <= tracked.version) {
      logger.info(`[CodeRooms] Ignoring stale patch for docId=${docId} at version=${version}`);
      return;
    }

    const currentRoomId = this.getEffectiveRoomId();

    if (version > tracked.version + 1) {
      // Micro-merge attempt: if gap is exactly 1 version (missing a single step), try applying anyway, otherwise full sync.
      if (version === tracked.version + 2 && currentRoomId) {
        const merged = await this.applyPatch(document, patch);
        if (merged) {
          tracked.version = version;
          tracked.lastSyncedText = document.getText();
          tracked.pendingSnapshot = false;
          await this.persistVersion(docId, tracked.version);
          return;
        }
      }
      logger.warn(
        `[CodeRooms] Patch gap detected for docId=${docId}: localVersion=${tracked.version}, incomingVersion=${version}. Requesting full sync.`
      );
      this.requestFullSyncForDoc(docId);
      return;
    }

    let applied = await this.applyPatch(document, patch);
    if (!applied) {
      // Retry once before forcing full sync.
      applied = await this.applyPatch(document, patch);
      if (!applied) {
        this.requestFullSyncForDoc(docId);
        void vscode.window.showWarningMessage('Resyncing shared file due to patch mismatch.', 'Retry now').then(action => {
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
    }

    tracked.version = version;
    tracked.lastSyncedText = document.getText();
    tracked.pendingSnapshot = false;
    await this.persistVersion(docId, tracked.version);
  }

  async applyFullDocumentSync(docId: string, text: string, version: number): Promise<void> {
    let tracked = this.documents.get(docId);
    if (!tracked) {
      tracked = { docId, version: 0, lastSyncedText: '', pendingSnapshot: false };
      this.documents.set(docId, tracked);
    }

    await this.ensureDocumentIsOpen(docId, docId === this.activeDocumentId);
    const document = tracked.sharedDocument;
    if (!document) {
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
    const tracked = this.documents.get(suggestion.docId);
    if (!tracked || !tracked.sharedDocument) {
      return;
    }

    if (suggestion.patches.length === 0) {
      this.sendMessage({ type: 'acceptSuggestion', roomId, suggestionId: suggestion.suggestionId });
      return;
    }

    for (const patch of suggestion.patches) {
      const applied = await this.applyPatch(tracked.sharedDocument, patch);
      if (!applied) {
        this.requestFullSyncForDoc(suggestion.docId);
        return;
      }

      tracked.version += 1;
    }

    tracked.lastSyncedText = tracked.sharedDocument.getText();
    await this.persistVersion(suggestion.docId, tracked.version);

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
    this.currentRoomId = undefined;
    this.remoteToLocal.clear();
    this.localToRemote.clear();
    this.pendingSuggestionPatches.clear();
    this.pendingDocChanges.clear();
    this.pendingDocFlush.forEach(timer => clearTimeout(timer));
    this.pendingDocFlush.clear();
    this.roomState.setActiveSharedDocLabel(undefined);
    this.emitSharedDocChanged();
  }

  private async onDidChangeTextDocument(event: TextDocumentChangeEvent): Promise<void> {
    if (this.suppressChanges) {
      return;
    }
    const docId = this.localToRemote.get(this.uriKey(event.document.uri));
    if (!docId || !this.documents.has(docId)) {
      if (this.roomState.isCollaborator() && this.roomState.getRoomId()) {
        const now = Date.now();
        if (now - this.lastUnsharedEditWarning > 2500) {
          this.lastUnsharedEditWarning = now;
          void vscode.window.showWarningMessage('This file is not shared in the CodeRoom. Open a shared file to collaborate.');
        }
      }
      return;
    }
    this.updateActiveDocumentState(docId, docId !== this.activeDocumentId);

    const tracked = this.documents.get(docId);
    if (tracked) {
      tracked.sharedDocument = event.document;
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
    const tracked = this.documents.get(targetDocId);
    if (!roomId || !tracked) {
      return;
    }
    if (tracked.pendingSnapshot) {
      return;
    }
    tracked.pendingSnapshot = true;
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

  private async ensureDocumentIsOpen(docId: string, reveal: boolean): Promise<void> {
    const tracked = this.documents.get(docId);
    if (!tracked) {
      return;
    }
    const targetUri = tracked.uri ?? this.remoteToLocal.get(docId);
    if (!targetUri) {
      logger.warn(`No local mapping found for document ${docId}`);
      return;
    }
    try {
      let document = await vscode.workspace.openTextDocument(targetUri);
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
      if (reveal) {
        await vscode.window.showTextDocument(document, { preview: false });
      }
      tracked.lastSyncedText = document.getText();
    } catch (error) {
      logger.warn(`Unable to open shared document ${docId}: ${error instanceof Error ? error.message : String(error)}`);
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
    this.emitSharedDocChanged();
  }

  private emitSharedDocChanged(): void {
    this.sharedDocEmitter.fire();
  }

  private updateActiveDocumentState(docId: string, emit = false): void {
    if (!this.documents.has(docId)) {
      return;
    }
    const changed = this.activeDocumentId !== docId;
    this.activeDocumentId = docId;
    const label = this.documents.get(docId)?.fileName;
    this.roomState.setActiveSharedDocLabel(label);
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
    this.remoteToLocal.delete(docId);
    this.documents.delete(docId);
    this.pendingSuggestionPatches.delete(docId);
    this.pendingDocChanges.delete(docId);
    const pending = this.pendingDocFlush.get(docId);
    if (pending) {
      clearTimeout(pending);
      this.pendingDocFlush.delete(docId);
    }
    if (this.activeDocumentId === docId) {
      this.activeDocumentId = this.getActiveDocumentId();
      const label = this.activeDocumentId ? this.documents.get(this.activeDocumentId)?.fileName : undefined;
      this.roomState.setActiveSharedDocLabel(label);
    }
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
    if (!roomId || !tracked || !tracked.sharedDocument) {
      return;
    }

    const changes = this.pendingDocChanges.get(docId) ?? [];
    if (changes.length === 0) {
      return;
    }

    for (const change of changes) {
      const patch = this.patchFromChange(change);
      tracked.version += 1;
      this.sendMessage({ type: 'docChange', roomId, docId, version: tracked.version, patch });
    }

    tracked.lastSyncedText = tracked.sharedDocument.getText();
    this.pendingDocChanges.set(docId, []);
    await this.persistVersion(docId, tracked.version);
  }

  private uriKey(uri: vscode.Uri): string {
    if (uri.scheme === 'file') {
      const normalized = path.normalize(uri.fsPath);
      return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    }
    return uri.toString();
  }
}
