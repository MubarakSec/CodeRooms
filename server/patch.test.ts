import { describe, expect, it } from 'vitest';
import { applyPatch, applyPatches } from './patch';

describe('patch application', () => {
  it('applies a single insertion', () => {
    const base = 'hello';
    const text = applyPatch(base, {
      range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } },
      text: ' world'
    });
    expect(text).toBe('hello world');
  });

  it('applies a deletion', () => {
    const base = 'line one\nline two';
    const text = applyPatch(base, {
      range: { start: { line: 0, character: 4 }, end: { line: 0, character: 8 } },
      text: ''
    });
    expect(text).toBe('line\nline two');
  });

  it('applies multiple patches in one set, even if out of order', () => {
    const base = 'abcdef';
    const text = applyPatches(base, [
      { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 6 } }, text: 'XY' },
      { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } }, text: '12' }
    ]);
    expect(text).toBe('a12dXY');
  });

  it('rejects overlapping patches', () => {
    const base = 'abcdef';
    const text = applyPatches(base, [
      { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } }, text: 'XX' },
      { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 5 } }, text: 'YY' }
    ]);
    expect(text).toBeUndefined();
  });

  it('rejects out-of-range patches', () => {
    const base = 'abc';
    const text = applyPatch(base, {
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
      text: 'oops'
    });
    expect(text).toBeUndefined();
  });
});
