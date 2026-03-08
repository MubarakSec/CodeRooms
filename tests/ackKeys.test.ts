import { describe, it, expect } from 'vitest';
import { getClientMessageAckKey } from '../shared/ackKeys';
import type { ClientToServerMessage } from '../src/connection/MessageTypes';

describe('client message ack keys', () => {
  it('matches each tracked outbound message type', () => {
    const trackedMessages: ClientToServerMessage[] = [
      {
        type: 'shareDocument',
        roomId: 'room1',
        docId: 'doc1',
        originalUri: 'file:///tmp/doc1',
        fileName: 'doc1.ts',
        languageId: 'typescript',
        text: 'hello',
        version: 1
      },
      {
        type: 'docChange',
        roomId: 'room1',
        docId: 'doc1',
        version: 2,
        patch: {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          text: 'x'
        }
      },
      {
        type: 'suggestion',
        roomId: 'room1',
        docId: 'doc1',
        suggestionId: 's1',
        patches: [],
        authorId: 'u1',
        authorName: 'User',
        createdAt: 1
      },
      {
        type: 'acceptSuggestion',
        roomId: 'room1',
        suggestionId: 's1'
      },
      {
        type: 'unshareDocument',
        roomId: 'room1',
        documentId: 'doc1'
      },
      {
        type: 'requestFullSync',
        roomId: 'room1',
        docId: 'doc1'
      },
      {
        type: 'fullDocumentSync',
        roomId: 'room1',
        docId: 'doc1',
        text: 'hello',
        version: 3
      }
    ];

    expect(trackedMessages.map(message => getClientMessageAckKey(message))).toEqual([
      'share:doc1',
      'doc:doc1:2',
      'suggest:s1',
      'suggest:s1',
      'unshare:doc1',
      'reqfull:doc1',
      'full:doc1:3'
    ]);
  });

  it('clears pending doc changes by the original sent version, not by rebroadcast version', () => {
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

    const pendingAck = new Map([[getClientMessageAckKey(change)!, change]]);
    pendingAck.delete('doc:doc1:3');
    expect(pendingAck.size).toBe(1);

    pendingAck.delete(getClientMessageAckKey(change)!);
    expect(pendingAck.size).toBe(0);
  });
});
