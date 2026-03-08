import { Role } from '../connection/MessageTypes';

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
