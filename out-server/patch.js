"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyPatch = applyPatch;
exports.applyPatches = applyPatches;
/**
 * Apply a single patch. Returns undefined when the patch is invalid or overlaps improperly.
 */
function applyPatch(text, patch) {
    const result = applyPatches(text, [patch]);
    return result ?? undefined;
}
/**
 * Apply multiple patches against the same base text. Patches are validated to be non-overlapping.
 * If validation fails, undefined is returned.
 */
function applyPatches(text, patches) {
    const normalized = normalizePatches(text, patches);
    if (!normalized) {
        return undefined;
    }
    let output = text;
    for (const patch of normalized) {
        output = `${output.slice(0, patch.start)}${patch.text}${output.slice(patch.end)}`;
    }
    return output;
}
function normalizePatches(text, patches) {
    const normalized = [];
    for (const patch of patches) {
        const start = offsetFromPosition(text, patch.range.start);
        const end = offsetFromPosition(text, patch.range.end);
        if (start === undefined || end === undefined || start > end) {
            return undefined;
        }
        normalized.push({ start, end, text: patch.text });
    }
    normalized.sort((a, b) => b.start - a.start);
    for (let i = 1; i < normalized.length; i++) {
        const previous = normalized[i - 1];
        const current = normalized[i];
        if (current.end > previous.start) {
            return undefined;
        }
    }
    return normalized;
}
function offsetFromPosition(text, position) {
    if (position.line < 0 || position.character < 0) {
        return undefined;
    }
    const lines = text.split('\n');
    if (position.line >= lines.length) {
        return undefined;
    }
    const line = lines[position.line];
    if (position.character > line.length) {
        return undefined;
    }
    let offset = 0;
    for (let i = 0; i < position.line; i++) {
        offset += lines[i].length + 1;
    }
    return offset + position.character;
}
