import * as vscode from 'vscode';
import { Suggestion, TextPatch } from '../connection/MessageTypes';
import { RoomState } from './RoomState';
import { DocumentSync } from './DocumentSync';

export class SuggestionManager {
  private suggestions = new Map<string, Suggestion>();
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private acceptHandler?: (suggestion: Suggestion) => Promise<void> | void;
  private rejectHandler?: (suggestion: Suggestion) => Promise<void> | void;

  readonly onDidChange = this.changeEmitter.event;

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
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshDecorations()),
      vscode.workspace.onDidChangeTextDocument(() => this.refreshDecorations()),
      this.changeEmitter
    );
  }

  setHandlers(onAccept: (suggestion: Suggestion) => Promise<void> | void, onReject: (suggestion: Suggestion) => Promise<void> | void): void {
    this.acceptHandler = onAccept;
    this.rejectHandler = onReject;
  }

  dispose(): void {
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
      .flatMap(suggestion =>
        suggestion.patches.map(patch => {
          const preview = (patch.text || 'Remove text').slice(0, 80);
          const truncated = preview.length < (patch.text || '').length ? preview + '…' : preview;
          const hover = new vscode.MarkdownString();
          hover.isTrusted = true;
          hover.appendMarkdown(`**💡 Suggestion from ${suggestion.authorName}**\n\n`);
          hover.appendCodeblock(truncated, 'text');
          hover.appendMarkdown(`\n\n_Use the Suggestions panel to accept or reject_`);
          return {
            range: this.rangeFromPatch(patch),
            hoverMessage: hover
          };
        })
      );

    editor.setDecorations(this.decorationType, decorations);
  }

  private rangeFromPatch(patch: TextPatch): vscode.Range {
    return new vscode.Range(
      patch.range.start.line,
      patch.range.start.character,
      patch.range.end.line,
      patch.range.end.character
    );
  }

  private emitChange(): void {
    this.changeEmitter.fire();
  }
}
