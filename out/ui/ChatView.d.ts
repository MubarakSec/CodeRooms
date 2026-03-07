import * as vscode from 'vscode';
import { ChatManager } from '../core/ChatManager';
export declare class ChatView implements vscode.WebviewViewProvider {
    private readonly chatManager;
    private view?;
    constructor(chatManager: ChatManager);
    focusInput(): void;
    resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void>;
    private postMessages;
    private renderHtml;
}
