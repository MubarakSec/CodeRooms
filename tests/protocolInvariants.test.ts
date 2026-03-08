import { afterEach, describe, expect, it } from 'vitest';
import { getClientMessageAckKey } from '../shared/ackKeys';
import {
  canPerformOwnerAction,
  canSendChat
} from '../server/authorization';
import { getRoomInvariantViolations } from '../server/roomInvariants';
import { createRoomOperationGuards, getJoinClaimKey } from '../server/roomOperationGuards';
import {
  createOwnerParticipant,
  getRestoredOwnerId,
  resolveJoinParticipant,
  toPublicParticipant,
  toRecoverableParticipant,
  type ParticipantState,
  type RecoverableParticipantState
} from '../server/roomSessions';
import { prepareRoomClosure } from '../server/roomClosure';
import { buildTrackedErrorResponses } from '../server/trackedResponses';
import type { ClientToServerMessage, Role, RoomMode } from '../shared/protocol';
import { HarnessClient, MultiClientHarness } from './harness/multiClientHarness';

interface ProtocolRoomConnection {
  userId: string;
  roomId?: string;
  role?: Role;
  sessionToken?: string;
  ws: { close(): void };
}

interface ProtocolRoomState {
  roomId: string;
  ownerId: string;
  ownerSessionToken: string;
  mode: RoomMode;
  participants: Map<string, ParticipantState>;
  recoverableSessions: Map<string, RecoverableParticipantState>;
  connections: Map<string, ProtocolRoomConnection>;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForTerminalJoinMessage(client: HarnessClient) {
  return client.waitForMessage(
    message => message.type === 'joinedRoom' || message.type === 'error',
    1_500
  );
}

async function createProtocolHarness(joinDelayMs = 0): Promise<{
  harness: MultiClientHarness;
  snapshotRoom(): ProtocolRoomState | undefined;
}> {
  const guards = createRoomOperationGuards();
  const connections = new Map<string, ProtocolRoomConnection>();
  let room: ProtocolRoomState | undefined;

  const harness = await MultiClientHarness.create({
    onConnection(peer) {
      connections.set(peer.id, {
        userId: peer.id,
        ws: {
          close: () => peer.close()
        }
      });
    },
    async onMessage(peer, message, helpers) {
      const connection = connections.get(peer.id);
      if (!connection) {
        return;
      }

      switch (message.type) {
        case 'createRoom': {
          const owner = createOwnerParticipant(peer.id, message.displayName);
          room = {
            roomId: 'ROOM1',
            ownerId: owner.userId,
            ownerSessionToken: owner.sessionToken,
            mode: message.mode,
            participants: new Map([[owner.userId, owner]]),
            recoverableSessions: new Map([[owner.sessionToken, toRecoverableParticipant(owner)]]),
            connections: new Map([[owner.userId, connection]])
          };
          connection.roomId = room.roomId;
          connection.role = owner.role;
          connection.sessionToken = owner.sessionToken;
          helpers.send(peer, {
            type: 'roomCreated',
            roomId: room.roomId,
            userId: owner.userId,
            mode: room.mode,
            sessionToken: owner.sessionToken
          });
          return;
        }

        case 'joinRoom': {
          if (!room || room.roomId !== message.roomId) {
            helpers.send(peer, { type: 'error', message: 'Room not found.', code: 'ROOM_NOT_FOUND' });
            return;
          }

          const claimKey = getJoinClaimKey({
            sessionToken: message.sessionToken,
            connectionId: peer.id
          });

          if (!guards.beginJoinClaim(room.roomId, claimKey)) {
            helpers.send(peer, {
              type: 'error',
              message: 'A join for this session is already in progress.',
              code: 'ROOM_OPERATION_IN_PROGRESS'
            });
            return;
          }

          try {
            if (joinDelayMs > 0) {
              await delay(joinDelayMs);
            }

            const resolved = resolveJoinParticipant({
              userId: peer.id,
              displayName: message.displayName,
              mode: room.mode,
              activeParticipantCount: room.participants.size,
              ownerSessionToken: room.ownerSessionToken,
              activeParticipants: room.participants.values(),
              recoverableSessions: room.recoverableSessions,
              requestedSessionToken: message.sessionToken
            });

            if (resolved.previousUserId && resolved.previousUserId !== peer.id) {
              room.participants.delete(resolved.previousUserId);
              const previousConnection = room.connections.get(resolved.previousUserId);
              if (previousConnection) {
                previousConnection.roomId = undefined;
                previousConnection.role = undefined;
                previousConnection.sessionToken = undefined;
              }
              room.connections.delete(resolved.previousUserId);
            }

            room.participants.set(peer.id, resolved.participant);
            room.recoverableSessions.set(
              resolved.participant.sessionToken,
              toRecoverableParticipant(resolved.participant)
            );
            connection.roomId = room.roomId;
            connection.role = resolved.participant.role;
            connection.sessionToken = resolved.participant.sessionToken;
            room.connections.set(peer.id, connection);

            if (resolved.participant.role === 'root') {
              room.ownerId = peer.id;
            }

            helpers.send(peer, {
              type: 'joinedRoom',
              roomId: room.roomId,
              userId: peer.id,
              role: resolved.participant.role,
              participants: Array.from(room.participants.values(), participant => toPublicParticipant(participant)),
              mode: room.mode,
              sessionToken: resolved.participant.sessionToken
            });
          } finally {
            guards.endJoinClaim(room.roomId, claimKey);
          }
          return;
        }

        case 'createToken': {
          if (!room || !canPerformOwnerAction(peer.id, room.ownerId)) {
            helpers.send(peer, {
              type: 'error',
              message: 'Only the room owner can generate invite tokens.',
              code: 'FORBIDDEN'
            });
            return;
          }
          helpers.send(peer, { type: 'tokenCreated', token: 'token-1', label: message.label });
          return;
        }

        case 'chatSend': {
          const participant = room?.participants.get(peer.id);
          if (!canSendChat(participant)) {
            for (const response of buildTrackedErrorResponses(
              message,
              'Viewers cannot send messages.',
              'FORBIDDEN'
            )) {
              helpers.send(peer, response);
            }
            return;
          }

          helpers.broadcast({
            type: 'chatMessage',
            roomId: room!.roomId,
            messageId: message.messageId,
            fromUserId: peer.id,
            fromName: participant.displayName,
            role: participant.role,
            content: message.content,
            timestamp: message.timestamp
          });
          const ackKey = getClientMessageAckKey(message);
          if (ackKey) {
            helpers.send(peer, { type: 'ack', key: ackKey });
          }
          return;
        }

        case 'leaveRoom': {
          if (!room) {
            return;
          }
          const participant = room.participants.get(peer.id);
          if (!participant) {
            return;
          }
          if (room.ownerId === peer.id) {
            const peersToNotify = prepareRoomClosure(room.connections.values(), peer.id);
            room.participants.clear();
            room.connections.clear();
            room.recoverableSessions.clear();
            room = undefined;
            for (const peerConnection of peersToNotify) {
              const targetPeer = helpers.peers().find(candidate => candidate.id === peerConnection.userId);
              if (!targetPeer) {
                continue;
              }
              helpers.send(targetPeer, {
                type: 'error',
                message: 'Room closed by root user.',
                code: 'ROOM_CLOSED'
              });
              targetPeer.close();
            }
            return;
          }

          room.participants.delete(peer.id);
          room.connections.delete(peer.id);
          room.recoverableSessions.delete(participant.sessionToken);
          connection.roomId = undefined;
          connection.role = undefined;
          connection.sessionToken = undefined;
          return;
        }

        default:
          return;
      }
    },
    onClose(peer) {
      if (!room) {
        connections.delete(peer.id);
        return;
      }

      const participant = room.participants.get(peer.id);
      room.participants.delete(peer.id);
      room.connections.delete(peer.id);

      if (participant) {
        room.recoverableSessions.set(participant.sessionToken, toRecoverableParticipant(participant));
        if (room.ownerId === peer.id) {
          room.ownerId = getRestoredOwnerId(room.ownerSessionToken);
        }
      }

      const connection = connections.get(peer.id);
      if (connection) {
        connection.roomId = undefined;
        connection.role = undefined;
        connection.sessionToken = undefined;
      }
      connections.delete(peer.id);
    }
  });

  return {
    harness,
    snapshotRoom: () => room
  };
}

describe('protocol invariants', () => {
  let harness: MultiClientHarness | undefined;

  afterEach(async () => {
    await harness?.close();
  });

  it('keeps room invariants stable across owner disconnect and reclaim', async () => {
    const protocol = await createProtocolHarness();
    harness = protocol.harness;

    const root = await harness.connectClient('root');
    root.send({ type: 'createRoom', displayName: 'Owner', mode: 'team' });
    const created = await root.waitForType('roomCreated');

    const collaborator = await harness.connectClient('collaborator');
    collaborator.send({
      type: 'joinRoom',
      roomId: created.roomId,
      displayName: 'Casey'
    });
    const joined = await collaborator.waitForType('joinedRoom');
    expect(joined.role).toBe('collaborator');

    await root.disconnect();
    await delay(25);

    expect(protocol.snapshotRoom()?.ownerId).toBe(getRestoredOwnerId(created.sessionToken));
    expect(getRoomInvariantViolations(protocol.snapshotRoom()!)).toEqual([]);

    const reclaimedRoot = await harness.connectClient('root-reclaimed');
    reclaimedRoot.send({
      type: 'joinRoom',
      roomId: created.roomId,
      displayName: 'Owner',
      sessionToken: created.sessionToken
    });
    const reclaimed = await reclaimedRoot.waitForType('joinedRoom');

    expect(reclaimed.role).toBe('root');
    expect(protocol.snapshotRoom()?.ownerId).toBe(reclaimed.userId);
    expect(getRoomInvariantViolations(protocol.snapshotRoom()!)).toEqual([]);
  });

  it('enforces owner-only actions and sends tracked terminal responses for viewer chat', async () => {
    const protocol = await createProtocolHarness();
    harness = protocol.harness;

    const root = await harness.connectClient('root');
    root.send({ type: 'createRoom', displayName: 'Teacher', mode: 'classroom' });
    const created = await root.waitForType('roomCreated');

    const viewer = await harness.connectClient('viewer');
    viewer.send({
      type: 'joinRoom',
      roomId: created.roomId,
      displayName: 'Student'
    });
    const joined = await viewer.waitForType('joinedRoom');
    expect(joined.role).toBe('viewer');

    viewer.send({ type: 'createToken', label: 'forbidden' });
    const ownerActionError = await viewer.waitForType('error');
    expect(ownerActionError.code).toBe('FORBIDDEN');

    const chatMessage: ClientToServerMessage = {
      type: 'chatSend',
      roomId: created.roomId,
      messageId: 'chat-1',
      content: 'blocked',
      timestamp: 1
    };
    viewer.send(chatMessage);

    const chatError = await viewer.waitForMessage(
      message => message.type === 'error' && message.code === 'FORBIDDEN',
      1_500
    );
    expect(chatError.type).toBe('error');
    const ack = await viewer.waitForType('ack');
    expect(ack.key).toBe(getClientMessageAckKey(chatMessage));
    expect(getRoomInvariantViolations(protocol.snapshotRoom()!)).toEqual([]);
  });

  it('rejects concurrent session reclaims for the same owner token', async () => {
    const protocol = await createProtocolHarness(40);
    harness = protocol.harness;

    const root = await harness.connectClient('root');
    root.send({ type: 'createRoom', displayName: 'Owner', mode: 'team' });
    const created = await root.waitForType('roomCreated');
    await root.disconnect();
    await delay(25);

    const claimantA = await harness.connectClient('claimant-a');
    const claimantB = await harness.connectClient('claimant-b');
    const reclaimMessage: ClientToServerMessage = {
      type: 'joinRoom',
      roomId: created.roomId,
      displayName: 'Owner',
      sessionToken: created.sessionToken
    };

    claimantA.send(reclaimMessage);
    claimantB.send(reclaimMessage);

    const [outcomeA, outcomeB] = await Promise.all([
      waitForTerminalJoinMessage(claimantA),
      waitForTerminalJoinMessage(claimantB)
    ]);

    const terminalTypes = [outcomeA.type, outcomeB.type].sort();
    expect(terminalTypes).toEqual(['error', 'joinedRoom']);
    const conflict = [outcomeA, outcomeB].find(message => message.type === 'error');
    expect(conflict?.code).toBe('ROOM_OPERATION_IN_PROGRESS');
    expect(getRoomInvariantViolations(protocol.snapshotRoom()!)).toEqual([]);
  });

  it('closes the room for peers when the owner leaves explicitly', async () => {
    const protocol = await createProtocolHarness();
    harness = protocol.harness;

    const root = await harness.connectClient('root');
    root.send({ type: 'createRoom', displayName: 'Owner', mode: 'team' });
    const created = await root.waitForType('roomCreated');

    const collaborator = await harness.connectClient('collaborator');
    collaborator.send({
      type: 'joinRoom',
      roomId: created.roomId,
      displayName: 'Casey'
    });
    await collaborator.waitForType('joinedRoom');

    root.send({ type: 'leaveRoom' });
    const closedError = await collaborator.waitForType('error');

    expect(closedError.code).toBe('ROOM_CLOSED');
    await collaborator.waitForClose();
    expect(protocol.snapshotRoom()).toBeUndefined();
  });
});
