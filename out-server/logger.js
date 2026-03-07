"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = log;
function log(event, data) {
    const payload = { ts: Date.now(), event, ...(data ?? {}) };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
}
