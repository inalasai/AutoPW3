import { describe, expect, it } from 'vitest';
import { FixedClock } from '@autopw3/domain';
import type { EnergyInterval } from '@autopw3/shared';
import { InMemoryRepository } from '../../db/repository';
import { MockTeslaClient } from '../../providers/tesla/mock-adapter';
import { TeslaAuthError } from '../../providers/tesla/client';
import { InMemoryTokenStore } from '../tokens/store';
import { syncHistoricalIntervalsBatch, syncHistoricalIntervalsForSite } from './historical-sync';

describe('Historical Telemetry Sync', () => {
  const householdId = '11111111-1111-4111-8111-111111111111';
  const siteId = '22222222-2222-4222-8222-222222222222';
  const encKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  async function setupContext() {
    const repo = new InMemoryRepository();
    const tokenStore = new InMemoryTokenStore(encKey);
    const teslaClient = new MockTeslaClient();
    const clock = new FixedClock(new Date('2026-06-25T12:00:00Z'));

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

  it('syncs historical intervals and advances cursor', async () => {
    const { repo, tokenStore, teslaClient, clock } = await setupContext();

    const res = await syncHistoricalIntervalsForSite(siteId, {
      repo,
      tokenStore,
      teslaClient,
      clock,
      batchDays: 3,
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('SUCCESS');
    expect(res.intervalsSynced).toBeGreaterThan(0);
    expect(res.cursorAdvancedTo).toBeDefined();

    // Verify intervals in repository
    const intervals = await repo.queryEnergyIntervals(
      siteId,
      '2026-06-20T00:00:00Z',
      '2026-06-26T00:00:00Z',
    );
    expect(intervals.length).toBeGreaterThan(0);
    expect(intervals[0]?.source).toBe('TESLA');

    // Verify cursor updated in sync state
    const syncState = await repo.getSyncState(siteId, 'HISTORY');
    expect(syncState?.lastStatus).toBe('SUCCESS');
    expect(syncState?.cursor?.lastCompletedIntervalEnd).toBe(res.cursorAdvancedTo);
  });

  it('resumes from existing cursor on subsequent syncs', async () => {
    const { repo, tokenStore, teslaClient, clock } = await setupContext();

    // Set existing cursor to 2026-06-22T00:00:00Z
    await repo.updateSyncState(siteId, 'HISTORY', {
      cursor: { lastCompletedIntervalEnd: '2026-06-22T00:00:00Z' },
    });

    const res = await syncHistoricalIntervalsForSite(siteId, {
      repo,
      tokenStore,
      teslaClient,
      clock,
      batchDays: 2,
    });

    expect(res.success).toBe(true);
    // Cursor advanced from 2026-06-22 to 2026-06-24
    expect(res.cursorAdvancedTo).toBe('2026-06-24T00:00:00.000Z');
  });

  it('handles duplicate intervals idempotently without error', async () => {
    const { repo, tokenStore, teslaClient, clock } = await setupContext();

    // Run first sync
    await syncHistoricalIntervalsForSite(siteId, {
      repo,
      tokenStore,
      teslaClient,
      clock,
      batchDays: 1,
    });

    // Reset cursor to re-sync identical range
    await repo.updateSyncState(siteId, 'HISTORY', {
      cursor: null,
    });

    const secondRes = await syncHistoricalIntervalsForSite(siteId, {
      repo,
      tokenStore,
      teslaClient,
      clock,
      batchDays: 1,
    });

    expect(secondRes.success).toBe(true);

    // Verify count did not duplicate
    const intervals = await repo.queryEnergyIntervals(
      siteId,
      '2026-06-01T00:00:00Z',
      '2026-06-30T00:00:00Z',
    );
    expect(intervals.length).toBe(1);
  });

  it('isolates failures per site during batch synchronisation', async () => {
    const { repo, tokenStore, clock } = await setupContext();

    // Create a second site on the same household
    const site2 = await repo.createSite(householdId, {
      provider: 'TESLA',
      providerSiteId: '987654321',
      name: 'Second Site',
      timezone: 'Europe/Dublin',
    });

    class SelectiveFailingClient extends MockTeslaClient {
      override async getCalendarHistory(_baseUrl: string, siteId: string) {
        if (siteId === '1234567890') {
          throw new TeslaAuthError('/calendar_history');
        }
        return super.getCalendarHistory(_baseUrl, siteId, '', {
          startDate: '2026-06-20',
          endDate: '2026-06-22',
        });
      }
    }

    const results = await syncHistoricalIntervalsBatch([siteId, site2.id], {
      repo,
      tokenStore,
      teslaClient: new SelectiveFailingClient(),
      clock,
    });

    expect(results.length).toBe(2);
    // Site 1 failed
    expect(results[0]?.siteId).toBe(siteId);
    expect(results[0]?.success).toBe(false);

    // Site 2 succeeded
    expect(results[1]?.siteId).toBe(site2.id);
    expect(results[1]?.success).toBe(true);
  });

  it('rejects DEMO source when attempting to record energy intervals', async () => {
    const repo = new InMemoryRepository();

    const demoInterval: EnergyInterval = {
      intervalStart: '2026-06-21T00:00:00Z',
      intervalEnd: '2026-06-21T01:00:00Z',
      resolutionSeconds: 3600,
      solarGeneratedWh: 1000,
      homeConsumedWh: 500,
      gridImportWh: 0,
      gridExportWh: 500,
      batteryChargedWh: 0,
      batteryDischargedWh: 0,
      source: 'DEMO' as unknown as 'TESLA',
      quality: 'OK',
    };

    await expect(repo.recordEnergyIntervals(siteId, [demoInterval])).rejects.toThrow(
      'DEMO source is rejected',
    );
  });
});
