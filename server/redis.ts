import Redis from 'ioredis';
import { ServerToClientMessage } from '../shared/protocol';

let pubClient: Redis | undefined;
let subClient: Redis | undefined;

export type RedisMessageHandler = (roomId: string, message: ServerToClientMessage) => void;
const subscribers = new Set<RedisMessageHandler>();

export function initRedis(url: string) {
  pubClient = new Redis(url);
  subClient = new Redis(url);

  subClient.on('message', (channel, message) => {
    if (channel.startsWith('room:')) {
      const roomId = channel.substring(5);
      const parsed = JSON.parse(message) as ServerToClientMessage;
      for (const handler of subscribers) {
        handler(roomId, parsed);
      }
    }
  });
}

export function subscribeToRoomBroadcasts(handler: RedisMessageHandler) {
  subscribers.add(handler);
}

export function joinRoomPubSub(roomId: string) {
  subClient?.subscribe(`room:${roomId}`);
}

export function leaveRoomPubSub(roomId: string) {
  subClient?.unsubscribe(`room:${roomId}`);
}

export function broadcastToRoomPubSub(roomId: string, message: ServerToClientMessage) {
  pubClient?.publish(`room:${roomId}`, JSON.stringify(message));
}
