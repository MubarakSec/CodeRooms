"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
class SectionItem extends vscode.TreeItem {
    constructor(section, label, collapsibleState = vscode.TreeItemCollapsibleState.Expanded) {
        super(label, collapsibleState);
        this.section = section;
        this.contextValue = `coderooms.section.${section}`;
    }
}
class InfoItem extends vscode.TreeItem {
    constructor(label, description) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.contextValue = 'coderooms.info';
    }
}
class ActionItem extends vscode.TreeItem {
    constructor(label, command, args = [], icon) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.command = { command, title: label, arguments: args };
        this.iconPath = icon;
        this.contextValue = 'coderooms.action';
    }
}
class ParticipantTreeItem extends vscode.TreeItem {
    constructor(participant, isSelf, isRootUser) {
        super(participant.displayName, vscode.TreeItemCollapsibleState.None);
        this.participant = participant;
        const roleLabel = participant.role === 'collaborator'
            ? `${participant.role} (${participant.isDirectEditMode ? 'direct' : 'suggestion'})`
            : participant.role;
        this.description = isSelf ? `${roleLabel} � you` : roleLabel;
        this.tooltip = `${participant.displayName} � ${roleLabel}`;
        const icon = participant.role === 'root' ? 'crown' : participant.role === 'collaborator' ? 'pencil' : 'eye';
        this.iconPath = new vscode.ThemeIcon(icon);
        if (isRootUser && !isSelf) {
            this.contextValue = 'coderooms.participant.owner';
        }
        else {
            this.contextValue = 'coderooms.participant';
        }
    }
}
class SuggestionTreeItem extends vscode.TreeItem {
    constructor(suggestion, isRoot) {
        const uri = vscode.Uri.parse(suggestion.docId);
        const filePath = vscode.workspace.workspaceFolders
            ? vscode.workspace.asRelativePath(uri, false)
            : uri.fsPath;
        const rangeLabel = SuggestionTreeItem.formatRange(suggestion);
        super(`${filePath} ${rangeLabel}`, vscode.TreeItemCollapsibleState.None);
        this.suggestion = suggestion;
        this.description = suggestion.authorName;
        this.tooltip = suggestion.patch.text || 'Suggested edit';
        this.iconPath = new vscode.ThemeIcon('lightbulb');
        this.contextValue = isRoot ? 'coderooms.suggestion.root' : 'coderooms.suggestion';
    }
    static formatRange(suggestion) {
        const { start, end } = suggestion.patch.range;
        return `[L${start.line + 1}:${start.character + 1}-L${end.line + 1}:${end.character + 1}]`;
    }
}
class SessionTreeProvider {
    constructor(roomState, documentSync, suggestionManager) {
        this.roomState = roomState;
        this.documentSync = documentSync;
        this.suggestionManager = suggestionManager;
        this.onDidChangeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.onDidChangeData.event;
    }
    refresh() {
        this.onDidChangeData.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!element) {
            return this.buildRootSections();
        }
        if (element instanceof SectionItem) {
            switch (element.section) {
                case "roomInfo" /* SessionSection.RoomInfo */:
                    return this.buildRoomInfo();
                case "participants" /* SessionSection.Participants */:
                    return this.buildParticipants();
                case "mode" /* SessionSection.Mode */:
                    return this.buildModeSection();
                case "activeFile" /* SessionSection.ActiveFile */:
                    return this.buildActiveFileSection();
                case "suggestions" /* SessionSection.Suggestions */:
                    return this.buildSuggestionsSection();
            }
        }
        return [];
    }
    buildRootSections() {
        const sections = [];
        if (this.roomState.isRoot()) {
            sections.push(new SectionItem("roomInfo" /* SessionSection.RoomInfo */, 'Room Info'));
        }
        sections.push(new SectionItem("participants" /* SessionSection.Participants */, 'Participants'));
        sections.push(new SectionItem("mode" /* SessionSection.Mode */, 'Collaborator Mode', vscode.TreeItemCollapsibleState.Collapsed));
        sections.push(new SectionItem("activeFile" /* SessionSection.ActiveFile */, 'Active File', vscode.TreeItemCollapsibleState.Collapsed));
        sections.push(new SectionItem("suggestions" /* SessionSection.Suggestions */, 'Suggestions', vscode.TreeItemCollapsibleState.Collapsed));
        return sections;
    }
    buildRoomInfo() {
        const items = [];
        const roomId = this.roomState.getRoomId();
        const role = this.roomState.getRole();
        if (!roomId) {
            items.push(new InfoItem('Room not started'));
            return items;
        }
        items.push(new InfoItem(`Room ID: ${roomId}`));
        items.push(new InfoItem(`Status: ${role?.toUpperCase() ?? 'UNKNOWN'}`));
        items.push(new ActionItem('Copy Room ID', 'coderooms.copyRoomId', [roomId], new vscode.ThemeIcon('clippy')));
        items.push(new ActionItem('Stop Room', 'coderooms.stopRoom', [], new vscode.ThemeIcon('debug-stop')));
        return items;
    }
    buildParticipants() {
        const participants = [...this.roomState.getParticipants()];
        if (participants.length === 0) {
            return [new InfoItem('No participants yet')];
        }
        const isRootUser = this.roomState.isRoot();
        const currentId = this.roomState.getUserId();
        return participants
            .sort((a, b) => a.displayName.localeCompare(b.displayName))
            .map(participant => new ParticipantTreeItem(participant, participant.userId === currentId, isRootUser));
    }
    buildModeSection() {
        if (!this.roomState.isCollaborator()) {
            return [new InfoItem('Only collaborators can toggle edit mode')];
        }
        const direct = this.roomState.isCollaboratorInDirectMode();
        const label = direct ? 'Direct Edit' : 'Suggestion Mode';
        const icon = new vscode.ThemeIcon(direct ? 'edit' : 'comment');
        const action = new ActionItem(`Current mode: ${label}`, 'coderooms.toggleCollaboratorMode', [], icon);
        action.tooltip = 'Click to toggle collaborator mode';
        return [action];
    }
    buildActiveFileSection() {
        const uri = this.documentSync.getSharedDocumentUri();
        const items = [];
        if (!uri) {
            items.push(new InfoItem('No file is currently shared.'));
            if (this.roomState.isRoot()) {
                items.push(new ActionItem('Share Current File', 'coderooms.shareCurrentFile', [], new vscode.ThemeIcon('cloud-upload')));
            }
            return items;
        }
        const filePath = vscode.workspace.workspaceFolders
            ? vscode.workspace.asRelativePath(uri, false)
            : uri.fsPath;
        items.push(new InfoItem(filePath));
        if (this.roomState.isRoot()) {
            items.push(new ActionItem('Stop Sharing', 'coderooms.unshareCurrentFile', [], new vscode.ThemeIcon('close')));
        }
        return items;
    }
    buildSuggestionsSection() {
        if (!this.roomState.isRoot()) {
            return [new InfoItem('Suggestions are managed by the room owner.')];
        }
        const suggestions = this.suggestionManager.getSuggestions();
        if (suggestions.length === 0) {
            return [new InfoItem('No pending suggestions')];
        }
        return suggestions.map(s => new SuggestionTreeItem(s, true));
    }
}
exports.SessionTreeProvider = SessionTreeProvider;
//# sourceMappingURL=SessionTreeProvider.js.map