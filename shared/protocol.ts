export type Role = "root" | "collaborator" | "viewer";
export type RoomMode = "team" | "classroom";

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

// For Yjs + E2EE, updates are pure binary Uint8Arrays
export type YjsUpdate = Uint8Array;

export type SuggestionReviewAction = "accept" | "reject";

export interface Suggestion {
  suggestionId: string;
  roomId: string;
  docId: string;
  authorId: string;
  authorName: string;
  patches: TextPatch[];
  yjsUpdate?: YjsUpdate; // Optional for backward compatibility during migration
  createdAt: number;
  status: "pending" | "accepted" | "rejected";
  reviewedAt?: number;
  reviewedById?: string;
}

export type ClientToServerMessage =
  | { type: "createRoom"; displayName: string; mode: RoomMode; secret?: string }
  | { type: "joinRoom"; roomId: string; displayName: string; secret?: string; token?: string; sessionToken?: string }
  | { type: "leaveRoom" }
  | { type: "removeParticipant"; userId: string }
  | { type: "updateRole"; userId: string; role: "collaborator" | "viewer" }
  | { type: "shareDocument"; roomId: string; docId: string; originalUri: string; fileName: string; languageId: string; text: string; version: number; yjsState?: YjsUpdate }
  | { type: "unshareDocument"; roomId: string; documentId: string }
  | { type: "docChange"; roomId: string; docId: string; version: number; patch: TextPatch; yjsUpdate?: YjsUpdate }
  | { type: "suggestion"; roomId: string; docId: string; suggestionId: string; patches: TextPatch[]; yjsUpdate?: YjsUpdate; authorId: string; authorName: string; createdAt: number }
  | { type: "acceptSuggestion"; roomId: string; suggestionId: string }
  | { type: "rejectSuggestion"; roomId: string; suggestionId: string }
  | { type: "reviewSuggestions"; roomId: string; suggestionIds: string[]; action: SuggestionReviewAction }
  | { type: "setEditMode"; userId: string; direct: boolean }
  | { type: "requestFullSync"; roomId: string; docId: string }
  | { type: "fullDocumentSync"; roomId: string; docId: string; text: string; version: number; yjsState?: YjsUpdate }
  | { type: "rootCursor"; roomId: string; docId: string; uri: string; position: Position }
  | { type: "cursorUpdate"; roomId: string; userId?: string; userName?: string; docId: string; uri: string; position: Position; selections?: { start: Position; end: Position }[] }
  | { type: "participantActivity"; roomId: string; userId: string; activity: "typing" | "idle"; at: number }
  | { type: "chatSend"; roomId: string; messageId: string; content: string; timestamp: number }
  | { type: "awarenessUpdate"; roomId: string; docId: string; update: Uint8Array }
  | { type: "voiceSignal"; roomId: string; targetUserId: string; signal: any }
  | { type: "voiceJoin"; roomId: string; userId: string; token: string }
  | { type: "voiceActivity"; roomId: string; userId: string; talking: boolean }
  | { type: "voiceMute"; roomId: string; userId: string; muted: boolean }
  | { type: "createToken"; label?: string };

export type ServerToClientMessage =
  | { type: "ack"; key: string }
  | { type: "roomCreated"; roomId: string; userId: string; mode: RoomMode; sessionToken: string }
  | { type: "joinedRoom"; roomId: string; userId: string; role: Role; participants: Participant[]; mode: RoomMode; sessionToken: string }
  | { type: "syncSuggestions"; suggestions: Suggestion[] }
  | { type: "participantJoined"; participant: Participant }
  | { type: "participantLeft"; userId: string }
  | { type: "roleUpdated"; userId: string; role: Role }
  | { type: "editModeUpdated"; userId: string; isDirectEditMode: boolean }
  | { type: "shareDocument"; roomId: string; docId: string; originalUri: string; fileName: string; languageId: string; text?: string; version: number; yjsState?: YjsUpdate }
  | { type: "documentUnshared"; roomId: string; documentId: string }
  | { type: "docChangeBroadcast"; docId: string; version: number; patch?: TextPatch; yjsUpdate?: YjsUpdate; authorId: string }
  | { type: "awarenessUpdate"; docId: string; update: Uint8Array }
  | { type: "voiceSignal"; fromUserId: string; signal: any }
  | { type: "voiceActivity"; roomId: string; userId: string; talking: boolean }
  | { type: "voiceMute"; userId: string; muted: boolean }
  | { type: "fullDocumentSync"; roomId: string; docId: string; version: number; text?: string; yjsState?: YjsUpdate }
  | { type: "requestFullSync"; roomId: string; docId: string }
  | { type: "newSuggestion"; suggestion: Suggestion }
  | { type: "suggestionAccepted"; suggestionId: string; docId: string }
  | { type: "suggestionRejected"; suggestionId: string; docId: string }
  | {
      type: "suggestionsReviewed";
      roomId: string;
      action: SuggestionReviewAction;
      requestedCount: number;
      reviewedCount: number;
      alreadyReviewedCount: number;
      conflictCount: number;
      missingCount: number;
    }
  | { type: "rootCursor"; roomId: string; docId: string; uri: string; position: Position }
  | { type: "cursorUpdate"; roomId: string; userId?: string; userName?: string; docId: string; uri: string; position: Position; selections?: { start: Position; end: Position }[] }
  | { type: "participantActivity"; roomId: string; userId: string; activity: "typing" | "idle"; at: number }
  | {
      type: "chatMessage";
      roomId: string;
      messageId: string;
      fromUserId: string;
      fromName: string;
      role: Role;
      content: string;
      timestamp: number;
      isSystem?: boolean;
    }
  | { type: "error"; message: string; code?: string }
  | { type: "tokenCreated"; token: string; label?: string };
