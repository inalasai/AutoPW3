export interface StoredIdempotencyRecord {
  readonly key: string;
  readonly scope: string;
  readonly bodyHash: string;
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly createdAt: number;
}

export interface IdempotencyStore {
  get(scope: string, key: string): Promise<StoredIdempotencyRecord | null>;
  set(record: StoredIdempotencyRecord): Promise<void>;
}

/**
 * In-memory store for idempotency records with TTL cleanup.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, StoredIdempotencyRecord>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 24 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  private compositeKey(scope: string, key: string): string {
    return `${scope}:::${key}`;
  }

  async get(scope: string, key: string): Promise<StoredIdempotencyRecord | null> {
    const k = this.compositeKey(scope, key);
    const rec = this.records.get(k);
    if (!rec) return null;

    if (Date.now() - rec.createdAt > this.ttlMs) {
      this.records.delete(k);
      return null;
    }
    return rec;
  }

  async set(record: StoredIdempotencyRecord): Promise<void> {
    const k = this.compositeKey(record.scope, record.key);
    this.records.set(k, record);
  }

  clear(): void {
    this.records.clear();
  }
}

export const defaultIdempotencyStore = new InMemoryIdempotencyStore();

export async function hashCanonicalBody(bodyText: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(bodyText);
  const digestBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(digestBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{8,128}$/;

export function isValidIdempotencyKey(key: string): boolean {
  return IDEMPOTENCY_KEY_REGEX.test(key);
}
