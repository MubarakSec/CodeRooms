import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startCodeRoomsServer, StartedCodeRoomsServer } from '../server/server';
import { LiveWsClient } from './harness/liveWsClient';
import * as Y from 'yjs';

describe('CodeRooms Shadow E2E Integration', () => {
  let server: StartedCodeRoomsServer;
  let url: string;

  beforeAll(async () => {
    // Start real server on a random port
    server = await startCodeRoomsServer({
      port: 0,
      host: '127.0.0.1',
      persistRooms: false,
      enableBackgroundTasks: false,
      installProcessHandlers: false,
      logToConsole: false
    });
    url = `ws://${server.host}:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it('verifies robustness: concurrent CRDT edits, session recovery, and security barriers', async () => {
    // 1. Setup: Owner creates a room
    const owner = await LiveWsClient.connect(url, 'Owner');
    owner.send({ type: 'createRoom', displayName: 'OwnerAlice', mode: 'team' });
    const roomCreated = await owner.waitForType('roomCreated');
    const { roomId, sessionToken } = roomCreated;
    const ownerSessionToken = sessionToken;
    await owner.waitForType('joinedRoom');

    // 2. Setup: Collaborator joins
    const collab = await LiveWsClient.connect(url, 'Collab');
    collab.send({ type: 'joinRoom', roomId, displayName: 'CollabBob' });
    const collabJoined = await collab.waitForType('joinedRoom');
    const collabUserId = collabJoined.userId;
    await owner.waitForType('participantJoined');

    // 3. Action: Owner enables direct edit for collaborator (it's off by default)
    owner.send({ type: 'setEditMode', userId: collabUserId, direct: true });
    await owner.waitForType('editModeUpdated');
    await collab.waitForType('editModeUpdated');

    // 4. Action: Share a document
    owner.send({
      type: 'shareDocument',
      roomId,
      docId: 'doc-1',
      originalUri: 'file:///test.ts',
      fileName: 'test.ts',
      languageId: 'typescript',
      text: 'initial content',
      version: 1
    });
    await collab.waitForType('shareDocument');
    await owner.waitForMessage(m => m.type === 'ack');

    // 5. Robustness Check: Concurrent CRDT edits
    // We simulate two users typing simultaneously. 
    // The server should broadcast both even if version numbers collide (our fix).
    const yDoc1 = new Y.Doc();
    const yDoc2 = new Y.Doc();
    yDoc1.getText('text').insert(0, 'initial content');
    yDoc2.getText('text').insert(0, 'initial content');

    // Perform local edits
    yDoc1.getText('text').insert(0, 'A');
    yDoc2.getText('text').insert(0, 'B');

    const update1 = Y.encodeStateAsUpdate(yDoc1);
    const update2 = Y.encodeStateAsUpdate(yDoc2);

    // Send simultaneous updates with SAME version (2)
    owner.send({
      type: 'docChange',
      roomId,
      docId: 'doc-1',
      version: 2,
      yjsUpdate: update1
    });
    collab.send({
      type: 'docChange',
      roomId,
      docId: 'doc-1',
      version: 2,
      yjsUpdate: update2
    });

    // Both should receive two broadcasts
    await owner.waitForType('docChangeBroadcast');
    await owner.waitForType('docChangeBroadcast');
    
    // 6. Security Check: Session Token Protection (IP Pinning)
    // Attacker connects from a different IP
    const attacker = await LiveWsClient.connect(url, 'Attacker', { 'x-forwarded-for': '1.2.3.4' });
    attacker.send({
      type: 'joinRoom',
      roomId,
      displayName: 'Attacker',
      sessionToken: ownerSessionToken
    });
    
    const attackerJoined = await attacker.waitForType('joinedRoom');
    // FIX verified: attacker should NOT be root because they are on a different IP
    expect(attackerJoined.role).not.toBe('root');
    expect(attackerJoined.role).toBe('collaborator');

    // 7. Robustness Check: Session Recovery
    // Owner disconnects and reconnects with their token
    await owner.disconnect();
    const ownerRecovered = await LiveWsClient.connect(url, 'OwnerRecovered');
    ownerRecovered.send({
      type: 'joinRoom',
      roomId,
      displayName: 'OwnerAlice',
      sessionToken: ownerSessionToken
    });

    const recoveredJoined = await ownerRecovered.waitForType('joinedRoom');
    expect(recoveredJoined.role).toBe('root');
    expect(recoveredJoined.reclaimedSession).toBe(true);

    // Cleanup
    await collab.disconnect();
    await attacker.disconnect();
    await ownerRecovered.disconnect();
  });
});
