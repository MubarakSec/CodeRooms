import * as vscode from 'vscode';
import { Role } from '../connection/MessageTypes';
export type ChatMessage = {
    messageId: string;
    fromUserId: string;
    fromName: string;
    role: Role;
    content: string;
    timestamp: number;
    isSystem?: boolean;
};
export declare class ChatManager extends vscode.Disposable {
    private readonly memento;
    private messages;
    private roomId?;
    private readonly onDidChangeEmitter;
    readonly onDidChange: vscode.Event<void>;
    private readonly memoryLimit;
    private readonly persistLimit;
    constructor(memento: vscode.Memento);
    setRoom(roomId?: string): void;
    addMessage(msg: ChatMessage): void;
    getMessages(): ChatMessage[];
    clear(): void;
    dispose(): void;
    private persist;
    private restore;
    private storageKey;
}
