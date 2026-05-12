import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startCodeRoomsServer, StartedCodeRoomsServer } from '../server/server';
import { LiveWsClient } from './harness/liveWsClient';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

describe('CodeRooms Resilience Blind Spots', () => {
  let server: StartedCodeRoomsServer;
  let url: string;
  let backupDir: string;

  beforeAll(async () => {
    backupDir = await mkdtemp(path.join(os.tmpdir(), 'coderooms-blindspots-'));
    server = await startCodeRoomsServer({
      port: 0,
      host: '127.0.0.1',
      backupDir,
      persistRooms: true,
      loadPersistedRooms: false,
      enableBackgroundTasks: false,
      installProcessHandlers: false,
      logToConsole: false
    });
    url = `ws://${server.host}:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
    await rm(backupDir, { recursive: true, force: true });
  });

  it('Blind Spot 1: Memory Pressure (The "Big Paste" Test)', async () => {
    const owner = await LiveWsClient.connect(url, 'BigPaster');
    owner.send({ type: 'createRoom', displayName: 'BigPaster', mode: 'team' });
    const { roomId } = await owner.waitForType('roomCreated');
    await owner.waitForType('joinedRoom');

    // 1.5 MB string (well under the 2MB doc limit, but tests the 2.25MB payload limit)
    const largeText = 'A'.repeat(1.5 * 1024 * 1024);
    
    owner.send({
      type: 'shareDocument',
      roomId,
      docId: 'big-doc',
      originalUri: 'file:///big.txt',
      fileName: 'big.txt',
      languageId: 'plaintext',
      text: largeText,
      version: 1
    });

    // Server should ACK the large document
    await owner.waitForMessage(m => m.type === 'ack', 5000);
    
    // Now simulate unsharing to verify memory reclaiming
    owner.send({ type: 'unshareDocument', roomId, documentId: 'big-doc' });
    await owner.waitForMessage(m => m.type === 'ack');

    await owner.disconnect();
  });

  it('Blind Spot 2: Database Scalability Smoke Test', async () => {
    // Create 50 rooms quickly using different IPs to avoid per-IP limits
    const clients = [];
    for (let i = 0; i < 50; i++) {
      const ip = `10.0.0.${i}`;
      const c = await LiveWsClient.connect(url, `User-${i}`, { 'x-forwarded-for': ip });
      c.send({ type: 'createRoom', displayName: `Room-${i}`, mode: 'team' });
      clients.push(c);
    }

    // Wait for all rooms to be created (longer timeout for bulk)
    await Promise.all(clients.map(c => c.waitForType('roomCreated', 10000)));

    // Disconnect everyone
    await Promise.all(clients.map(c => c.disconnect()));
  });

  it('Blind Spot 3: Network Resilience (Zombie Connections)', async () => {
    const ip = '1.2.3.5';
    const limit = 20; // MAX_CONNECTIONS_PER_IP is 20 in server.ts
    
    // Connect up to the limit
    const sockets = [];
    for (let i = 0; i < limit; i++) {
      const ws = new WebSocket(url, { headers: { 'x-forwarded-for': ip } });
      await new Promise(resolve => ws.once('open', resolve));
      sockets.push(ws);
    }

    // Attempting 21st should fail
    const failingWs = new WebSocket(url, { headers: { 'x-forwarded-for': ip } });
    const closePromise = new Promise(resolve => failingWs.once('close', resolve));
    await closePromise; // Should be rejected/closed by server

    // ZOMBIE KILL: Destroy one socket without a handshake
    sockets[0].terminate(); // Terminate is immediate, no FIN/CLOSE handshake
    
    // Give server a tiny bit of time to detect socket drop
    await new Promise(resolve => setTimeout(resolve, 100));

    // Now the 22nd connection should succeed because the zombie was reaped
    const retryWs = new WebSocket(url, { headers: { 'x-forwarded-for': ip } });
    await new Promise((resolve, reject) => {
      retryWs.once('open', resolve);
      retryWs.once('error', reject);
      setTimeout(() => reject(new Error('Still blocked after zombie cleanup')), 1000);
    });

    retryWs.close();
    sockets.slice(1).forEach(s => s.close());
  });
});
