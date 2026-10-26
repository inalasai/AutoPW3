export interface RateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number | undefined;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiter {
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
