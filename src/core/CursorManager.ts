import * as vscode from 'vscode';
import { Position } from '../connection/MessageTypes';

interface RemoteCursor {
  uri: string;
  position: Position;
  selections?: { start: Position; end: Position }[];
  userName: string;
  color: string;
}

export class CursorManager {
  private cursors = new Map<string, RemoteCursor>();
  private decorationTypes = new Map<string, { cursor: vscode.TextEditorDecorationType, selection: vscode.TextEditorDecorationType }>();

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

  private getDecorationType(userId: string): { cursor: vscode.TextEditorDecorationType, selection: vscode.TextEditorDecorationType } {
    if (!this.decorationTypes.has(userId)) {
      const color = this.getColorForUser(userId);
      const cursor = vscode.window.createTextEditorDecorationType({
        after: {
          contentText: ' \u200B',
          textDecoration: `none; border-left: 2px solid ${color}; margin-left: -1px; position: absolute;`
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
      });

      const selection = vscode.window.createTextEditorDecorationType({
        backgroundColor: `${color}40`, // 25% opacity
        borderRadius: '2px'
      });

      this.decorationTypes.set(userId, { cursor, selection });
    }
    return this.decorationTypes.get(userId)!;
  }

  public updateCursor(userId: string, userName: string, uri: string, position: Position, selections?: { start: Position; end: Position }[]) {
    this.cursors.set(userId, {
      userName,
      uri,
      position,
      selections,
      color: this.getColorForUser(userId)
    });
    this.refreshDecorations();
  }

  public removeCursor(userId: string) {
    this.cursors.delete(userId);
    const dt = this.decorationTypes.get(userId);
    if (dt) {
      dt.cursor.dispose();
      dt.selection.dispose();
      this.decorationTypes.delete(userId);
    }
    this.refreshDecorations();
  }

  public clearAll() {
    this.cursors.clear();
    for (const dt of this.decorationTypes.values()) {
      dt.cursor.dispose();
      dt.selection.dispose();
    }
    this.decorationTypes.clear();
  }

  public refreshDecorations() {
    // Collect cursors by URI
    const cursorsByUri = new Map<string, { userId: string, cursor: RemoteCursor }[]>();
    for (const [userId, cursor] of this.cursors.entries()) {
      if (!cursorsByUri.has(cursor.uri)) {
        cursorsByUri.set(cursor.uri, []);
      }
      cursorsByUri.get(cursor.uri)!.push({ userId, cursor });
    }

    // Apply to visible text editors
    for (const editor of vscode.window.visibleTextEditors) {
      const uriStr = editor.document.uri.toString();
      const editorCursors = cursorsByUri.get(uriStr) || [];

      // We still need to clear decorations for users who are NO LONGER in this file
      for (const [userId, dt] of this.decorationTypes.entries()) {
        const uCursor = this.cursors.get(userId);
        if (uCursor && uCursor.uri === uriStr) {
          // This user is in this file, we will set them
        } else {
          // Clear it out
          editor.setDecorations(dt.cursor, []);
          editor.setDecorations(dt.selection, []);
        }
      }

      // Set new decorations
      for (const { userId, cursor } of editorCursors) {
        const dt = this.getDecorationType(userId);
        const cursorPosition = new vscode.Position(cursor.position.line, cursor.position.character);
        const cursorRange = new vscode.Range(cursorPosition, cursorPosition);
        editor.setDecorations(dt.cursor, [cursorRange]);

        if (cursor.selections && cursor.selections.length > 0) {
          const selRanges = cursor.selections.map(sel => 
            new vscode.Range(new vscode.Position(sel.start.line, sel.start.character), new vscode.Position(sel.end.line, sel.end.character))
          );
          editor.setDecorations(dt.selection, selRanges);
        } else {
          editor.setDecorations(dt.selection, []);
        }
      }
    }
  }
}
