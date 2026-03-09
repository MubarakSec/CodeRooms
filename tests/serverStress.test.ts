import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/logger', () => ({
  log: vi.fn()
}));

import { startCodeRoomsServer, stopCodeRoomsServer } from '../server/server';
import { getClientMessageAckKey } from '../shared/ackKeys';
import type { ClientToServerMessage, Suggestion } from '../shared/protocol';
import { LiveWsClient } from './harness/liveWsClient';

async function connectClient(url: string, label: string): Promise<LiveWsClient> {
  return LiveWsClient.connect(url, label);
}

async function createRoom(url: string, displayName: string) {
  const client = await connectClient(url, `${displayName}-root`);
  client.send({ type: 'createRoom', displayName, mode: 'team' });
  const roomCreated = await client.waitForType('roomCreated');
  const joinedRoom = await client.waitForType('joinedRoom');
  return { client, roomCreated, joinedRoom };
}

async function joinRoom(
  url: string,
  roomId: string,
  displayName: string,
  sessionToken?: string
) {
  const client = await connectClient(url, displayName);
  client.send({ type: 'joinRoom', roomId, displayName, sessionToken });
  const joinedRoom = await client.waitForType('joinedRoom');
  return { client, joinedRoom };
}

async function waitForAck(client: LiveWsClient, message: ClientToServerMessage): Promise<void> {
  const key = getClientMessageAckKey(message);
  if (!key) {
    return;
  }
  await client.waitForMessage(candidate => candidate.type === 'ack' && candidate.key === key);
}

describe.sequential('CodeRooms server stress', () => {
  afterEach(async () => {
    await stopCodeRoomsServer().catch(() => undefined);
  });

  it('survives reconnect storms without leaving ghost participants behind', async () => {
    const server = await startCodeRoomsServer({
      port: 0,
      host: '127.0.0.1',
      persistRooms: false,
      loadPersistedRooms: false,
      enableBackgroundTasks: false,
      installProcessHandlers: false
    });
    const url = `ws://${server.host}:${server.port}`;
    const participantCount = 8;

    const root = await createRoom(url, 'Root');
    const roomId = root.roomCreated.roomId;

    let participants = await Promise.all(
      Array.from({ length: participantCount }, (_, index) => joinRoom(url, roomId, `User ${index + 1}`))
    );
    const participantSessions = participants.map(entry => ({
      displayName: entry.joinedRoom.participants.find(participant => participant.userId === entry.joinedRoom.userId)?.displayName ?? '',
      sessionToken: entry.joinedRoom.sessionToken
    }));

    for (let cycle = 1; cycle <= 3; cycle += 1) {
      await Promise.all(participants.map(entry => entry.client.disconnect()));

      participants = await Promise.all(
        participantSessions.map(entry => joinRoom(url, roomId, entry.displayName, entry.sessionToken))
      );

      const probe = await joinRoom(url, roomId, `Probe ${cycle}`);
      const participantNames = probe.joinedRoom.participants.map(participant => participant.displayName);
      const uniqueNames = new Set(participantNames);

      expect(uniqueNames.size).toBe(participantCount + 2);
      expect(uniqueNames.has('Root')).toBe(true);
      for (const entry of participantSessions) {
        expect(uniqueNames.has(entry.displayName)).toBe(true);
      }

      await probe.client.disconnect();
    }

    await root.client.disconnect();
  });

  it('restores documents and pending suggestions across repeated restart cycles', async () => {
    const backupDir = await mkdtemp(path.join(os.tmpdir(), 'coderooms-restart-'));
    try {
      let server = await startCodeRoomsServer({
        port: 0,
        host: '127.0.0.1',
        backupDir,
        persistRooms: true,
        loadPersistedRooms: false,
        enableBackgroundTasks: false,
        installProcessHandlers: false
      });

      let url = `ws://${server.host}:${server.port}`;
      const root = await createRoom(url, 'Root');
      const roomId = root.roomCreated.roomId;
      const rootSessionToken = root.joinedRoom.sessionToken;

      const collaborator = await joinRoom(url, roomId, 'Casey');
      const collaboratorSessionToken = collaborator.joinedRoom.sessionToken;
      const collaboratorUserId = collaborator.joinedRoom.userId;

      const setSuggestionMode: ClientToServerMessage = {
        type: 'setEditMode',
        userId: collaboratorUserId,
        direct: false
      };
      collaborator.client.send(setSuggestionMode);
      await root.client.waitForMessage(
        message => message.type === 'editModeUpdated' && message.userId === collaboratorUserId && message.isDirectEditMode === false
      );

      const shareDocument: ClientToServerMessage = {
        type: 'shareDocument',
        roomId,
        docId: 'doc-1',
        originalUri: 'file:///workspace/main.ts',
        fileName: 'main.ts',
        languageId: 'typescript',
        text: 'export const value = 1;\n',
        version: 1
      };
      root.client.send(shareDocument);
      await waitForAck(root.client, shareDocument);
      await collaborator.client.waitForMessage(
        message => message.type === 'shareDocument' && message.docId === 'doc-1'
      );

      const suggestionMessage: ClientToServerMessage = {
        type: 'suggestion',
        roomId,
        docId: 'doc-1',
        suggestionId: 'suggestion-1',
        authorId: collaboratorUserId,
        authorName: 'Casey',
        createdAt: Date.now(),
        patches: [{
          range: {
            start: { line: 0, character: 20 },
            end: { line: 0, character: 21 }
          },
          text: '2'
        }]
      };
      collaborator.client.send(suggestionMessage);
      await waitForAck(collaborator.client, suggestionMessage);
      const newSuggestion = await root.client.waitForType('newSuggestion');
      expect((newSuggestion.suggestion as Suggestion).suggestionId).toBe('suggestion-1');

      await stopCodeRoomsServer();
      await Promise.all([root.client.waitForClose(), collaborator.client.waitForClose()]);

      for (let cycle = 1; cycle <= 2; cycle += 1) {
        server = await startCodeRoomsServer({
          port: 0,
          host: '127.0.0.1',
          backupDir,
          persistRooms: true,
          loadPersistedRooms: true,
          enableBackgroundTasks: false,
          installProcessHandlers: false
        });
        url = `ws://${server.host}:${server.port}`;

        const rejoinedRoot = await joinRoom(url, roomId, 'Root', rootSessionToken);
        expect(rejoinedRoot.joinedRoom.role).toBe('root');

        const replayedDocument = await rejoinedRoot.client.waitForMessage(
          message => message.type === 'shareDocument' && message.docId === 'doc-1'
        ) as Extract<any, { type: 'shareDocument' }>;
        expect(replayedDocument.text).toBe('export const value = 1;\n');

        const replayedSuggestions = await rejoinedRoot.client.waitForType('syncSuggestions');
        expect(replayedSuggestions.suggestions.map(entry => entry.suggestionId)).toEqual(['suggestion-1']);

        const rejoinedCollaborator = await joinRoom(url, roomId, 'Casey', collaboratorSessionToken);
        expect(rejoinedCollaborator.joinedRoom.role).toBe('collaborator');
        expect(
          new Set(rejoinedCollaborator.joinedRoom.participants.map(participant => participant.displayName))
        ).toEqual(new Set(['Root', 'Casey']));

        await stopCodeRoomsServer();
        await Promise.all([rejoinedRoot.client.waitForClose(), rejoinedCollaborator.client.waitForClose()]);
      }
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });
});
