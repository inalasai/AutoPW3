import { createPrivilegedRpcClient, type PrivilegedRpcClient } from '../db/system-client';

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number | undefined;
}

export interface RateLimiter {
  check(
    key: string,
    limit: number,
    windowSeconds: number,
  ): RateLimitResult | Promise<RateLimitResult>;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  check(key: string, limit: number, windowSeconds: number): RateLimitResult {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, {
        count: 1,
        resetAt: now + windowSeconds * 1000,
      });
      return { allowed: true };
    }

    if (bucket.count >= limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return { allowed: false, retryAfterSeconds: retryAfter };
    }

    bucket.count += 1;
    return { allowed: true };
  }

  clear(): void {
    this.buckets.clear();
  }
}

export class SupabaseRateLimiter implements RateLimiter {
  private readonly rpc: PrivilegedRpcClient;

  constructor(supabaseUrl: string, serviceRoleKey: string, fetcher: typeof fetch = fetch) {
    this.rpc = createPrivilegedRpcClient(supabaseUrl, serviceRoleKey, fetcher);
  }

  async check(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
      throw new Error('Invalid rate limit');
    }
    if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86_400) {
      throw new Error('Invalid rate limit window');
    }
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${key}\u0000${limit}\u0000${windowSeconds}`),
    );
    const keyHash = `\\x${Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')}`;
    const rows = await this.rpc.call<readonly { allowed: boolean; retry_after_seconds: number }[]>(
      'worker_check_rate_limit',
      { p_key_hash: keyHash, p_limit: limit, p_window_seconds: windowSeconds },
    );
    const result = rows[0];
    if (
      !result ||
      typeof result.allowed !== 'boolean' ||
      !Number.isInteger(result.retry_after_seconds) ||
      result.retry_after_seconds < 1
    ) {
      throw new Error('Invalid durable rate limit response');
    }
    return result.allowed
      ? { allowed: true }
      : { allowed: false, retryAfterSeconds: result.retry_after_seconds };
  }
}

export const defaultRateLimiter = new InMemoryRateLimiter();

export function determineRateLimit(
  method: string,
  pathname: string,
  isAuthenticated: boolean,
): { limit: number; windowSeconds: number } {
  if (!isAuthenticated) {
    // 60 per minute for unauthenticated public requests
    return { limit: 60, windowSeconds: 60 };
  }

  if (pathname.includes('/invitations/accept') || pathname.includes('/provider/tesla')) {
    // 10 per minute on invitation accept and token-sensitive routes
    return { limit: 10, windowSeconds: 60 };
  }

  if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
    // 30 per minute on mutating routes
    return { limit: 30, windowSeconds: 60 };
  }

  // 120 per minute general
  return { limit: 120, windowSeconds: 60 };
}
