export type Role = "root" | "collaborator" | "viewer";
export type RoomMode = "team" | "classroom";
export interface EncryptedPayload {
    iv: string;
    data: string;
    authTag: string;
}
export interface Participant {
    userId: string;
    displayName: string;
    role: Role;
    isDirectEditMode?: boolean;
}
export interface Position {
    line: number;
    character: number;
}
export interface TextPatch {
    range: {
        start: Position;
        end: Position;
    };
    text: string;
}
export interface Suggestion {
    suggestionId: string;
    roomId: string;
    docId: string;
    authorId: string;
    authorName: string;
    patches: TextPatch[];
    createdAt: number;
    status: "pending" | "accepted" | "rejected";
}
export type ClientToServerMessage = {
    type: "createRoom";
    displayName: string;
    mode: RoomMode;
    secret?: string;
} | {
    type: "joinRoom";
    roomId: string;
    displayName: string;
    secret?: string;
} | {
    type: "leaveRoom";
} | {
    type: "updateRole";
    userId: string;
    role: "collaborator" | "viewer";
} | {
    type: "shareDocument";
    roomId: string;
    docId: string;
    originalUri: string;
    fileName: string;
    languageId: string;
    text: string;
    version: number;
} | {
    type: "unshareDocument";
    roomId: string;
    documentId: string;
} | {
    type: "docChange";
    roomId: string;
    docId: string;
    version: number;
    patch: TextPatch;
} | {
    type: "suggestion";
    roomId: string;
    docId: string;
    suggestionId: string;
    patches: TextPatch[];
    authorId: string;
    authorName: string;
    createdAt: number;
} | {
    type: "acceptSuggestion";
    roomId: string;
    suggestionId: string;
} | {
    type: "rejectSuggestion";
    roomId: string;
    suggestionId: string;
} | {
    type: "setEditMode";
    userId: string;
    direct: boolean;
} | {
    type: "requestFullSync";
    roomId: string;
    docId: string;
} | {
    type: "fullDocumentSync";
    roomId: string;
    docId: string;
    text: string;
    version: number;
} | {
    type: "rootCursor";
    roomId: string;
    docId: string;
    uri: string;
    position: Position;
} | {
    type: "cursorUpdate";
    roomId: string;
    userId?: string;
    userName?: string;
    docId: string;
    uri: string;
    position: Position;
    selections?: {
        start: Position;
        end: Position;
    }[];
} | {
    type: "participantActivity";
    roomId: string;
    userId: string;
    activity: "typing" | "idle";
    at: number;
} | {
    type: "chatSend";
    roomId: string;
    messageId: string;
    content: string;
    timestamp: number;
};
export type ServerToClientMessage = {
    type: "roomCreated";
    roomId: string;
    userId: string;
    mode: RoomMode;
} | {
    type: "joinedRoom";
    roomId: string;
    userId: string;
    role: Role;
    participants: Participant[];
    mode: RoomMode;
} | {
    type: "participantJoined";
    participant: Participant;
} | {
    type: "participantLeft";
    userId: string;
} | {
    type: "roleUpdated";
    userId: string;
    role: Role;
} | {
    type: "editModeUpdated";
    userId: string;
    isDirectEditMode: boolean;
} | {
    type: "shareDocument";
    roomId: string;
    docId: string;
    originalUri: string;
    fileName: string;
    languageId: string;
    text: string;
    version: number;
} | {
    type: "documentUnshared";
    roomId: string;
    documentId: string;
} | {
    type: "docChangeBroadcast";
    docId: string;
    version: number;
    patch: TextPatch;
    authorId: string;
} | {
    type: "fullDocumentSync";
    roomId: string;
    docId: string;
    text: string;
    version: number;
} | {
    type: "requestFullSync";
    roomId: string;
    docId: string;
} | {
    type: "newSuggestion";
    suggestion: Suggestion;
} | {
    type: "suggestionAccepted";
    suggestionId: string;
    docId: string;
} | {
    type: "suggestionRejected";
    suggestionId: string;
    docId: string;
} | {
    type: "rootCursor";
    roomId: string;
    docId: string;
    uri: string;
    position: Position;
} | {
    type: "cursorUpdate";
    roomId: string;
    userId?: string;
    userName?: string;
    docId: string;
    uri: string;
    position: Position;
    selections?: {
        start: Position;
        end: Position;
    }[];
} | {
    type: "participantActivity";
    roomId: string;
    userId: string;
    activity: "typing" | "idle";
    at: number;
} | {
    type: "chatMessage";
    roomId: string;
    messageId: string;
    fromUserId: string;
    fromName: string;
    role: Role;
    content: string;
    timestamp: number;
    isSystem?: boolean;
} | {
    type: "error";
    message: string;
    code?: string;
};
