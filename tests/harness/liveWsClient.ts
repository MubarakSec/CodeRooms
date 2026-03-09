import { pack, unpack } from 'msgpackr';
import WebSocket from 'ws';

import type { ClientToServerMessage, ServerToClientMessage } from '../../shared/protocol';

type Predicate<T> = (message: T) => boolean;

interface Waiter<T> {
  predicate: Predicate<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class LiveWsClient {
  readonly messages: ServerToClientMessage[] = [];
  private readonly waiters: Waiter<ServerToClientMessage>[] = [];
  private readonly closeWaiters: Array<() => void> = [];
  private closed = false;

  private constructor(
    readonly label: string,
    private readonly socket: WebSocket
  ) {
    socket.on('message', data => {
      const payload = Array.isArray(data)
        ? Buffer.concat(data)
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : Buffer.from(data as Buffer);
      const message = unpack(payload) as ServerToClientMessage;
      this.messages.push(message);
      this.resolveWaiters(message);
    });
    socket.on('close', () => {
      this.closed = true;
      for (const resolve of this.closeWaiters.splice(0)) {
        resolve();
      }
    });
  }

  static async connect(url: string, label: string): Promise<LiveWsClient> {
    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
    return new LiveWsClient(label, socket);
  }

  send(message: ClientToServerMessage): void {
    if (this.closed) {
      throw new Error(`${this.label} is closed.`);
    }
    this.socket.send(pack(message));
  }

  waitForMessage(predicate: Predicate<ServerToClientMessage>, timeoutMs = 3_000): Promise<ServerToClientMessage> {
    const existing = this.messages.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise<ServerToClientMessage>((resolve, reject) => {
      const waiter: Waiter<ServerToClientMessage> = {
        predicate,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.removeWaiter(waiter);
          reject(new Error(`Timed out waiting for message for ${this.label}.`));
        }, timeoutMs)
      };
      this.waiters.push(waiter);
    });
  }

  waitForType<TType extends ServerToClientMessage['type']>(
    type: TType,
    timeoutMs = 3_000
  ): Promise<Extract<ServerToClientMessage, { type: TType }>> {
    return this.waitForMessage(message => message.type === type, timeoutMs) as Promise<Extract<ServerToClientMessage, { type: TType }>>;
  }

  async disconnect(): Promise<void> {
    if (this.closed) {
      return;
    }
    const closePromise = this.waitForClose();
    this.socket.close();
    await closePromise;
  }

  waitForClose(timeoutMs = 3_000): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }
    return Promise.race([
      new Promise<void>(resolve => {
        this.closeWaiters.push(resolve);
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Timed out waiting for ${this.label} to close.`)), timeoutMs);
      })
    ]);
  }

  private removeWaiter(waiter: Waiter<ServerToClientMessage>): void {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) {
      this.waiters.splice(index, 1);
    }
  }

  private resolveWaiters(message: ServerToClientMessage): void {
    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(message)) {
        continue;
      }
      clearTimeout(waiter.timeout);
      this.removeWaiter(waiter);
      waiter.resolve(message);
    }
  }
}
