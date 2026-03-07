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
exports.ParticipantsView = void 0;
const vscode = __importStar(require("vscode"));
const participantsIcons_1 = require("./participantsIcons");
var Block;
(function (Block) {
    Block["Session"] = "session";
    Block["Work"] = "work";
    Block["People"] = "people";
    Block["Suggestions"] = "suggestions";
})(Block || (Block = {}));
class BlockItem extends vscode.TreeItem {
    constructor(block, label, description, icon, collapsible = vscode.TreeItemCollapsibleState.Expanded) {
        super(label, collapsible);
        this.block = block;
        this.description = description;
        this.iconPath = icon;
        this.contextValue = `coderooms.block.${block}`;
    }
}
class InfoItem extends vscode.TreeItem {
    constructor(label, description, icon) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.iconPath = icon;
        this.contextValue = 'coderooms.info';
    }
}
class ActionItem extends vscode.TreeItem {
    constructor(label, command, args = [], icon, description) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.command = { command, title: label, arguments: args };
        this.iconPath = icon;
        this.contextValue = 'coderooms.action';
    }
}
class ParticipantItem extends vscode.TreeItem {
    constructor(participant, isSelf, canManage, isTyping) {
        const name = isSelf ? `${participant.displayName} (you)` : participant.displayName;
        const modeDetail = participant.role === 'collaborator'
            ? participant.isDirectEditMode ? 'direct' : 'suggest'
            : undefined;
        super(name, vscode.TreeItemCollapsibleState.None);
        this.participant = participant;
        const descriptionParts = [roleBadge(participant.role)];
        if (modeDetail) {
            descriptionParts.push(modeDetail);
        }
        if (isTyping) {
            descriptionParts.push('typing');
        }
        this.description = descriptionParts.join(' · ');
        this.tooltip = `${participant.displayName}\nRole: ${roleBadge(participant.role)}${modeDetail ? ` (${modeDetail})` : ''}${isTyping ? '\nTyping now' : ''}`;
        this.iconPath = (0, participantsIcons_1.roleIcon)(participant.role);
        if (canManage && !isSelf) {
            this.command = { command: 'coderooms.changeParticipantRole', title: 'Change role', arguments: [participant] };
            this.contextValue = 'coderooms.participant.owner';
        }
        else if (!canManage) {
            this.contextValue = 'coderooms.participant.readonly';
        }
        else {
            this.contextValue = 'coderooms.participant';
        }
    }
}
class DocumentItem extends vscode.TreeItem {
    constructor(docId, label, description, isActive, isRoot) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.docId = docId;
        const descParts = [];
        if (isActive) {
            descParts.push('active');
        }
        if (description) {
            descParts.push(description);
        }
        this.description = descParts.join(' · ') || undefined;
        this.tooltip = description ?? label;
        this.iconPath = new vscode.ThemeIcon(isActive ? 'file-symlink-file' : 'file-code');
        this.command = { command: 'coderooms.setActiveDocument', title: 'Open shared document', arguments: [docId] };
        this.contextValue = isRoot ? 'coderooms.document.owner' : 'coderooms.document';
    }
}
class SuggestionItem extends vscode.TreeItem {
    constructor(suggestion, targetUri) {
        const fileLabel = describeLocation(targetUri);
        const range = describeRange(suggestion);
        const label = range ? `${fileLabel} ${range}` : fileLabel;
        super(label, vscode.TreeItemCollapsibleState.None);
        this.suggestion = suggestion;
        this.description = suggestion.authorName;
        this.tooltip = suggestion.patches[0]?.text || 'Suggested edit';
        this.iconPath = new vscode.ThemeIcon('lightbulb');
        this.contextValue = 'coderooms.suggestion.root';
    }
}
function roleBadge(role) {
    switch (role) {
        case 'root':
            return 'ROOT';
        case 'collaborator':
            return 'COLLAB';
        case 'viewer':
            return 'VIEWER';
        default:
            return 'GUEST';
    }
}
function describeRange(suggestion) {
    const patch = suggestion.patches[0];
    if (!patch) {
        return '';
    }
    const { start, end } = patch.range;
    return `[L${start.line + 1}:${start.character + 1}-L${end.line + 1}:${end.character + 1}]`;
}
function describeLocation(uri) {
    if (!uri) {
        return 'Shared document';
    }
    if (vscode.workspace.workspaceFolders) {
        return vscode.workspace.asRelativePath(uri, false);
    }
    return uri.fsPath;
}
class ParticipantsView {
    constructor(roomState, documentSync, suggestionManager, followController) {
        this.roomState = roomState;
        this.documentSync = documentSync;
        this.suggestionManager = suggestionManager;
        this.followController = followController;
        this.emitter = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.emitter.event;
        this.treeViews = new Map();
    }
    refresh() {
        this.emitter.fire(undefined);
    }
    registerTreeView(viewId, treeView) {
        this.treeViews.set(viewId, treeView);
    }
    async reveal(preferredView = 'coderoomsPanel') {
        const view = this.treeViews.get(preferredView) ?? this.treeViews.values().next().value;
        if (!view) {
            return;
        }
        const roots = await this.getChildren();
        if (roots.length) {
            view.reveal(roots[0], { focus: true, select: false });
        }
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (!element) {
            return this.buildRootBlocks();
        }
        if (element instanceof BlockItem) {
            switch (element.block) {
                case Block.Session:
                    return this.buildSessionBlock();
                case Block.Work:
                    return this.buildWorkBlock();
                case Block.People:
                    return this.buildPeopleBlock();
                case Block.Suggestions:
                    return this.buildSuggestionsBlock();
            }
        }
        return [];
    }
    buildRootBlocks() {
        const roots = [];
        roots.push(this.createSessionHeader());
        const roomId = this.roomState.getRoomId();
        if (roomId) {
            roots.push(this.createWorkHeader());
            roots.push(this.createPeopleHeader());
            roots.push(this.createSuggestionsHeader());
        }
        return roots;
    }
    createSessionHeader() {
        const roomId = this.roomState.getRoomId();
        const role = this.roomState.getRole();
        const mode = this.roomState.getRoomMode();
        const descriptionParts = [];
        if (role) {
            descriptionParts.push(roleBadge(role));
        }
        if (mode) {
            descriptionParts.push(mode);
        }
        if (!roomId) {
            descriptionParts.push('disconnected');
        }
        const icon = roomId ? (0, participantsIcons_1.roleIcon)(role) : new vscode.ThemeIcon('debug-disconnect');
        const header = new BlockItem(Block.Session, roomId ? `Room ${roomId}` : 'Session', descriptionParts.join(' · ') || undefined, icon);
        header.tooltip = roomId
            ? `Connected to CodeRoom ${roomId}${role ? ` as ${roleBadge(role)}` : ''}${mode ? ` • ${mode}` : ''}`
            : 'Start or join a CodeRoom to collaborate.';
        return header;
    }
    buildSessionBlock() {
        const items = [];
        const roomId = this.roomState.getRoomId();
        const role = this.roomState.getRole();
        const mode = this.roomState.getRoomMode();
        if (!roomId) {
            items.push(new InfoItem('Not in a room', 'Start or join to begin', new vscode.ThemeIcon('debug-disconnect')));
            items.push(new ActionItem('Start a room as root', 'coderooms.startAsRoot', [], new vscode.ThemeIcon('debug-start')));
            items.push(new ActionItem('Join a room', 'coderooms.joinRoom', [], new vscode.ThemeIcon('sign-in')));
            items.push(new ActionItem('Reconnect to server', 'coderooms.reconnect', [], new vscode.ThemeIcon('refresh')));
            return items;
        }
        const roleLabel = role ? `${roleBadge(role)}${mode ? ` • ${mode}` : ''}` : undefined;
        items.push(new InfoItem('Room', `${roomId}${roleLabel ? ` • ${roleLabel}` : ''}`, new vscode.ThemeIcon('key')));
        items.push(new ActionItem('Open chat', 'coderooms.focusChatInput', [], new vscode.ThemeIcon('comment-discussion')));
        items.push(new ActionItem('Copy invite', 'coderooms.copyRoomId', [roomId], new vscode.ThemeIcon('clippy')));
        items.push(new ActionItem('Settings', 'coderooms.quickSettings', [], new vscode.ThemeIcon('gear')));
        if (this.roomState.isRoot()) {
            items.push(new ActionItem('Export room', 'coderooms.exportRoom', [], new vscode.ThemeIcon('package')));
            items.push(new ActionItem('Stop room', 'coderooms.stopRoom', [], new vscode.ThemeIcon('debug-stop')));
        }
        else {
            items.push(new ActionItem('Leave room', 'coderooms.leaveRoom', [], new vscode.ThemeIcon('sign-out')));
        }
        return items;
    }
    createWorkHeader() {
        const docs = this.documentSync.getSharedDocuments();
        const active = docs.find(doc => doc.isActive);
        const description = docs.length
            ? describeLocation(active?.uri) ?? active?.fileName ?? `${docs.length} files`
            : this.roomState.isRoot()
                ? 'Share a file'
                : 'Waiting for a share';
        return new BlockItem(Block.Work, 'Live work', description, new vscode.ThemeIcon('file-code'));
    }
    buildWorkBlock() {
        const items = [];
        const docs = this.documentSync.getSharedDocuments();
        const activeDoc = docs.find(doc => doc.isActive);
        if (docs.length === 0) {
            if (this.roomState.isRoot()) {
                items.push(new ActionItem('Share file', 'coderooms.shareCurrentFile', [], new vscode.ThemeIcon('cloud-upload')));
            }
            else {
                items.push(new InfoItem('Shared file', 'Waiting for the owner to share a file', new vscode.ThemeIcon('clock')));
            }
        }
        else {
            if (activeDoc) {
                const activeLabel = activeDoc.fileName ?? 'Shared file';
                const activeDesc = activeDoc.uri ? describeLocation(activeDoc.uri) : undefined;
                items.push(new InfoItem('Active document', activeDesc ?? activeLabel, new vscode.ThemeIcon('file-symlink-file')));
            }
            for (const doc of docs) {
                const label = doc.fileName ?? 'Shared file';
                const description = doc.uri ? describeLocation(doc.uri) : undefined;
                items.push(new DocumentItem(doc.docId, label, description, doc.isActive, this.roomState.isRoot()));
            }
            if (this.roomState.isRoot()) {
                items.push(new ActionItem('Share another', 'coderooms.shareCurrentFile', [], new vscode.ThemeIcon('cloud-upload')));
                items.push(new ActionItem('Stop sharing', 'coderooms.unshareCurrentFile', [], new vscode.ThemeIcon('close')));
            }
            else if (this.roomState.isCollaborator() && !this.roomState.isCollaboratorInDirectMode()) {
                const pending = this.documentSync.getPendingSuggestionCount();
                const label = pending > 0 ? `Send suggestion (${pending})` : 'Send suggestion';
                items.push(new ActionItem(label, 'coderooms.sendPendingSuggestion', [], new vscode.ThemeIcon('mail')));
            }
        }
        if (this.roomState.isCollaborator()) {
            const following = this.followController.isFollowing();
            const followLabel = following ? 'Stop follow' : 'Follow root';
            const followIcon = new vscode.ThemeIcon(following ? 'eye-closed' : 'eye');
            items.push(new ActionItem(followLabel, 'coderooms.toggleFollowRoot', [], followIcon));
            const direct = this.roomState.isCollaboratorInDirectMode();
            const modeLabel = direct ? 'Go to suggestion mode' : 'Go to direct edit';
            const modeIcon = new vscode.ThemeIcon(direct ? 'comment' : 'edit');
            items.push(new ActionItem(modeLabel, 'coderooms.toggleCollaboratorMode', [], modeIcon));
        }
        return items;
    }
    createPeopleHeader() {
        const participantCount = this.roomState.getParticipants().length;
        const roleCounts = this.countRoles();
        const summary = `Root ${roleCounts.root} • Collab ${roleCounts.collab} • Viewer ${roleCounts.viewer}`;
        const description = participantCount === 1 ? '1 person' : `${participantCount} people`;
        const header = new BlockItem(Block.People, 'People', description, new vscode.ThemeIcon('organization'));
        header.tooltip = summary;
        return header;
    }
    buildPeopleBlock() {
        const participants = [...this.roomState.getParticipants()];
        if (participants.length === 0) {
            return [new InfoItem('No one is here yet', 'Share your room ID to bring people in.', new vscode.ThemeIcon('circle-slash'))];
        }
        const isRootUser = this.roomState.isRoot();
        const currentId = this.roomState.getUserId();
        const items = [];
        items.push(...participants
            .sort((a, b) => {
            const roleOrder = rolePriority(b.role) - rolePriority(a.role);
            if (roleOrder !== 0) {
                return roleOrder;
            }
            return a.displayName.localeCompare(b.displayName);
        })
            .map(participant => new ParticipantItem(participant, participant.userId === currentId, isRootUser, this.roomState.isParticipantTyping(participant.userId))));
        return items;
    }
    countRoles() {
        return this.roomState.getParticipants().reduce((acc, p) => {
            if (p.role === 'root')
                acc.root += 1;
            else if (p.role === 'collaborator')
                acc.collab += 1;
            else if (p.role === 'viewer')
                acc.viewer += 1;
            return acc;
        }, { root: 0, collab: 0, viewer: 0 });
    }
    createSuggestionsHeader() {
        const isRoot = this.roomState.isRoot();
        const pending = this.suggestionManager.getSuggestions().length;
        const description = isRoot ? `${pending} pending` : 'Owner only';
        const state = vscode.TreeItemCollapsibleState.Expanded;
        return new BlockItem(Block.Suggestions, 'Suggestions', description, new vscode.ThemeIcon('lightbulb'), state);
    }
    buildSuggestionsBlock() {
        if (!this.roomState.isRoot()) {
            return [new InfoItem('Suggestions are visible to the room owner.', undefined, new vscode.ThemeIcon('info'))];
        }
        const suggestions = this.suggestionManager.getSuggestions();
        if (suggestions.length === 0) {
            return [new InfoItem('No pending suggestions', undefined, new vscode.ThemeIcon('check'))];
        }
        const items = suggestions.map(suggestion => new SuggestionItem(suggestion, this.documentSync.getDocumentUri(suggestion.docId)));
        items.push(new ActionItem('Clear all suggestions', 'coderooms.clearPendingSuggestions', [], new vscode.ThemeIcon('trash')));
        return items;
    }
}
exports.ParticipantsView = ParticipantsView;
function rolePriority(role) {
    switch (role) {
        case 'root':
            return 3;
        case 'collaborator':
            return 2;
        case 'viewer':
            return 1;
        default:
            return 0;
    }
}
//# sourceMappingURL=ParticipantsView.js.map