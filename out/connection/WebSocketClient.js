"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketClient = void 0;
const events_1 = require("events");
const ws_1 = __importDefault(require("ws"));
const logger_1 = require("../util/logger");
const DEFAULT_RECONNECT = {
    enabled: true,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffFactor: 2,
    maxAttempts: 10
};
class WebSocketClient extends events_1.EventEmitter {
    constructor(options) {
        super();
        this.reconnectAttempt = 0;
        this.intentionalClose = false;
        this.lastPongTime = 0;
        this.reconnectOptions = { ...DEFAULT_RECONNECT, ...options };
    }
    async connect(url) {
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
    establishConnection(url) {
        return new Promise((resolve, reject) => {
            const socket = new ws_1.default(url);
            let settled = false;
            const cleanup = () => {
                socket.removeAllListeners();
            };
            socket.on('open', () => {
                settled = true;
                this.socket = socket;
                this.reconnectAttempt = 0;
                this.lastPongTime = Date.now();
                this.startHeartbeat();
                logger_1.logger.info(`Connected to CodeRooms server at ${url}`);
                this.emit('connected');
                resolve();
            });
            socket.on('message', (data) => {
                try {
                    const parsed = JSON.parse(data.toString());
                    this.emit('message', parsed);
                }
                catch (error) {
                    logger_1.logger.error(`Failed to parse WebSocket message: ${String(error)}`);
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
                logger_1.logger.warn(`Disconnected from CodeRooms server (code=${code})`);
                this.emit('close', code);
                cleanup();
                if (!this.intentionalClose && this.reconnectOptions.enabled) {
                    this.scheduleReconnect();
                }
            });
            socket.on('error', (error) => {
                logger_1.logger.error(`WebSocket error: ${error instanceof Error ? error.message : String(error)}`);
                if (!settled) {
                    settled = true;
                    cleanup();
                    reject(error);
                }
            });
        });
    }
    scheduleReconnect() {
        if (this.reconnectAttempt >= this.reconnectOptions.maxAttempts) {
            logger_1.logger.error(`Max reconnect attempts (${this.reconnectOptions.maxAttempts}) reached. Giving up.`);
            this.emit('reconnectFailed');
            return;
        }
        const delay = Math.min(this.reconnectOptions.initialDelayMs * Math.pow(this.reconnectOptions.backoffFactor, this.reconnectAttempt), this.reconnectOptions.maxDelayMs);
        const jitter = delay * (0.8 + Math.random() * 0.4);
        this.reconnectAttempt++;
        logger_1.logger.info(`Reconnect attempt ${this.reconnectAttempt}/${this.reconnectOptions.maxAttempts} in ${Math.round(jitter)}ms`);
        this.emit('reconnecting', { attempt: this.reconnectAttempt, delayMs: Math.round(jitter) });
        this.reconnectTimer = setTimeout(async () => {
            if (this.intentionalClose || !this.url) {
                return;
            }
            try {
                await this.establishConnection(this.url);
            }
            catch {
                // error handler cleaned up the socket listeners, so the close event
                // won't fire — schedule the next reconnect attempt explicitly.
                if (!this.intentionalClose) {
                    this.scheduleReconnect();
                }
            }
        }, jitter);
    }
    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }
    startHeartbeat() {
        this.stopHeartbeat();
        this.pingInterval = setInterval(() => {
            if (this.socket?.readyState === ws_1.default.OPEN) {
                this.socket.ping();
                // If no pong in 10 seconds, connection is likely dead
                if (this.lastPongTime && Date.now() - this.lastPongTime > 10000) {
                    logger_1.logger.warn('No pong received in 10s — terminating stale connection');
                    this.socket.terminate();
                }
            }
        }, 5000);
    }
    stopHeartbeat() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = undefined;
        }
    }
    send(message) {
        if (!this.socket || this.socket.readyState !== ws_1.default.OPEN) {
            logger_1.logger.warn('WebSocket is not connected; unable to send message.');
            return;
        }
        this.socket.send(JSON.stringify(message));
    }
    isOpen() {
        return this.socket?.readyState === ws_1.default.OPEN;
    }
    getReconnectAttempt() {
        return this.reconnectAttempt;
    }
    disconnect() {
        this.intentionalClose = true;
        this.clearReconnectTimer();
        this.stopHeartbeat();
        if (this.socket) {
            this.socket.close();
            this.socket = undefined;
        }
    }
}
exports.WebSocketClient = WebSocketClient;
//# sourceMappingURL=WebSocketClient.js.map