import { describe, it, expect } from 'vitest';
import { transformPatch, VersionedPatch } from '../server/ot';
import { TextPatch, Position } from '../server/types';

function pos(line: number, character: number): Position {
  return { line, character };
}

function patch(startLine: number, startChar: number, endLine: number, endChar: number, text: string): TextPatch {
  return { range: { start: pos(startLine, startChar), end: pos(endLine, endChar) }, text };
}

describe('OT transformPatch', () => {
  const baseText = 'hello world';

  it('returns incoming unchanged when no concurrent patches', () => {
    const incoming = patch(0, 5, 0, 5, ' there');
    const result = transformPatch(baseText, incoming, 1, []);
    expect(result).toEqual(incoming);
  });

  it('shifts insert after a prior insert at earlier position', () => {
    // Base: "hello world" (version 1)
    // A inserts "X" at offset 0 → "Xhello world" (version 2)
    const patchA = patch(0, 0, 0, 0, 'X');
    const history: VersionedPatch[] = [
      { patch: patchA, authorId: 'a', version: 2, baseText }
    ];
    // B inserts "Y" at offset 5 in the original text
    const incoming = patch(0, 5, 0, 5, 'Y');
    const result = transformPatch('Xhello world', incoming, 1, history);
    expect(result).toBeDefined();
    // After transform, B should insert at offset 6 (shifted by 1)
    expect(result!.range.start).toEqual(pos(0, 6));
    expect(result!.range.end).toEqual(pos(0, 6));
    expect(result!.text).toBe('Y');
  });

  it('does not shift insert before a prior insert at later position', () => {
    // A inserts "X" at offset 10 → "hello worlXd" (version 2)
    const patchA = patch(0, 10, 0, 10, 'X');
    const history: VersionedPatch[] = [
      { patch: patchA, authorId: 'a', version: 2, baseText }
    ];
    // B inserts "Y" at offset 2
    const incoming = patch(0, 2, 0, 2, 'Y');
    const result = transformPatch('hello worlXd', incoming, 1, history);
    expect(result).toBeDefined();
    expect(result!.range.start).toEqual(pos(0, 2));
    expect(result!.range.end).toEqual(pos(0, 2));
    expect(result!.text).toBe('Y');
  });

  it('handles delete before an insert', () => {
    // A deletes "hel" (0-3) → "lo world" (version 2)
    const patchA = patch(0, 0, 0, 3, '');
    const history: VersionedPatch[] = [
      { patch: patchA, authorId: 'a', version: 2, baseText }
    ];
    // B inserts "Y" at offset 5 in original
    const incoming = patch(0, 5, 0, 5, 'Y');
    const result = transformPatch('lo world', incoming, 1, history);
    expect(result).toBeDefined();
    // Offset 5 should shift left by 3 → offset 2
    expect(result!.range.start).toEqual(pos(0, 2));
    expect(result!.text).toBe('Y');
  });

  it('drops patch that is entirely subsumed by a concurrent delete', () => {
    // A deletes "hello" (0-5) → " world" (version 2)
    const patchA = patch(0, 0, 0, 5, '');
    const history: VersionedPatch[] = [
      { patch: patchA, authorId: 'a', version: 2, baseText }
    ];
    // B tries to replace "ell" (1-4) which is inside A's deleted range
    const incoming = patch(0, 1, 0, 4, 'XYZ');
    const result = transformPatch(' world', incoming, 1, history);
    expect(result).toBeUndefined();
  });

  it('handles multiline text transforms', () => {
    const multiText = 'line1\nline2\nline3';
    // A inserts at start of line 2 (offset 6 → "line1\nXline2\nline3")
    const patchA = patch(1, 0, 1, 0, 'X');
    const history: VersionedPatch[] = [
      { patch: patchA, authorId: 'a', version: 2, baseText: multiText }
    ];
    // B inserts at start of line 3 (offset 12 in original)
    const incoming = patch(2, 0, 2, 0, 'Y');
    const result = transformPatch('line1\nXline2\nline3', incoming, 1, history);
    expect(result).toBeDefined();
    // After A, line 2 is "Xline2", so line 3 offset shifts by 1
    expect(result!.range.start.line).toBe(2);
    expect(result!.range.start.character).toBe(0);
    expect(result!.text).toBe('Y');
  });

  it('transforms through multiple concurrent patches', () => {
    // Base: "ABCDE" (version 1)
    const base = 'ABCDE';
    // A inserts "X" at 0 → "XABCDE" (version 2)
    const pA = patch(0, 0, 0, 0, 'X');
    // B inserts "Y" at 1 (in text "XABCDE") → "XYABCDE" is wrong...
    // Actually B is concurrent and also based on version 1.
    // After A transforms, B inserts "Y" at 1+1=2...
    // Let me set up properly:
    const afterA = 'XABCDE';
    // C: another user inserts "Z" at offset 3 in "XABCDE" → "XABZCDE" (version 3)
    const pC = patch(0, 3, 0, 3, 'Z');

    const history: VersionedPatch[] = [
      { patch: pA, authorId: 'a', version: 2, baseText: base },
      { patch: pC, authorId: 'c', version: 3, baseText: afterA },
    ];

    // Incoming: based on version 1, insert "W" at offset 4 in original "ABCDE"
    const incoming = patch(0, 4, 0, 4, 'W');
    const currentText = 'XABZCDE'; // after both A and C applied 
    const result = transformPatch(currentText, incoming, 1, history);
    expect(result).toBeDefined();
    // Offset 4 in original "ABCDE":
    //   After A (insert at 0): 4 → 5
    //   After C (insert at 3 in "XABCDE"): 5 → 6
    expect(result!.range.start).toEqual(pos(0, 6));
    expect(result!.text).toBe('W');
  });

  it('handles pure insert at boundary of delete', () => {
    // A deletes "BC" (1-3) → "ADE"
    const base = 'ABCDE';
    const pA = patch(0, 1, 0, 3, '');
    const history: VersionedPatch[] = [
      { patch: pA, authorId: 'a', version: 2, baseText: base }
    ];
    // B inserts "X" at offset 1 (same as start of A's delete)
    const incoming = patch(0, 1, 0, 1, 'X');
    const result = transformPatch('ADE', incoming, 1, history);
    expect(result).toBeDefined();
    // Pure insert at A boundary: should anchor at 1 (A.start + A.insertLen = 1+0 = 1)
    expect(result!.range.start).toEqual(pos(0, 1));
    expect(result!.text).toBe('X');
  });
});
