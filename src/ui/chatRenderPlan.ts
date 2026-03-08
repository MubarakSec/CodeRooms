import { ChatMessage } from '../core/ChatManager';

export interface ChatRenderPlan {
  append: boolean;
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
      messages: nextMessages.slice(previousMessageIds.length),
      messageIds: nextMessageIds
    };
  }

  return {
    append: false,
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
