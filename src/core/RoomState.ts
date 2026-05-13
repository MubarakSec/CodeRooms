import * as vscode from 'vscode';
import { Participant, Role, RoomMode } from '../connection/MessageTypes';

const PARTICIPANT_ACTIVITY_TTL_MS = 2_000;

export class RoomState {
  public stateVersion = 0;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  private roomId?: string;
  private userId?: string;
  private role?: Role;
  private displayName?: string;
  private participants: Participant[] = [];
  private collaboratorDirectMode = false;
  private participantActivity = new Map<string, number>();
  private participantFiles = new Map<string, string>();
  private talkingUsers = new Set<string>();
  private mutedUsers = new Set<string>();
  private mode?: RoomMode;
  private activeSharedDocLabel?: string;
  private e2eKey?: Buffer;

  setSelfInfo(userId: string, role: Role, roomId?: string, displayName?: string): void {
    this.userId = userId;
    this.role = role;
    this.roomId = roomId;
    if (displayName) {
      this.displayName = displayName;
    }
    if (role !== 'collaborator') {
      this.collaboratorDirectMode = false;
    }
    this.syncCollaboratorMode();
    this.stateVersion++;
    this.emitter.fire();
  }

  reset(): void {
    this.roomId = undefined;
    this.userId = undefined;
    this.role = undefined;
    this.participants = [];
    this.collaboratorDirectMode = false;
    this.participantActivity.clear();
    this.participantFiles.clear();
    this.talkingUsers.clear();
    this.mode = undefined;
    this.activeSharedDocLabel = undefined;
    this.stateVersion++;
    this.emitter.fire();
  }

  setParticipants(list: Participant[]): void {
    this.participants = list;
    const activeIds = new Set(list.map(p => p.userId));
    for (const [userId] of this.participantActivity) {
      if (!activeIds.has(userId)) {
        this.participantActivity.delete(userId);
        this.participantFiles.delete(userId);
        this.talkingUsers.delete(userId);
      }
    }
    this.syncCollaboratorMode();
    this.stateVersion++;
    this.emitter.fire();
  }

  addParticipant(participant: Participant): void {
    this.participants = this.participants.filter(p => p.userId !== participant.userId);
    this.participants.push(participant);
    if (participant.userId === this.userId) {
      this.syncCollaboratorMode();
    }
    this.stateVersion++;
    this.emitter.fire();
  }

  removeParticipant(userId: string): void {
    this.participants = this.participants.filter(p => p.userId !== userId);
    if (userId === this.userId) {
      this.collaboratorDirectMode = false;
    }
    this.participantActivity.delete(userId);
    this.participantFiles.delete(userId);
    this.talkingUsers.delete(userId);
    this.stateVersion++;
    this.emitter.fire();
  }

  updateParticipantRole(userId: string, role: Role): void {
    this.participants = this.participants.map(p =>
      p.userId === userId
        ? { ...p, role }
        : p
    );
    if (userId === this.userId) {
      this.role = role;
      if (role !== 'collaborator') {
        this.collaboratorDirectMode = false;
      }
    }
    this.stateVersion++;
    this.emitter.fire();
  }

  updateParticipantMode(userId: string, direct: boolean): void {
    this.participants = this.participants.map(p =>
      p.userId === userId
        ? { ...p, isDirectEditMode: direct }
        : p
    );
    if (userId === this.userId && this.isCollaborator()) {
      this.collaboratorDirectMode = direct;
    }
    this.stateVersion++;
    this.emitter.fire();
  }

  getRoomId(): string | undefined {
    return this.roomId;
  }

  getUserId(): string | undefined {
    return this.userId;
  }

  getRole(): Role | undefined {
    return this.role;
  }

  getDisplayName(): string | undefined {
    return this.displayName;
  }

  getParticipants(): Participant[] {
    return this.participants;
  }

  isRoot(): boolean {
    return this.role === 'root';
  }

  isCollaborator(): boolean {
    return this.role === 'collaborator';
  }

  isViewer(): boolean {
    return this.role === 'viewer';
  }

  setCollaboratorMode(direct: boolean): void {
    this.collaboratorDirectMode = direct;
  }

  isCollaboratorInDirectMode(): boolean {
    return this.collaboratorDirectMode;
  }

  setActiveSharedDocLabel(label?: string): void {
    this.activeSharedDocLabel = label;
  }

  getActiveSharedDocLabel(): string | undefined {
    return this.activeSharedDocLabel;
  }

  setParticipantActivity(userId: string, at: number): void {
    this.participantActivity.set(userId, at);
    this.stateVersion++;
    this.emitter.fire();
  }

  setParticipantFile(userId: string, file: string): void {
    this.participantFiles.set(userId, file);
    this.stateVersion++;
    this.emitter.fire();
  }

  getParticipantFile(userId: string): string | undefined {
    return this.participantFiles.get(userId);
  }

  setParticipantTalking(userId: string, talking: boolean): void {
    if (talking) {
      this.talkingUsers.add(userId);
    } else {
      this.talkingUsers.delete(userId);
    }
    this.stateVersion++;
    this.emitter.fire();
  }

  isParticipantTalking(userId: string): boolean {
    return this.talkingUsers.has(userId);
  }

  setParticipantMuted(userId: string, muted: boolean): void {
    if (muted) {
      this.mutedUsers.add(userId);
    } else {
      this.mutedUsers.delete(userId);
    }
    this.stateVersion++;
    this.emitter.fire();
  }

  isParticipantMuted(userId: string): boolean {
    return this.mutedUsers.has(userId);
  }

  isParticipantTyping(userId: string): boolean {
    const at = this.participantActivity.get(userId);
    if (!at) {
      return false;
    }
    return Date.now() - at < PARTICIPANT_ACTIVITY_TTL_MS;
  }

  pruneExpiredParticipantActivity(now = Date.now()): boolean {
    let changed = false;
    for (const [userId, at] of this.participantActivity) {
      if (now - at >= PARTICIPANT_ACTIVITY_TTL_MS) {
        this.participantActivity.delete(userId);
        changed = true;
      }
    }
    return changed;
  }

  getNextParticipantActivityExpiry(now = Date.now()): number | undefined {
    let nextExpiry: number | undefined;
    for (const at of this.participantActivity.values()) {
      const expiry = at + PARTICIPANT_ACTIVITY_TTL_MS;
      if (expiry <= now) {
        return now;
      }
      if (nextExpiry === undefined || expiry < nextExpiry) {
        nextExpiry = expiry;
      }
    }
    return nextExpiry;
  }

  setMode(mode: RoomMode | undefined): void {
    this.mode = mode;
  }

  getRoomMode(): RoomMode | undefined {
    return this.mode;
  }

  setE2EKey(key: Buffer | undefined): void {
    this.e2eKey = key;
  }

  getE2EKey(): Buffer | undefined {
    return this.e2eKey;
  }

  private syncCollaboratorMode(): void {
    if (!this.isCollaborator()) {
      return;
    }
    const self = this.participants.find(p => p.userId === this.userId);
    if (self) {
      this.collaboratorDirectMode = Boolean(self.isDirectEditMode);
    }
  }
}
