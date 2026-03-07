import { EventEmitter } from 'events';
import { ClientToServerMessage } from './MessageTypes';
export interface ReconnectOptions {
    enabled: boolean;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffFactor: number;
    maxAttempts: number;
}
export declare class WebSocketClient extends EventEmitter {
    private socket?;
    private url?;
    private reconnectTimer?;
    private reconnectAttempt;
    private intentionalClose;
    private reconnectOptions;
    private lastPongTime;
    private pingInterval?;
    constructor(options?: Partial<ReconnectOptions>);
    connect(url: string): Promise<void>;
    private establishConnection;
    private scheduleReconnect;
    private clearReconnectTimer;
    private startHeartbeat;
    private stopHeartbeat;
    send(message: ClientToServerMessage): void;
    isOpen(): boolean;
    getReconnectAttempt(): number;
    disconnect(): void;
}
