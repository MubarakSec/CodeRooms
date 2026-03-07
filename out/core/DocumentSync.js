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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentSync = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const vscode_1 = require("vscode");
const uuid_1 = require("uuid");
const logger_1 = require("../util/logger");
class DocumentSync {
    constructor(roomState, storage, sendMessage) {
        this.roomState = roomState;
        this.storage = storage;
        this.sendMessage = sendMessage;
        this.documents = new Map();
        this.suppressChanges = false;
        this.disposables = [];
        this.sharedDocEmitter = new vscode.EventEmitter();
        this.remoteToLocal = new Map();
        this.localToRemote = new Map();
        this.lastActivitySent = 0;
        this.typingIntervalMs = 800;
        this.pendingSuggestionPatches = new Map();
        this.pendingDocFlush = new Map();
        this.flushDelayMs = 45;
        this.pendingDocChanges = new Map();
        this.lastUnsharedEditWarning = 0;
        this.onDidChangeSharedDocument = this.sharedDocEmitter.event;
        this.disposables.push(vscode_1.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this), vscode_1.workspace.onDidCloseTextDocument(this.onDidCloseTextDocument, this), this.sharedDocEmitter);
    }
    dispose() {
        this.disposables.forEach(disposable => disposable.dispose());
    }
    shareDocument(document) {
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
        const docId = (0, uuid_1.v4)();
        const text = document.getText();
        const tracked = {
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
    unshareDocument(targetDocId) {
        const roomId = this.roomState.getRoomId();
        const docId = targetDocId ?? this.getActiveDocumentId();
        if (!roomId || !docId) {
            void vscode.window.showWarningMessage('No shared document to unshare.');
            return;
        }
        this.sendMessage({ type: 'unshareDocument', roomId, documentId: docId });
        this.removeTrackedDocument(docId);
    }
    stopSharing() {
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
    getSharedDocumentUri() {
        const active = this.getActiveDocumentState();
        return active?.uri;
    }
    isSharing() {
        return this.documents.size > 0;
    }
    getActiveDocumentId() {
        if (this.activeDocumentId) {
            return this.activeDocumentId;
        }
        const first = this.documents.values().next().value;
        return first?.docId;
    }
    getSharedDocuments() {
        const active = this.getActiveDocumentId();
        return Array.from(this.documents.values()).map(doc => ({
            docId: doc.docId,
            uri: doc.uri,
            fileName: doc.fileName ?? (doc.uri ? this.fileNameFromUri(doc.uri) : undefined),
            isActive: doc.docId === active
        }));
    }
    async setActiveDocument(docId, reveal = true) {
        if (!this.documents.has(docId)) {
            return;
        }
        this.activeDocumentId = docId;
        const label = this.documents.get(docId)?.fileName;
        this.roomState.setActiveSharedDocLabel(label);
        await this.ensureDocumentIsOpen(docId, reveal);
        this.emitSharedDocChanged();
    }
    hasPendingSuggestion(docId) {
        const target = docId ?? this.getActiveDocumentId();
        if (!target) {
            return false;
        }
        const patches = this.pendingSuggestionPatches.get(target);
        return Boolean(patches && patches.length > 0);
    }
    getPendingSuggestionCount(docId) {
        const target = docId ?? this.getActiveDocumentId();
        if (!target) {
            return 0;
        }
        return this.pendingSuggestionPatches.get(target)?.length ?? 0;
    }
    async sendPendingSuggestion(docId) {
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
        const suggestion = {
            suggestionId: (0, uuid_1.v4)(),
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
    getDocumentUri(docId) {
        const tracked = this.documents.get(docId);
        if (tracked?.uri) {
            return tracked.uri;
        }
        return this.remoteToLocal.get(docId);
    }
    async revealRemoteCursor(docId, position, fallbackUri) {
        let targetUri = this.remoteToLocal.get(docId);
        if (!targetUri && fallbackUri) {
            try {
                targetUri = vscode.Uri.parse(fallbackUri);
            }
            catch (error) {
                logger_1.logger.warn(`Unable to parse fallback uri for docId=${docId}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (!targetUri) {
            logger_1.logger.warn(`Unable to follow root cursor for docId=${docId}: missing local uri mapping.`);
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
    async handleShareDocument(message) {
        const isNewRoom = this.currentRoomId && this.currentRoomId !== message.roomId;
        if (isNewRoom) {
            // Clear any leftover state when a new room starts sharing to avoid cross-room collisions.
            this.reset();
        }
        this.currentRoomId = message.roomId;
        try {
            await this.storage.prepare();
            const { uri } = await this.storage.registerDocument(message.roomId, message.docId, message.fileName, message.originalUri, message.text, message.version);
            const tracked = {
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
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            logger_1.logger.error(`Unable to open shared document: ${detail}`);
            void vscode.window.showErrorMessage('Unable to open shared CodeRoom document. Check storage permissions.');
        }
    }
    async handleFullDocumentSync(message) {
        await this.applyFullDocumentSync(message.docId, message.text, message.version);
    }
    async handleRequestFullSync(message) {
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
            logger_1.logger.warn('Unable to fulfill full sync request because document is unavailable.');
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
    async handleDocumentUnshared(message) {
        this.removeTrackedDocument(message.documentId);
    }
    async applyRemoteChange(docId, patch, version) {
        const tracked = this.documents.get(docId);
        if (!tracked) {
            logger_1.logger.warn(`Received change for unknown document ${docId}`);
            return;
        }
        await this.ensureDocumentIsOpen(docId, docId === this.activeDocumentId);
        const document = tracked.sharedDocument;
        if (!document) {
            logger_1.logger.warn(`Unable to apply patch for docId=${docId}: document not loaded.`);
            return;
        }
        if (version <= tracked.version) {
            logger_1.logger.info(`[CodeRooms] Ignoring stale patch for docId=${docId} at version=${version}`);
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
            logger_1.logger.warn(`[CodeRooms] Patch gap detected for docId=${docId}: localVersion=${tracked.version}, incomingVersion=${version}. Requesting full sync.`);
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
    async applyFullDocumentSync(docId, text, version) {
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
        await vscode_1.workspace.applyEdit(edit);
        this.suppressChanges = false;
        tracked.version = version;
        tracked.lastSyncedText = text;
        tracked.pendingSnapshot = false;
        await this.persistVersion(docId, version);
        logger_1.logger.info(`[CodeRooms] Full document sync applied for docId=${docId}, version=${version}`);
        this.emitSharedDocChanged();
    }
    async acceptSuggestion(suggestion) {
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
            this.sendMessage({ type: 'docChange', roomId, docId: suggestion.docId, version: tracked.version, patch });
        }
        tracked.lastSyncedText = tracked.sharedDocument.getText();
        await this.persistVersion(suggestion.docId, tracked.version);
        this.sendMessage({ type: 'acceptSuggestion', roomId, suggestionId: suggestion.suggestionId });
    }
    rejectSuggestion(suggestion) {
        const roomId = this.roomState.getRoomId();
        if (!roomId) {
            return;
        }
        this.sendMessage({ type: 'rejectSuggestion', roomId, suggestionId: suggestion.suggestionId });
    }
    reset() {
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
    async onDidChangeTextDocument(event) {
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
        if (!this.activeDocumentId) {
            this.activeDocumentId = docId;
        }
        if (docId !== this.activeDocumentId) {
            return;
        }
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
    async handleLiveUpdate(docId, event) {
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
    async handleSuggestionMode(docId, event) {
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
    requestFullSyncForDoc(targetDocId) {
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
    async revertToSnapshot(docId) {
        const tracked = this.documents.get(docId);
        if (!tracked?.sharedDocument) {
            return;
        }
        const edit = new vscode.WorkspaceEdit();
        const range = this.fullDocumentRange(tracked.sharedDocument);
        edit.replace(tracked.sharedDocument.uri, range, tracked.lastSyncedText);
        this.suppressChanges = true;
        await vscode_1.workspace.applyEdit(edit);
        this.suppressChanges = false;
    }
    sendTypingActivity() {
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
    async ensureDocumentIsOpen(docId, reveal) {
        const tracked = this.documents.get(docId);
        if (!tracked) {
            return;
        }
        const targetUri = tracked.uri ?? this.remoteToLocal.get(docId);
        if (!targetUri) {
            logger_1.logger.warn(`No local mapping found for document ${docId}`);
            return;
        }
        try {
            let document = await vscode.workspace.openTextDocument(targetUri);
            if (tracked.languageId && tracked.languageId !== document.languageId) {
                try {
                    document = await vscode.languages.setTextDocumentLanguage(document, tracked.languageId);
                }
                catch (error) {
                    logger_1.logger.warn(`Unable to set document language: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            tracked.sharedDocument = document;
            tracked.uri = document.uri;
            this.registerLocalMapping(docId, document.uri);
            if (reveal) {
                await vscode.window.showTextDocument(document, { preview: false });
            }
            tracked.lastSyncedText = document.getText();
        }
        catch (error) {
            logger_1.logger.warn(`Unable to open shared document ${docId}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async applyPatch(document, patch) {
        const edit = new vscode.WorkspaceEdit();
        const range = this.rangeFromPatch(patch);
        edit.replace(document.uri, range, patch.text);
        this.suppressChanges = true;
        const applied = await vscode_1.workspace.applyEdit(edit);
        this.suppressChanges = false;
        return applied;
    }
    fullDocumentRange(document) {
        if (document.lineCount === 0) {
            return new vscode.Range(0, 0, 0, 0);
        }
        const endLine = document.lineCount - 1;
        const endCharacter = document.lineAt(endLine).range.end.character;
        return new vscode.Range(0, 0, endLine, endCharacter);
    }
    patchFromChange(change) {
        return {
            range: {
                start: { line: change.range.start.line, character: change.range.start.character },
                end: { line: change.range.end.line, character: change.range.end.character }
            },
            text: change.text
        };
    }
    rangeFromPatch(patch) {
        return new vscode.Range(patch.range.start.line, patch.range.start.character, patch.range.end.line, patch.range.end.character);
    }
    onDidCloseTextDocument(document) {
        const docId = this.localToRemote.get(this.uriKey(document.uri));
        const tracked = docId ? this.documents.get(docId) : undefined;
        if (!tracked) {
            return;
        }
        tracked.sharedDocument = undefined;
        tracked.pendingSnapshot = false;
        this.emitSharedDocChanged();
    }
    emitSharedDocChanged() {
        this.sharedDocEmitter.fire();
    }
    registerLocalMapping(docId, uri) {
        this.remoteToLocal.set(docId, uri);
        this.localToRemote.set(this.uriKey(uri), docId);
    }
    fileNameFromUri(uri) {
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
    async persistVersion(docId, version) {
        const roomId = this.getEffectiveRoomId();
        if (!roomId) {
            return;
        }
        try {
            await this.storage.updateVersion(roomId, docId, version);
        }
        catch (error) {
            logger_1.logger.warn(`Unable to update room metadata: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    getEffectiveRoomId() {
        const roomId = this.roomState.getRoomId();
        if (roomId) {
            this.currentRoomId = roomId;
        }
        return roomId ?? this.currentRoomId;
    }
    removeTrackedDocument(docId) {
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
    getActiveDocumentState() {
        const activeId = this.getActiveDocumentId();
        return activeId ? this.documents.get(activeId) : undefined;
    }
    scheduleFlush(docId) {
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
    async flushDocumentChanges(docId) {
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
    uriKey(uri) {
        if (uri.scheme === 'file') {
            const normalized = path.normalize(uri.fsPath);
            return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
        }
        return uri.toString();
    }
}
exports.DocumentSync = DocumentSync;
//# sourceMappingURL=DocumentSync.js.map