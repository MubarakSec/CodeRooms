import * as vscode from 'vscode';
import { Participant, Role, Suggestion } from '../connection/MessageTypes';
import { RoomState } from '../core/RoomState';
import { DocumentSync } from '../core/DocumentSync';
import { SuggestionManager } from '../core/SuggestionManager';
import { FollowController } from '../core/FollowController';
import { roleIcon } from './participantsIcons';
import {
  buildParticipantViewModel,
  buildPeopleHeaderViewModel,
  buildReviewHeaderViewModel,
  buildSessionHeaderViewModel,
  buildWorkHeaderDescription,
  formatCollaboratorModeLabel,
  formatRoleLabel,
  formatRoomModeLabel
} from './viewState';
import { buildParticipantsViewRefreshKey } from './participantsViewRefresh';
import { buildSuggestionChunks, buildSuggestionGroups, SuggestionChunkPlan, SuggestionGroupPlan, SUGGESTION_CHUNK_SIZE } from './suggestionBuckets';
import { buildSuggestionPreview } from '../util/suggestionPreview';

enum Block {
  Session = 'session',
  Work = 'work',
  People = 'people',
  Suggestions = 'suggestions'
}

class BlockItem extends vscode.TreeItem {
  constructor(
    readonly block: Block,
    label: string,
    description?: string,
    icon?: vscode.ThemeIcon,
    collapsible: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Expanded
  ) {
    super(label, collapsible);
    this.description = description;
    this.iconPath = icon;
    this.contextValue = `coderooms.block.${block}`;
  }
}

class InfoItem extends vscode.TreeItem {
  constructor(label: string, description?: string, icon?: vscode.ThemeIcon) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon;
    this.contextValue = 'coderooms.info';
  }
}

class ActionItem extends vscode.TreeItem {
  constructor(label: string, command: string, args: any[] = [], icon?: vscode.ThemeIcon, description?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.command = { command, title: label, arguments: args };
    this.iconPath = icon;
    this.contextValue = 'coderooms.action';
  }
}

class ParticipantItem extends vscode.TreeItem {
  readonly participant: Participant;

  constructor(participant: Participant, isSelf: boolean, canManage: boolean, isTyping: boolean, currentFile?: string) {
    const presentation = buildParticipantViewModel({ participant, isSelf, canManage, isTyping, currentFile });
    super(presentation.label, vscode.TreeItemCollapsibleState.None);
    this.participant = participant;
    this.description = presentation.description;

    const md = new vscode.MarkdownString(
      presentation.tooltipLines.map(line => escapeMarkdown(line)).join('\n\n')
    );
    md.isTrusted = true;
    this.tooltip = md;

    this.iconPath = roleIcon(participant.role);
    if (canManage && !isSelf) {
      this.command = { command: 'coderooms.changeParticipantRole', title: 'Change role', arguments: [participant] };
      this.contextValue = 'coderooms.participant.owner';
    } else if (!canManage) {
      this.contextValue = 'coderooms.participant.readonly';
    } else {
      this.contextValue = 'coderooms.participant';
    }
  }
}

class DocumentItem extends vscode.TreeItem {
  constructor(
    readonly docId: string,
    label: string,
    description: string | undefined,
    isActive: boolean,
    isRoot: boolean,
    isPending = false
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    const descParts = [];
    if (isActive) {
      descParts.push('active');
    }
    if (isPending) {
      descParts.push('sharing...');
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
  readonly suggestion: Suggestion;

  constructor(suggestion: Suggestion, targetUri?: vscode.Uri) {
    const fileLabel = describeLocation(targetUri);
    const range = describeRange(suggestion);
    const label = range ? `${fileLabel} ${range}` : fileLabel;
    super(label, vscode.TreeItemCollapsibleState.None);
    this.suggestion = suggestion;

    const preview = buildSuggestionPreview(suggestion.patches, 60);
    const createdTime = new Date(suggestion.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.description = `by ${suggestion.authorName} · ${suggestion.patches.length} patch${suggestion.patches.length !== 1 ? 'es' : ''} · ${createdTime}`;

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**Review from ${escapeMarkdown(suggestion.authorName)}**\n\n`);
    if (preview.text) {
      md.appendCodeblock(preview.text, 'text');
    }
    if (preview.omittedPatchCount > 0) {
      md.appendMarkdown(`\n\n_${preview.omittedPatchCount} more patch${preview.omittedPatchCount !== 1 ? 'es' : ''} in this suggestion_`);
    }
    md.appendMarkdown(`\n\n${suggestion.patches.length} patch${suggestion.patches.length !== 1 ? 'es' : ''} · ${createdTime}\n\n_Click to open the shared file_`);
    this.tooltip = md;
    this.iconPath = new vscode.ThemeIcon('lightbulb');
    this.command = { command: 'coderooms.setActiveDocument', title: 'Open suggestion target', arguments: [suggestion.docId] };
    this.contextValue = 'coderooms.suggestion.root';
  }
}

class SuggestionGroupItem extends vscode.TreeItem {
  constructor(
    readonly group: SuggestionGroupPlan,
    label: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${group.suggestions.length} pending`;
    this.iconPath = new vscode.ThemeIcon('file-code');
    this.contextValue = 'coderooms.suggestion.group';
  }
}

class SuggestionChunkItem extends vscode.TreeItem {
  constructor(readonly chunk: SuggestionChunkPlan) {
    super(chunk.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${chunk.suggestions.length} pending`;
    this.iconPath = new vscode.ThemeIcon('list-ordered');
    this.contextValue = 'coderooms.suggestion.chunk';
  }
}

/** Escape characters that have special meaning in VS Code MarkdownString */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}\[\]()#+\-.!|~<>]/g, '\\$&');
}

function describeRange(suggestion: Suggestion): string {
  const patch = suggestion.patches[0];
  if (!patch) {
    return '';
  }
  const { start, end } = patch.range;
  return `[L${start.line + 1}:${start.character + 1}-L${end.line + 1}:${end.character + 1}]`;
}

function describeLocation(uri?: vscode.Uri): string {
  if (!uri) {
    return 'Shared document';
  }
  if (vscode.workspace.workspaceFolders) {
    return vscode.workspace.asRelativePath(uri, false);
  }
  return uri.fsPath;
}

export class ParticipantsView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly treeViews = new Map<string, vscode.TreeView<vscode.TreeItem>>();
  private lastRefreshKey?: string;
  private refreshStats = { requested: 0, emitted: 0, skipped: 0 };

  constructor(
    private readonly roomState: RoomState,
    private readonly documentSync: DocumentSync,
    private readonly suggestionManager: SuggestionManager,
    private readonly followController: FollowController
  ) {}

  refresh(force = false): void {
    this.refreshStats.requested += 1;
    const nextKey = this.computeRefreshKey();
    if (!force && this.lastRefreshKey === nextKey) {
      this.refreshStats.skipped += 1;
      return;
    }
    this.lastRefreshKey = nextKey;
    this.refreshStats.emitted += 1;
    this.emitter.fire(undefined);
  }

  getRefreshStats(): { requested: number; emitted: number; skipped: number } {
    return { ...this.refreshStats };
  }

  registerTreeView(viewId: string, treeView: vscode.TreeView<vscode.TreeItem>): void {
    this.treeViews.set(viewId, treeView);
  }

  async reveal(preferredView = 'coderoomsPanel'): Promise<void> {
    const view = this.treeViews.get(preferredView) ?? this.treeViews.values().next().value;
    if (!view) {
      return;
    }
    const roots = await this.getChildren();
    if (roots.length) {
      view.reveal(roots[0], { focus: true, select: false });
    }
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
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

    if (element instanceof SuggestionGroupItem) {
      const chunks = buildSuggestionChunks(element.group.suggestions);
      if (chunks.length <= 1) {
        return element.group.suggestions.map(suggestion => new SuggestionItem(suggestion, this.documentSync.getDocumentUri(suggestion.docId)));
      }
      return chunks.map(chunk => new SuggestionChunkItem(chunk));
    }

    if (element instanceof SuggestionChunkItem) {
      return element.chunk.suggestions.map(suggestion => new SuggestionItem(suggestion, this.documentSync.getDocumentUri(suggestion.docId)));
    }

    return [];
  }

  private buildRootBlocks(): vscode.TreeItem[] {
    const roots: vscode.TreeItem[] = [];
    roots.push(this.createSessionHeader());
    const roomId = this.roomState.getRoomId();
    if (roomId) {
      roots.push(this.createWorkHeader());
      roots.push(this.createPeopleHeader());
      roots.push(this.createSuggestionsHeader());
    }
    return roots;
  }

  private computeRefreshKey(): string {
    const participants = this.roomState.getParticipants();
    return buildParticipantsViewRefreshKey({
      roomId: this.roomState.getRoomId(),
      role: this.roomState.getRole(),
      mode: this.roomState.getRoomMode(),
      collaboratorDirectMode: this.roomState.isCollaboratorInDirectMode(),
      activeSharedDocLabel: this.roomState.getActiveSharedDocLabel(),
      isFollowing: this.followController.isFollowing(),
      activePendingSuggestionCount: this.documentSync.getPendingSuggestionCount(),
      participants: participants.map(participant => ({
        userId: participant.userId,
        displayName: participant.displayName,
        role: participant.role,
        isDirectEditMode: participant.isDirectEditMode,
        isTyping: this.roomState.isParticipantTyping(participant.userId),
        currentFile: this.roomState.getParticipantFile(participant.userId)
      })),
      documents: this.documentSync.getSharedDocuments().map(document => ({
        ...document,
        uri: document.uri?.toString()
      })),
      suggestions: this.suggestionManager.getSuggestions()
    });
  }

  private createSessionHeader(): vscode.TreeItem {
    const roomId = this.roomState.getRoomId();
    const role = this.roomState.getRole();
    const presentation = buildSessionHeaderViewModel({
      roomId,
      role,
      mode: this.roomState.getRoomMode()
    });
    const icon = roomId ? roleIcon(role) : new vscode.ThemeIcon('debug-disconnect');
    const header = new BlockItem(Block.Session, presentation.label, presentation.description, icon);

    const md = new vscode.MarkdownString(
      presentation.tooltipLines.map(line => escapeMarkdown(line)).join('\n\n')
    );
    md.isTrusted = true;
    header.tooltip = md;
    return header;
  }

  private buildSessionBlock(): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [];
    const roomId = this.roomState.getRoomId();
    const role = this.roomState.getRole();
    const mode = this.roomState.getRoomMode();

    if (!roomId) {
      items.push(new InfoItem('Not in a room', 'Start or join to begin', new vscode.ThemeIcon('debug-disconnect')));
      items.push(new ActionItem('Start room', 'coderooms.startAsRoot', [], new vscode.ThemeIcon('debug-start')));
      items.push(new ActionItem('Join a room', 'coderooms.joinRoom', [], new vscode.ThemeIcon('sign-in')));
      items.push(new ActionItem('Reconnect', 'coderooms.reconnect', [], new vscode.ThemeIcon('refresh')));
      return items;
    }

    const accessParts: string[] = [];
    if (role) {
      accessParts.push(formatRoleLabel(role));
    }
    const roomModeLabel = formatRoomModeLabel(mode);
    if (roomModeLabel) {
      accessParts.push(roomModeLabel);
    }
    if (role === 'collaborator') {
      accessParts.push(formatCollaboratorModeLabel(this.roomState.isCollaboratorInDirectMode()));
    }
    items.push(new InfoItem('Room ID', roomId, new vscode.ThemeIcon('key')));
    items.push(new InfoItem('Access', accessParts.join(' · ') || undefined, roleIcon(role)));

    items.push(new ActionItem('Open chat', 'coderooms.focusChatInput', [], new vscode.ThemeIcon('comment-discussion')));
    items.push(new ActionItem('Copy room code', 'coderooms.copyRoomId', [roomId], new vscode.ThemeIcon('clippy')));
    items.push(new ActionItem('Quick settings', 'coderooms.quickSettings', [], new vscode.ThemeIcon('gear')));

    if (this.roomState.isRoot()) {
      items.push(new ActionItem('Export session', 'coderooms.exportRoom', [], new vscode.ThemeIcon('package')));
      items.push(new ActionItem('End session', 'coderooms.stopRoom', [], new vscode.ThemeIcon('debug-stop')));
    } else {
      items.push(new ActionItem('Leave session', 'coderooms.leaveRoom', [], new vscode.ThemeIcon('sign-out')));
    }
    return items;
  }

  private createWorkHeader(): vscode.TreeItem {
    const docs = this.documentSync.getSharedDocuments();
    const active = docs.find(doc => doc.isActive);
    const description = buildWorkHeaderDescription({
      activeLabel: active ? (active.uri ? describeLocation(active.uri) : active.fileName) : undefined,
      documentCount: docs.length,
      isRoot: this.roomState.isRoot()
    });
    return new BlockItem(Block.Work, 'Work', description, new vscode.ThemeIcon('file-code'));
  }

  private buildWorkBlock(): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [];
    const docs = this.documentSync.getSharedDocuments();
    const activeDoc = docs.find(doc => doc.isActive);

    if (docs.length === 0) {
      if (this.roomState.isRoot()) {
        items.push(new ActionItem('Share current file', 'coderooms.shareCurrentFile', [], new vscode.ThemeIcon('cloud-upload')));
      } else {
        items.push(new InfoItem('Shared file', 'Waiting for the owner to share a file', new vscode.ThemeIcon('clock')));
      }
    } else {
      if (activeDoc) {
        const activeLabel = activeDoc.fileName ?? 'Shared file';
        const activeDesc = activeDoc.uri ? describeLocation(activeDoc.uri) : undefined;
        items.push(new InfoItem('Active document', activeDesc ?? activeLabel, new vscode.ThemeIcon('file-symlink-file')));
      }

      for (const doc of docs) {
        const label = doc.fileName ?? 'Shared file';
        const description = doc.uri ? describeLocation(doc.uri) : undefined;
        items.push(new DocumentItem(doc.docId, label, description, doc.isActive, this.roomState.isRoot(), Boolean(doc.isPending)));
      }

      if (this.roomState.isRoot()) {
        items.push(new ActionItem('Share current file', 'coderooms.shareCurrentFile', [], new vscode.ThemeIcon('cloud-upload')));
        items.push(new ActionItem('Stop sharing current file', 'coderooms.unshareCurrentFile', [], new vscode.ThemeIcon('close')));
      } else if (this.roomState.isCollaborator() && !this.roomState.isCollaboratorInDirectMode()) {
        const pending = this.documentSync.getPendingSuggestionCount();
        const label = pending > 0 ? `Send pending suggestion (${pending})` : 'Send pending suggestion';
        items.push(new ActionItem(label, 'coderooms.sendPendingSuggestion', [], new vscode.ThemeIcon('mail')));
      }
    }

    const role = this.roomState.getRole();
    if (role === 'collaborator' || role === 'viewer') {
      const following = this.followController.isFollowing();
      const followLabel = following ? 'Stop following' : 'Follow owner';
      const followIcon = new vscode.ThemeIcon(following ? 'eye-closed' : 'eye');
      items.push(new ActionItem(followLabel, 'coderooms.toggleFollowRoot', [], followIcon));
    }

    if (role === 'collaborator') {
      const direct = this.roomState.isCollaboratorInDirectMode();
      const modeLabel = direct ? 'Use suggestion mode' : 'Use direct edit';
      const modeIcon = new vscode.ThemeIcon(direct ? 'comment' : 'edit');
      items.push(new ActionItem(modeLabel, 'coderooms.toggleCollaboratorMode', [], modeIcon));
    }

    return items;
  }

  private createPeopleHeader(): vscode.TreeItem {
    const presentation = buildPeopleHeaderViewModel(this.roomState.getParticipants());
    const header = new BlockItem(Block.People, presentation.label, presentation.description, new vscode.ThemeIcon('organization'));
    header.tooltip = presentation.tooltipLines.join('\n');
    return header;
  }

  private buildPeopleBlock(): vscode.TreeItem[] {
    const participants = [...this.roomState.getParticipants()];
    if (participants.length === 0) {
      return [new InfoItem('No one is here yet', 'Share your room ID to bring people in.', new vscode.ThemeIcon('circle-slash'))];
    }
    const isRootUser = this.roomState.isRoot();
    const currentId = this.roomState.getUserId();
    const items: vscode.TreeItem[] = [];
    items.push(...participants
      .sort((a, b) => {
        const roleOrder = rolePriority(b.role) - rolePriority(a.role);
        if (roleOrder !== 0) {
          return roleOrder;
        }
        return a.displayName.localeCompare(b.displayName);
      })
      .map(participant => {
        const currentFile = this.roomState.getParticipantFile(participant.userId);
        return new ParticipantItem(
          participant,
          participant.userId === currentId,
          isRootUser,
          this.roomState.isParticipantTyping(participant.userId),
          currentFile
        );
      }));
    return items;
  }

  private createSuggestionsHeader(): vscode.TreeItem {
    const presentation = buildReviewHeaderViewModel(this.roomState.isRoot(), this.suggestionManager.getSuggestions().length);
    const header = new BlockItem(
      Block.Suggestions,
      presentation.label,
      presentation.description,
      new vscode.ThemeIcon('lightbulb'),
      vscode.TreeItemCollapsibleState.Expanded
    );
    header.tooltip = presentation.tooltipLines.join('\n');
    return header;
  }

  private buildSuggestionsBlock(): vscode.TreeItem[] {
    if (!this.roomState.isRoot()) {
      return [new InfoItem('Review queue is owner-only', 'Pending suggestions appear here for the owner.', new vscode.ThemeIcon('info'))];
    }
    const suggestions = this.suggestionManager.getSuggestions();
    if (suggestions.length === 0) {
      return [new InfoItem('Review queue is clear', 'New suggestions will stay here until reviewed.', new vscode.ThemeIcon('check'))];
    }
    const groups = buildSuggestionGroups(suggestions);
    const items: vscode.TreeItem[] = [];
    if (groups.some(group => group.suggestions.length > SUGGESTION_CHUNK_SIZE)) {
      items.push(new InfoItem('Large review queue', `Grouped by file and chunked in sets of ${SUGGESTION_CHUNK_SIZE}`, new vscode.ThemeIcon('info')));
    }
    items.push(...groups.map(group => {
      const targetUri = this.documentSync.getDocumentUri(group.docId);
      const label = targetUri ? describeLocation(targetUri) : 'Shared document';
      return new SuggestionGroupItem(group, label);
    }));
    items.push(new ActionItem('Accept all pending', 'coderooms.acceptPendingSuggestions', [], new vscode.ThemeIcon('pass')));
    items.push(new ActionItem('Reject all pending', 'coderooms.clearPendingSuggestions', [], new vscode.ThemeIcon('trash')));
    return items;
  }
}

function rolePriority(role?: Role): number {
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
