import { ChatMessage } from '../core/ChatManager';

export interface ChatRenderPlan {
  append: boolean;
  dropHeadCount: number;
  messages: ChatMessage[];
  messageIds: string[];
}

export function buildChatRenderPlan(previousMessageIds: string[], nextMessages: ChatMessage[]): ChatRenderPlan {
  const nextMessageIds = nextMessages.map(message => message.messageId);
  const isPrefixMatch = previousMessageIds.length > 0
    && nextMessageIds.length >= previousMessageIds.length
    && previousMessageIds.every((messageId, index) => nextMessageIds[index] === messageId);

  if (isPrefixMatch) {
    return {
      append: true,
      dropHeadCount: 0,
      messages: nextMessages.slice(previousMessageIds.length),
      messageIds: nextMessageIds
    };
  }

  const overlapCount = findSuffixPrefixOverlap(previousMessageIds, nextMessageIds);
  if (overlapCount > 0) {
    return {
      append: true,
      dropHeadCount: previousMessageIds.length - overlapCount,
      messages: nextMessages.slice(overlapCount),
      messageIds: nextMessageIds
    };
  }

  return {
    append: false,
    dropHeadCount: 0,
    messages: nextMessages,
    messageIds: nextMessageIds
  };
}

export function chunkChatMessages(messages: ChatMessage[], chunkSize: number): ChatMessage[][] {
  if (chunkSize <= 0) {
    return [messages];
  }

  const chunks: ChatMessage[][] = [];
  for (let index = 0; index < messages.length; index += chunkSize) {
    chunks.push(messages.slice(index, index + chunkSize));
  }
  return chunks;
}

function findSuffixPrefixOverlap(previousMessageIds: string[], nextMessageIds: string[]): number {
  const maxOverlap = Math.min(previousMessageIds.length, nextMessageIds.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const previousStart = previousMessageIds.length - overlap;
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      if (previousMessageIds[previousStart + index] !== nextMessageIds[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return overlap;
    }
  }
  return 0;
}
