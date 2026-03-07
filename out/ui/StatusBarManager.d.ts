import { RoomState } from '../core/RoomState';
import { FollowController } from '../core/FollowController';
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
export declare class StatusBarManager {
    private readonly roomState;
    private readonly followController?;
    private readonly item;
    private connectionState;
    private connectionDetail?;
    constructor(roomState: RoomState, followController?: FollowController | undefined);
    setConnectionState(state: ConnectionState, detail?: string): void;
    update(): void;
    dispose(): void;
}
export {};
