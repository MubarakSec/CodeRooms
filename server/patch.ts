import { TextPatch } from './types';

interface NormalizedPatch {
  start: number;
  end: number;
  text: string;
}

/**
 * Apply a single patch. Returns undefined when the patch is invalid or overlaps improperly.
 */
export function applyPatch(text: string, patch: TextPatch): string | undefined {
  const result = applyPatches(text, [patch]);
  return result ?? undefined;
}

/**
 * Apply multiple patches against the same base text. Patches are validated to be non-overlapping.
 * If validation fails, undefined is returned.
 */
export function applyPatches(text: string, patches: TextPatch[]): string | undefined {
  // Normalize CRLF to LF so offsets computed from Position are consistent
  const normalizedText = text.replace(/\r\n/g, '\n');
  const normalized = normalizePatches(normalizedText, patches);
  if (!normalized) {
    return undefined;
  }

  let output = normalizedText;
  for (const patch of normalized) {
    output = `${output.slice(0, patch.start)}${patch.text}${output.slice(patch.end)}`;
  }
  return output;
}

function normalizePatches(text: string, patches: TextPatch[]): NormalizedPatch[] | undefined {
  const normalized: NormalizedPatch[] = [];

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

function offsetFromPosition(text: string, position: { line: number; character: number }): number | undefined {
  if (position.line < 0 || position.character < 0) {
    return undefined;
  }
  // Normalize CRLF to LF before splitting to handle Windows line endings
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
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
