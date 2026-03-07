import * as crypto from 'crypto';

/**
 * E2E Encryption utilities for CodeRooms
 * Uses AES-256-GCM for authenticated encryption
 */

export interface EncryptedPayload {
  iv: string; // Base64 encoded initialization vector
  data: string; // Base64 encoded ciphertext
  authTag: string; // Base64 encoded authentication tag
}

/**
 * Derives a 256-bit encryption key from a passphrase using PBKDF2
 * @param passphrase Room passphrase
 * @param salt Salt (typically room ID)
 * @returns Encryption key buffer
 */
export function deriveKey(passphrase: string, salt: string): Buffer {
  return crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
}

/**
 * Encrypts text using AES-256-GCM
 * @param plaintext Text to encrypt
 * @param key Encryption key (32 bytes)
 * @returns Encrypted payload
 */
export function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = crypto.randomBytes(12); // GCM standard IV size
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  const authTag = cipher.getAuthTag();
  
  return {
    iv: iv.toString('base64'),
    data: encrypted.toString('base64'),
    authTag: authTag.toString('base64')
  };
}

/**
 * Decrypts text using AES-256-GCM
 * @param payload Encrypted payload
 * @param key Encryption key (32 bytes)
 * @returns Decrypted plaintext or null on failure
 */
export function decrypt(payload: EncryptedPayload, key: Buffer): string | null {
  try {
    const iv = Buffer.from(payload.iv, 'base64');
    const encrypted = Buffer.from(payload.data, 'base64');
    const authTag = Buffer.from(payload.authTag, 'base64');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    // Decryption failed (wrong key, tampered data, etc.)
    return null;
  }
}

/**
 * Generates a random passphrase for a room
 * @returns Random passphrase string
 */
export function generatePassphrase(): string {
  const words = [
    'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',
    'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima',
    'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo',
    'sierra', 'tango', 'uniform', 'victor', 'whiskey', 'xray',
    'yankee', 'zulu'
  ];
  
  const randomWords: string[] = [];
  for (let i = 0; i < 4; i++) {
    randomWords.push(words[Math.floor(Math.random() * words.length)]);
  }
  
  return randomWords.join('-');
}
