import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, deriveKey, generatePassphrase } from '../src/util/crypto';

describe('E2E crypto utilities', () => {
  it('deriveKey produces a 32-byte buffer', () => {
    const key = deriveKey('password', 'salt');
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it('deriveKey is deterministic for same input', () => {
    const key1 = deriveKey('password', 'salt');
    const key2 = deriveKey('password', 'salt');
    expect(key1.equals(key2)).toBe(true);
  });

  it('deriveKey produces different keys for different passphrases', () => {
    const key1 = deriveKey('password1', 'salt');
    const key2 = deriveKey('password2', 'salt');
    expect(key1.equals(key2)).toBe(false);
  });

  it('deriveKey produces different keys for different salts', () => {
    const key1 = deriveKey('password', 'salt1');
    const key2 = deriveKey('password', 'salt2');
    expect(key1.equals(key2)).toBe(false);
  });

  it('encrypt returns a valid EncryptedPayload', () => {
    const key = deriveKey('test', 'room1');
    const payload = encrypt('hello world', key);
    expect(payload).toHaveProperty('iv');
    expect(payload).toHaveProperty('data');
    expect(payload).toHaveProperty('authTag');
    expect(typeof payload.iv).toBe('string');
    expect(typeof payload.data).toBe('string');
    expect(typeof payload.authTag).toBe('string');
  });

  it('encrypt produces different ciphertexts each time (random IV)', () => {
    const key = deriveKey('test', 'room1');
    const a = encrypt('hello', key);
    const b = encrypt('hello', key);
    expect(a.data).not.toBe(b.data);
    expect(a.iv).not.toBe(b.iv);
  });

  it('decrypt recovers original plaintext', () => {
    const key = deriveKey('test', 'room1');
    const payload = encrypt('secret message', key);
    const result = decrypt(payload, key);
    expect(result).toBe('secret message');
  });

  it('decrypt with wrong key returns null', () => {
    const key1 = deriveKey('correct', 'room1');
    const key2 = deriveKey('wrong', 'room1');
    const payload = encrypt('secret message', key1);
    const result = decrypt(payload, key2);
    expect(result).toBeNull();
  });

  it('decrypt with tampered data returns null', () => {
    const key = deriveKey('test', 'room1');
    const payload = encrypt('hello', key);
    payload.data = Buffer.from('tampered').toString('base64');
    expect(decrypt(payload, key)).toBeNull();
  });

  it('decrypt with tampered authTag returns null', () => {
    const key = deriveKey('test', 'room1');
    const payload = encrypt('hello', key);
    payload.authTag = Buffer.from('bad').toString('base64');
    expect(decrypt(payload, key)).toBeNull();
  });

  it('handles empty string encryption/decryption', () => {
    const key = deriveKey('test', 'room1');
    const payload = encrypt('', key);
    expect(decrypt(payload, key)).toBe('');
  });

  it('handles unicode text', () => {
    const key = deriveKey('test', 'room1');
    const text = '你好世界 🌍 مرحبا';
    const payload = encrypt(text, key);
    expect(decrypt(payload, key)).toBe(text);
  });

  it('handles large text', () => {
    const key = deriveKey('test', 'room1');
    const text = 'x'.repeat(100_000);
    const payload = encrypt(text, key);
    expect(decrypt(payload, key)).toBe(text);
  });
});

describe('generatePassphrase', () => {
  it('returns a hyphen-separated string of 6 words', () => {
    const phrase = generatePassphrase();
    const parts = phrase.split('-');
    expect(parts.length).toBe(6);
    for (const word of parts) {
      expect(word.length).toBeGreaterThan(0);
      expect(/^[a-z]+$/.test(word)).toBe(true);
    }
  });

  it('generates different passphrases each time', () => {
    const phrases = new Set<string>();
    for (let i = 0; i < 20; i++) {
      phrases.add(generatePassphrase());
    }
    // With 256^6 combinations, all 20 should be unique
    expect(phrases.size).toBe(20);
  });

  it('only contains lowercase alphabetical characters and hyphens', () => {
    for (let i = 0; i < 10; i++) {
      const phrase = generatePassphrase();
      expect(/^[a-z]+(-[a-z]+)*$/.test(phrase)).toBe(true);
    }
  });
});
