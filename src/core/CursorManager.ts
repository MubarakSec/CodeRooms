import * as vscode from 'vscode';
import { Position } from '../connection/MessageTypes';

interface RemoteCursor {
  uri: string;
  position: Position;
  selections?: { start: Position; end: Position }[];
  userName: string;
  color: string;
}

interface AppliedDecorationState {
  cursor: string;
  selection: string;
  activityGlow?: string;
}

export class CursorManager {
  private cursors = new Map<string, RemoteCursor>();
  private decorationTypes = new Map<string, { cursor: vscode.TextEditorDecorationType, selection: vscode.TextEditorDecorationType, activityGlow: vscode.TextEditorDecorationType }>();
  private appliedDecorations = new Map<vscode.TextEditor, Map<string, AppliedDecorationState>>();
  private refreshTimer?: NodeJS.Timeout;
  private typingTimers = new Map<string, NodeJS.Timeout>();
  private typingUsers = new Set<string>();

  // A fixed palette of colors for participants
  private colors = [
    '#f53b57', '#3c40c6', '#0abde3', '#10ac84', '#ff9f43',
    '#ff3f34', '#808e9b', '#d2dae2', '#00d8d6', '#05c46b'
  ];

  private getColorForUser(userId: string): string {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % this.colors.length;
    return this.colors[index];
  }

  private getDecorationType(userId: string): { cursor: vscode.TextEditorDecorationType, selection: vscode.TextEditorDecorationType, activityGlow: vscode.TextEditorDecorationType } {
    if (!this.decorationTypes.has(userId)) {
      const color = this.getColorForUser(userId);
      const cursor = vscode.window.createTextEditorDecorationType({
        after: {
          contentText: ' \u200B',
          textDecoration: `none; border-left: 2px solid ${color}; margin-left: -1px; position: absolute; transition: all 0.15s ease-out;`
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
      });

      const selection = vscode.window.createTextEditorDecorationType({
        backgroundColor: `${color}40`, // 25% opacity
        borderRadius: '2px',
        textDecoration: 'transition: all 0.15s ease-out;'
      });

      const activityGlow = vscode.window.createTextEditorDecorationType({
        backgroundColor: `${color}40`, // 25% opacity
        borderRadius: '4px'
      });

      this.decorationTypes.set(userId, { cursor, selection, activityGlow });
    }
    return this.decorationTypes.get(userId)!;
  }

  public updateCursor(userId: string, userName: string, uri: string, position: Position, selections?: { start: Position; end: Position }[]) {
    const nextCursor: RemoteCursor = {
      userName,
      uri,
      position,
      selections,
      color: this.getColorForUser(userId)
    };
    const previous = this.cursors.get(userId);
    if (previous && this.remoteCursorSignature(previous) === this.remoteCursorSignature(nextCursor)) {
      return;
    }
    this.cursors.set(userId, nextCursor);
    this.scheduleRefreshDecorations();
  }

  public setTyping(userId: string, isTyping: boolean) {
    const existingTimer = this.typingTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.typingTimers.delete(userId);
    }

    if (isTyping) {
      this.typingUsers.add(userId);
      const timer = setTimeout(() => {
        this.setTyping(userId, false);
      }, 2000);
      this.typingTimers.set(userId, timer);
    } else {
      this.typingUsers.delete(userId);
    }
    this.scheduleRefreshDecorations();
  }

  public removeCursor(userId: string) {
    this.cursors.delete(userId);
    this.clearAppliedDecorationsForUser(userId);
    const dt = this.decorationTypes.get(userId);
    if (dt) {
      dt.cursor.dispose();
      dt.selection.dispose();
      dt.activityGlow.dispose();
      this.decorationTypes.delete(userId);
    }
    const timer = this.typingTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(userId);
    }
    this.typingUsers.delete(userId);
  }

  public clearAll() {
    this.cursors.clear();
    this.clearAppliedDecorations();
    for (const dt of this.decorationTypes.values()) {
      dt.cursor.dispose();
      dt.selection.dispose();
      dt.activityGlow.dispose();
    }
    this.decorationTypes.clear();
    for (const timer of this.typingTimers.values()) {
      clearTimeout(timer);
    }
    this.typingTimers.clear();
    this.typingUsers.clear();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  public refreshDecorations() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.applyDecorations();
  }

  private scheduleRefreshDecorations() {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.applyDecorations();
    }, 16);
  }

  private applyDecorations() {
    const cursorsByUri = new Map<string, { userId: string, cursor: RemoteCursor }[]>();
    for (const [userId, cursor] of this.cursors.entries()) {
      if (!cursorsByUri.has(cursor.uri)) {
        cursorsByUri.set(cursor.uri, []);
      }
      cursorsByUri.get(cursor.uri)!.push({ userId, cursor });
    }

    const visibleEditors = vscode.window.visibleTextEditors;
    const visibleEditorSet = new Set(visibleEditors);
    for (const editor of Array.from(this.appliedDecorations.keys())) {
      if (!visibleEditorSet.has(editor)) {
        this.appliedDecorations.delete(editor);
      }
    }

    for (const editor of vscode.window.visibleTextEditors) {
      const uriStr = editor.document.uri.toString();
      const editorCursors = cursorsByUri.get(uriStr) || [];
      const desiredUserIds = new Set(editorCursors.map(entry => entry.userId));
      const editorState = this.appliedDecorations.get(editor) ?? new Map<string, AppliedDecorationState>();

      for (const userId of Array.from(editorState.keys())) {
        if (!desiredUserIds.has(userId)) {
          const dt = this.decorationTypes.get(userId);
          if (dt) {
            editor.setDecorations(dt.cursor, []);
            editor.setDecorations(dt.selection, []);
          }
          editorState.delete(userId);
        }
      }

      for (const { userId, cursor } of editorCursors) {
        const dt = this.getDecorationType(userId);
        const lastLine = editor.document.lineCount - 1;
        const clampedLine = Math.max(0, Math.min(cursor.position.line, lastLine));
        const maxChar = editor.document.lineAt(clampedLine).text.length;
        const clampedChar = Math.max(0, Math.min(cursor.position.character, maxChar));
        const cursorPosition = new vscode.Position(clampedLine, clampedChar);
        const cursorRange = new vscode.Range(cursorPosition, cursorPosition);
        const cursorRanges = [cursorRange];

        let selectionRanges: vscode.Range[] = [];
        if (cursor.selections && cursor.selections.length > 0) {
          selectionRanges = cursor.selections.map(sel => {
            const sLine = Math.max(0, Math.min(sel.start.line, lastLine));
            const sChar = Math.max(0, Math.min(sel.start.character, editor.document.lineAt(sLine).text.length));
            const eLine = Math.max(0, Math.min(sel.end.line, lastLine));
            const eChar = Math.max(0, Math.min(sel.end.character, editor.document.lineAt(eLine).text.length));
            return new vscode.Range(new vscode.Position(sLine, sChar), new vscode.Position(eLine, eChar));
          });
        }

        const isTyping = this.typingUsers.has(userId);
        const glowRanges = isTyping ? [new vscode.Range(cursorPosition, cursorPosition)] : [];

        const nextState: AppliedDecorationState = {
          cursor: this.rangeSignature(cursorRanges),
          selection: this.rangeSignature(selectionRanges),
          activityGlow: this.rangeSignature(glowRanges)
        };
        const previousState = editorState.get(userId);
        if (!previousState || previousState.cursor !== nextState.cursor) {
          editor.setDecorations(dt.cursor, cursorRanges);
        }
        if (!previousState || previousState.selection !== nextState.selection) {
          editor.setDecorations(dt.selection, selectionRanges);
        }
        if (!previousState || previousState.activityGlow !== nextState.activityGlow) {
          editor.setDecorations(dt.activityGlow, glowRanges);
        }
        editorState.set(userId, nextState);
      }

      if (editorState.size > 0) {
        this.appliedDecorations.set(editor, editorState);
      } else {
        this.appliedDecorations.delete(editor);
      }
    }
  }

  private clearAppliedDecorationsForUser(userId: string) {
    const dt = this.decorationTypes.get(userId);
    for (const [editor, editorState] of this.appliedDecorations.entries()) {
      if (!editorState.has(userId)) {
        continue;
      }
      if (dt) {
        editor.setDecorations(dt.cursor, []);
        editor.setDecorations(dt.selection, []);
        editor.setDecorations(dt.activityGlow, []);
      }
      editorState.delete(userId);
      if (editorState.size === 0) {
        this.appliedDecorations.delete(editor);
      }
    }
  }

  private clearAppliedDecorations() {
    for (const [editor, editorState] of this.appliedDecorations.entries()) {
      for (const userId of editorState.keys()) {
        const dt = this.decorationTypes.get(userId);
        if (!dt) {
          continue;
        }
        editor.setDecorations(dt.cursor, []);
        editor.setDecorations(dt.selection, []);
        editor.setDecorations(dt.activityGlow, []);
      }
    }
    this.appliedDecorations.clear();
  }

  private remoteCursorSignature(cursor: RemoteCursor): string {
    return JSON.stringify({
      uri: cursor.uri,
      position: cursor.position,
      selections: cursor.selections ?? []
    });
  }

  private rangeSignature(ranges: vscode.Range[]): string {
    return ranges.map(range =>
      `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`
    ).join('|');
  }
}
