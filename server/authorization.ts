import { Role } from './types';

export interface RoomParticipantAccess {
  role: Role;
  isDirectEditMode?: boolean;
}

export function canPerformOwnerAction(requesterUserId: string, ownerUserId: string): boolean {
  return requesterUserId === ownerUserId;
}

export function canChangeEditMode(
  requesterUserId: string,
  ownerUserId: string,
  targetUserId: string
): boolean {
  return requesterUserId === ownerUserId || requesterUserId === targetUserId;
}

export function canEditSharedDocument(
  requesterRole: Role | undefined,
  participant?: RoomParticipantAccess
): boolean {
  if (requesterRole === 'root') {
    return true;
  }
  if (requesterRole !== 'collaborator') {
    return false;
  }
  return Boolean(participant?.role === 'collaborator' && participant.isDirectEditMode);
}

export function canSendChat(participant?: RoomParticipantAccess): boolean {
  return Boolean(participant && participant.role !== 'viewer');
}
