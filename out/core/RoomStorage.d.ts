import * as vscode from 'vscode';
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
export declare class RoomStorage {
    private readonly roomsRoot;
    constructor(storageUri: vscode.Uri);
    prepare(): Promise<void>;
    registerDocument(roomId: string, docId: string, fileName: string, originalUri: string, text: string, version: number): Promise<{
        uri: vscode.Uri;
        entry: RoomDocumentEntry;
    }>;
    updateVersion(roomId: string, docId: string, version: number): Promise<void>;
    getEntry(roomId: string, docId: string): Promise<RoomDocumentEntry | undefined>;
    clearRoom(roomId: string): Promise<void>;
    recordRoomInfo(roomId: string, mode: RoomMode): Promise<void>;
    appendEvent(roomId: string, event: RoomEvent): Promise<void>;
    getRoomFolder(roomId: string): string;
    private ensureRoomFolders;
    private readMetadata;
    private writeMetadata;
    private resolveFileName;
    private ensureDir;
    private exists;
}
