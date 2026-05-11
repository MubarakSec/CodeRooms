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

export function encryptBinary(plaintext: Uint8Array, key: Buffer): Uint8Array {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(plaintext);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  const authTag = cipher.getAuthTag();
  
  // Format: [12 bytes IV] [16 bytes AuthTag] [Ciphertext]
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypts binary data using AES-256-GCM
 * @param payload Encrypted binary payload [12 IV + 16 AuthTag + Ciphertext]
 * @param key Encryption key (32 bytes)
 * @returns Decrypted plaintext or null on failure
 */
export function decryptBinary(payload: Uint8Array, key: Buffer): Uint8Array | null {
  try {
    if (payload.length < 28) return null;
    
    const buf = Buffer.from(payload);
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted;
  } catch (error) {
    return null;
  }
}

/**
 * Generates a random passphrase for a room using a 256-word list and 6 words (~48 bits entropy)
 * @returns Random passphrase string
 */
export function generatePassphrase(): string {
  // 256-word list (8 bits per word × 6 words = 48 bits entropy)
  const words = [
    'anchor', 'arctic', 'atlas', 'autumn', 'badge', 'barrel', 'beacon', 'blade',
    'bloom', 'board', 'bridge', 'bronze', 'cabin', 'candle', 'canyon', 'cargo',
    'cedar', 'chain', 'chief', 'cliff', 'cloud', 'comet', 'coral', 'crane',
    'crown', 'crystal', 'curve', 'cycle', 'dawn', 'delta', 'desert', 'drift',
    'eagle', 'ember', 'engine', 'epoch', 'fable', 'falcon', 'field', 'flame',
    'fleet', 'flint', 'flora', 'forge', 'frost', 'future', 'garden', 'gate',
    'ghost', 'glacier', 'globe', 'grain', 'grove', 'guard', 'guide', 'harbor',
    'harvest', 'haven', 'hawk', 'hearth', 'herald', 'hollow', 'horizon', 'hunter',
    'ivory', 'jade', 'jewel', 'journal', 'jungle', 'karma', 'kennel', 'kernel',
    'kettle', 'lantern', 'latch', 'laurel', 'legend', 'lemon', 'lever', 'light',
    'linden', 'lodge', 'lotus', 'lunar', 'magnet', 'manor', 'maple', 'marble',
    'marsh', 'meadow', 'medal', 'meteor', 'mirror', 'moose', 'mortar', 'mosaic',
    'noble', 'north', 'novel', 'nutmeg', 'oasis', 'ocean', 'olive', 'onyx',
    'orbit', 'otter', 'oxide', 'oyster', 'palace', 'palm', 'panel', 'parade',
    'pearl', 'pepper', 'piano', 'pilot', 'pine', 'plume', 'polar', 'portal',
    'prism', 'pulse', 'quartz', 'quest', 'radar', 'raven', 'realm', 'reef',
    'ridge', 'river', 'robin', 'rocket', 'royal', 'ruby', 'sage', 'sail',
    'salmon', 'sandal', 'satin', 'scale', 'scout', 'shadow', 'shell', 'shield',
    'shore', 'shrub', 'sigma', 'silver', 'sketch', 'slate', 'slope', 'solar',
    'spark', 'sphere', 'spire', 'spring', 'spruce', 'staff', 'stage', 'stamp',
    'steel', 'stone', 'storm', 'stream', 'studio', 'summit', 'sunset', 'surge',
    'swift', 'symbol', 'table', 'talon', 'temple', 'terra', 'throne', 'timber',
    'token', 'torch', 'tower', 'trail', 'trend', 'tribe', 'tropic', 'trust',
    'tulip', 'tunnel', 'ultra', 'unity', 'upper', 'urban', 'valley', 'vault',
    'velvet', 'verse', 'vigor', 'villa', 'violet', 'viper', 'vivid', 'voice',
    'voyage', 'walnut', 'watch', 'water', 'whale', 'wheat', 'wheel', 'willow',
    'wind', 'winter', 'wisdom', 'wolf', 'wonder', 'yacht', 'zenith', 'zinc',
    'amber', 'arrow', 'basalt', 'berry', 'birch', 'blaze', 'breeze', 'brook',
    'canopy', 'castle', 'cherry', 'cipher', 'coast', 'copper', 'crest', 'cypress',
    'dagger', 'diamond', 'dragon', 'dusk', 'falcon', 'feather', 'fern', 'fig',
    'fossil', 'fox', 'garnet', 'geyser', 'golden', 'granite', 'gust', 'haze',
    'horse', 'island', 'jasper', 'maple', 'mystic', 'oak', 'orchid', 'pebble'
  ];

  const wordCount = 6;
  const randomWords: string[] = [];
  const bytes = crypto.randomBytes(wordCount);
  for (let i = 0; i < wordCount; i++) {
    randomWords.push(words[bytes[i] % words.length]);
  }

  return randomWords.join('-');
}
