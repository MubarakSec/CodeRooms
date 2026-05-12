import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startCodeRoomsServer, StartedCodeRoomsServer } from '../server/server';
import { WebSocket } from 'ws';
import { pack, unpack } from 'msgpackr';

describe('Voice Activity Integration', () => {
  let server: StartedCodeRoomsServer;
  const port = 5173;
  const host = '127.0.0.1';

  beforeEach(async () => {
    server = await startCodeRoomsServer({
      port,
      host,
      persistRooms: false,
      loadPersistedRooms: false,
      enableBackgroundTasks: false,
      installProcessHandlers: false
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it('broadcasts voiceActivity to other participants', async () => {
    const ws1 = new WebSocket(`ws://${host}:${port}`);
    const ws2 = new WebSocket(`ws://${host}:${port}`);

    await Promise.all([
      new Promise(resolve => ws1.on('open', resolve)),
      new Promise(resolve => ws2.on('open', resolve))
    ]);

    const messages1: any[] = [];
    ws1.on('message', (data) => {
      const msg = unpack(data as Buffer);
      console.log('WS1 received:', msg.type);
      messages1.push(msg);
    });

    const messages2: any[] = [];
    ws2.on('message', (data) => {
      const msg = unpack(data as Buffer);
      console.log('WS2 received:', msg.type);
      messages2.push(msg);
    });

    const waitForMessage = async (msgs: any[], type: string, timeout = 2000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const msg = msgs.find(m => m.type === type);
        if (msg) return msg;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out waiting for message ${type}`);
    };

    // Create room with client 1
    ws1.send(pack({ type: 'createRoom', displayName: 'Alice', mode: 'team' }));
    const roomCreated = await waitForMessage(messages1, 'roomCreated');
    const roomId = roomCreated.roomId;
    
    // Join room with client 2
    ws2.send(pack({ type: 'joinRoom', roomId, displayName: 'Bob' }));
    const joinedRoom2 = await waitForMessage(messages2, 'joinedRoom');
    const userId2 = joinedRoom2.userId;

    // Send voiceActivity from client 2
    ws2.send(pack({ type: 'voiceActivity', roomId, userId: userId2, talking: true }));

    // Client 1 should receive voiceActivity
    const voiceActivityMsg = await waitForMessage(messages1, 'voiceActivity');

    expect(voiceActivityMsg).toEqual({
      type: 'voiceActivity',
      roomId,
      userId: userId2,
      talking: true
    });

    ws1.close();
    ws2.close();
  });
});
