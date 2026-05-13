import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners: Array<(event: T) => void> = [];
    event = (listener: (event: T) => void) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
    fire(event?: T) {
      for (const listener of this.listeners) {
        listener(event as T);
      }
    }
  }

  class TreeItem {
    label?: string;
    description?: string;
    tooltip?: unknown;
    iconPath?: unknown;
    command?: unknown;
    contextValue?: string;

    constructor(label?: string) {
      this.label = label;
    }
  }

  class ThemeIcon {
    constructor(readonly id: string) {}
  }

  class MarkdownString {
    isTrusted = false;
    value = '';
    appendMarkdown(value: string) {
      this.value += value;
    }
    appendCodeblock(value: string) {
      this.value += value;
    }
  }

  return {
    EventEmitter,
    TreeItem,
    ThemeIcon,
    MarkdownString,
    TreeItemCollapsibleState: {
      None: 0,
      Expanded: 1,
      Collapsed: 2
    },
    workspace: {
      workspaceFolders: undefined,
      asRelativePath: (value: unknown) => String(value)
    }
  };
});

import { ParticipantsView } from '../src/ui/ParticipantsView';

function createDependencies() {
  const roomState = {
    stateVersion: 0,
    getRoomId: () => 'room-1',
    getRole: () => 'root',
    getRoomMode: () => 'team',
    isCollaboratorInDirectMode: () => false,
    getActiveSharedDocLabel: () => 'main.ts',
    getParticipants: () => [{ userId: 'u1', displayName: 'Alice', role: 'root' as const }],
    isParticipantTyping: () => false,
    isParticipantTalking: () => false,
    getParticipantFile: () => undefined,
    isRoot: () => true
  } as any;

  const documentSync = {
    stateVersion: 0,
    getPendingSuggestionCount: () => 0,
    getSharedDocuments: () => [],
    getDocumentUri: () => undefined
  } as any;

  const suggestionManager = {
    stateVersion: 0,
    getSuggestions: () => []
  } as any;

  const followController = {
    stateVersion: 0,
    isFollowing: () => false
  } as any;

  const terminalManager = {
    onDidChange: vi.fn(),
    getSharedTerminals: () => [],
    getRemoteTerminals: () => []
  } as any;

  const portForwardManager = {
    onDidChange: vi.fn(),
    getSharedPorts: () => [],
    getLocalServers: () => []
  } as any;

  return { roomState, documentSync, suggestionManager, followController, terminalManager, portForwardManager };
}

describe('ParticipantsView refresh gating', () => {
  it('skips full tree refreshes when the rendered state is unchanged', () => {
    const deps = createDependencies();
    const view = new ParticipantsView(
      deps.roomState,
      deps.documentSync,
      deps.suggestionManager,
      deps.followController,
      deps.terminalManager,
      deps.portForwardManager
    );

    let refreshEvents = 0;
    view.onDidChangeTreeData(() => {
      refreshEvents += 1;
    });

    view.refresh();
    view.refresh();

    expect(refreshEvents).toBe(1);
    expect(view.getRefreshStats()).toEqual({
      requested: 2,
      emitted: 1,
      skipped: 1
    });
  });

  it('emits when participant typing state changes the rendered tree', () => {
    const deps = createDependencies();
    let isTyping = false;
    deps.roomState.isParticipantTyping = () => isTyping;

    const view = new ParticipantsView(
      deps.roomState,
      deps.documentSync,
      deps.suggestionManager,
      deps.followController,
      deps.terminalManager,
      deps.portForwardManager
    );

    let refreshEvents = 0;
    view.onDidChangeTreeData(() => {
      refreshEvents += 1;
    });

    view.refresh();
    isTyping = true;
    deps.roomState.stateVersion++;
    view.refresh();

    expect(refreshEvents).toBe(2);
    expect(view.getRefreshStats().emitted).toBe(2);
  });

  it('chunks large review queues by file and suggestion range', async () => {
    const deps = createDependencies();
    deps.documentSync.getDocumentUri = () => ({ fsPath: '/workspace/main.ts' });
    deps.suggestionManager.getSuggestions = () => Array.from({ length: 30 }, (_, index) => ({
      suggestionId: `s-${index + 1}`,
      roomId: 'room-1',
      docId: 'doc-1',
      authorId: 'u2',
      authorName: 'Casey',
      patches: [{
        range: {
          start: { line: index, character: 0 },
          end: { line: index, character: 1 }
        },
        text: `change-${index + 1}`
      }],
      createdAt: 1_000 + index,
      status: 'pending' as const
    }));

    const view = new ParticipantsView(
      deps.roomState,
      deps.documentSync,
      deps.suggestionManager,
      deps.followController,
      deps.terminalManager,
      deps.portForwardManager
    );

    const roots = await view.getChildren();
    const suggestionSection = roots.find(r => r.contextValue === 'coderooms.block.suggestions');
    const reviewChildren = await view.getChildren(suggestionSection);

    expect(reviewChildren).toHaveLength(4);
    expect(reviewChildren[0]?.label).toBe('Large review queue');
    expect(reviewChildren[1]?.label).toBe('/workspace/main.ts');

    const groupChildren = await view.getChildren(reviewChildren[1]);
    expect(groupChildren.map(item => item.label)).toEqual(['Suggestions 1-25', 'Suggestions 26-30']);

    const firstChunkItems = await view.getChildren(groupChildren[0]);
    expect(firstChunkItems).toHaveLength(25);
  });

  it('shows follow owner for viewers without exposing collaborator edit toggles', async () => {
    const deps = createDependencies();
    deps.roomState.getRole = () => 'viewer';
    deps.roomState.isRoot = () => false;

    const view = new ParticipantsView(
      deps.roomState,
      deps.documentSync,
      deps.suggestionManager,
      deps.followController,
      deps.terminalManager,
      deps.portForwardManager
    );

    const roots = await view.getChildren();
    const workSection = roots.find(item => item.label === 'Work');
    const workChildren = await view.getChildren(workSection);
    const labels = workChildren.map(item => item.label);

    expect(labels).toContain('Follow owner');
    expect(labels).not.toContain('Use direct edit');
    expect(labels).not.toContain('Use suggestion mode');
  });
});
