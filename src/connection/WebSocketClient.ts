import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { pack, unpack } from 'msgpackr';
import { ClientToServerMessage, ServerToClientMessage } from './MessageTypes';
import { logger } from '../util/logger';

export interface ReconnectOptions {
  enabled: boolean;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  maxAttempts: number;
}

const DEFAULT_RECONNECT: ReconnectOptions = {
  enabled: true,
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffFactor: 2,
  maxAttempts: 10
};

export class WebSocketClient extends EventEmitter {
  private socket?: WebSocket;
  private url?: string;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private intentionalClose = false;
  private reconnectOptions: ReconnectOptions;
  private lastPongTime = 0;
  private pingInterval?: ReturnType<typeof setInterval>;

  constructor(options?: Partial<ReconnectOptions>) {
    super();
    this.reconnectOptions = { ...DEFAULT_RECONNECT, ...options };
  }

  async connect(url: string): Promise<void> {
    this.url = url;
    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.terminate();
    }

    return this.establishConnection(url);
  }

  private establishConnection(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      let settled = false;

      const cleanup = (): void => {
        socket.removeAllListeners();
      };

      socket.on('open', () => {
        settled = true;
        this.socket = socket;
        this.reconnectAttempt = 0;
        this.lastPongTime = Date.now();
        this.startHeartbeat();
        logger.info(`Connected to CodeRooms server at ${url}`);
        this.emit('connected');
        resolve();
      });

      socket.on('message', (data) => {
        try {
          let parsed: ServerToClientMessage;
          if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
            parsed = unpack(data as Buffer) as ServerToClientMessage;
          } else {
            parsed = JSON.parse(data.toString()) as ServerToClientMessage;
          }
          this.emit('message', parsed);
        } catch (error) {
          logger.error(`Failed to parse WebSocket message: ${String(error)}`);
        }
      });

      socket.on('pong', () => {
        this.lastPongTime = Date.now();
      });

      socket.on('close', (code) => {
        this.stopHeartbeat();
        if (this.socket === socket) {
          this.socket = undefined;
        }
        logger.warn(`Disconnected from CodeRooms server (code=${code})`);
        this.emit('close', code);
        cleanup();

        if (!this.intentionalClose && this.reconnectOptions.enabled) {
          this.scheduleReconnect();
        }
      });

      socket.on('error', (error) => {
        logger.error(`WebSocket error: ${error instanceof Error ? error.message : String(error)}`);
        if (!settled) {
          settled = true;
          cleanup();
          reject(error);
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= this.reconnectOptions.maxAttempts) {
      logger.error(`Max reconnect attempts (${this.reconnectOptions.maxAttempts}) reached. Giving up.`);
      this.emit('reconnectFailed');
      return;
    }

    const delay = Math.min(
      this.reconnectOptions.initialDelayMs * Math.pow(this.reconnectOptions.backoffFactor, this.reconnectAttempt),
      this.reconnectOptions.maxDelayMs
    );
    const jitter = delay * (0.8 + Math.random() * 0.4);
    this.reconnectAttempt++;

    logger.info(`Reconnect attempt ${this.reconnectAttempt}/${this.reconnectOptions.maxAttempts} in ${Math.round(jitter)}ms`);
    this.emit('reconnecting', { attempt: this.reconnectAttempt, delayMs: Math.round(jitter) });

    this.reconnectTimer = setTimeout(async () => {
      if (this.intentionalClose || !this.url) {
        return;
      }
      try {
        await this.establishConnection(this.url);
      } catch {
        // error handler cleaned up the socket listeners, so the close event
        // won't fire — schedule the next reconnect attempt explicitly.
        if (!this.intentionalClose) {
          this.scheduleReconnect();
        }
      }
    }, jitter);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.ping();
        // If no pong in 10 seconds, connection is likely dead
        if (this.lastPongTime && Date.now() - this.lastPongTime > 10_000) {
          logger.warn('No pong received in 10s — terminating stale connection');
          this.socket.terminate();
        }
      }
    }, 5_000);
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }

  send(message: ClientToServerMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      logger.warn('WebSocket is not connected; unable to send message.');
      return;
    }
    this.socket.send(pack(message));
  }

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** True when the client intends to reconnect (auto-reconnect in progress). */
  isAutoReconnecting(): boolean {
    return !this.intentionalClose && this.reconnectOptions.enabled && this.reconnectAttempt < this.reconnectOptions.maxAttempts;
  }

  getReconnectAttempt(): number {
    return this.reconnectAttempt;
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
    }
  }
}
