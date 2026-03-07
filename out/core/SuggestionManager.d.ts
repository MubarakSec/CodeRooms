import * as vscode from 'vscode';
import { Suggestion } from '../connection/MessageTypes';
import { RoomState } from './RoomState';
import { DocumentSync } from './DocumentSync';
export declare class SuggestionManager {
    private readonly roomState;
    private readonly documentSync?;
    private suggestions;
    private readonly decorationType;
    private readonly disposables;
    private readonly changeEmitter;
    private acceptHandler?;
    private rejectHandler?;
    readonly onDidChange: vscode.Event<void>;
    constructor(roomState: RoomState, documentSync?: DocumentSync | undefined);
    setHandlers(onAccept: (suggestion: Suggestion) => Promise<void> | void, onReject: (suggestion: Suggestion) => Promise<void> | void): void;
    dispose(): void;
    reset(): void;
    getSuggestions(): Suggestion[];
    clearAll(): void;
    handleSuggestion(suggestion: Suggestion): void;
    handleSuggestionAccepted(suggestionId: string): void;
    handleSuggestionRejected(suggestionId: string): void;
    private promptDecision;
    private refreshDecorations;
    private rangeFromPatch;
    private emitChange;
}
