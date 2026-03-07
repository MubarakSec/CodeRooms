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
exports.ChatManager = void 0;
const vscode = __importStar(require("vscode"));
class ChatManager extends vscode.Disposable {
    constructor(memento) {
        super(() => this.dispose());
        this.memento = memento;
        this.messages = [];
        this.onDidChangeEmitter = new vscode.EventEmitter();
        this.onDidChange = this.onDidChangeEmitter.event;
        this.memoryLimit = 200;
        this.persistLimit = 200;
    }
    setRoom(roomId) {
        this.roomId = roomId;
        this.messages = roomId ? this.restore(roomId) : [];
        this.onDidChangeEmitter.fire();
    }
    addMessage(msg) {
        this.messages.push(msg);
        if (this.messages.length > this.memoryLimit) {
            this.messages.splice(0, this.messages.length - this.memoryLimit);
        }
        this.persist();
        this.onDidChangeEmitter.fire();
    }
    getMessages() {
        return [...this.messages];
    }
    clear() {
        this.messages = [];
        this.persist();
        this.onDidChangeEmitter.fire();
    }
    dispose() {
        this.onDidChangeEmitter.dispose();
    }
    persist() {
        if (!this.roomId) {
            return;
        }
        void this.memento.update(this.storageKey(this.roomId), this.messages.slice(-this.persistLimit));
    }
    restore(roomId) {
        const stored = this.memento.get(this.storageKey(roomId));
        if (!stored) {
            return [];
        }
        return stored.slice(-this.memoryLimit);
    }
    storageKey(roomId) {
        return `coderooms.chat.${roomId}`;
    }
}
exports.ChatManager = ChatManager;
//# sourceMappingURL=ChatManager.js.map