import { Role } from './types';

export interface ClosableRoomConnection {
  userId: string;
  roomId?: string;
  role?: Role;
  ws: { close(): void };
}

export function prepareRoomClosure(
  connections: Iterable<ClosableRoomConnection>,
  ownerUserId: string
): ClosableRoomConnection[] {
  const peersToNotify: ClosableRoomConnection[] = [];

  for (const connection of connections) {
    connection.roomId = undefined;
    connection.role = undefined;
    if (connection.userId !== ownerUserId) {
      peersToNotify.push(connection);
    }
  }

  return peersToNotify;
}
