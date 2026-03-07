import * as path from 'path';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { logger } from '../util/logger';
import { Role, RoomMode } from '../connection/MessageTypes';

export interface RoomDocumentEntry {
  docId: string;
  originalUri: string;
  fileName: string;
  localUri: string;
  lastVersion: number;
}

export interface RoomEvent {
  type: 'joined' | 'left' | 'roleChanged' | 'suggestionCreated' | 'suggestionAccepted' | 'suggestionRejected';
  roomId: string;
  userId?: string;
  fromRole?: Role;
  toRole?: Role;
  suggestionId?: string;
  docId?: string;
  timestamp: number;
}

interface RoomMetadata {
  roomId: string;
  mode?: RoomMode;
  documents: RoomDocumentEntry[];
  createdAt: number;
  lastUpdatedAt: number;
}

export class RoomStorage {
  private readonly roomsRoot: string;

  constructor(storageUri: vscode.Uri) {
    this.roomsRoot = path.join(storageUri.fsPath, 'rooms');
  }

  async prepare(): Promise<void> {
    await this.ensureDir(this.roomsRoot);
  }

  async registerDocument(
    roomId: string,
    docId: string,
    fileName: string,
    originalUri: string,
    text: string,
    version: number
  ): Promise<{ uri: vscode.Uri; entry: RoomDocumentEntry }> {
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
      await fs.writeFile(existingPath, text, 'utf8');
      existing.fileName = path.basename(existingPath);
      existing.lastVersion = version;
      metadata.documents = metadata.documents.map(item => item.docId === docId ? existing : item);
      metadata.lastUpdatedAt = Date.now();
      await this.writeMetadata(roomId, metadata);
      return { uri: vscode.Uri.file(existingPath), entry: existing };
    }

    const targetName = await this.resolveFileName(filesFolder, fileName);
    const targetPath = path.join(filesFolder, targetName);

    await fs.writeFile(targetPath, text, 'utf8');

    const entry: RoomDocumentEntry = {
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

  async updateVersion(roomId: string, docId: string, version: number): Promise<void> {
    const metadata = await this.readMetadata(roomId);
    const target = metadata.documents.find(item => item.docId === docId);
    if (!target) {
      return;
    }
    target.lastVersion = version;
    metadata.lastUpdatedAt = Date.now();
    await this.writeMetadata(roomId, metadata);
  }

  async getEntry(roomId: string, docId: string): Promise<RoomDocumentEntry | undefined> {
    const metadata = await this.readMetadata(roomId);
    return metadata.documents.find(item => item.docId === docId);
  }

  async clearRoom(roomId: string): Promise<void> {
    const roomFolder = path.join(this.roomsRoot, roomId);
    try {
      await fs.rm(roomFolder, { recursive: true, force: true });
    } catch (error) {
      logger.warn(`Failed to clear room storage for ${roomId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async recordRoomInfo(roomId: string, mode: RoomMode): Promise<void> {
    const metadata = await this.readMetadata(roomId);
    const now = Date.now();
    metadata.mode = mode;
    metadata.createdAt ||= now;
    metadata.lastUpdatedAt = now;
    await this.writeMetadata(roomId, metadata);
  }

  async appendEvent(roomId: string, event: RoomEvent): Promise<void> {
    const roomFolder = await this.ensureRoomFolders(roomId);
    const logPath = path.join(roomFolder, 'events.log');
    const line = `${JSON.stringify(event)}\n`;
    await fs.appendFile(logPath, line, 'utf8');
  }

  getRoomFolder(roomId: string): string {
    return path.join(this.roomsRoot, roomId);
  }

  private async ensureRoomFolders(roomId: string): Promise<string> {
    // Sanitize roomId to prevent directory traversal
    const safeRoomId = path.basename(roomId);
    const roomFolder = path.join(this.roomsRoot, safeRoomId);
    await this.ensureDir(roomFolder);
    return roomFolder;
  }

  private async readMetadata(roomId: string): Promise<RoomMetadata> {
    const roomFolder = path.join(this.roomsRoot, roomId);
    const metadataPath = path.join(roomFolder, 'room.json');

    try {
      const raw = await fs.readFile(metadataPath, 'utf8');
      return JSON.parse(raw) as RoomMetadata;
    } catch (error) {
      const now = Date.now();
      return { roomId, mode: undefined, documents: [], createdAt: now, lastUpdatedAt: now };
    }
  }

  private async writeMetadata(roomId: string, metadata: RoomMetadata): Promise<void> {
    const roomFolder = path.join(this.roomsRoot, roomId);
    await this.ensureDir(roomFolder);
    const metadataPath = path.join(roomFolder, 'room.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  }

  private async resolveFileName(folder: string, fileName: string): Promise<string> {
    // Sanitize: strip directory traversal and path separators, keep only the base name
    const sanitized = path.basename(fileName).replace(/\.\./g, '');
    const parsed = path.parse(sanitized);
    let candidate = sanitized || 'shared-file.txt';
    let suffix = 2;

    while (await this.exists(path.join(folder, candidate))) {
      const base = parsed.name || 'shared-file';
      const ext = parsed.ext || '';
      candidate = `${base}-${suffix}${ext}`;
      suffix += 1;
    }

    return candidate;
  }

  private async ensureDir(target: string): Promise<void> {
    await fs.mkdir(target, { recursive: true });
  }

  private async exists(target: string): Promise<boolean> {
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }
}
