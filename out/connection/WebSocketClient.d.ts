import { EventEmitter } from 'events';
import { ClientToServerMessage } from './MessageTypes';
export declare class WebSocketClient extends EventEmitter {
    private socket?;
    private url?;
    connect(url: string): Promise<void>;
    send(message: ClientToServerMessage): void;
    disconnect(): void;
}
