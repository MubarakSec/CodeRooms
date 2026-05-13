import * as vscode from 'vscode';
import { Suggestion, TextPatch } from '../connection/MessageTypes';
import { RoomState } from './RoomState';
import { DocumentSync } from './DocumentSync';
import { buildSuggestionPreview } from '../util/suggestionPreview';

export class SuggestionManager implements vscode.CodeLensProvider {
  public stateVersion = 0;
  private suggestions = new Map<string, Suggestion>();
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly codeLensEmitter = new vscode.EventEmitter<void>();
  private refreshTimer?: NodeJS.Timeout;
  private acceptHandler?: (suggestion: Suggestion) => Promise<void> | void;
  private rejectHandler?: (suggestion: Suggestion) => Promise<void> | void;

  readonly onDidChange = this.changeEmitter.event;
  readonly onDidChangeCodeLenses = this.codeLensEmitter.event;

  constructor(
    private readonly roomState: RoomState,
    private readonly documentSync?: DocumentSync
  ) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(255, 186, 73, 0.18)',
      border: '1.5px solid rgba(255, 152, 0, 0.65)',
      borderRadius: '3px',
      gutterIconPath: undefined,
      gutterIconSize: 'contain',
      overviewRulerColor: 'rgba(255, 152, 0, 0.65)',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      isWholeLine: false,
      after: {
        contentText: ' 💡',
        color: 'rgba(255, 152, 0, 0.8)',
        fontStyle: 'italic',
        margin: '0 0 0 8px'
      }
    });

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleRefreshDecorations()),
      vscode.workspace.onDidChangeTextDocument(event => this.handleDocumentChange(event)),
      this.changeEmitter
    );
  }

  setHandlers(onAccept: (suggestion: Suggestion) => Promise<void> | void, onReject: (suggestion: Suggestion) => Promise<void> | void): void {
    this.acceptHandler = onAccept;
    this.rejectHandler = onReject;
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.disposables.forEach(disposable => disposable.dispose());
    this.decorationType.dispose();
  }

  reset(): void {
    this.suggestions.clear();
    this.refreshDecorations();
    this.emitChange();
  }

  getSuggestions(): Suggestion[] {
    return Array.from(this.suggestions.values());
  }

  getPendingSuggestionIds(): string[] {
    return Array.from(this.suggestions.keys());
  }

  replaceAll(suggestions: Suggestion[]): void {
    this.suggestions.clear();
    for (const suggestion of suggestions) {
      if (suggestion.status === 'pending') {
        this.suggestions.set(suggestion.suggestionId, suggestion);
      }
    }
    this.refreshDecorations();
    this.emitChange();
  }

  clearAll(): void {
    this.suggestions.clear();
    this.refreshDecorations();
    this.emitChange();
  }

  async rejectAllPending(): Promise<number> {
    const pending = Array.from(this.suggestions.values());
    for (const suggestion of pending) {
      await this.rejectHandler?.(suggestion);
    }
    return pending.length;
  }

  handleSuggestion(suggestion: Suggestion): boolean {
    if (!this.roomState.isRoot() || suggestion.status !== 'pending') {
      return false;
    }

    const alreadyPresent = this.suggestions.has(suggestion.suggestionId);
    this.suggestions.set(suggestion.suggestionId, suggestion);
    this.refreshDecorations();
    this.emitChange();
    return !alreadyPresent;
  }

  handleSuggestionAccepted(suggestionId: string): void {
    if (this.suggestions.delete(suggestionId)) {
      this.refreshDecorations();
      this.emitChange();
    }
  }

  handleSuggestionRejected(suggestionId: string): void {
    if (this.suggestions.delete(suggestionId)) {
      this.refreshDecorations();
      this.emitChange();
    }
  }

  private refreshDecorations(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
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
      .flatMap(suggestion => {
        const hover = new vscode.MarkdownString();
        const preview = buildSuggestionPreview(suggestion.patches, 80);
        hover.isTrusted = true;
        hover.appendMarkdown(`**💡 Suggestion from ${suggestion.authorName}**\n\n`);
        if (preview.text) {
          hover.appendCodeblock(preview.text, 'text');
        }
        if (preview.omittedPatchCount > 0) {
          hover.appendMarkdown(`\n\n_${preview.omittedPatchCount} more patch${preview.omittedPatchCount !== 1 ? 'es' : ''} in this suggestion_`);
        }
        hover.appendMarkdown(`\n\n_Use the Suggestions panel to accept or reject_`);
        return suggestion.patches.map(patch => ({
          range: this.rangeFromPatch(patch),
          hoverMessage: hover
        }));
      });

    editor.setDecorations(this.decorationType, decorations);
  }

  private scheduleRefreshDecorations(): void {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.refreshDecorations();
    }, 30);
  }

  private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== event.document.uri.toString()) {
      return;
    }
    const activeDocId = this.documentSync?.getActiveDocumentId();
    const sharedUri = activeDocId ? this.documentSync?.getDocumentUri(activeDocId) : undefined;
    if (sharedUri && sharedUri.toString() !== event.document.uri.toString()) {
      return;
    }
    this.scheduleRefreshDecorations();
  }

  private rangeFromPatch(patch: TextPatch): vscode.Range {
    return new vscode.Range(
      patch.range.start.line,
      patch.range.start.character,
      patch.range.end.line,
      patch.range.end.character
    );
  }

  provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] | undefined {
    if (!this.roomState.isRoot()) {
      return undefined;
    }
    const activeDocId = this.documentSync?.getActiveDocumentId();
    if (!activeDocId || !this.documentSync) {
      return undefined;
    }
    const sharedUri = this.documentSync.getDocumentUri(activeDocId);
    if (!sharedUri || document.uri.toString() !== sharedUri.toString()) {
      return undefined;
    }

    const lenses: vscode.CodeLens[] = [];
    for (const suggestion of this.suggestions.values()) {
      if (suggestion.docId !== activeDocId || suggestion.status !== 'pending') continue;
      
      const firstPatch = suggestion.patches[0];
      if (!firstPatch) continue;
      
      const range = this.rangeFromPatch(firstPatch);
      lenses.push(new vscode.CodeLens(range, {
        title: `✅ Accept Suggestion (by ${suggestion.authorName})`,
        command: 'coderooms.acceptSuggestion',
        arguments: [suggestion]
      }));
      lenses.push(new vscode.CodeLens(range, {
        title: `❌ Reject`,
        command: 'coderooms.rejectSuggestion',
        arguments: [suggestion]
      }));
    }
    return lenses;
  }

  private emitChange(): void {
    this.stateVersion++;
    this.changeEmitter.fire();
    this.codeLensEmitter.fire();
  }
}
