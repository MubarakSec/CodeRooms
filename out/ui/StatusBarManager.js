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
exports.StatusBarManager = void 0;
const vscode = __importStar(require("vscode"));
class StatusBarManager {
    constructor(roomState, followController) {
        this.roomState = roomState;
        this.followController = followController;
        this.connectionState = 'disconnected';
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.command = 'coderooms.openParticipantsView';
        this.update();
        this.item.show();
    }
    setConnectionState(state, detail) {
        this.connectionState = state;
        this.connectionDetail = detail;
        this.update();
    }
    update() {
        const roomId = this.roomState.getRoomId();
        const role = this.roomState.getRole();
        if (this.connectionState === 'connecting') {
            this.item.text = '$(sync~spin) CR connecting';
            this.item.tooltip = this.connectionDetail ?? 'Attempting to reach the CodeRooms server';
            this.item.command = undefined;
            return;
        }
        if (this.connectionState === 'error') {
            this.item.text = '$(error) CR error';
            this.item.tooltip = this.connectionDetail ?? 'Connection error. Click to retry.';
            this.item.command = 'coderooms.reconnect';
            return;
        }
        if (this.connectionState === 'disconnected' && !roomId) {
            this.item.text = '$(debug-disconnect) CR offline';
            this.item.tooltip = 'Click to reconnect to the server';
            this.item.command = 'coderooms.reconnect';
            return;
        }
        if (!roomId) {
            this.item.text = 'CR connected';
            this.item.tooltip = 'Connected to the CodeRooms server. Click to open the CodeRooms panel.';
            this.item.command = 'coderooms.openParticipantsView';
            return;
        }
        this.item.command = 'coderooms.openParticipantsView';
        const activeDoc = this.roomState.getActiveSharedDocLabel?.() ?? '';
        const docPart = activeDoc ? ` • ${activeDoc}` : '';
        if (role === 'root') {
            this.item.text = `$(crown) CR ${roomId}${docPart}`;
            this.item.tooltip = 'Room owner — open the CodeRooms panel for actions and sharing';
            return;
        }
        if (role === 'collaborator') {
            const mode = this.roomState.isCollaboratorInDirectMode() ? 'direct' : 'suggest';
            const followSuffix = this.followController?.isFollowing() ? ' • follow' : '';
            this.item.text = `$(pencil) CR ${roomId}${docPart} • ${mode}${followSuffix}`;
            this.item.tooltip = `Collaborator — mode=${mode}${followSuffix ? ' • following root cursor' : ''}. Click to open CodeRooms panel.`;
            return;
        }
        if (role === 'viewer') {
            this.item.text = `$(eye) CR ${roomId} • view${docPart ? docPart : ''}`;
            this.item.tooltip = 'Read-only member — click to open CodeRooms panel';
            return;
        }
        this.item.text = `CR ${roomId}${docPart}`;
        this.item.tooltip = 'CodeRooms session is active';
    }
    dispose() {
        this.item.dispose();
    }
}
exports.StatusBarManager = StatusBarManager;
//# sourceMappingURL=StatusBarManager.js.map