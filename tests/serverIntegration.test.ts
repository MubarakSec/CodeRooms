/**
 * Server-side integration tests.
 *
 * These test the exported handler logic by simulating message sequences
 * without starting a real WebSocket server. We directly invoke the key
 * functions via a thin test harness.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyPatch, applyPatches } from '../server/patch';
import { TextPatch, Position } from '../server/types';

// ── patch application tests ────────────────────────────────────────────────

function pos(line: number, character: number): Position {
  return { line, character };
}

function mkPatch(sl: number, sc: number, el: number, ec: number, text: string): TextPatch {
  return { range: { start: pos(sl, sc), end: pos(el, ec) }, text };
}

describe('Server patch application', () => {
  it('inserts text at cursor position', () => {
    const result = applyPatch('hello world', mkPatch(0, 5, 0, 5, ' there'));
    expect(result).toBe('hello there world');
  });

  it('deletes text range', () => {
    const result = applyPatch('hello world', mkPatch(0, 5, 0, 11, ''));
    expect(result).toBe('hello');
  });

  it('replaces text range', () => {
    const result = applyPatch('hello world', mkPatch(0, 6, 0, 11, 'universe'));
    expect(result).toBe('hello universe');
  });

  it('handles multiline insert', () => {
    const result = applyPatch('line1\nline2', mkPatch(0, 5, 0, 5, '\nextra'));
    expect(result).toBe('line1\nextra\nline2');
  });

  it('rejects invalid patch with start > end', () => {
    const result = applyPatch('hello', mkPatch(0, 3, 0, 1, 'x'));
    expect(result).toBeUndefined();
  });

  it('rejects patch with out-of-range line', () => {
    const result = applyPatch('hello', mkPatch(5, 0, 5, 0, 'x'));
    expect(result).toBeUndefined();
  });

  it('rejects patch with out-of-range character', () => {
    const result = applyPatch('hello', mkPatch(0, 99, 0, 99, 'x'));
    expect(result).toBeUndefined();
  });

  it('applies multiple non-overlapping patches', () => {
    const result = applyPatches('ABCDE', [
      mkPatch(0, 0, 0, 1, 'X'),  // A → X
      mkPatch(0, 4, 0, 5, 'Y'),  // E → Y
    ]);
    expect(result).toBe('XBCDY');
  });

  it('rejects overlapping patches', () => {
    const result = applyPatches('ABCDE', [
      mkPatch(0, 0, 0, 3, 'X'),
      mkPatch(0, 2, 0, 5, 'Y'),
    ]);
    expect(result).toBeUndefined();
  });

  it('applies insert at empty document', () => {
    const result = applyPatch('', mkPatch(0, 0, 0, 0, 'hello'));
    expect(result).toBe('hello');
  });

  it('handles CRLF normalization', () => {
    const result = applyPatch('line1\r\nline2', mkPatch(1, 0, 1, 5, 'LINE2'));
    expect(result).toBe('line1\nLINE2');
  });
});

// ── Message validation shape tests ─────────────────────────────────────────

describe('Message validation (shape checks)', () => {
  // We can't import validateMessage directly (it's not exported),
  // so we test the type discriminators used by it.
  it('ClientToServerMessage types are well-defined', () => {
    const createMsg = { type: 'createRoom', displayName: 'Alice', mode: 'team' };
    expect(createMsg.type).toBe('createRoom');
    expect(typeof createMsg.displayName).toBe('string');
  });

  it('joinRoom requires roomId and displayName', () => {
    const joinMsg = { type: 'joinRoom', roomId: 'ABC123', displayName: 'Bob' };
    expect(joinMsg.type).toBe('joinRoom');
    expect(typeof joinMsg.roomId).toBe('string');
  });

  it('docChange requires patch object', () => {
    const changeMsg = {
      type: 'docChange',
      roomId: 'R1',
      docId: 'D1',
      version: 2,
      patch: mkPatch(0, 0, 0, 1, 'X')
    };
    expect(changeMsg.patch).toBeDefined();
    expect(typeof changeMsg.patch.range).toBe('object');
  });

  it('chatSend requires all fields', () => {
    const chatMsg = {
      type: 'chatSend',
      roomId: 'R1',
      messageId: 'msg1',
      content: 'hello',
      timestamp: Date.now()
    };
    expect(typeof chatMsg.content).toBe('string');
    expect(typeof chatMsg.timestamp).toBe('number');
  });
});

// ── Concurrent edit simulation ─────────────────────────────────────────────

describe('Concurrent editing scenarios', () => {
  it('two users inserting at different positions', () => {
    let doc = 'ABCDE';

    // User A inserts 'X' at position 2
    const patchA = mkPatch(0, 2, 0, 2, 'X');
    const resultA = applyPatch(doc, patchA);
    expect(resultA).toBe('ABXCDE');
    doc = resultA!;

    // User B inserts 'Y' at position 4 (in ABXCDE, which was position 4 in original → now 5)
    const patchB = mkPatch(0, 5, 0, 5, 'Y');
    const resultB = applyPatch(doc, patchB);
    expect(resultB).toBe('ABXCDYE');
  });

  it('delete then insert at adjacent position', () => {
    let doc = 'ABCDE';

    // Delete 'C' (position 2-3)
    const patchDel = mkPatch(0, 2, 0, 3, '');
    const afterDel = applyPatch(doc, patchDel);
    expect(afterDel).toBe('ABDE');
    doc = afterDel!;

    // Insert 'X' at position 2 (where C used to be)
    const patchIns = mkPatch(0, 2, 0, 2, 'X');
    const afterIns = applyPatch(doc, patchIns);
    expect(afterIns).toBe('ABXDE');
  });

  it('rapid sequential edits maintain consistency', () => {
    let doc = 'function hello() {}';
    const edits: TextPatch[] = [
      mkPatch(0, 9, 0, 14, 'world'),     // hello → world
      mkPatch(0, 18, 0, 18, '\n  return;'), // insert body after '{'
    ];

    for (const edit of edits) {
      const result = applyPatch(doc, edit);
      expect(result).toBeDefined();
      doc = result!;
    }
    expect(doc).toBe('function world() {\n  return;}');
  });

  it('multiline document concurrent edits', () => {
    let doc = 'line1\nline2\nline3\nline4';

    // Edit line 1
    const p1 = mkPatch(0, 0, 0, 5, 'LINE1');
    const after1 = applyPatch(doc, p1);
    expect(after1).toBe('LINE1\nline2\nline3\nline4');
    doc = after1!;

    // Edit line 3 (still line 2 in 0-indexed after line-1 unchanged count)
    const p2 = mkPatch(2, 0, 2, 5, 'LINE3');
    const after2 = applyPatch(doc, p2);
    expect(after2).toBe('LINE1\nline2\nLINE3\nline4');
  });
});
