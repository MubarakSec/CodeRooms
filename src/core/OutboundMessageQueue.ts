import { ClientToServerMessage } from '../connection/MessageTypes';
import { getClientMessageAckKey } from '../../shared/ackKeys';

export class OutboundMessageQueue {
  private readonly pendingOffline: ClientToServerMessage[] = [];
  private readonly pendingAck = new Map<string, ClientToServerMessage>();

  constructor(
    private readonly sendNow: (message: ClientToServerMessage) => void,
    private readonly maxPendingAck = 10000
  ) {}

  send(message: ClientToServerMessage, isConnected: boolean): void {
    if (isConnected) {
      this.trackForAck(message);
      this.sendNow(message);
      return;
    }

    this.trackForAck(message);
    this.pendingOffline.push(message);
  }

  flush(isConnected: boolean): void {
    if (!isConnected) {
      return;
    }

    for (const [, message] of this.pendingAck) {
      this.sendNow(message);
    }

    while (this.pendingOffline.length) {
      const next = this.pendingOffline.shift();
      if (!next) {
        continue;
      }

      const key = getClientMessageAckKey(next);
      if (key && this.pendingAck.has(key)) {
        continue;
      }
      if (key) {
        this.pendingAck.set(key, next);
      }
      this.sendNow(next);
    }
  }

  acknowledge(key: string): void {
    this.pendingAck.delete(key);
  }

  clear(): void {
    this.pendingOffline.splice(0, this.pendingOffline.length);
    this.pendingAck.clear();
  }

  private trackForAck(message: ClientToServerMessage): void {
    const key = getClientMessageAckKey(message);
    if (!key) {
      return;
    }

    if (this.pendingAck.size >= this.maxPendingAck) {
      const first = this.pendingAck.keys().next().value;
      if (first !== undefined) {
        this.pendingAck.delete(first);
      }
    }
    this.pendingAck.set(key, message);
  }
}
