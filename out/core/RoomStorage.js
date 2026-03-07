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
exports.RoomStorage = void 0;
const path = __importStar(require("path"));
const fs_1 = require("fs");
const vscode = __importStar(require("vscode"));
const logger_1 = require("../util/logger");
class RoomStorage {
    constructor(storageUri) {
        this.roomsRoot = path.join(storageUri.fsPath, 'rooms');
    }
    async prepare() {
        await this.ensureDir(this.roomsRoot);
    }
    async registerDocument(roomId, docId, fileName, originalUri, text, version) {
        const roomFolder = await this.ensureRoomFolders(roomId);
        const filesFolder = path.join(roomFolder, 'files');
        await this.ensureDir(filesFolder);
        const metadata = await this.readMetadata(roomId);
        const existing = metadata.documents.find(item => item.docId === docId);
        // Reuse the same on-disk file when reconnecting to the same room/document
        // so we do not create conflicting copies or fail to open an existing file.
        if (existing) {
            const existingPath = vscode.Uri.parse(existing.localUri).fsPath;
            await this.ensureDir(path.dirname(existingPath));
            await fs_1.promises.writeFile(existingPath, text, 'utf8');
            existing.fileName = path.basename(existingPath);
            existing.lastVersion = version;
            metadata.documents = metadata.documents.map(item => item.docId === docId ? existing : item);
            metadata.lastUpdatedAt = Date.now();
            await this.writeMetadata(roomId, metadata);
            return { uri: vscode.Uri.file(existingPath), entry: existing };
        }
        const targetName = await this.resolveFileName(filesFolder, fileName);
        const targetPath = path.join(filesFolder, targetName);
        await fs_1.promises.writeFile(targetPath, text, 'utf8');
        const entry = {
            docId,
            originalUri,
            fileName: targetName,
            localUri: vscode.Uri.file(targetPath).toString(),
            lastVersion: version
        };
        const filtered = metadata.documents.filter(item => item.docId !== docId);
        metadata.documents = [...filtered, entry];
        metadata.lastUpdatedAt = Date.now();
        await this.writeMetadata(roomId, metadata);
        return { uri: vscode.Uri.file(targetPath), entry };
    }
    async updateVersion(roomId, docId, version) {
        const metadata = await this.readMetadata(roomId);
        const target = metadata.documents.find(item => item.docId === docId);
        if (!target) {
            return;
        }
        target.lastVersion = version;
        metadata.lastUpdatedAt = Date.now();
        await this.writeMetadata(roomId, metadata);
    }
    async getEntry(roomId, docId) {
        const metadata = await this.readMetadata(roomId);
        return metadata.documents.find(item => item.docId === docId);
    }
    async clearRoom(roomId) {
        const roomFolder = path.join(this.roomsRoot, roomId);
        try {
            await fs_1.promises.rm(roomFolder, { recursive: true, force: true });
        }
        catch (error) {
            logger_1.logger.warn(`Failed to clear room storage for ${roomId}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async recordRoomInfo(roomId, mode) {
        const metadata = await this.readMetadata(roomId);
        const now = Date.now();
        metadata.mode = mode;
        metadata.createdAt || (metadata.createdAt = now);
        metadata.lastUpdatedAt = now;
        await this.writeMetadata(roomId, metadata);
    }
    async appendEvent(roomId, event) {
        const roomFolder = await this.ensureRoomFolders(roomId);
        const logPath = path.join(roomFolder, 'events.log');
        const line = `${JSON.stringify(event)}\n`;
        await fs_1.promises.appendFile(logPath, line, 'utf8');
    }
    getRoomFolder(roomId) {
        return path.join(this.roomsRoot, roomId);
    }
    async ensureRoomFolders(roomId) {
        const roomFolder = path.join(this.roomsRoot, roomId);
        await this.ensureDir(roomFolder);
        return roomFolder;
    }
    async readMetadata(roomId) {
        const roomFolder = path.join(this.roomsRoot, roomId);
        const metadataPath = path.join(roomFolder, 'room.json');
        try {
            const raw = await fs_1.promises.readFile(metadataPath, 'utf8');
            return JSON.parse(raw);
        }
        catch (error) {
            const now = Date.now();
            return { roomId, mode: undefined, documents: [], createdAt: now, lastUpdatedAt: now };
        }
    }
    async writeMetadata(roomId, metadata) {
        const roomFolder = path.join(this.roomsRoot, roomId);
        await this.ensureDir(roomFolder);
        const metadataPath = path.join(roomFolder, 'room.json');
        await fs_1.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    }
    async resolveFileName(folder, fileName) {
        const parsed = path.parse(fileName);
        let candidate = fileName || 'shared-file.txt';
        let suffix = 2;
        while (await this.exists(path.join(folder, candidate))) {
            const base = parsed.name || 'shared-file';
            const ext = parsed.ext || '';
            candidate = `${base}-${suffix}${ext}`;
            suffix += 1;
        }
        return candidate;
    }
    async ensureDir(target) {
        await fs_1.promises.mkdir(target, { recursive: true });
    }
    async exists(target) {
        try {
            await fs_1.promises.access(target);
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.RoomStorage = RoomStorage;
//# sourceMappingURL=RoomStorage.js.map