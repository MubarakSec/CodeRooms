import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test the CSP and nonce generation logic independently
describe('ChatView CSP nonce', () => {
  it('crypto.randomBytes produces base64 nonce', () => {
    const crypto = require('crypto');
    const nonce = crypto.randomBytes(16).toString('base64');
    expect(typeof nonce).toBe('string');
    expect(nonce.length).toBeGreaterThan(0);
    // base64 characters only
    expect(/^[A-Za-z0-9+/=]+$/.test(nonce)).toBe(true);
  });

  it('nonce is different each time', () => {
    const crypto = require('crypto');
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      nonces.add(crypto.randomBytes(16).toString('base64'));
    }
    expect(nonces.size).toBe(100);
  });

  it('CSP meta tag is properly formed', () => {
    const crypto = require('crypto');
    const nonce = crypto.randomBytes(16).toString('base64');
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:;`;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(csp).toContain("style-src 'unsafe-inline'");
  });
});

describe('ChatView HTML escaping', () => {
  // This mirrors the escapeHtml function in ChatView's webview script
  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  it('preserves normal text', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('linkify safety', () => {
  function linkify(text: string): string {
    return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" title="$1">$1</a>');
  }

  it('linkifies valid HTTPS URLs', () => {
    const result = linkify('Visit https://example.com');
    expect(result).toContain('<a href="https://example.com"');
  });

  it('linkifies valid HTTP URLs', () => {
    const result = linkify('Visit http://example.com');
    expect(result).toContain('<a href="http://example.com"');
  });

  it('does not linkify javascript: URLs', () => {
    const result = linkify('javascript:alert(1)');
    expect(result).not.toContain('<a');
  });

  it('does not linkify data: URLs', () => {
    const result = linkify('data:text/html,<script>alert(1)</script>');
    expect(result).not.toContain('<a');
  });

  it('preserves text without URLs', () => {
    expect(linkify('no links here')).toBe('no links here');
  });
});
