import { RoomState } from '../core/RoomState';
import { FollowController } from '../core/FollowController';
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';
export declare class StatusBarManager {
    private readonly roomState;
    private readonly followController?;
    private readonly item;
    private connectionState;
    private connectionDetail?;
    private reconnectAttempt;
    constructor(roomState: RoomState, followController?: FollowController | undefined);
    setConnectionState(state: ConnectionState, detail?: string, reconnectAttempt?: number): void;
    update(): void;
    dispose(): void;
}
export {};
