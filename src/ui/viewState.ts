import { Participant, Role, RoomMode } from '../connection/MessageTypes';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';

export interface HeaderViewModel {
  label: string;
  description?: string;
  tooltipLines: string[];
}

export interface ParticipantViewModel {
  label: string;
  description?: string;
  tooltipLines: string[];
  isTalking: boolean;
}

export interface StatusBarViewModel {
  text: string;
  tooltip: string;
  command?: string;
  emphasis?: 'warning' | 'error';
}

export function formatRoleLabel(role?: Role): string {
  switch (role) {
    case 'root':
      return 'Owner';
    case 'collaborator':
      return 'Collaborator';
    case 'viewer':
      return 'Viewer';
    default:
      return 'Guest';
  }
}

export function formatRoomModeLabel(mode?: RoomMode): string | undefined {
  switch (mode) {
    case 'team':
      return 'Team mode';
    case 'classroom':
      return 'Classroom mode';
    default:
      return undefined;
  }
}

export function formatCollaboratorModeLabel(direct: boolean): string {
  return direct ? 'Direct edit' : 'Suggest changes';
}

export function formatParticipantCount(count: number): string {
  return `${count} participant${count === 1 ? '' : 's'}`;
}

export function formatPeopleCount(count: number): string {
  return count === 1 ? '1 person' : `${count} people`;
}

export function buildSessionHeaderViewModel(args: {
  roomId?: string;
  role?: Role;
  mode?: RoomMode;
}): HeaderViewModel {
  if (!args.roomId) {
    return {
      label: 'Get Started',
      description: 'Collaborate',
      tooltipLines: [
        'Not connected to a room.',
        'Start or join a CodeRoom to collaborate in real time.'
      ]
    };
  }

  const descriptionParts = [args.roomId];
  if (args.role) {
    descriptionParts.push(formatRoleLabel(args.role));
  }
  const modeLabel = formatRoomModeLabel(args.mode);
  if (modeLabel) {
    descriptionParts.push(modeLabel);
  }

  return {
    label: 'Session',
    description: descriptionParts.join(' · '),
    tooltipLines: [
      `Room: ${args.roomId}`,
      args.role ? `Access: ${formatRoleLabel(args.role)}` : '',
      modeLabel ? `Room mode: ${modeLabel}` : ''
    ].filter(Boolean)
  };
}

export function buildWorkHeaderDescription(args: {
  activeLabel?: string;
  documentCount: number;
  isRoot: boolean;
}): string {
  if (args.documentCount === 0) {
    return args.isRoot ? 'Share a file' : 'Waiting for the owner';
  }
  if (!args.activeLabel) {
    return args.documentCount === 1 ? '1 shared file' : `${args.documentCount} shared files`;
  }
  if (args.documentCount === 1) {
    return args.activeLabel;
  }
  return `${args.activeLabel} +${args.documentCount - 1}`;
}

export function buildPeopleHeaderViewModel(participants: Participant[]): HeaderViewModel {
  const counts = participants.reduce(
    (acc, participant) => {
      if (participant.role === 'root') {
        acc.root += 1;
      } else if (participant.role === 'collaborator') {
        acc.collaborator += 1;
      } else if (participant.role === 'viewer') {
        acc.viewer += 1;
      }
      return acc;
    },
    { root: 0, collaborator: 0, viewer: 0 }
  );

  return {
    label: 'People',
    description: formatPeopleCount(participants.length),
    tooltipLines: [
      `Owners: ${counts.root}`,
      `Collaborators: ${counts.collaborator}`,
      `Viewers: ${counts.viewer}`
    ]
  };
}

export function buildReviewHeaderViewModel(isRoot: boolean, pending: number): HeaderViewModel {
  if (!isRoot) {
    return {
      label: 'Review',
      description: 'Owner only',
      tooltipLines: ['Pending suggestions are reviewed by the room owner.']
    };
  }

  return {
    label: pending > 0 ? `Review (${pending})` : 'Review',
    description: pending > 0 ? 'Action needed' : 'Clear',
    tooltipLines: [
      pending === 0
        ? 'No pending suggestions.'
        : `${pending} pending suggestion${pending === 1 ? '' : 's'} ready for review.`
    ]
  };
}

export function buildParticipantViewModel(args: {
  participant: Participant;
  isSelf: boolean;
  isTyping: boolean;
  isTalking: boolean;
  currentFile?: string;
  canManage: boolean;
}): ParticipantViewModel {
  const { participant, isSelf, isTyping, isTalking, currentFile, canManage } = args;
  const descriptionParts = [formatRoleLabel(participant.role)];

  if (participant.role === 'collaborator') {
    descriptionParts.push(formatCollaboratorModeLabel(Boolean(participant.isDirectEditMode)));
  }
  if (currentFile) {
    descriptionParts.push(`on ${currentFile}`);
  }
  if (isTyping) {
    descriptionParts.push('typing...');
  }
  if (isTalking) {
    descriptionParts.push('talking...');
  }

  return {
    label: isSelf ? `${participant.displayName} (you)` : participant.displayName,
    description: descriptionParts.join(' · '),
    isTalking,
    tooltipLines: [
      `Name: ${participant.displayName}${isSelf ? ' (you)' : ''}`,
      `Role: ${formatRoleLabel(participant.role)}`,
      participant.role === 'collaborator'
        ? `Edit mode: ${formatCollaboratorModeLabel(Boolean(participant.isDirectEditMode))}`
        : '',
      currentFile ? `Current file: ${currentFile}` : '',
      isTyping ? 'Status: typing now' : '',
      isTalking ? 'Status: talking now' : '',
      canManage && !isSelf ? 'Action: click to change access' : ''
    ].filter(Boolean)
  };
}

export function buildStatusBarViewModel(args: {
  connectionState: ConnectionState;
  connectionDetail?: string;
  reconnectAttempt: number;
  roomId?: string;
  role?: Role;
  activeDocumentLabel?: string;
  participantCount: number;
  isFollowing: boolean;
  collaboratorDirectMode: boolean;
}): StatusBarViewModel {
  const {
    connectionState,
    connectionDetail,
    reconnectAttempt,
    roomId,
    role,
    activeDocumentLabel,
    participantCount,
    isFollowing,
    collaboratorDirectMode
  } = args;

  if (connectionState === 'reconnecting') {
    const attemptSuffix = reconnectAttempt > 0 ? ` (attempt ${reconnectAttempt})` : '';
    return {
      text: '$(sync~spin) CR reconnecting',
      tooltip: connectionDetail ?? `Reconnecting to CodeRooms${attemptSuffix}.`,
      emphasis: 'warning'
    };
  }

  if (connectionState === 'connecting') {
    return {
      text: '$(sync~spin) CR connecting',
      tooltip: connectionDetail ?? 'Connecting to the CodeRooms server.'
    };
  }

  if (connectionState === 'error') {
    return {
      text: '$(error) CR error',
      tooltip: connectionDetail ?? 'Connection error. Click to retry.',
      command: 'coderooms.reconnect',
      emphasis: 'error'
    };
  }

  if (connectionState === 'disconnected' && !roomId) {
    return {
      text: '$(debug-disconnect) CR offline',
      tooltip: connectionDetail ?? 'Disconnected from CodeRooms. Click to reconnect.',
      command: 'coderooms.reconnect'
    };
  }

  if (!roomId) {
    return {
      text: '$(pass) CR ready',
      tooltip: 'Connected to CodeRooms. Open the session panel to start or join a room.',
      command: 'coderooms.openParticipantsView'
    };
  }

  const tooltipLines = [
    `Room: ${roomId}`,
    `Access: ${formatRoleLabel(role)}`,
    `People: ${formatParticipantCount(participantCount)}`,
    activeDocumentLabel ? `Active file: ${activeDocumentLabel}` : 'Active file: none'
  ];
  const peopleSuffix = participantCount > 0 ? ` • ${participantCount}` : '';

  if (role === 'root') {
    return {
      text: `$(crown) CR ${roomId} • Owner${peopleSuffix}`,
      tooltip: tooltipLines.join('\n'),
      command: 'coderooms.openParticipantsView'
    };
  }

  if (role === 'collaborator') {
    tooltipLines.push(`Edit mode: ${formatCollaboratorModeLabel(collaboratorDirectMode)}`);
    if (isFollowing) {
      tooltipLines.push('Follow mode: following owner');
    }
    return {
      text: `$(pencil) CR ${roomId} • ${collaboratorDirectMode ? 'Direct' : 'Suggest'}${isFollowing ? ' • Follow' : ''}${peopleSuffix}`,
      tooltip: tooltipLines.join('\n'),
      command: 'coderooms.openParticipantsView'
    };
  }

  if (role === 'viewer') {
    return {
      text: `$(eye) CR ${roomId} • View only${peopleSuffix}`,
      tooltip: tooltipLines.join('\n'),
      command: 'coderooms.openParticipantsView'
    };
  }

  return {
    text: `CR ${roomId}`,
    tooltip: tooltipLines.join('\n'),
    command: 'coderooms.openParticipantsView'
  };
}
