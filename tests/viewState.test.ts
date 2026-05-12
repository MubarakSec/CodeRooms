import { describe, expect, it } from 'vitest';
import type { Participant } from '../src/connection/MessageTypes';
import {
  buildParticipantViewModel,
  buildPeopleHeaderViewModel,
  buildReviewHeaderViewModel,
  buildSessionHeaderViewModel,
  buildStatusBarViewModel,
  formatCollaboratorModeLabel,
  formatRoleLabel,
  formatRoomModeLabel
} from '../src/ui/viewState';

function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    userId: overrides.userId ?? 'user-1',
    displayName: overrides.displayName ?? 'Alice',
    role: overrides.role ?? 'collaborator',
    isDirectEditMode: overrides.isDirectEditMode,
  };
}

describe('ui view state helpers', () => {
  it('formats role, room mode, and collaborator mode labels for display', () => {
    expect(formatRoleLabel('root')).toBe('Owner');
    expect(formatRoleLabel('collaborator')).toBe('Collaborator');
    expect(formatRoleLabel('viewer')).toBe('Viewer');
    expect(formatRoomModeLabel('team')).toBe('Team mode');
    expect(formatRoomModeLabel('classroom')).toBe('Classroom mode');
    expect(formatCollaboratorModeLabel(true)).toBe('Direct edit');
    expect(formatCollaboratorModeLabel(false)).toBe('Suggest changes');
  });

  it('builds a disconnected session header view model', () => {
    const viewModel = buildSessionHeaderViewModel({});

    expect(viewModel.label).toBe('Get Started');
    expect(viewModel.description).toBe('Collaborate');
    expect(viewModel.tooltipLines).toContain('Not connected to a room.');
  });

  it('builds participant state with role, file, and typing context', () => {
    const viewModel = buildParticipantViewModel({
      participant: participant({ displayName: 'Sam', isDirectEditMode: true }),
      isSelf: true,
      isTyping: true,
      currentFile: 'app.ts',
      canManage: false
    });

    expect(viewModel.label).toBe('Sam (you)');
    expect(viewModel.description).toBe('Collaborator · Direct edit · on app.ts · typing...');
    expect(viewModel.tooltipLines).toContain('Current file: app.ts');
    expect(viewModel.tooltipLines).toContain('Status: typing now');
  });

  it('builds people and review headers with role-specific summaries', () => {
    const people = buildPeopleHeaderViewModel([
      participant({ role: 'root', displayName: 'Owner' }),
      participant({ userId: 'c1', displayName: 'Collab', role: 'collaborator' }),
      participant({ userId: 'v1', displayName: 'Viewer', role: 'viewer' })
    ]);
    const review = buildReviewHeaderViewModel(true, 2);

    expect(people.description).toBe('3 people');
    expect(people.tooltipLines).toEqual(['Owners: 1', 'Collaborators: 1', 'Viewers: 1']);
    expect(review.label).toBe('Review');
    expect(review.description).toBe('2 pending');
  });

  it('builds concise collaborator status bar state with tooltip details', () => {
    const viewModel = buildStatusBarViewModel({
      connectionState: 'connected',
      reconnectAttempt: 0,
      roomId: 'room-7',
      role: 'collaborator',
      activeDocumentLabel: 'notes.md',
      participantCount: 4,
      isFollowing: true,
      collaboratorDirectMode: false
    });

    expect(viewModel.text).toBe('$(pencil) CR room-7 • Suggest • Follow • 4');
    expect(viewModel.tooltip).toContain('Room: room-7');
    expect(viewModel.tooltip).toContain('Access: Collaborator');
    expect(viewModel.tooltip).toContain('Edit mode: Suggest changes');
    expect(viewModel.tooltip).toContain('Follow mode: following owner');
    expect(viewModel.command).toBe('coderooms.openParticipantsView');
  });

  it('builds reconnecting status with warning emphasis', () => {
    const viewModel = buildStatusBarViewModel({
      connectionState: 'reconnecting',
      connectionDetail: undefined,
      reconnectAttempt: 3,
      roomId: 'room-8',
      role: 'root',
      activeDocumentLabel: 'server.ts',
      participantCount: 2,
      isFollowing: false,
      collaboratorDirectMode: false
    });

    expect(viewModel.text).toBe('$(sync~spin) CR reconnecting');
    expect(viewModel.tooltip).toBe('Reconnecting to CodeRooms (attempt 3).');
    expect(viewModel.emphasis).toBe('warning');
  });
});
