import { describe, it, expect } from 'vitest';
import { applyPatch, applyPatches } from '../server/patch';

describe('patch CRLF handling', () => {
  it('handles CRLF line endings in text', () => {
    const base = 'line one\r\nline two\r\nline three';
    const result = applyPatch(base, {
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 8 } },
      text: 'replaced'
    });
    expect(result).toBeDefined();
    expect(result).toContain('replaced');
  });

  it('handles mixed LF and CRLF', () => {
    const base = 'line one\nline two\r\nline three';
    const result = applyPatch(base, {
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 10 } },
      text: 'FIXED'
    });
    expect(result).toBeDefined();
    expect(result).toContain('FIXED');
  });

  it('applies insertion at start of CRLF line', () => {
    const base = 'aaa\r\nbbb\r\nccc';
    const result = applyPatch(base, {
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
      text: 'PREFIX'
    });
    expect(result).toContain('PREFIXbbb');
  });

  it('rejects negative positions', () => {
    const base = 'hello';
    expect(applyPatch(base, {
      range: { start: { line: -1, character: 0 }, end: { line: 0, character: 5 } },
      text: 'x'
    })).toBeUndefined();
  });

  it('rejects character beyond line length', () => {
    const base = 'short';
    expect(applyPatch(base, {
      range: { start: { line: 0, character: 100 }, end: { line: 0, character: 100 } },
      text: 'x'
    })).toBeUndefined();
  });

  it('rejects line beyond document', () => {
    const base = 'one line';
    expect(applyPatch(base, {
      range: { start: { line: 5, character: 0 }, end: { line: 5, character: 0 } },
      text: 'x'
    })).toBeUndefined();
  });

  it('applies multiple non-overlapping patches on CRLF text', () => {
    const base = 'aaa\r\nbbb\r\nccc';
    const result = applyPatches(base, [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, text: 'AAA' },
      { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } }, text: 'CCC' }
    ]);
    expect(result).toBeDefined();
    expect(result).toContain('AAA');
    expect(result).toContain('CCC');
  });

  it('handles empty document', () => {
    const base = '';
    const result = applyPatch(base, {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      text: 'inserted'
    });
    expect(result).toBe('inserted');
  });

  it('handles single newline document', () => {
    const base = '\n';
    const result = applyPatch(base, {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      text: 'x'
    });
    expect(result).toBe('x\n');
  });
});
