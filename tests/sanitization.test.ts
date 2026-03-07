import { describe, it, expect } from 'vitest';

// Test the escapeMarkdown function logic used in ParticipantsView
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}\[\]()#+\-.!|~<>]/g, '\\$&');
}

describe('display name sanitization', () => {
  it('escapes markdown bold syntax', () => {
    expect(escapeMarkdown('**bold**')).toBe('\\*\\*bold\\*\\*');
  });

  it('escapes markdown link syntax', () => {
    expect(escapeMarkdown('[link](http://evil.com)')).toBe('\\[link\\]\\(http://evil\\.com\\)');
  });

  it('escapes backtick code injection', () => {
    expect(escapeMarkdown('`code`')).toBe('\\`code\\`');
  });

  it('escapes HTML-like tags', () => {
    expect(escapeMarkdown('<script>alert(1)</script>')).toBe('\\<script\\>alert\\(1\\)\\</script\\>');
  });

  it('preserves normal display names', () => {
    expect(escapeMarkdown('Alice')).toBe('Alice');
    expect(escapeMarkdown('Bob Smith')).toBe('Bob Smith');
    expect(escapeMarkdown('用户1')).toBe('用户1');
  });

  it('escapes heading syntax', () => {
    expect(escapeMarkdown('# Heading')).toBe('\\# Heading');
  });

  it('escapes pipe for table injection', () => {
    expect(escapeMarkdown('| cell |')).toBe('\\| cell \\|');
  });

  it('handles empty string', () => {
    expect(escapeMarkdown('')).toBe('');
  });
});
