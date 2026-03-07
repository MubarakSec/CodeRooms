/**
 * Lightweight server-side Operational Transform for single-character text patches.
 *
 * Each patch is a range-replacement: delete text in [start, end) and insert `text`.
 * When two patches are produced concurrently against the same document version,
 * we must transform the later one so that it applies correctly after the earlier
 * one has already been applied.
 *
 * This is a simplified 1-D OT suitable for the CodeRooms single-patch-per-message
 * protocol. It handles:
 *  - Non-overlapping inserts/deletes (position shifting)
 *  - Overlapping deletes (range trimming)
 *  - Insert inside a deleted range (anchor to delete boundary)
 */

import { TextPatch, Position } from './types';

/** Flat offset representation of a range-replacement patch. */
interface FlatPatch {
  start: number;   // inclusive offset in the original text
  end: number;     // exclusive offset in the original text
  text: string;    // replacement text
}

// ── helpers ──────────────────────────────────────────────────────────────────

function positionToOffset(text: string, pos: Position): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < pos.line && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  offset += pos.character;
  return offset;
}

function offsetToPosition(text: string, offset: number): Position {
  let line = 0;
  let remaining = offset;
  const lines = text.split('\n');
  while (line < lines.length && remaining > lines[line].length) {
    remaining -= lines[line].length + 1;
    line++;
  }
  return { line, character: Math.max(0, remaining) };
}

function toFlat(text: string, patch: TextPatch): FlatPatch {
  const normalized = text.replace(/\r\n/g, '\n');
  return {
    start: positionToOffset(normalized, patch.range.start),
    end: positionToOffset(normalized, patch.range.end),
    text: patch.text,
  };
}

function fromFlat(text: string, flat: FlatPatch): TextPatch {
  const normalized = text.replace(/\r\n/g, '\n');
  return {
    range: {
      start: offsetToPosition(normalized, flat.start),
      end: offsetToPosition(normalized, flat.end),
    },
    text: flat.text,
  };
}

// ── core transform ───────────────────────────────────────────────────────────

/**
 * Transform patch B against patch A, assuming both were created against the
 * same document state. Returns a new patch B' that, when applied after A,
 * produces the intended effect of B.
 *
 * Returns `undefined` if B is entirely subsumed by A (no-op).
 */
function transformFlat(a: FlatPatch, b: FlatPatch): FlatPatch | undefined {
  const aLen = a.end - a.start;          // characters deleted by A
  const aInsertLen = a.text.length;       // characters inserted by A
  const shift = aInsertLen - aLen;        // net shift produced by A

  // Case 1: B is entirely before A → no adjustment needed
  if (b.end <= a.start) {
    return { ...b };
  }

  // Case 2: B is entirely after A → shift both endpoints
  if (b.start >= a.end) {
    return {
      start: b.start + shift,
      end: b.end + shift,
      text: b.text,
    };
  }

  // Case 3: A is entirely inside B → adjust B's end to account for A's change
  if (b.start <= a.start && b.end >= a.end) {
    return {
      start: b.start,
      end: b.end + shift,
      text: b.text,
    };
  }

  // Case 4: B is entirely inside A (subsumed) — the text B targeted has been
  // replaced by A. B becomes a no-op unless it's a pure insert at the boundary.
  if (b.start >= a.start && b.end <= a.end) {
    // Pure insert at A's start boundary — anchor it there after A
    if (b.start === b.end) {
      const anchorPoint = a.start + aInsertLen;
      return { start: anchorPoint, end: anchorPoint, text: b.text };
    }
    // The text B targeted is gone; drop it.
    return undefined;
  }

  // Case 5: Partial overlap — B starts before A and extends into it
  if (b.start < a.start && b.end > a.start && b.end <= a.end) {
    return {
      start: b.start,
      end: a.start,   // trim to not overlap with A's deleted region
      text: b.text,
    };
  }

  // Case 6: Partial overlap — B starts inside A and extends beyond it
  if (b.start >= a.start && b.start < a.end && b.end > a.end) {
    const newStart = a.start + aInsertLen;
    return {
      start: newStart,
      end: b.end + shift,
      text: b.text,
    };
  }

  // Fallback: shouldn't reach here, but return shifted patch to be safe
  return {
    start: Math.max(0, b.start + shift),
    end: Math.max(0, b.end + shift),
    text: b.text,
  };
}

// ── public API ───────────────────────────────────────────────────────────────

export interface VersionedPatch {
  patch: TextPatch;
  authorId: string;
  version: number;         // the version this patch produces (i.e. doc version after apply)
  baseText: string;        // document text *before* this patch was applied
}

/**
 * Transform an incoming patch against a series of concurrent patches that have
 * already been applied to the document since the client's base version.
 *
 * @param docText     The current document text (after all history patches applied)
 * @param incoming    The patch from the client
 * @param baseVersion The document version the client's patch was authored against
 * @param history     Ordered list of patches applied since baseVersion
 * @returns           The transformed TextPatch to apply to the current document,
 *                    or `undefined` if the patch is fully subsumed.
 */
export function transformPatch(
  docText: string,
  incoming: TextPatch,
  baseVersion: number,
  history: VersionedPatch[],
): TextPatch | undefined {
  // Find patches that were applied after the client's base version
  const concurrent = history.filter(h => h.version > baseVersion);
  if (concurrent.length === 0) {
    return incoming; // no concurrent edits, no transform needed
  }

  // We need to transform the incoming patch step-by-step against each
  // concurrent patch. Each step uses the document text *before* that
  // concurrent patch was applied (so offsets are correct).
  let flatB: FlatPatch | undefined = toFlat(
    concurrent.length > 0 ? concurrent[0].baseText : docText,
    incoming,
  );

  for (const entry of concurrent) {
    if (!flatB) {
      return undefined;
    }
    const flatA = toFlat(entry.baseText, entry.patch);
    flatB = transformFlat(flatA, flatB);
  }

  if (!flatB) {
    return undefined;
  }

  return fromFlat(docText, flatB);
}
