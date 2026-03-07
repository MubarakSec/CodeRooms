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

export class ChatManager extends vscode.Disposable {
  private messages: ChatMessage[] = [];
  private roomId?: string;
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  private readonly memoryLimit = 200;
  private readonly persistLimit = 200;

  constructor(private readonly memento: vscode.Memento) {
    super(() => this.dispose());
  }

  setRoom(roomId?: string): void {
    this.roomId = roomId;
    this.messages = roomId ? this.restore(roomId) : [];
    this.onDidChangeEmitter.fire();
  }

  addMessage(msg: ChatMessage): void {
    this.messages.push(msg);
    if (this.messages.length > this.memoryLimit) {
      this.messages.splice(0, this.messages.length - this.memoryLimit);
    }
    this.persist();
    this.onDidChangeEmitter.fire();
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
    this.persist();
    this.onDidChangeEmitter.fire();
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }

  private persist(): void {
    if (!this.roomId) {
      return;
    }
    void this.memento.update(this.storageKey(this.roomId), this.messages.slice(-this.persistLimit));
  }

  private restore(roomId: string): ChatMessage[] {
    const stored = this.memento.get<ChatMessage[]>(this.storageKey(roomId));
    if (!stored) {
      return [];
    }
    return stored.slice(-this.memoryLimit);
  }

  private storageKey(roomId: string): string {
    return `coderooms.chat.${roomId}`;
  }
}
