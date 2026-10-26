import { decryptTokenPayload, encryptTokenPayload, type EncryptedPayload } from './encryption';

/**
 * Decrypted Tesla Token Bundle stored at rest.
 * Never leaves the Worker and never appears in user-facing responses or logs.
 */
export interface DecryptedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number; // Unix timestamp in seconds
  readonly tokenType: string;
  readonly scope: string;
  readonly regionBaseUrl: string;
}

export interface StoredEncryptedRecord {
  readonly siteId: string;
  readonly encryptedPayload: EncryptedPayload;
  readonly expiresAt: number;
  readonly updatedAt: string;
}

export interface TokenStore {
  saveTokens(siteId: string, tokens: DecryptedTokens): Promise<void>;
  getTokens(siteId: string): Promise<DecryptedTokens | null>;
  deleteTokens(siteId: string): Promise<void>;
  acquireRefreshLock(siteId: string, ttlMs?: number): Promise<boolean>;
  releaseRefreshLock(siteId: string): Promise<void>;
}

/**
 * Checks whether an access token is expired or within threshold seconds of expiring.
 * S12 recommends renewing within one minute; we default to 5 minutes (300s) to be conservative.
 */
export function isTokenExpiredOrExpiring(
  expiresAtUnixSeconds: number,
  thresholdSeconds = 300,
): boolean {
  const nowUnixSeconds = Math.floor(Date.now() / 1000);
  return expiresAtUnixSeconds - nowUnixSeconds <= thresholdSeconds;
}

/**
 * Redacts any token material, client secrets, or auth headers from objects before logging.
 */
export function sanitizeForLog<T>(input: T): T {
  if (input === null || typeof input !== 'object') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeForLog(item)) as unknown as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('token') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('password') ||
      lowerKey.includes('authorization') ||
      lowerKey === 'code'
    ) {
      output[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      output[key] = sanitizeForLog(val);
    } else {
      output[key] = val;
    }
  }

  return output as T;
}

/**
 * In-memory Token Store implementation for testing and development.
 */
export class InMemoryTokenStore implements TokenStore {
  private readonly records = new Map<string, StoredEncryptedRecord>();
  private readonly locks = new Map<string, number>(); // siteId -> expiresAt timestamp
  private readonly encryptionKey: string;
  private readonly keyVersion: number;

  constructor(encryptionKey: string, keyVersion = 1) {
    this.encryptionKey = encryptionKey;
    this.keyVersion = keyVersion;
  }

  async saveTokens(siteId: string, tokens: DecryptedTokens): Promise<void> {
    const plaintext = JSON.stringify(tokens);
    const encryptedPayload = await encryptTokenPayload(
      plaintext,
      this.encryptionKey,
      this.keyVersion,
    );

    this.records.set(siteId, {
      siteId,
      encryptedPayload,
      expiresAt: tokens.expiresAt,
      updatedAt: new Date().toISOString(),
    });
  }

  async getTokens(siteId: string): Promise<DecryptedTokens | null> {
    const record = this.records.get(siteId);
    if (!record) {
      return null;
    }

    const plaintext = await decryptTokenPayload(record.encryptedPayload, this.encryptionKey);
    return JSON.parse(plaintext) as DecryptedTokens;
  }

  async deleteTokens(siteId: string): Promise<void> {
    this.records.delete(siteId);
    this.locks.delete(siteId);
  }

  async acquireRefreshLock(siteId: string, ttlMs = 15_000): Promise<boolean> {
    const now = Date.now();
    const currentLockUntil = this.locks.get(siteId);

    if (currentLockUntil && currentLockUntil > now) {
      // Lock is actively held by another process
      return false;
    }

    this.locks.set(siteId, now + ttlMs);
    return true;
  }

  async releaseRefreshLock(siteId: string): Promise<void> {
    this.locks.delete(siteId);
  }
}
