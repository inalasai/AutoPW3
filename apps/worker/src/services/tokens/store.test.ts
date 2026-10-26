import { describe, expect, it } from 'vitest';
import {
  InMemoryTokenStore,
  isTokenExpiredOrExpiring,
  sanitizeForLog,
  type DecryptedTokens,
} from './store';

describe('Token Store & Sanitization', () => {
  const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const siteId = '22222222-2222-4222-8222-222222222222';

  const sampleTokens: DecryptedTokens = {
    accessToken: 'live-access-token-abc',
    refreshToken: 'live-refresh-token-xyz',
    expiresAt: Math.floor(Date.now() / 1000) + 28800,
    tokenType: 'Bearer',
    scope: 'openid offline_access energy_device_data',
    regionBaseUrl: 'https://fleet-api.prd.eu.vn.cloud.tesla.com',
  };

  it('persists and retrieves encrypted tokens cleanly', async () => {
    const store = new InMemoryTokenStore(testKey);
    await store.saveTokens(siteId, sampleTokens);

    const retrieved = await store.getTokens(siteId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.accessToken).toBe(sampleTokens.accessToken);
    expect(retrieved?.refreshToken).toBe(sampleTokens.refreshToken);
    expect(retrieved?.regionBaseUrl).toBe(sampleTokens.regionBaseUrl);
  });

  it('deletes stored tokens and clears lock', async () => {
    const store = new InMemoryTokenStore(testKey);
    await store.saveTokens(siteId, sampleTokens);
    await store.acquireRefreshLock(siteId);

    await store.deleteTokens(siteId);
    expect(await store.getTokens(siteId)).toBeNull();

    // Lock can be acquired immediately again
    expect(await store.acquireRefreshLock(siteId)).toBe(true);
  });

  it('enforces concurrency control on refresh lock', async () => {
    const store = new InMemoryTokenStore(testKey);

    // First process acquires lock
    const locked1 = await store.acquireRefreshLock(siteId, 10_000);
    expect(locked1).toBe(true);

    // Concurrent process is locked out
    const locked2 = await store.acquireRefreshLock(siteId, 10_000);
    expect(locked2).toBe(false);

    // Release lock
    await store.releaseRefreshLock(siteId);

    // Second process can now acquire lock
    const locked3 = await store.acquireRefreshLock(siteId, 10_000);
    expect(locked3).toBe(true);
  });

  it('isTokenExpiredOrExpiring detects expiring tokens within threshold', () => {
    const now = Math.floor(Date.now() / 1000);

    // Expired 10 seconds ago
    expect(isTokenExpiredOrExpiring(now - 10)).toBe(true);

    // Expires in 100 seconds (under default 300s threshold)
    expect(isTokenExpiredOrExpiring(now + 100)).toBe(true);

    // Expires in 600 seconds (outside 300s threshold)
    expect(isTokenExpiredOrExpiring(now + 600)).toBe(false);
  });

  it('sanitizeForLog strips sensitive credentials and tokens from logs', () => {
    const sensitivePayload = {
      user: 'alice',
      access_token: 'secret-access-token-123',
      refreshToken: 'secret-refresh-token-456',
      client_secret: 'super-secret-key',
      headers: {
        authorization: 'Bearer secret-jwt',
        'content-type': 'application/json',
      },
      code: 'oauth-auth-code-789',
      safeMetric: 42,
    };

    const sanitized = sanitizeForLog(sensitivePayload);
    expect(sanitized.user).toBe('alice');
    expect(sanitized.access_token).toBe('[REDACTED]');
    expect(sanitized.refreshToken).toBe('[REDACTED]');
    expect(sanitized.client_secret).toBe('[REDACTED]');
    expect(sanitized.headers.authorization).toBe('[REDACTED]');
    expect(sanitized.headers['content-type']).toBe('application/json');
    expect(sanitized.code).toBe('[REDACTED]');
    expect(sanitized.safeMetric).toBe(42);
  });
});
