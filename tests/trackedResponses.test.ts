import { describe, expect, it } from 'vitest';
import { buildTrackedErrorResponses } from '../server/trackedResponses';

describe('tracked error responses', () => {
  it('returns both an error and an ack for tracked client messages', () => {
    const responses = buildTrackedErrorResponses(
      {
        type: 'chatSend',
        roomId: 'ROOM1',
        messageId: 'msg-1',
        content: '',
        timestamp: 1
      },
      'Message cannot be empty.',
      'MESSAGE_EMPTY'
    );

    expect(responses).toEqual([
      { type: 'error', message: 'Message cannot be empty.', code: 'MESSAGE_EMPTY' },
      { type: 'ack', key: 'chat:msg-1' }
    ]);
  });

  it('returns only an error for untracked client messages', () => {
    const responses = buildTrackedErrorResponses(
      {
        type: 'createToken',
        label: 'Pairing'
      },
      'Only the room owner can generate invite tokens.',
      'FORBIDDEN'
    );

    expect(responses).toEqual([
      { type: 'error', message: 'Only the room owner can generate invite tokens.', code: 'FORBIDDEN' }
    ]);
  });
});
