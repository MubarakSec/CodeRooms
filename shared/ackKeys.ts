import { ClientToServerMessage } from './protocol';

export function getClientMessageAckKey(message: ClientToServerMessage): string | undefined {
  switch (message.type) {
    case 'chatSend':
      return `chat:${message.messageId}`;
    case 'docChange':
      return `doc:${message.docId}:${message.version}`;
    case 'suggestion':
      return `suggest:${message.suggestionId}`;
    case 'acceptSuggestion':
    case 'rejectSuggestion':
      return `suggest:${message.suggestionId}`;
    case 'shareDocument':
      return `share:${message.docId}`;
    case 'unshareDocument':
      return `unshare:${message.documentId}`;
    case 'fullDocumentSync':
      return `full:${message.docId}:${message.version}`;
    case 'requestFullSync':
      return `reqfull:${message.docId}`;
    default:
      return undefined;
  }
}
