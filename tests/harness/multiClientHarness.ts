import { pack, unpack } from 'msgpackr';
import type { ClientToServerMessage, ServerToClientMessage } from '../../shared/protocol';

type MaybePromise<T> = T | Promise<T>;
type MessagePredicate<T> = (message: T) => boolean;

export interface HarnessServerPeer {
  id: string;
  socket: { close(code?: number, reason?: string): void };
  send(message: ServerToClientMessage): void;
  close(code?: number, reason?: string): void;
}

export interface MultiClientHarnessHandlers {
  onConnection?(peer: HarnessServerPeer, helpers: MultiClientHarnessServerHelpers): MaybePromise<void>;
  onMessage?(
    peer: HarnessServerPeer,
    message: ClientToServerMessage,
    helpers: MultiClientHarnessServerHelpers
  ): MaybePromise<void>;
  onClose?(peer: HarnessServerPeer, helpers: MultiClientHarnessServerHelpers): MaybePromise<void>;
}

export interface MultiClientHarnessServerHelpers {
  send(peer: HarnessServerPeer, message: ServerToClientMessage): void;
  broadcast(message: ServerToClientMessage, exceptPeerId?: string): void;
  peers(): HarnessServerPeer[];
}

interface MessageWaiter<T> {
  predicate: MessagePredicate<T>;
  resolve: (message: T) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class HarnessClient {
  readonly messages: ServerToClientMessage[] = [];
  private readonly waiters: MessageWaiter<ServerToClientMessage>[] = [];
  private readonly closeWaiters: Array<() => void> = [];
  private closed = false;
  private closeSignaled = false;

  constructor(
    readonly label: string,
    private readonly sendToServer: (message: ClientToServerMessage) => void,
    private readonly disconnectFromServer: () => void
  ) {}

  send(message: ClientToServerMessage): void {
    if (this.closed) {
      throw new Error(`${this.label} is already closed.`);
    }
    const cloned = unpack(pack(message)) as ClientToServerMessage;
    queueMicrotask(() => this.sendToServer(cloned));
  }

  waitForMessage(predicate: MessagePredicate<ServerToClientMessage>, timeoutMs = 1_000): Promise<ServerToClientMessage> {
    const existing = this.messages.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise<ServerToClientMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeWaiter(waiter);
        reject(new Error(`Timed out waiting for message for ${this.label}.`));
      }, timeoutMs);
      const waiter: MessageWaiter<ServerToClientMessage> = { predicate, resolve, reject, timeout };
      this.waiters.push(waiter);
    });
  }

  waitForType<TType extends ServerToClientMessage['type']>(
    type: TType,
    timeoutMs = 1_000
  ): Promise<Extract<ServerToClientMessage, { type: TType }>> {
    return this.waitForMessage(message => message.type === type, timeoutMs) as Promise<Extract<ServerToClientMessage, { type: TType }>>;
  }

  async disconnect(): Promise<void> {
    if (this.closed) {
      return;
    }
    const waitForClose = this.waitForClose();
    this.closed = true;
    queueMicrotask(() => this.disconnectFromServer());
    await waitForClose;
  }

  waitForClose(timeoutMs = 1_000): Promise<void> {
    if (this.closeSignaled) {
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

  receiveFromServer(message: ServerToClientMessage): void {
    if (this.closed) {
      return;
    }
    const cloned = unpack(pack(message)) as ServerToClientMessage;
    this.messages.push(cloned);
    this.resolveWaiters(cloned);
  }

  closeFromServer(): void {
    if (this.closeSignaled) {
      return;
    }
    this.closeSignaled = true;
    this.closed = true;
    for (const resolve of this.closeWaiters.splice(0)) {
      resolve();
    }
  }

  private removeWaiter(waiter: MessageWaiter<ServerToClientMessage>): void {
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

export class MultiClientHarness {
  private readonly clients = new Map<string, HarnessClient>();
  private readonly peers = new Map<string, HarnessServerPeer>();
  private nextPeerId = 1;

  private constructor(private readonly handlers: MultiClientHarnessHandlers) {}

  static async create(handlers: MultiClientHarnessHandlers = {}): Promise<MultiClientHarness> {
    return new MultiClientHarness(handlers);
  }

  async connectClient(label: string): Promise<HarnessClient> {
    const peerId = `peer-${this.nextPeerId++}`;
    let client!: HarnessClient;

    const peer: HarnessServerPeer = {
      id: peerId,
      socket: {
        close: () => {
          queueMicrotask(() => {
            client.closeFromServer();
            this.peers.delete(peerId);
            this.clients.delete(peerId);
            void this.handlers.onClose?.(peer, this.helpers);
          });
        }
      },
      send: message => {
        queueMicrotask(() => client.receiveFromServer(message));
      },
      close: () => {
        peer.socket.close();
      }
    };

    client = new HarnessClient(
      label,
      message => {
        void this.handlers.onMessage?.(peer, message, this.helpers);
      },
      () => {
        this.peers.delete(peerId);
        this.clients.delete(peerId);
        void this.handlers.onClose?.(peer, this.helpers);
        client.closeFromServer();
      }
    );

    this.peers.set(peerId, peer);
    this.clients.set(peerId, client);
    await this.handlers.onConnection?.(peer, this.helpers);
    return client;
  }

  async close(): Promise<void> {
    for (const client of Array.from(this.clients.values())) {
      await client.disconnect().catch(() => undefined);
    }
    this.peers.clear();
    this.clients.clear();
  }

  private readonly helpers: MultiClientHarnessServerHelpers = {
    send: (peer, message) => {
      peer.send(message);
    },
    broadcast: (message, exceptPeerId) => {
      for (const [peerId, peer] of this.peers.entries()) {
        if (peerId === exceptPeerId) {
          continue;
        }
        peer.send(message);
      }
    },
    peers: () => Array.from(this.peers.values())
  };
}
