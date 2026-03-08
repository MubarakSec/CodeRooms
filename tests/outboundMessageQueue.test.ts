import { describe, it, expect } from 'vitest';
import { OutboundMessageQueue } from '../src/core/OutboundMessageQueue';
import type { ClientToServerMessage } from '../src/connection/MessageTypes';

describe('OutboundMessageQueue', () => {
  it('replays tracked messages until they are acknowledged', () => {
    const sent: ClientToServerMessage[] = [];
    const queue = new OutboundMessageQueue(message => sent.push(message), 10);
    const change: ClientToServerMessage = {
      type: 'docChange',
      roomId: 'room1',
      docId: 'doc1',
      version: 2,
      patch: {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        text: 'x'
      }
    };

    queue.send(change, false);
    expect(sent).toHaveLength(0);

    queue.flush(true);
    expect(sent).toEqual([change]);

    queue.acknowledge('doc:doc1:2');
    queue.flush(true);
    expect(sent).toEqual([change]);
  });

  it('deduplicates offline messages that are already pending acknowledgement', () => {
    const sent: ClientToServerMessage[] = [];
    const queue = new OutboundMessageQueue(message => sent.push(message), 10);
    const message: ClientToServerMessage = {
      type: 'suggestion',
      roomId: 'room1',
      docId: 'doc1',
      suggestionId: 's1',
      patches: [],
      authorId: 'u1',
      authorName: 'User',
      createdAt: 1
    };

    queue.send(message, false);
    queue.send(message, false);
    queue.flush(true);

    expect(sent).toEqual([message]);
  });
});
