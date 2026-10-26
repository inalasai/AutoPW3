/**
 * Authenticated Token Encryption Module
 *
 * Implements AES-256-GCM authenticated encryption for sensitive credentials at rest (Operation S4).
 * Uses the Web Crypto API (`crypto.subtle`) available in Cloudflare Workers and modern Node.js.
 *
 * Security Invariants:
 * - 256-bit AES-GCM encryption with 128-bit authentication tag.
 * - Per-record 96-bit (12-byte) cryptographically secure random IV generated via `crypto.getRandomValues`.
 * - Tamper detection: any modification to ciphertext, IV, or authentication tag throws `TamperError`.
 * - Key versioning: every encrypted payload records `keyVersion` enabling zero-downtime key rotation.
 * - Token material is never written to logs or exposed unencrypted.
 */

export interface EncryptedPayload {
  readonly ciphertext: string; // Base64-encoded ciphertext with appended GCM tag
  readonly iv: string; // Base64-encoded 12-byte IV
  readonly keyVersion: number;
}

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionError';
  }
}

export class TamperError extends EncryptionError {
  constructor(
    message = 'Ciphertext verification failed: payload has been tampered with or key is invalid',
  ) {
    super(message);
    this.name = 'TamperError';
  }
}

/**
 * Keyring mapping key versions to raw key bytes (32 bytes / 256 bits).
 */
export type Keyring = Readonly<Record<number, Uint8Array>>;

/**
 * Parse a secret key string (64-character hex or 44-character base64) into a 32-byte Uint8Array.
 */
export function parseSecretKey(keyString: string): Uint8Array {
  const trimmed = keyString.trim();
  if (trimmed.length === 64 && /^[0-9a-fA-F]{64}$/.test(trimmed)) {
    // Hex string (32 bytes = 64 hex chars)
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(trimmed.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  // Base64 string
  try {
    const binary = atob(trimmed);
    if (binary.length !== 32) {
      throw new Error(`Invalid key length: expected 32 bytes, got ${binary.length}`);
    }
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    throw new EncryptionError(
      `Invalid TOKEN_ENCRYPTION_KEY format: must be 32 bytes as 64-character hex or base64. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/**
 * Import raw key bytes into Web Crypto CryptoKey for AES-GCM.
 */
async function importCryptoKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    rawKey as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @param plaintext The secret string to encrypt (e.g. JSON stringified token bundle).
 * @param key Key bytes (32 bytes) or secret key string (hex/base64).
 * @param keyVersion Integer key version (defaults to 1).
 */
export async function encryptTokenPayload(
  plaintext: string,
  key: Uint8Array | string,
  keyVersion = 1,
): Promise<EncryptedPayload> {
  const rawKey = typeof key === 'string' ? parseSecretKey(key) : key;
  if (rawKey.byteLength !== 32) {
    throw new EncryptionError(`AES-256 requires exactly 32-byte key, got ${rawKey.byteLength}`);
  }

  const cryptoKey = await importCryptoKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(plaintext);

  try {
    const encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        tagLength: 128,
      },
      cryptoKey,
      encodedText,
    );

    return {
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer))),
      iv: btoa(String.fromCharCode(...iv)),
      keyVersion,
    };
  } catch (err) {
    throw new EncryptionError(
      `Encryption failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Decrypt an EncryptedPayload using AES-256-GCM.
 *
 * @param payload The encrypted ciphertext, IV, and keyVersion.
 * @param key Key bytes, secret key string, or Keyring mapping key versions to keys.
 */
export async function decryptTokenPayload(
  payload: EncryptedPayload,
  key: Uint8Array | string | Keyring,
): Promise<string> {
  let rawKey: Uint8Array;

  if (typeof key === 'object' && !(key instanceof Uint8Array)) {
    // Keyring provided
    const keyringKey = key[payload.keyVersion];
    if (!keyringKey) {
      throw new EncryptionError(`Unknown key version: ${payload.keyVersion}`);
    }
    rawKey = keyringKey;
  } else if (typeof key === 'string') {
    rawKey = parseSecretKey(key);
  } else {
    rawKey = key;
  }

  if (rawKey.byteLength !== 32) {
    throw new EncryptionError(`AES-256 requires exactly 32-byte key, got ${rawKey.byteLength}`);
  }

  let iv: Uint8Array;
  let ciphertextBytes: Uint8Array;

  try {
    const rawIv = atob(payload.iv);
    iv = new Uint8Array(rawIv.length);
    for (let i = 0; i < rawIv.length; i++) {
      iv[i] = rawIv.charCodeAt(i);
    }

    const rawCiphertext = atob(payload.ciphertext);
    ciphertextBytes = new Uint8Array(rawCiphertext.length);
    for (let i = 0; i < rawCiphertext.length; i++) {
      ciphertextBytes[i] = rawCiphertext.charCodeAt(i);
    }
  } catch (err) {
    throw new TamperError(
      `Corrupted base64 encoding in payload: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const cryptoKey = await importCryptoKey(rawKey);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        tagLength: 128,
      },
      cryptoKey,
      ciphertextBytes,
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch {
    // Web Crypto decrypt throws on GCM tag verification mismatch
    throw new TamperError();
  }
}
