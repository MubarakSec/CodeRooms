import { Role, SuggestionReviewAction } from '../connection/MessageTypes';

const ENCRYPTION_NOTICE = '🔒 **E2E Encryption active.** Chat messages are end-to-end encrypted with your room secret. Share the Room ID and secret separately.';

export function getEncryptionNotice(): string {
  return ENCRYPTION_NOTICE;
}

export function buildWelcomeMessage(role: Role, encrypted: boolean): string {
  let welcomeText = `\`\`\n👋 Welcome to the CodeRoom! You joined as a ${role}.\n\`\`\n`;

  if (role === 'collaborator') {
    welcomeText += '✏️ **Suggest Mode:** By default, edits you make turn into inline suggestions for the room owner to approve!\n';
    welcomeText += '🖊️ **Direct Edit:** To bypass suggestions and type directly, click the pencil icon in the People panel or toggle the "Suggest" Status Bar item.';
  } else if (role === 'viewer') {
    welcomeText += '👁️ **Read Only:** You are currently in read-only mode.';
  } else {
    welcomeText += '🏠 **Owner:** You are the room owner. To share files, open a document and click the "Share Document" icon in the top right window menu, or right click it in the explorer!';
  }

  if (encrypted) {
    welcomeText += '\n🔒 **E2E Encryption active.** Chat is end-to-end encrypted with your room secret.';
  }

  return welcomeText;
}

export function getJoinAccessDeniedNotice(): string {
  return 'Unable to join room. Check the invite code, secret, or token and try again.';
}

export function getJoinAccessRetryActionLabel(): string {
  return 'Retry with secret or token';
}

export function getDocumentResyncNotice(): string {
  return 'Resyncing shared file due to patch mismatch.';
}

export function getOwnerUnavailableNotice(): string {
  return 'The room owner is unavailable right now, so the file cannot resync yet.';
}

export function getRoomStateInvalidNotice(): string {
  return 'This action no longer matches the active room state. Retry after rejoining or reopening the shared file.';
}

export function getRoomClosedNotice(): string {
  return 'The room has been closed by the owner.';
}

export function getReconnectFailureNotice(): string {
  return 'CodeRooms: unable to reconnect to the server after multiple attempts.';
}

export function buildSuggestionReviewSummary(args: {
  action: SuggestionReviewAction;
  reviewedCount: number;
  alreadyReviewedCount: number;
  conflictCount: number;
  missingCount: number;
}): string {
  const actionLabel = args.action === 'accept' ? 'Accepted' : 'Rejected';
  const parts = [`${actionLabel} ${args.reviewedCount} suggestion${args.reviewedCount === 1 ? '' : 's'}`];

  if (args.alreadyReviewedCount > 0) {
    parts.push(`${args.alreadyReviewedCount} already reviewed`);
  }
  if (args.conflictCount > 0) {
    parts.push(`${args.conflictCount} conflicted`);
  }
  if (args.missingCount > 0) {
    parts.push(`${args.missingCount} missing`);
  }

  return parts.join(' · ');
}
