import { describe, expect, it } from 'vitest';
import type { PersistedPowerSample } from '@autopw3/shared';
import { InMemoryRepository } from '../../db/repository';
import { runRetentionJob } from './retention';

describe('Retention Job', () => {
  const siteId = '22222222-2222-4222-8222-222222222222';

  function makeSample(sampledAt: string): PersistedPowerSample {
    return {
      source: 'TESLA',
      sampledAt,
      receivedAt: sampledAt,
      timestampOrigin: 'RECEIVED',
      solarPowerW: 1000,
      batteryPowerW: 0,
      gridPowerW: 0,
      loadPowerW: 1000,
      batterySocPercent: 50,
      gridStatus: 'Active',
      quality: 'OK',
    };
  }

  it('reports candidate rows without deleting in dryRun mode', async () => {
    const repo = new InMemoryRepository();
    const now = new Date('2026-10-01T12:00:00Z');

    // 100 days old sample (should be purged)
    await repo.recordPowerSample(siteId, makeSample('2026-06-20T12:00:00Z'));
    // 30 days old sample (should be kept)
    await repo.recordPowerSample(siteId, makeSample('2026-09-01T12:00:00Z'));

    const result = await runRetentionJob(repo, {
      dryRun: true,
      rawMetricsRetentionDays: 90,
      now,
    });

    expect(result.dryRun).toBe(true);
    expect(result.rawMetricsDeleted).toBe(1);

    // Verify row was NOT deleted
    const all = await repo.queryPowerSamples(
      siteId,
      '2026-01-01T00:00:00Z',
      '2026-12-31T23:59:59Z',
      10,
    );
    expect(all.items.length).toBe(2);
  });

  it('deletes old rows when dryRun is false', async () => {
    const repo = new InMemoryRepository();
    const now = new Date('2026-10-01T12:00:00Z');

    // 100 days old sample
    await repo.recordPowerSample(siteId, makeSample('2026-06-20T12:00:00Z'));
    // 30 days old sample
    await repo.recordPowerSample(siteId, makeSample('2026-09-01T12:00:00Z'));

    const result = await runRetentionJob(repo, {
      dryRun: false,
      rawMetricsRetentionDays: 90,
      now,
    });

    expect(result.dryRun).toBe(false);
    expect(result.rawMetricsDeleted).toBe(1);

    // Verify only the recent row remains
    const remaining = await repo.queryPowerSamples(
      siteId,
      '2026-01-01T00:00:00Z',
      '2026-12-31T23:59:59Z',
      10,
    );
    expect(remaining.items.length).toBe(1);
    expect(remaining.items[0]?.sampledAt).toBe('2026-09-01T12:00:00Z');
  });
});
