import { describe, expect, it } from 'vitest';
import {
  decryptTokenPayload,
  encryptTokenPayload,
  EncryptionError,
  parseSecretKey,
  TamperError,
} from './encryption';

describe('Authenticated Token Encryption (AES-256-GCM)', () => {
  const testKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const testPlaintext = JSON.stringify({
    accessToken: 'test-access-token-12345',
    refreshToken: 'test-refresh-token-67890',
    expiresAt: 1700000000,
  });

  it('parses valid 64-character hex key into 32-byte array', () => {
    const keyBytes = parseSecretKey(testKeyHex);
    expect(keyBytes).toBeInstanceOf(Uint8Array);
    expect(keyBytes.byteLength).toBe(32);
    expect(keyBytes[0]).toBe(0x01);
    expect(keyBytes[31]).toBe(0xef);
  });

  it('parses valid 32-byte base64 key into 32-byte array', () => {
    const raw = new Uint8Array(32);
    raw.fill(42);
    const b64 = btoa(String.fromCharCode(...raw));
    const keyBytes = parseSecretKey(b64);
    expect(keyBytes.byteLength).toBe(32);
    expect(keyBytes[0]).toBe(42);
  });

  it('rejects invalid key lengths with EncryptionError', () => {
    expect(() => parseSecretKey('too-short')).toThrow(EncryptionError);
  });

  it('encrypts and decrypts plaintext symmetrically without data loss', async () => {
    const encrypted = await encryptTokenPayload(testPlaintext, testKeyHex, 1);
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.keyVersion).toBe(1);

    const decrypted = await decryptTokenPayload(encrypted, testKeyHex);
    expect(decrypted).toBe(testPlaintext);
    const parsed = JSON.parse(decrypted);
    expect(parsed.accessToken).toBe('test-access-token-12345');
  });

  it('generates unique IVs and distinct ciphertexts for identical plaintext', async () => {
    const enc1 = await encryptTokenPayload(testPlaintext, testKeyHex);
    const enc2 = await encryptTokenPayload(testPlaintext, testKeyHex);

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);

    // Both decrypt to the same plaintext
    expect(await decryptTokenPayload(enc1, testKeyHex)).toBe(testPlaintext);
    expect(await decryptTokenPayload(enc2, testKeyHex)).toBe(testPlaintext);
  });

  it('detects tampering with ciphertext and throws TamperError', async () => {
    const encrypted = await encryptTokenPayload(testPlaintext, testKeyHex);

    // Tamper with base64 ciphertext
    const raw = atob(encrypted.ciphertext);
    const tamperedRaw = String.fromCharCode(raw.charCodeAt(0) ^ 0xff) + raw.slice(1);
    const tamperedPayload = {
      ...encrypted,
      ciphertext: btoa(tamperedRaw),
    };

    await expect(decryptTokenPayload(tamperedPayload, testKeyHex)).rejects.toThrow(TamperError);
  });

  it('detects tampering with IV and throws TamperError', async () => {
    const encrypted = await encryptTokenPayload(testPlaintext, testKeyHex);

    const rawIv = atob(encrypted.iv);
    const tamperedIv = String.fromCharCode(rawIv.charCodeAt(0) ^ 0x01) + rawIv.slice(1);
    const tamperedPayload = {
      ...encrypted,
      iv: btoa(tamperedIv),
    };

    await expect(decryptTokenPayload(tamperedPayload, testKeyHex)).rejects.toThrow(TamperError);
  });

  it('supports key rotation via Keyring mapping key versions to keys', async () => {
    const oldKey = parseSecretKey(testKeyHex);
    const newKeyHex = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    const newKey = parseSecretKey(newKeyHex);

    const keyring = {
      1: oldKey,
      2: newKey,
    };

    // Payload encrypted with version 1
    const encV1 = await encryptTokenPayload(testPlaintext, oldKey, 1);
    // Payload encrypted with version 2
    const encV2 = await encryptTokenPayload(testPlaintext, newKey, 2);

    expect(await decryptTokenPayload(encV1, keyring)).toBe(testPlaintext);
    expect(await decryptTokenPayload(encV2, keyring)).toBe(testPlaintext);

    // Unknown key version throws
    const encV3 = { ...encV1, keyVersion: 3 };
    await expect(decryptTokenPayload(encV3, keyring)).rejects.toThrow(EncryptionError);
  });
});
