"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomState = void 0;
class RoomState {
    constructor() {
        this.participants = [];
        this.collaboratorDirectMode = false;
        this.participantActivity = new Map();
        this.participantFiles = new Map();
    }
    setSelfInfo(userId, role, roomId, displayName) {
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
    }
    reset() {
        this.roomId = undefined;
        this.userId = undefined;
        this.role = undefined;
        this.participants = [];
        this.collaboratorDirectMode = false;
        this.participantActivity.clear();
        this.participantFiles.clear();
        this.mode = undefined;
    }
    setParticipants(list) {
        this.participants = list;
        const activeIds = new Set(list.map(p => p.userId));
        for (const [userId] of this.participantActivity) {
            if (!activeIds.has(userId)) {
                this.participantActivity.delete(userId);
                this.participantFiles.delete(userId);
                this.participantFiles.delete(userId);
            }
        }
        this.syncCollaboratorMode();
    }
    addParticipant(participant) {
        this.participants = this.participants.filter(p => p.userId !== participant.userId);
        this.participants.push(participant);
        if (participant.userId === this.userId) {
            this.syncCollaboratorMode();
        }
    }
    removeParticipant(userId) {
        this.participants = this.participants.filter(p => p.userId !== userId);
        if (userId === this.userId) {
            this.collaboratorDirectMode = false;
        }
        this.participantActivity.delete(userId);
        this.participantFiles.delete(userId);
        this.participantFiles.delete(userId);
    }
    updateParticipantRole(userId, role) {
        this.participants = this.participants.map(p => p.userId === userId
            ? { ...p, role }
            : p);
        if (userId === this.userId) {
            this.role = role;
            if (role !== 'collaborator') {
                this.collaboratorDirectMode = false;
            }
        }
    }
    updateParticipantMode(userId, direct) {
        this.participants = this.participants.map(p => p.userId === userId
            ? { ...p, isDirectEditMode: direct }
            : p);
        if (userId === this.userId && this.isCollaborator()) {
            this.collaboratorDirectMode = direct;
        }
    }
    getRoomId() {
        return this.roomId;
    }
    getUserId() {
        return this.userId;
    }
    getRole() {
        return this.role;
    }
    getDisplayName() {
        return this.displayName;
    }
    getParticipants() {
        return this.participants;
    }
    isRoot() {
        return this.role === 'root';
    }
    isCollaborator() {
        return this.role === 'collaborator';
    }
    isViewer() {
        return this.role === 'viewer';
    }
    setCollaboratorMode(direct) {
        this.collaboratorDirectMode = direct;
    }
    isCollaboratorInDirectMode() {
        return this.collaboratorDirectMode;
    }
    setActiveSharedDocLabel(label) {
        this.activeSharedDocLabel = label;
    }
    getActiveSharedDocLabel() {
        return this.activeSharedDocLabel;
    }
    setParticipantActivity(userId, at) {
        this.participantActivity.set(userId, at);
    }
    setParticipantFile(userId, file) {
        this.participantFiles.set(userId, file);
    }
    getParticipantFile(userId) {
        return this.participantFiles.get(userId);
    }
    isParticipantTyping(userId) {
        const at = this.participantActivity.get(userId);
        if (!at) {
            return false;
        }
        return Date.now() - at < 2000;
    }
    setMode(mode) {
        this.mode = mode;
    }
    getRoomMode() {
        return this.mode;
    }
    syncCollaboratorMode() {
        if (!this.isCollaborator()) {
            return;
        }
        const self = this.participants.find(p => p.userId === this.userId);
        if (self) {
            this.collaboratorDirectMode = Boolean(self.isDirectEditMode);
        }
    }
}
exports.RoomState = RoomState;
//# sourceMappingURL=RoomState.js.map