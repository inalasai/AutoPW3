import { describe, expect, it } from 'vitest';
import type { EnergyInterval } from '@autopw3/shared';
import { InMemoryRepository } from '../../db/repository';
import {
  computeDailyRollupsFromIntervals,
  computeHourlyRollupsFromIntervals,
  recomputeRollups,
} from './rollups';

describe('Rollup Engine', () => {
  const siteId = '22222222-2222-4222-8222-222222222222';

  function makeInterval(
    start: string,
    end: string,
    resSeconds: number,
    overrides: Partial<EnergyInterval> = {},
  ): EnergyInterval {
    return {
      intervalStart: start,
      intervalEnd: end,
      resolutionSeconds: resSeconds,
      solarGeneratedWh: 1000,
      homeConsumedWh: 800,
      gridImportWh: 200,
      gridExportWh: 400,
      batteryChargedWh: 100,
      batteryDischargedWh: 100,
      source: 'TESLA',
      quality: 'OK',
      ...overrides,
    };
  }

  it('computes hourly rollups aligned to whole UTC hours with completeness', () => {
    // Four 15-minute intervals covering 12:00 to 13:00 UTC
    const intervals: EnergyInterval[] = [
      makeInterval('2026-06-21T12:00:00Z', '2026-06-21T12:15:00Z', 900, {
        solarGeneratedWh: 250,
      }),
      makeInterval('2026-06-21T12:15:00Z', '2026-06-21T12:30:00Z', 900, {
        solarGeneratedWh: 250,
      }),
      makeInterval('2026-06-21T12:30:00Z', '2026-06-21T12:45:00Z', 900, {
        solarGeneratedWh: 250,
      }),
      makeInterval('2026-06-21T12:45:00Z', '2026-06-21T13:00:00Z', 900, {
        solarGeneratedWh: 250,
      }),
    ];

    const rollups = computeHourlyRollupsFromIntervals(intervals);

    expect(rollups.length).toBe(1);
    const r = rollups[0]!;
    expect(r.start).toBe('2026-06-21T12:00:00.000Z');
    expect(r.end).toBe('2026-06-21T13:00:00.000Z');
    expect(r.solarGeneratedWh).toBe(1000);
    expect(r.completeness).toBe(1);
    expect(r.resolutionSecondsMin).toBe(900);
    expect(r.resolutionSecondsMax).toBe(900);
    expect(r.quality).toBe('OK');
  });

  it('accurately computes partial completeness when intervals are missing', () => {
    // Only two 15-minute intervals (1800s out of 3600s = 0.5 completeness)
    const intervals: EnergyInterval[] = [
      makeInterval('2026-06-21T14:00:00Z', '2026-06-21T14:15:00Z', 900),
      makeInterval('2026-06-21T14:15:00Z', '2026-06-21T14:30:00Z', 900),
    ];

    const rollups = computeHourlyRollupsFromIntervals(intervals);
    expect(rollups.length).toBe(1);
    expect(rollups[0]?.completeness).toBe(0.5);
  });

  it('correctly computes daily rollups across DST changes', () => {
    const timezone = 'Europe/Dublin';

    // 1. Spring-forward 23-hour day: 2026-03-29 (23 hours = 82800 seconds)
    const springIntervals: EnergyInterval[] = [
      makeInterval('2026-03-29T00:00:00Z', '2026-03-29T23:00:00Z', 82800, {
        solarGeneratedWh: 15000,
      }),
    ];
    const springRollups = computeDailyRollupsFromIntervals(springIntervals, timezone);
    expect(springRollups.length).toBe(1);
    expect(springRollups[0]?.localDate).toBe('2026-03-29');
    expect(springRollups[0]?.completeness).toBe(1);

    // 2. Fall-back 25-hour day: 2026-10-25 (25 hours = 90000 seconds)
    const fallIntervals: EnergyInterval[] = [
      makeInterval('2026-10-25T00:00:00Z', '2026-10-26T01:00:00Z', 90000, {
        solarGeneratedWh: 12000,
      }),
    ];
    const fallRollups = computeDailyRollupsFromIntervals(fallIntervals, timezone);
    expect(fallRollups.length).toBe(1);
    expect(fallRollups[0]?.localDate).toBe('2026-10-25');
    expect(fallRollups[0]?.completeness).toBe(1);
  });

  it('recomputes rollups idempotently when late data arrives', async () => {
    const repo = new InMemoryRepository();

    // Initial interval for 10:00-11:00 UTC
    const initial = makeInterval('2026-06-21T10:00:00Z', '2026-06-21T10:30:00Z', 1800, {
      solarGeneratedWh: 500,
    });
    await repo.recordEnergyIntervals(siteId, [initial]);

    // Initial rollup pass
    await recomputeRollups(siteId, '2026-06-21T00:00:00Z', '2026-06-21T23:59:59Z', repo);

    const firstRollup = (
      await repo.getHourlyRollups(siteId, '2026-06-21T10:00:00Z', '2026-06-21T11:00:00Z')
    )[0];
    expect(firstRollup?.solarGeneratedWh).toBe(500);
    expect(firstRollup?.completeness).toBe(0.5);

    // Late interval arrives for second half of hour
    const lateInterval = makeInterval('2026-06-21T10:30:00Z', '2026-06-21T11:00:00Z', 1800, {
      solarGeneratedWh: 750,
    });
    await repo.recordEnergyIntervals(siteId, [lateInterval]);

    // Recompute rollups
    await recomputeRollups(siteId, '2026-06-21T00:00:00Z', '2026-06-21T23:59:59Z', repo);

    const secondRollup = (
      await repo.getHourlyRollups(siteId, '2026-06-21T10:00:00Z', '2026-06-21T11:00:00Z')
    )[0];
    expect(secondRollup?.solarGeneratedWh).toBe(1250);
    expect(secondRollup?.completeness).toBe(1);
  });
});
