import * as vscode from 'vscode';
export declare class FollowController {
    private followingRoot;
    private readonly emitter;
    readonly onDidChange: vscode.Event<boolean>;
    isFollowing(): boolean;
    setFollowing(value: boolean): void;
    toggle(): void;
    reset(): void;
}
