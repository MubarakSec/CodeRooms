"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const patch_1 = require("./patch");
(0, vitest_1.describe)('patch application', () => {
    (0, vitest_1.it)('applies a single insertion', () => {
        const base = 'hello';
        const text = (0, patch_1.applyPatch)(base, {
            range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } },
            text: ' world'
        });
        (0, vitest_1.expect)(text).toBe('hello world');
    });
    (0, vitest_1.it)('applies a deletion', () => {
        const base = 'line one\nline two';
        const text = (0, patch_1.applyPatch)(base, {
            range: { start: { line: 0, character: 4 }, end: { line: 0, character: 8 } },
            text: ''
        });
        (0, vitest_1.expect)(text).toBe('line\nline two');
    });
    (0, vitest_1.it)('applies multiple patches in one set, even if out of order', () => {
        const base = 'abcdef';
        const text = (0, patch_1.applyPatches)(base, [
            { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 6 } }, text: 'XY' },
            { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } }, text: '12' }
        ]);
        (0, vitest_1.expect)(text).toBe('a12dXY');
    });
    (0, vitest_1.it)('rejects overlapping patches', () => {
        const base = 'abcdef';
        const text = (0, patch_1.applyPatches)(base, [
            { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } }, text: 'XX' },
            { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 5 } }, text: 'YY' }
        ]);
        (0, vitest_1.expect)(text).toBeUndefined();
    });
    (0, vitest_1.it)('rejects out-of-range patches', () => {
        const base = 'abc';
        const text = (0, patch_1.applyPatch)(base, {
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
            text: 'oops'
        });
        (0, vitest_1.expect)(text).toBeUndefined();
    });
});
