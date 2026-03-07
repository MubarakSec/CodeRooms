"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketClient = void 0;
const events_1 = require("events");
const ws_1 = __importDefault(require("ws"));
const logger_1 = require("../util/logger");
class WebSocketClient extends events_1.EventEmitter {
    async connect(url) {
        this.url = url;
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.terminate();
        }
        return new Promise((resolve, reject) => {
            const socket = new ws_1.default(url);
            const cleanup = () => {
                socket.removeAllListeners();
            };
            socket.on('open', () => {
                this.socket = socket;
                logger_1.logger.info(`Connected to CodeRooms server at ${url}`);
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
            socket.on('close', () => {
                if (this.socket === socket) {
                    this.socket = undefined;
                }
                logger_1.logger.warn('Disconnected from CodeRooms server');
                this.emit('close');
                cleanup();
            });
            socket.on('error', (error) => {
                logger_1.logger.error(`WebSocket error: ${error instanceof Error ? error.message : String(error)}`);
                cleanup();
                reject(error);
            });
        });
    }
    send(message) {
        if (!this.socket || this.socket.readyState !== ws_1.default.OPEN) {
            logger_1.logger.warn('WebSocket is not connected; unable to send message.');
            return;
        }
        this.socket.send(JSON.stringify(message));
    }
    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = undefined;
        }
    }
}
exports.WebSocketClient = WebSocketClient;
//# sourceMappingURL=WebSocketClient.js.map