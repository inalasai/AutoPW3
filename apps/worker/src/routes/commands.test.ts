import { describe, expect, it } from 'vitest';
import { InMemoryRepository } from '../db/repository';
import type { Env } from '../env';
import { handleApiRequest } from '../lib/app';
import { InMemoryIdempotencyStore } from '../lib/idempotency';
import { InMemoryRateLimiter } from '../lib/rate-limiter';
import { MockTeslaClient } from '../providers/tesla/mock-adapter';
import { InMemoryOAuthStateStore } from '../providers/tesla/oauth';
import { InMemoryTokenStore } from '../services/tokens/store';
import { createTestJwt, getTestAuthKeys } from '../test/jwt-helpers';

// Helper for parsing JSON responses in tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonOf<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function makeTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    SUPABASE_URL: 'https://project.supabase.co',
    ALLOWED_ORIGINS: 'http://localhost:5173,https://app.autopw3.com',
    TESLA_CLIENT_ID: 'mock-tesla-client-id',
    TESLA_CLIENT_SECRET: 'mock-tesla-client-secret',
    TESLA_REDIRECT_URI: 'https://app.autopw3.com/provider/tesla/callback',
    TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    ASSETS: {
      fetch: (): Promise<Response> => Promise.resolve(new Response('OK')),
      connect: () => {
        throw new Error('not used');
      },
    } as unknown as Fetcher,
    ...overrides,
  };
}

async function makeTestContext() {
  const keys = await getTestAuthKeys();
  const repo = new InMemoryRepository();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const rateLimiter = new InMemoryRateLimiter();
  const tokenStore = new InMemoryTokenStore(
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  );
  const oauthStateStore = new InMemoryOAuthStateStore();
  const teslaClient = new MockTeslaClient();
  const env = makeTestEnv();
  const jwtConfig = {
    supabaseUrl: env.SUPABASE_URL,
    testKeySet: keys.publicKey,
  };

  const adminToken = await createTestJwt({ userId: '44444444-4444-4444-8444-444444444444' }, keys);
  const rwToken = await createTestJwt({ userId: '55555555-5555-4555-8555-555555555555' }, keys);
  const roToken = await createTestJwt({ userId: '66666666-6666-4666-8666-666666666666' }, keys);

  return {
    repo,
    idempotencyStore,
    rateLimiter,
    tokenStore,
    oauthStateStore,
    teslaClient,
    env,
    jwtConfig,
    adminToken,
    rwToken,
    roToken,
  };
}

describe('Device Commands Routes', () => {
  const siteId = '22222222-2222-4222-8222-222222222222';
  const householdId = '11111111-1111-4111-8111-111111111111';

  it('rejects dispatch when caller has READ_ONLY role (acceptance criterion)', async () => {
    const ctx = await makeTestContext();

    const req = new Request(`https://api.autopw3.com/api/v1/sites/${siteId}/commands`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ctx.roToken}`,
        'idempotency-key': 'ro-attempt-001',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'SET_BACKUP_RESERVE',
        params: { backupReservePercent: 50 },
      }),
    });

    const res = await handleApiRequest(req, ctx.env, ctx);

    expect(res.status).toBe(403);
    const body = await jsonOf(res);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('READ_WRITE role required');
  });

  it('requires Idempotency-Key header on command creation', async () => {
    const ctx = await makeTestContext();

    const req = new Request(`https://api.autopw3.com/api/v1/sites/${siteId}/commands`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ctx.rwToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'SET_BACKUP_RESERVE',
        params: { backupReservePercent: 50 },
      }),
    });

    const res = await handleApiRequest(req, ctx.env, ctx);

    expect(res.status).toBe(422);
    const body = await jsonOf(res);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('dispatches supported command with READ_WRITE role and returns 202 Accepted', async () => {
    const ctx = await makeTestContext();

    const req = new Request(`https://api.autopw3.com/api/v1/sites/${siteId}/commands`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ctx.rwToken}`,
        'idempotency-key': 'valid-rw-cmd-001',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'SET_BACKUP_RESERVE',
        params: { backupReservePercent: 45 },
      }),
    });

    const res = await handleApiRequest(req, ctx.env, ctx);

    expect(res.status).toBe(202);
    const body = await jsonOf(res);
    expect(body.id).toBeDefined();
    expect(body.state).toBe('PENDING');

    // Verify command is in list
    const listReq = new Request(`https://api.autopw3.com/api/v1/sites/${siteId}/commands`, {
      headers: { authorization: `Bearer ${ctx.roToken}` },
    });
    const listRes = await handleApiRequest(listReq, ctx.env, ctx);
    expect(listRes.status).toBe(200);
    const listBody = await jsonOf(listRes);
    expect(listBody.items.length).toBeGreaterThan(0);
    expect(listBody.items[0].id).toBe(body.id);

    // Verify command detail endpoint GET /commands/{id}
    const detailReq = new Request(`https://api.autopw3.com/api/v1/commands/${body.id}`, {
      headers: { authorization: `Bearer ${ctx.roToken}` },
    });
    const detailRes = await handleApiRequest(detailReq, ctx.env, ctx);
    expect(detailRes.status).toBe(200);
    const detailBody = await jsonOf(detailRes);
    expect(detailBody.command.id).toBe(body.id);
    expect(detailBody.events.length).toBeGreaterThan(0);
  });

  it('rejects unverified and unsupported commands with CAPABILITY_NOT_SUPPORTED', async () => {
    const ctx = await makeTestContext();

    const req = new Request(`https://api.autopw3.com/api/v1/sites/${siteId}/commands`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ctx.rwToken}`,
        'idempotency-key': 'unverified-cmd-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'SET_OFF_GRID_VEHICLE_CHARGING_RESERVE',
        params: { reservePercent: 20 },
      }),
    });

    const res = await handleApiRequest(req, ctx.env, ctx);

    expect(res.status).toBe(422);
    const body = await jsonOf(res);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toMatch(/UNVERIFIED|not supported/);
  });

  it('handles pause and resume automation endpoints', async () => {
    const ctx = await makeTestContext();

    // Pause automation (READ_WRITE allowed)
    const pauseReq = new Request(
      `https://api.autopw3.com/api/v1/households/${householdId}/automation/pause`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${ctx.rwToken}` },
      },
    );

    const pauseRes = await handleApiRequest(pauseReq, ctx.env, ctx);
    expect(pauseRes.status).toBe(200);
    const pauseBody = await jsonOf(pauseRes);
    expect(pauseBody.automationPaused).toBe(true);

    // Resume automation requires ADMIN (RW rejected with 403)
    const rwResumeReq = new Request(
      `https://api.autopw3.com/api/v1/households/${householdId}/automation/resume`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${ctx.rwToken}` },
      },
    );
    const rwResumeRes = await handleApiRequest(rwResumeReq, ctx.env, ctx);
    expect(rwResumeRes.status).toBe(403);

    // Resume automation with ADMIN
    const adminResumeReq = new Request(
      `https://api.autopw3.com/api/v1/households/${householdId}/automation/resume`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${ctx.adminToken}` },
      },
    );
    const adminResumeRes = await handleApiRequest(adminResumeReq, ctx.env, ctx);
    expect(adminResumeRes.status).toBe(200);
    const adminResumeBody = await jsonOf(adminResumeRes);
    expect(adminResumeBody.automationPaused).toBe(false);
  });
});
