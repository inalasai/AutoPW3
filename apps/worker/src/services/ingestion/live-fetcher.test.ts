import { describe, expect, it } from 'vitest';
import { FixedClock } from '@autopw3/domain';
import type { PersistedPowerSample } from '@autopw3/shared';
import { InMemoryRepository } from '../../db/repository';
import { MockTeslaClient } from '../../providers/tesla/mock-adapter';
import { TeslaAuthError, TeslaRateLimitError } from '../../providers/tesla/client';
import type { TeslaRawLiveStatus } from '../../providers/tesla/raw-types';
import { InMemoryTokenStore } from '../tokens/store';
import { fetchAndPersistLiveStatus } from './live-fetcher';

describe('Live Telemetry Fetcher', () => {
  const householdId = '11111111-1111-4111-8111-111111111111';
  const siteId = '22222222-2222-4222-8222-222222222222';
  const encKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  async function setupContext() {
    const repo = new InMemoryRepository();
    const tokenStore = new InMemoryTokenStore(encKey);
    const clock = new FixedClock(new Date('2026-06-21T12:00:00Z'));
    const teslaClient = new MockTeslaClient(undefined, undefined, () => clock.now().toISOString());

    // Save active tokens
    await tokenStore.saveTokens(householdId, {
      accessToken: 'valid-access-token',
      refreshToken: 'valid-refresh-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      tokenType: 'Bearer',
      scope: 'openid email offline_access energy_device_data',
      regionBaseUrl: 'https://fleet-api.prd.eu.vn.cloud.tesla.com',
    });

    return { repo, tokenStore, teslaClient, clock };
  }

  it('fetches and persists live status with normalized signs and fresh state', async () => {
    const { repo, tokenStore, teslaClient, clock } = await setupContext();

    const res = await fetchAndPersistLiveStatus(siteId, {
      repo,
      tokenStore,
      teslaClient,
      clock,
      staleAfterSeconds: 300,
    });

    expect(res.success).toBe(true);
    expect(res.sample).toBeDefined();
    expect(res.sample?.source).toBe('TESLA');
    expect(res.sample?.solarPowerW).toBe(3500);
    // Mock returned battery_power: -1200 (discharging in Tesla), normalised to 1200 W discharging in project convention
    expect(res.sample?.batteryPowerW).toBe(1200);
    expect(res.sample?.gridPowerW).toBe(-800);
    expect(res.freshness).toBe('FRESH');

    // Verify stored in repository
    const stored = await repo.getLatestPowerSample(siteId);
    expect(stored).toBeDefined();
    expect(stored?.sampledAt).toBe(res.sample?.sampledAt);

    // Verify site connectionState is LIVE
    const site = await repo.getSite(siteId);
    expect(site?.connectionState).toBe('LIVE');

    // Verify sync state
    const sync = await repo.getSyncState(siteId, 'LIVE');
    expect(sync?.lastStatus).toBe('SUCCESS');
    expect(sync?.consecutiveFailures).toBe(0);
  });

  it('idempotently handles duplicate samples at the exact same sampledAt instant', async () => {
    const { repo, tokenStore, teslaClient, clock } = await setupContext();

    // First fetch
    const res1 = await fetchAndPersistLiveStatus(siteId, {
      repo,
      tokenStore,
      teslaClient,
      clock,
    });

    // Second fetch with same clock
    await fetchAndPersistLiveStatus(siteId, {
      repo,
      tokenStore,
      teslaClient,
      clock,
    });

    // Should only have 1 sample in query
    const sampleMs = Date.parse(res1.sample!.sampledAt);
    const fromUtc = new Date(sampleMs - 1000).toISOString();
    const toUtc = new Date(sampleMs + 1000).toISOString();
    const queried = await repo.queryPowerSamples(siteId, fromUtc, toUtc, 10);
    expect(queried.items.length).toBe(1);
  });

  it('detects stale readings when data is older than threshold', async () => {
    const { repo, tokenStore, clock } = await setupContext();

    // Mock client returning reading 2 hours in the past
    class StaleTeslaClient extends MockTeslaClient {
      override async getLiveStatus(): Promise<TeslaRawLiveStatus> {
        return {
          solar_power: 2000,
          battery_power: 500,
          grid_power: 100,
          load_power: 2600,
          percentage_charged: 80,
          timestamp: '2026-06-21T10:00:00Z', // 2 hours old
        };
      }
    }

    const res = await fetchAndPersistLiveStatus(siteId, {
      repo,
      tokenStore,
      teslaClient: new StaleTeslaClient(),
      clock,
      staleAfterSeconds: 300, // 5 min threshold
    });

    expect(res.success).toBe(true);
    expect(res.freshness).toBe('STALE');

    // Connection state transitions to STALE
    const site = await repo.getSite(siteId);
    expect(site?.connectionState).toBe('STALE');
  });

  it('rejects DEMO source when attempting to write to live powerwall_metrics_log', async () => {
    const repo = new InMemoryRepository();

    const demoSample: PersistedPowerSample = {
      source: 'DEMO' as unknown as 'TESLA',
      sampledAt: '2026-06-21T12:00:00Z',
      receivedAt: '2026-06-21T12:00:00Z',
      timestampOrigin: 'RECEIVED',
      solarPowerW: 3000,
      batteryPowerW: 0,
      gridPowerW: 0,
      loadPowerW: 3000,
      batterySocPercent: 50,
      gridStatus: 'Active',
      quality: 'OK',
    };

    await expect(repo.recordPowerSample(siteId, demoSample)).rejects.toThrow(
      'DEMO source is rejected',
    );
  });

  it('handles rate-limiting backoff and updates sync failure counters', async () => {
    const { repo, tokenStore, clock } = await setupContext();

    class RateLimitedClient extends MockTeslaClient {
      override async getLiveStatus(): Promise<TeslaRawLiveStatus> {
        throw new TeslaRateLimitError('/live_status', 60);
      }
    }

    const res = await fetchAndPersistLiveStatus(siteId, {
      repo,
      tokenStore,
      teslaClient: new RateLimitedClient(),
      clock,
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('rate limit');

    const sync = await repo.getSyncState(siteId, 'LIVE');
    expect(sync?.lastStatus).toBe('FAILED');
    expect(sync?.lastErrorCode).toBe('RATE_LIMITED');
    expect(sync?.consecutiveFailures).toBe(1);

    // Verify usage error was recorded
    const usage = await repo.getProviderUsage(householdId, '2026-06-21', 'DATA');
    expect(usage.requestCount).toBe(1);
    expect(usage.errorCount).toBe(1);
  });

  it('transitions connectionState to ERROR on persistent authentication failure', async () => {
    const { repo, tokenStore, clock } = await setupContext();

    class AuthFailedClient extends MockTeslaClient {
      override async getLiveStatus(): Promise<TeslaRawLiveStatus> {
        throw new TeslaAuthError('/live_status');
      }
    }

    const res = await fetchAndPersistLiveStatus(siteId, {
      repo,
      tokenStore,
      teslaClient: new AuthFailedClient(),
      clock,
    });

    expect(res.success).toBe(false);
    const site = await repo.getSite(siteId);
    expect(site?.connectionState).toBe('ERROR');

    const sync = await repo.getSyncState(siteId, 'LIVE');
    expect(sync?.lastErrorCode).toBe('UNAUTHORIZED');
  });
});
