import { afterEach, describe, expect, it } from 'vitest';

import { startCodeRoomsServer, stopCodeRoomsServer } from '../server/server';
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

async function joinRoom(url: string, roomId: string, displayName: string) {
  const client = await connectClient(url, displayName);
  client.send({ type: 'joinRoom', roomId, displayName });
  const joinedRoom = await client.waitForType('joinedRoom');
  return { client, joinedRoom };
}

describe.sequential('participant removal', () => {
  afterEach(async () => {
    await stopCodeRoomsServer().catch(() => undefined);
  });

  it('removes the target participant without forcing a reconnect', async () => {
    const server = await startCodeRoomsServer({
      port: 0,
      host: '127.0.0.1',
      persistRooms: false,
      loadPersistedRooms: false,
      enableBackgroundTasks: false,
      installProcessHandlers: false
    });
    const url = `ws://${server.host}:${server.port}`;

    const root = await createRoom(url, 'Root');
    const removed = await joinRoom(url, root.roomCreated.roomId, 'Casey');

    root.client.send({ type: 'removeParticipant', userId: removed.joinedRoom.userId });

    const removalError = await removed.client.waitForMessage(
      message => message.type === 'error' && message.code === 'REMOVED_FROM_ROOM'
    );
    expect(removalError.type).toBe('error');

    const participantLeft = await root.client.waitForMessage(
      message => message.type === 'participantLeft' && message.userId === removed.joinedRoom.userId
    );
    expect(participantLeft.type).toBe('participantLeft');

    const probe = await joinRoom(url, root.roomCreated.roomId, 'Probe');
    expect(
      new Set(probe.joinedRoom.participants.map(participant => participant.displayName))
    ).toEqual(new Set(['Root', 'Probe']));

    removed.client.send({ type: 'createRoom', displayName: 'Casey', mode: 'team' });
    const newRoom = await removed.client.waitForType('roomCreated');
    expect(newRoom.roomId).not.toBe(root.roomCreated.roomId);
  });
});
