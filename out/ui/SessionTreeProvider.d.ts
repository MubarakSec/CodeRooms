import * as vscode from 'vscode';
import { RoomState } from '../core/RoomState';
import { DocumentSync } from '../core/DocumentSync';
import { SuggestionManager } from '../core/SuggestionManager';
export declare class SessionTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly roomState;
    private readonly documentSync;
    private readonly suggestionManager;
    private readonly onDidChangeData;
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined>;
    constructor(roomState: RoomState, documentSync: DocumentSync, suggestionManager: SuggestionManager);
    refresh(): void;
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem;
    getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]>;
    private buildRootSections;
    private buildRoomInfo;
    private buildParticipants;
    private buildModeSection;
    private buildActiveFileSection;
    private buildSuggestionsSection;
}
