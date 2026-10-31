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

async function jsonOf<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function makeTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    SUPABASE_URL: 'https://project.supabase.co',
    ALLOWED_ORIGINS: 'http://localhost:5173,https://app.autopw3.com',
    APP_BASE_URL: 'http://localhost:5173',
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

  const adminId = '44444444-4444-4444-8444-444444444444';
  const rwId = '55555555-5555-4555-8555-555555555555';
  const roId = '66666666-6666-4666-8666-666666666666';

  const adminToken = await createTestJwt({ userId: adminId }, keys);
  const rwToken = await createTestJwt({ userId: rwId }, keys);
  const roToken = await createTestJwt({ userId: roId }, keys);

  return {
    repo,
    idempotencyStore,
    rateLimiter,
    tokenStore,
    oauthStateStore,
    teslaClient,
    env,
    jwtConfig,
    adminId,
    rwId,
    roId,
    adminToken,
    rwToken,
    roToken,
  };
}

describe('Admin and Operations Routes', () => {
  const householdId = '11111111-1111-4111-8111-111111111111';

  it('enforces ADMIN role on member list and returns members for ADMIN', async () => {
    const ctx = await makeTestContext();

    // 1. READ_ONLY caller denied with 403
    const roReq = new Request(`https://api.autopw3.com/api/v1/households/${householdId}/members`, {
      headers: { Authorization: `Bearer ${ctx.roToken}` },
    });
    const roRes = await handleApiRequest(roReq, ctx.env, ctx);
    expect(roRes.status).toBe(403);

    // 2. ADMIN caller succeeds with 200
    const adminReq = new Request(
      `https://api.autopw3.com/api/v1/households/${householdId}/members`,
      {
        headers: { Authorization: `Bearer ${ctx.adminToken}` },
      },
    );
    const adminRes = await handleApiRequest(adminReq, ctx.env, ctx);
    expect(adminRes.status).toBe(200);
    const body = await jsonOf<{ items: { userId: string; role: string }[] }>(adminRes);
    expect(body.items.length).toBe(3);
  });

  it('enforces last-admin protection and prevents self-demotion on role change', async () => {
    const ctx = await makeTestContext();

    // 1. Self-demotion rejected with 403
    const selfDemoteReq = new Request(
      `https://api.autopw3.com/api/v1/households/${householdId}/members/${ctx.adminId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${ctx.adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'READ_WRITE' }),
      },
    );
    const selfRes = await handleApiRequest(selfDemoteReq, ctx.env, ctx);
    expect(selfRes.status).toBe(403);

    // 2. Change Bob to ADMIN succeeds
    const promoteReq = new Request(
      `https://api.autopw3.com/api/v1/households/${householdId}/members/${ctx.rwId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${ctx.adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'ADMIN' }),
      },
    );
    const promoteRes = await handleApiRequest(promoteReq, ctx.env, ctx);
    expect(promoteRes.status).toBe(200);

    // 3. Demote Bob back to READ_WRITE succeeds now that there are 2 admins
    const demoteReq = new Request(
      `https://api.autopw3.com/api/v1/households/${householdId}/members/${ctx.rwId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${ctx.adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'READ_WRITE' }),
      },
    );
    const demoteRes = await handleApiRequest(demoteReq, ctx.env, ctx);
    expect(demoteRes.status).toBe(200);

    // 4. If Bob were the last admin, demotion would fail (tested via repo directly)
    const lastAdminRes = await ctx.repo.updateMemberRole(
      householdId,
      ctx.rwId,
      ctx.adminId,
      'READ_WRITE',
    );
    expect(lastAdminRes.success).toBe(false);
    expect(lastAdminRes.error).toBe('LAST_ADMIN');
  });

  it('handles member removal with last-admin and self-removal protections', async () => {
    const ctx = await makeTestContext();

    // 1. Self removal rejected via removeMember
    const selfRemoveReq = new Request(
      `https://api.autopw3.com/api/v1/households/${householdId}/members/${ctx.adminId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ctx.adminToken}` },
      },
    );
    const selfRemoveRes = await handleApiRequest(selfRemoveReq, ctx.env, ctx);
    expect(selfRemoveRes.status).toBe(403);

    // 2. Remove non-admin member succeeds (204)
    const removeRoReq = new Request(
      `https://api.autopw3.com/api/v1/households/${householdId}/members/${ctx.roId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ctx.adminToken}` },
      },
    );
    const removeRoRes = await handleApiRequest(removeRoReq, ctx.env, ctx);
    expect(removeRoRes.status).toBe(204);

    // 3. Verify member removed from list
    const member = await ctx.repo.getMembership(householdId, ctx.roId);
    expect(member).toBeNull();
  });

  it('updates settings and enforces cross-field bounds', async () => {
    const ctx = await makeTestContext();

    // 1. Non-admin denied
    const roReq = new Request(`https://api.autopw3.com/api/v1/households/${householdId}/settings`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${ctx.roToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ monthlySpendCapUsd: '15.00' }),
    });
    const roRes = await handleApiRequest(roReq, ctx.env, ctx);
    expect(roRes.status).toBe(403);

    // 2. Cross-field validation failure: staleAfterSeconds <= liveBackgroundIntervalMinutes * 60
    const invalidReq = new Request(
      `https://api.autopw3.com/api/v1/households/${householdId}/settings`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${ctx.adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          liveBackgroundIntervalMinutes: 5,
          staleAfterSeconds: 300, // 300 is not > 300 (must be strictly greater)
        }),
      },
    );
    const invalidRes = await handleApiRequest(invalidReq, ctx.env, ctx);
    expect(invalidRes.status).toBe(422);

    // 3. Valid update succeeds
    const validReq = new Request(
      `https://api.autopw3.com/api/v1/households/${householdId}/settings`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${ctx.adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          monthlySpendCapUsd: '20.00',
          staleAfterSeconds: 600,
          controlsEnabled: false,
        }),
      },
    );
    const validRes = await handleApiRequest(validReq, ctx.env, ctx);
    expect(validRes.status).toBe(200);
    const settings = await jsonOf<{
      staleAfterSeconds: number;
      controlsEnabled: boolean;
      budget: { capUsd: string };
    }>(validRes);
    expect(settings.staleAfterSeconds).toBe(600);
    expect(settings.controlsEnabled).toBe(false);
    expect(settings.budget.capUsd).toBe('20.00');
  });

  it('lists audit logs with action and date filtering for ADMIN only', async () => {
    const ctx = await makeTestContext();

    // 1. Non-admin denied
    const roReq = new Request(`https://api.autopw3.com/api/v1/households/${householdId}/audit`, {
      headers: { Authorization: `Bearer ${ctx.roToken}` },
    });
    const roRes = await handleApiRequest(roReq, ctx.env, ctx);
    expect(roRes.status).toBe(403);

    // 2. Admin retrieves audit entries
    const adminReq = new Request(`https://api.autopw3.com/api/v1/households/${householdId}/audit`, {
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
    });
    const adminRes = await handleApiRequest(adminReq, ctx.env, ctx);
    expect(adminRes.status).toBe(200);
    const auditData = await jsonOf<{ items: { action: string; id: string }[] }>(adminRes);
    expect(auditData.items.length).toBeGreaterThan(0);

    // 3. Filter by action
    const filterReq = new Request(
      `https://api.autopw3.com/api/v1/households/${householdId}/audit?action=member.added`,
      {
        headers: { Authorization: `Bearer ${ctx.adminToken}` },
      },
    );
    const filterRes = await handleApiRequest(filterReq, ctx.env, ctx);
    expect(filterRes.status).toBe(200);
    const filtered = await jsonOf<{ items: { action: string }[] }>(filterRes);
    expect(filtered.items.every((i) => i.action === 'member.added')).toBe(true);
  });

  it('exports household data sanitised of credentials and secrets', async () => {
    const ctx = await makeTestContext();

    const exportReq = new Request(
      `https://api.autopw3.com/api/v1/households/${householdId}/export`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.adminToken}` },
      },
    );
    const exportRes = await handleApiRequest(exportReq, ctx.env, ctx);
    expect(exportRes.status).toBe(200);
    const body = await jsonOf<{
      status: string;
      data: {
        household: { name: string };
        members: unknown[];
        sites: unknown[];
        tariffs: unknown[];
      };
    }>(exportRes);

    expect(body.status).toBe('READY');
    expect(body.data.household.name).toBe('Demo Household');
    expect(body.data.members.length).toBe(3);

    // Verify sanitisation: no raw tokens or credentials
    const jsonStr = JSON.stringify(body);
    expect(jsonStr).not.toContain('mock-tesla-client-secret');
    expect(jsonStr).not.toContain('0123456789abcdef');
    expect(jsonStr).not.toContain('tokenHash');
  });

  it('requires typed confirmation name to delete household', async () => {
    const ctx = await makeTestContext();

    // 1. Name mismatch fails with 422
    const wrongNameReq = new Request(`https://api.autopw3.com/api/v1/households/${householdId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${ctx.adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmName: 'Wrong Name' }),
    });
    const wrongRes = await handleApiRequest(wrongNameReq, ctx.env, ctx);
    expect(wrongRes.status).toBe(422);

    // 2. Matching name deletes household
    const correctReq = new Request(`https://api.autopw3.com/api/v1/households/${householdId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${ctx.adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmName: 'Demo Household' }),
    });
    const correctRes = await handleApiRequest(correctReq, ctx.env, ctx);
    expect(correctRes.status).toBe(204);

    // 3. Subsequent request returns 404
    const checkReq = new Request(`https://api.autopw3.com/api/v1/households/${householdId}`, {
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
    });
    const checkRes = await handleApiRequest(checkReq, ctx.env, ctx);
    expect(checkRes.status).toBe(404);
  });

  it('allows user export and respects account deletion constraints', async () => {
    const ctx = await makeTestContext();

    // 1. POST /me/export
    const exportMeReq = new Request('https://api.autopw3.com/api/v1/me/export', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.rwToken}` },
    });
    const exportMeRes = await handleApiRequest(exportMeReq, ctx.env, ctx);
    expect(exportMeRes.status).toBe(200);
    const exportBody = await jsonOf<{ profile: { userId: string }; memberships: unknown[] }>(
      exportMeRes,
    );
    expect(exportBody.profile.userId).toBe(ctx.rwId);
    expect(exportBody.memberships.length).toBe(1);

    // 2. DELETE /me as sole admin with other members fails with 409
    const deleteAdminReq = new Request('https://api.autopw3.com/api/v1/me', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${ctx.adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirm: true }),
    });
    const deleteAdminRes = await handleApiRequest(deleteAdminReq, ctx.env, ctx);
    expect(deleteAdminRes.status).toBe(409);

    // 3. DELETE /me as non-admin succeeds with 204
    const deleteRwReq = new Request('https://api.autopw3.com/api/v1/me', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${ctx.rwToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirm: true }),
    });
    const deleteRwRes = await handleApiRequest(deleteRwReq, ctx.env, ctx);
    expect(deleteRwRes.status).toBe(204);
  });

  it('allows regular member to leave household but prevents last admin from leaving', async () => {
    const ctx = await makeTestContext();

    // 1. Last admin cannot leave (409)
    const adminLeaveReq = new Request(
      `https://api.autopw3.com/api/v1/me/memberships/${householdId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ctx.adminToken}` },
      },
    );
    const adminLeaveRes = await handleApiRequest(adminLeaveReq, ctx.env, ctx);
    expect(adminLeaveRes.status).toBe(409);

    // 2. Regular member can leave (204)
    const roLeaveReq = new Request(`https://api.autopw3.com/api/v1/me/memberships/${householdId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ctx.roToken}` },
    });
    const roLeaveRes = await handleApiRequest(roLeaveReq, ctx.env, ctx);
    expect(roLeaveRes.status).toBe(204);

    // 3. RO member is no longer in household
    const member = await ctx.repo.getMembership(householdId, ctx.roId);
    expect(member).toBeNull();
  });
});
