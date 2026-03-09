import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../src/core/ChatManager';
import { buildChatRenderPlan, chunkChatMessages } from '../src/ui/chatRenderPlan';

function message(messageId: string): ChatMessage {
  return {
    messageId,
    fromUserId: 'user-1',
    fromName: 'Alice',
    role: 'collaborator',
    content: `message:${messageId}`,
    timestamp: 1
  };
}

describe('chat render plan', () => {
  it('appends only new messages when the previous list is a prefix', () => {
    const plan = buildChatRenderPlan(
      ['m1', 'm2'],
      [message('m1'), message('m2'), message('m3')]
    );

    expect(plan.append).toBe(true);
    expect(plan.messages.map(entry => entry.messageId)).toEqual(['m3']);
    expect(plan.messageIds).toEqual(['m1', 'm2', 'm3']);
  });

  it('falls back to full render when the history changes or shrinks', () => {
    const changedPlan = buildChatRenderPlan(
      ['m1', 'm2'],
      [message('m1'), message('m9')]
    );
    const clearedPlan = buildChatRenderPlan(['m1'], []);

    expect(changedPlan.append).toBe(false);
    expect(changedPlan.messages.map(entry => entry.messageId)).toEqual(['m1', 'm9']);
    expect(clearedPlan.append).toBe(false);
    expect(clearedPlan.dropHeadCount).toBe(0);
    expect(clearedPlan.messages).toEqual([]);
  });

  it('drops the head and appends only the new tail when the message window slides', () => {
    const plan = buildChatRenderPlan(
      ['m1', 'm2', 'm3'],
      [message('m2'), message('m3'), message('m4')]
    );

    expect(plan.append).toBe(true);
    expect(plan.dropHeadCount).toBe(1);
    expect(plan.messages.map(entry => entry.messageId)).toEqual(['m4']);
  });

  it('chunks large message sets into fixed-size slices', () => {
    const chunks = chunkChatMessages(
      [message('m1'), message('m2'), message('m3'), message('m4'), message('m5')],
      2
    );

    expect(chunks).toHaveLength(3);
    expect(chunks[0].map(entry => entry.messageId)).toEqual(['m1', 'm2']);
    expect(chunks[1].map(entry => entry.messageId)).toEqual(['m3', 'm4']);
    expect(chunks[2].map(entry => entry.messageId)).toEqual(['m5']);
  });
});
