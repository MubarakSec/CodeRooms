import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';

import { roomScaleScenarios, performanceBudgets, type RoomScaleScenario } from '../src/perf/performanceBudgets';

var visibleTextEditors: any[];
var activeTextEditor: any;

vi.mock('vscode', () => {
  visibleTextEditors = [];
  activeTextEditor = undefined;

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
    dispose() {
      this.listeners = [];
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

  class Disposable {
    constructor(private readonly disposeFn?: () => void) {}
    dispose() {
      this.disposeFn?.();
    }
  }

  class Position {
    constructor(readonly line: number, readonly character: number) {}
  }

  class Range {
    start: Position;
    end: Position;
    constructor(startOrLine: number | Position, startCharacterOrEnd?: number | Position, endLine?: number, endCharacter?: number) {
      if (startOrLine instanceof Position && startCharacterOrEnd instanceof Position) {
        this.start = startOrLine;
        this.end = startCharacterOrEnd;
        return;
      }
      this.start = new Position(startOrLine as number, startCharacterOrEnd as number);
      this.end = new Position(endLine ?? startOrLine as number, endCharacter ?? startCharacterOrEnd as number);
    }
  }

  return {
    EventEmitter,
    TreeItem,
    ThemeIcon,
    MarkdownString,
    Disposable,
    Position,
    Range,
    TreeItemCollapsibleState: {
      None: 0,
      Expanded: 1,
      Collapsed: 2
    },
    OverviewRulerLane: {
      Left: 1
    },
    DecorationRangeBehavior: {
      ClosedClosed: 0
    },
    window: {
      get visibleTextEditors() {
        return visibleTextEditors;
      },
      get activeTextEditor() {
        return activeTextEditor;
      },
      createTextEditorDecorationType: () => ({ dispose: () => {} }),
      onDidChangeActiveTextEditor: () => ({ dispose: () => {} })
    },
    workspace: {
      workspaceFolders: undefined,
      asRelativePath: (value: unknown) => String(value),
      onDidChangeTextDocument: () => ({ dispose: () => {} })
    }
  };
});

import { CursorManager } from '../src/core/CursorManager';
import { ParticipantsView } from '../src/ui/ParticipantsView';
import { buildChatRenderPlan } from '../src/ui/chatRenderPlan';

interface Measurement {
  averageMs: number;
  p95Ms: number;
}

async function measureAsync(iterations: number, fn: () => Promise<void>): Promise<Measurement> {
  const samples: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    await fn();
  }
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  return summarize(samples);
}

function measureSync(iterations: number, fn: () => void): Measurement {
  const samples: number[] = [];
  for (let index = 0; index < 10; index += 1) {
    fn();
  }
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return summarize(samples);
}

function summarize(samples: number[]): Measurement {
  const sorted = [...samples].sort((left, right) => left - right);
  const averageMs = samples.reduce((total, sample) => total + sample, 0) / Math.max(1, samples.length);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    averageMs,
    p95Ms: sorted[Math.max(0, p95Index)] ?? 0
  };
}

function createScenarioParticipants(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    userId: `user-${index + 1}`,
    displayName: `User ${index + 1}`,
    role: index === 0 ? 'root' as const : index % 3 === 0 ? 'viewer' as const : 'collaborator' as const,
    isDirectEditMode: index % 2 === 0
  }));
}

function createScenarioDocuments(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    docId: `doc-${index + 1}`,
    uri: { toString: () => `file:///workspace/doc-${index + 1}.ts`, fsPath: `/workspace/doc-${index + 1}.ts` },
    fileName: `doc-${index + 1}.ts`,
    isActive: index === 0,
    isPending: index === count - 1 && count > 3
  }));
}

function createScenarioSuggestions(scenario: RoomScaleScenario) {
  return Array.from({ length: scenario.suggestions }, (_, index) => ({
    suggestionId: `suggestion-${index + 1}`,
    roomId: 'room-1',
    docId: `doc-${(index % scenario.documents) + 1}`,
    authorId: `user-${(index % Math.max(2, scenario.participants - 1)) + 2}`,
    authorName: `User ${(index % Math.max(2, scenario.participants - 1)) + 2}`,
    createdAt: 1_000 + index,
    status: 'pending' as const,
    patches: Array.from({ length: scenario.patchesPerSuggestion }, (_, patchIndex) => ({
      range: {
        start: { line: patchIndex + index, character: 0 },
        end: { line: patchIndex + index, character: 4 }
      },
      text: `change-${index + 1}-${patchIndex + 1}`
    }))
  }));
}

function createParticipantsView(scenario: RoomScaleScenario) {
  const participants = createScenarioParticipants(scenario.participants);
  const documents = createScenarioDocuments(scenario.documents);
  const suggestions = createScenarioSuggestions(scenario);
  const roomState = {
    getRoomId: () => 'room-1',
    getRole: () => 'root',
    getRoomMode: () => 'team',
    isCollaborator: () => false,
    isCollaboratorInDirectMode: () => false,
    getActiveSharedDocLabel: () => documents[0]?.fileName,
    getParticipants: () => participants,
    isParticipantTyping: (userId: string) => Number(userId.split('-')[1]) % 5 === 0,
    getParticipantFile: (userId: string) => documents[(Number(userId.split('-')[1]) - 1) % documents.length]?.fileName,
    isRoot: () => true,
    getUserId: () => 'user-1'
  } as any;
  const documentSync = {
    getPendingSuggestionCount: () => 0,
    getSharedDocuments: () => documents,
    getDocumentUri: (docId: string) => documents.find(document => document.docId === docId)?.uri
  } as any;
  const suggestionManager = {
    getSuggestions: () => suggestions
  } as any;
  const followController = {
    isFollowing: () => false
  } as any;
  return new ParticipantsView(roomState, documentSync, suggestionManager, followController);
}

async function materializeTree(view: ParticipantsView): Promise<void> {
  const roots = await view.getChildren();
  for (const root of roots) {
    const children = await view.getChildren(root);
    for (const child of children) {
      const grandChildren = await view.getChildren(child);
      for (const grandChild of grandChildren) {
        await view.getChildren(grandChild);
      }
    }
  }
}

function createCursorManager(participants: number): CursorManager {
  const manager = new CursorManager();
  const lines = 400;
  const textLine = 'x'.repeat(120);
  const setDecorations = vi.fn();
  const editor = {
    document: {
      uri: { toString: () => 'file:///workspace/shared.ts' },
      lineCount: lines,
      lineAt: () => ({ text: textLine })
    },
    setDecorations
  };
  visibleTextEditors.length = 0;
  visibleTextEditors.push(editor);
  for (let index = 0; index < participants; index += 1) {
    manager.updateCursor(
      `user-${index + 1}`,
      `User ${index + 1}`,
      'file:///workspace/shared.ts',
      { line: index % lines, character: (index * 3) % 40 },
      [{ start: { line: index % lines, character: 0 }, end: { line: index % lines, character: 8 } }]
    );
  }
  manager.refreshDecorations();
  return manager;
}

function createChatMessages(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    messageId: `message-${offset + index + 1}`,
    fromUserId: `user-${(index % 5) + 1}`,
    fromName: `User ${(index % 5) + 1}`,
    role: index % 7 === 0 ? 'root' as const : 'collaborator' as const,
    content: `message ${offset + index + 1}`,
    timestamp: offset + index + 1
  }));
}

async function measureRecoveryCycle(scenario: RoomScaleScenario): Promise<Measurement> {
  return measureAsync(20, async () => {
    const view = createParticipantsView(scenario);
    const manager = createCursorManager(scenario.participants);
    view.refresh(true);
    await materializeTree(view);
    manager.refreshDecorations();
    buildChatRenderPlan([], createChatMessages(scenario.chatWindow));
  });
}

describe('Milestone 7 performance profile', () => {
  it.each(roomScaleScenarios)('keeps panel render within budget for $label', async scenario => {
    const view = createParticipantsView(scenario);

    const measurement = await measureAsync(30, async () => {
      view.refresh(true);
      await materializeTree(view);
    });

    console.log(
      `[perf] panel ${scenario.label}: avg=${measurement.averageMs.toFixed(2)}ms p95=${measurement.p95Ms.toFixed(2)}ms`
    );
    expect(measurement.p95Ms).toBeLessThanOrEqual(performanceBudgets[scenario.label].panelRenderP95Ms);
  });

  it.each(roomScaleScenarios)('keeps cursor refresh within budget for $label', scenario => {
    const manager = createCursorManager(scenario.participants);
    let tick = 0;

    const measurement = measureSync(80, () => {
      tick += 1;
      manager.updateCursor(
        'user-1',
        'User 1',
        'file:///workspace/shared.ts',
        { line: tick % 200, character: tick % 20 },
        [{ start: { line: tick % 200, character: 0 }, end: { line: tick % 200, character: 8 } }]
      );
      manager.refreshDecorations();
    });

    console.log(
      `[perf] cursor ${scenario.label}: avg=${measurement.averageMs.toFixed(2)}ms p95=${measurement.p95Ms.toFixed(2)}ms`
    );
    expect(measurement.p95Ms).toBeLessThanOrEqual(performanceBudgets[scenario.label].cursorRefreshP95Ms);
  });

  it.each(roomScaleScenarios)('keeps sliding chat diff within budget for $label', scenario => {
    const previous = createChatMessages(scenario.chatWindow);
    const next = createChatMessages(scenario.chatWindow, 1);

    const measurement = measureSync(500, () => {
      buildChatRenderPlan(
        previous.map(message => message.messageId),
        next
      );
    });

    console.log(
      `[perf] chat ${scenario.label}: avg=${measurement.averageMs.toFixed(3)}ms p95=${measurement.p95Ms.toFixed(3)}ms`
    );
    expect(measurement.p95Ms).toBeLessThanOrEqual(performanceBudgets[scenario.label].chatPlanP95Ms);
  });

  it.each(roomScaleScenarios)('keeps synthetic recovery rebuild within budget for $label', async scenario => {
    const measurement = await measureRecoveryCycle(scenario);

    console.log(
      `[perf] recovery ${scenario.label}: avg=${measurement.averageMs.toFixed(2)}ms p95=${measurement.p95Ms.toFixed(2)}ms`
    );
    expect(measurement.p95Ms).toBeLessThanOrEqual(performanceBudgets[scenario.label].recoveryCycleP95Ms);
  });
});
