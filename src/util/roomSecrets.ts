import { deriveKey } from './crypto';

export function consumePendingRoomSecret(pendingSecret: string | undefined, roomId: string): Buffer | undefined {
  return pendingSecret ? deriveKey(pendingSecret, roomId) : undefined;
}
