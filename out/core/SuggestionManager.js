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
exports.SuggestionManager = void 0;
const vscode = __importStar(require("vscode"));
class SuggestionManager {
    constructor(roomState, documentSync) {
        this.roomState = roomState;
        this.documentSync = documentSync;
        this.suggestions = new Map();
        this.disposables = [];
        this.changeEmitter = new vscode.EventEmitter();
        this.onDidChange = this.changeEmitter.event;
        this.decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 231, 168, 0.35)',
            border: '1px dashed rgba(255, 152, 0, 0.7)'
        });
        this.disposables.push(vscode.window.onDidChangeActiveTextEditor(() => this.refreshDecorations()), vscode.workspace.onDidChangeTextDocument(() => this.refreshDecorations()), this.changeEmitter);
    }
    setHandlers(onAccept, onReject) {
        this.acceptHandler = onAccept;
        this.rejectHandler = onReject;
    }
    dispose() {
        this.disposables.forEach(disposable => disposable.dispose());
        this.decorationType.dispose();
    }
    reset() {
        this.suggestions.clear();
        this.refreshDecorations();
        this.emitChange();
    }
    getSuggestions() {
        return Array.from(this.suggestions.values());
    }
    clearAll() {
        this.suggestions.clear();
        this.refreshDecorations();
        this.emitChange();
    }
    handleSuggestion(suggestion) {
        if (!this.roomState.isRoot() || suggestion.status !== 'pending') {
            return;
        }
        this.suggestions.set(suggestion.suggestionId, suggestion);
        this.refreshDecorations();
        this.emitChange();
        void this.promptDecision(suggestion);
    }
    handleSuggestionAccepted(suggestionId) {
        if (this.suggestions.delete(suggestionId)) {
            this.refreshDecorations();
            this.emitChange();
        }
    }
    handleSuggestionRejected(suggestionId) {
        if (this.suggestions.delete(suggestionId)) {
            this.refreshDecorations();
            this.emitChange();
        }
    }
    async promptDecision(suggestion) {
        const label = `${suggestion.authorName} suggested a change`;
        const choice = await vscode.window.showInformationMessage(label, 'Accept', 'Reject');
        if (choice === 'Accept') {
            await this.acceptHandler?.(suggestion);
        }
        else if (choice === 'Reject') {
            await this.rejectHandler?.(suggestion);
        }
        this.suggestions.delete(suggestion.suggestionId);
        this.refreshDecorations();
        this.emitChange();
    }
    refreshDecorations() {
        if (!this.roomState.isRoot()) {
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const activeDocId = this.documentSync?.getActiveDocumentId();
        if (!activeDocId || !this.documentSync) {
            editor.setDecorations(this.decorationType, []);
            return;
        }
        const sharedUri = this.documentSync.getDocumentUri(activeDocId);
        if (!sharedUri || editor.document.uri.toString() !== sharedUri.toString()) {
            editor.setDecorations(this.decorationType, []);
            return;
        }
        const decorations = Array.from(this.suggestions.values())
            .filter(suggestion => suggestion.docId === activeDocId)
            .flatMap(suggestion => suggestion.patches.map(patch => ({
            range: this.rangeFromPatch(patch),
            hoverMessage: `${suggestion.authorName} suggested: ${patch.text || 'Edit'}`
        })));
        editor.setDecorations(this.decorationType, decorations);
    }
    rangeFromPatch(patch) {
        return new vscode.Range(patch.range.start.line, patch.range.start.character, patch.range.end.line, patch.range.end.character);
    }
    emitChange() {
        this.changeEmitter.fire();
    }
}
exports.SuggestionManager = SuggestionManager;
//# sourceMappingURL=SuggestionManager.js.map