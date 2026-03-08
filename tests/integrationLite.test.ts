import { describe, it, expect } from 'vitest';
import type { ClientToServerMessage } from '../src/connection/MessageTypes';
import { getClientMessageAckKey } from '../shared/ackKeys';

class FakeSocket {
  sent: ClientToServerMessage[] = [];
  send(msg: ClientToServerMessage) {
    this.sent.push(msg);
  }
}

describe('Integration-lite: offline -> reconnect resend with dedup', () => {
  it('queues offline messages, resends once on reconnect, and ignores duplicates', () => {
    const pendingAck = new Map<string, ClientToServerMessage>();
    const pendingOffline: ClientToServerMessage[] = [];
    const socket = new FakeSocket();

    const flushPending = () => {
      for (const [, msg] of pendingAck) {
        socket.send(msg);
      }
      while (pendingOffline.length) {
        const next = pendingOffline.shift();
        if (next) {
          const key = getClientMessageAckKey(next);
          if (key && pendingAck.has(key)) {
            continue;
          }
          if (key) {
            pendingAck.set(key, next);
          }
          socket.send(next);
        }
      }
    };

    const share: ClientToServerMessage = {
      type: 'shareDocument',
      roomId: 'r',
      docId: 'd1',
      originalUri: 'uri',
      fileName: 'file.txt',
      languageId: 'txt',
      text: 'hello',
      version: 1
    };
    const change: ClientToServerMessage = {
      type: 'docChange',
      roomId: 'r',
      docId: 'd1',
      version: 2,
      patch: {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        text: 'x'
      }
    };

    // offline: enqueue share and duplicate docChange
    pendingOffline.push(share, change, change);
    pendingAck.set(getClientMessageAckKey(change)!, change);

    flushPending();

    expect(socket.sent.length).toBe(2); // share + one docChange
    expect(new Set(socket.sent.map(s => s.type))).toEqual(new Set(['shareDocument', 'docChange']));
    expect(pendingAck.size).toBe(2);
  });
});
