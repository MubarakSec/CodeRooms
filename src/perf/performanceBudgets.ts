export interface RoomScaleScenario {
  label: string;
  participants: number;
  documents: number;
  suggestions: number;
  patchesPerSuggestion: number;
  chatWindow: number;
}

export interface PerformanceBudget {
  label: string;
  panelRenderP95Ms: number;
  cursorRefreshP95Ms: number;
  chatPlanP95Ms: number;
  recoveryCycleP95Ms: number;
}

export const roomScaleScenarios: RoomScaleScenario[] = [
  {
    label: 'room-10',
    participants: 10,
    documents: 3,
    suggestions: 12,
    patchesPerSuggestion: 2,
    chatWindow: 80
  },
  {
    label: 'room-25',
    participants: 25,
    documents: 4,
    suggestions: 30,
    patchesPerSuggestion: 3,
    chatWindow: 160
  },
  {
    label: 'room-50',
    participants: 50,
    documents: 6,
    suggestions: 75,
    patchesPerSuggestion: 3,
    chatWindow: 200
  }
];

export const performanceBudgets: Record<string, PerformanceBudget> = {
  'room-10': {
    label: 'room-10',
    panelRenderP95Ms: 35,
    cursorRefreshP95Ms: 20,
    chatPlanP95Ms: 5,
    recoveryCycleP95Ms: 45
  },
  'room-25': {
    label: 'room-25',
    panelRenderP95Ms: 65,
    cursorRefreshP95Ms: 30,
    chatPlanP95Ms: 6,
    recoveryCycleP95Ms: 80
  },
  'room-50': {
    label: 'room-50',
    panelRenderP95Ms: 100,
    cursorRefreshP95Ms: 50,
    chatPlanP95Ms: 8,
    recoveryCycleP95Ms: 120
  }
};
