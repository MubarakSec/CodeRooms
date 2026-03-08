import * as path from 'path';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { logger } from '../util/logger';
import { RoomMode } from '../connection/MessageTypes';
import {
  createDefaultRoomMetadata,
  parseRoomMetadata,
  RoomDocumentEntry,
  RoomEvent,
  RoomMetadata,
  serializeRoomMetadata
} from './roomMetadata';
import { isPathInside, sanitizeRoomFolderName, sanitizeSharedFileName } from './storagePaths';
import {
  DEFAULT_ROOM_STORAGE_TTL_MS,
  MAX_ROOM_EVENT_LOG_BYTES,
  isStorageEntryStale,
  trimEventLogContent
} from './storageRetention';

export type { RoomDocumentEntry, RoomEvent, RoomMetadata } from './roomMetadata';

export class RoomStorage {
  private readonly roomsRoot: string;

  constructor(storageUri: vscode.Uri) {
    this.roomsRoot = path.join(storageUri.fsPath, 'rooms');
  }

  async prepare(): Promise<void> {
    await this.ensureDir(this.roomsRoot);
  }

  async pruneStaleRooms(
    now = Date.now(),
    maxAgeMs = DEFAULT_ROOM_STORAGE_TTL_MS,
    maxEventLogBytes = MAX_ROOM_EVENT_LOG_BYTES
  ): Promise<void> {
    await this.ensureDir(this.roomsRoot);
    const entries = await fs.readdir(this.roomsRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const roomFolder = path.join(this.roomsRoot, entry.name);
      const retentionTimestamp = await this.getRetentionTimestamp(roomFolder, entry.name, now);
      if (isStorageEntryStale(retentionTimestamp, now, maxAgeMs)) {
        await fs.rm(roomFolder, { recursive: true, force: true });
        continue;
      }

      await this.trimEventLog(roomFolder, maxEventLogBytes);
    }
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
      if (isPathInside(filesFolder, existingPath)) {
        await this.ensureDir(path.dirname(existingPath));
        await fs.writeFile(existingPath, text, 'utf8');
        existing.fileName = path.basename(existingPath);
        existing.lastVersion = version;
        metadata.documents = metadata.documents.map(item => item.docId === docId ? existing : item);
        metadata.lastUpdatedAt = Date.now();
        await this.writeMetadata(roomId, metadata);
        return { uri: vscode.Uri.file(existingPath), entry: existing };
      }

      metadata.documents = metadata.documents.filter(item => item.docId !== docId);
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
    const roomFolder = this.getRoomFolder(roomId);
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
    return path.join(this.roomsRoot, sanitizeRoomFolderName(roomId));
  }

  private async ensureRoomFolders(roomId: string): Promise<string> {
    const roomFolder = this.getRoomFolder(roomId);
    await this.ensureDir(roomFolder);
    return roomFolder;
  }

  private async getRetentionTimestamp(roomFolder: string, roomId: string, now: number): Promise<number> {
    const metadataPath = path.join(roomFolder, 'room.json');
    try {
      const raw = await fs.readFile(metadataPath, 'utf8');
      return parseRoomMetadata(raw, roomId, now).lastUpdatedAt || now;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        logger.warn(`Invalid retention metadata for ${roomId}; falling back to folder mtime.`);
      }
      try {
        const stat = await fs.stat(roomFolder);
        return stat.mtimeMs;
      } catch {
        return now;
      }
    }
  }

  private async readMetadata(roomId: string): Promise<RoomMetadata> {
    const roomFolder = this.getRoomFolder(roomId);
    const metadataPath = path.join(roomFolder, 'room.json');

    try {
      const raw = await fs.readFile(metadataPath, 'utf8');
      const metadata = parseRoomMetadata(raw, roomId);
      const filesFolder = path.join(roomFolder, 'files');
      const filteredDocuments = metadata.documents.filter(entry => this.isSafeDocumentEntry(entry, filesFolder));
      if (filteredDocuments.length !== metadata.documents.length) {
        const sanitizedMetadata = {
          ...metadata,
          documents: filteredDocuments,
          lastUpdatedAt: Date.now()
        };
        await this.writeMetadata(roomId, sanitizedMetadata);
        return sanitizedMetadata;
      }
      return metadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return createDefaultRoomMetadata(roomId);
      }

      const corruptPath = `${metadataPath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try {
        await this.ensureDir(roomFolder);
        await fs.rename(metadataPath, corruptPath);
      } catch {
        // Keep the original error context below; quarantine is best effort.
      }

      logger.warn(`Invalid room metadata for ${roomId}; resetting metadata state.`);
      return createDefaultRoomMetadata(roomId);
    }
  }

  private async writeMetadata(roomId: string, metadata: RoomMetadata): Promise<void> {
    const roomFolder = this.getRoomFolder(roomId);
    await this.ensureDir(roomFolder);
    const metadataPath = path.join(roomFolder, 'room.json');
    await fs.writeFile(metadataPath, serializeRoomMetadata(metadata), 'utf8');
  }

  private async resolveFileName(folder: string, fileName: string): Promise<string> {
    const sanitized = sanitizeSharedFileName(fileName);
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

  private isSafeDocumentEntry(entry: RoomDocumentEntry, filesFolder: string): boolean {
    try {
      const localPath = vscode.Uri.parse(entry.localUri).fsPath;
      if (!localPath) {
        return false;
      }
      return isPathInside(filesFolder, localPath);
    } catch {
      return false;
    }
  }

  private async ensureDir(target: string): Promise<void> {
    await fs.mkdir(target, { recursive: true });
  }

  private async trimEventLog(roomFolder: string, maxEventLogBytes: number): Promise<void> {
    const logPath = path.join(roomFolder, 'events.log');
    try {
      const raw = await fs.readFile(logPath, 'utf8');
      const trimmed = trimEventLogContent(raw, maxEventLogBytes);
      if (trimmed !== raw) {
        await fs.writeFile(logPath, trimmed, 'utf8');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        logger.warn(`Failed to trim event log in ${roomFolder}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
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
