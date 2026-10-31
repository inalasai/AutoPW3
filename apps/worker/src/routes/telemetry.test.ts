import { describe, expect, it } from 'vitest';
import type { PersistedPowerSample } from '@autopw3/shared';
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

  const adminToken = await createTestJwt({ userId: '44444444-4444-4444-8444-444444444444' }, keys);
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
    roToken,
  };
}

describe('Telemetry & Analytics API Routes', () => {
  const siteId = '22222222-2222-4222-8222-222222222222';

  it('GET /sites/{siteId}/live returns live reading with freshness', async () => {
    const ctx = await makeTestContext();

    const sample: PersistedPowerSample = {
      source: 'TESLA',
      sampledAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      timestampOrigin: 'RECEIVED',
      solarPowerW: 3200,
      batteryPowerW: -500,
      gridPowerW: -1200,
      loadPowerW: 1500,
      batterySocPercent: 75,
      gridStatus: 'Active',
      quality: 'OK',
    };
    await ctx.repo.recordPowerSample(siteId, sample);

    const req = new Request(`https://api.autopw3.com/api/v1/sites/${siteId}/live`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${ctx.roToken}`,
      },
    });

    const res = await handleApiRequest(req, ctx.env, ctx);
    expect(res.status).toBe(200);

    const body = await jsonOf(res);
    expect(body.source).toBe('TESLA');
    expect(body.solarPowerW).toBe(3200);
    expect(body.freshness).toBe('FRESH');
  });

  it('GET /sites/{siteId}/power returns range-bounded snapshots with pagination', async () => {
    const ctx = await makeTestContext();

    const sample1: PersistedPowerSample = {
      source: 'TESLA',
      sampledAt: '2026-06-21T12:00:00Z',
      receivedAt: '2026-06-21T12:00:00Z',
      timestampOrigin: 'RECEIVED',
      solarPowerW: 2000,
      batteryPowerW: 0,
      gridPowerW: 0,
      loadPowerW: 2000,
      batterySocPercent: 60,
      gridStatus: 'Active',
      quality: 'OK',
    };
    const sample2: PersistedPowerSample = {
      ...sample1,
      sampledAt: '2026-06-21T12:05:00Z',
      solarPowerW: 2500,
    };

    await ctx.repo.recordPowerSample(siteId, sample1);
    await ctx.repo.recordPowerSample(siteId, sample2);

    const req = new Request(
      `https://api.autopw3.com/api/v1/sites/${siteId}/power?from=2026-06-21T00:00:00Z&to=2026-06-21T23:59:59Z&limit=10`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${ctx.roToken}`,
        },
      },
    );

    const res = await handleApiRequest(req, ctx.env, ctx);
    expect(res.status).toBe(200);

    const body = await jsonOf(res);
    expect(body.items.length).toBe(2);
    expect(body.items[0].solarPowerW).toBe(2000);
    expect(body.items[1].solarPowerW).toBe(2500);
  });

  it('GET /sites/{siteId}/energy returns hourly and daily rollup series', async () => {
    const ctx = await makeTestContext();

    await ctx.repo.saveHourlyRollups(siteId, [
      {
        start: '2026-06-21T12:00:00.000Z',
        end: '2026-06-21T13:00:00.000Z',
        solarGeneratedWh: 2500,
        homeConsumedWh: 1200,
        gridImportWh: 100,
        gridExportWh: 1400,
        batteryChargedWh: 500,
        batteryDischargedWh: 0,
        completeness: 1,
        resolutionSecondsMin: 900,
        resolutionSecondsMax: 900,
        quality: 'OK',
      },
    ]);

    const req = new Request(
      `https://api.autopw3.com/api/v1/sites/${siteId}/energy?from=2026-06-21T00:00:00Z&to=2026-06-21T23:59:59Z&resolution=hourly`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${ctx.roToken}`,
        },
      },
    );

    const res = await handleApiRequest(req, ctx.env, ctx);
    expect(res.status).toBe(200);

    const body = await jsonOf(res);
    expect(body.resolution).toBe('hourly');
    expect(body.items.length).toBe(1);
    expect(body.items[0].solarGeneratedWh).toBe(2500);
  });

  it('GET /sites/{siteId}/costs returns daily cost rollups with string decimals', async () => {
    const ctx = await makeTestContext();

    await ctx.repo.saveDailyRollups(siteId, [
      {
        start: '2026-06-21T00:00:00.000Z',
        end: '2026-06-22T00:00:00.000Z',
        localDate: '2026-06-21',
        solarGeneratedWh: 20000,
        homeConsumedWh: 12000,
        gridImportWh: 3000,
        gridExportWh: 8000,
        batteryChargedWh: 6000,
        batteryDischargedWh: 4000,
        completeness: 1,
        resolutionSecondsMin: 3600,
        resolutionSecondsMax: 3600,
        quality: 'OK',
      },
    ]);

    const req = new Request(
      `https://api.autopw3.com/api/v1/sites/${siteId}/costs?from=2026-06-20&to=2026-06-22&granularity=day`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${ctx.roToken}`,
        },
      },
    );

    const res = await handleApiRequest(req, ctx.env, ctx);
    expect(res.status).toBe(200);

    const body = await jsonOf(res);
    expect(body.granularity).toBe('day');
    expect(body.items.length).toBe(1);
    expect(body.items[0].currency).toBe('EUR');
    expect(typeof body.items[0].netCost).toBe('string');
  });

  it('enforces household boundary and returns 404 for unknown site', async () => {
    const ctx = await makeTestContext();
    const unknownSiteId = '99999999-9999-4999-8999-999999999999';

    const req = new Request(`https://api.autopw3.com/api/v1/sites/${unknownSiteId}/live`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${ctx.roToken}`,
      },
    });

    const res = await handleApiRequest(req, ctx.env, ctx);
    expect(res.status).toBe(404);
  });
});
