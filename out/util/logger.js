"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const PREFIX = "[CodeRooms]";
let debugEnabled = false;
exports.logger = {
    setDebugLogging(enabled) {
        debugEnabled = enabled;
    },
    info(message) {
        if (!debugEnabled) {
            return;
        }
        console.log(`${PREFIX} INFO: ${message}`);
    },
    warn(message) {
        console.warn(`${PREFIX} WARN: ${message}`);
    },
    error(message) {
        console.error(`${PREFIX} ERROR: ${message}`);
    }
};
//# sourceMappingURL=logger.js.map