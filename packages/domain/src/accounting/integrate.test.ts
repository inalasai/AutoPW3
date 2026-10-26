import { describe, expect, it } from 'vitest';
import type { LivePowerSample } from '../telemetry/types';
import { powerSamplesToEnergyIntervals } from './integrate';

describe('power to energy integration', () => {
  function sample(
    sampledAt: string,
    power: {
      solar?: number;
      home?: number;
      grid?: number;
      battery?: number;
    },
  ): LivePowerSample {
    return {
      sampledAt,
      receivedAt: sampledAt,
      timestampOrigin: 'PROVIDER',
      solarPowerW: power.solar ?? 0,
      loadPowerW: power.home ?? 1000,
      gridPowerW: power.grid ?? 0,
      batteryPowerW: power.battery ?? 0,
      batterySocPercent: 50,
      gridStatus: 'on-grid',
      source: 'TESLA',
      quality: 'OK',
    };
  }

  it('integrates step power into Wh energy intervals', () => {
    // 300 seconds step: 1000 W for 300 s = 1000 * (300 / 3600) = 83.333... Wh -> 83.3 Wh
    const samples = [
      sample('2026-06-21T12:00:00Z', { solar: 2000, home: 1000, grid: -1000, battery: 0 }),
      sample('2026-06-21T12:05:00Z', { solar: 2000, home: 1000, grid: -1000, battery: 0 }),
    ];

    const intervals = powerSamplesToEnergyIntervals(samples);
    expect(intervals).toHaveLength(1);
    const i = intervals[0]!;
    expect(i.intervalStart).toBe('2026-06-21T12:00:00Z');
    expect(i.intervalEnd).toBe('2026-06-21T12:05:00Z');
    expect(i.resolutionSeconds).toBe(300);
    expect(i.quality).toBe('DERIVED');

    // 2000 W * (300/3600) = 166.666... -> 166.7 Wh
    expect(i.solarGeneratedWh).toBe(166.7);
    // 1000 W * (300/3600) = 83.3 Wh
    expect(i.homeConsumedWh).toBe(83.3);
    // Grid: -1000 W is 1000 W export
    expect(i.gridExportWh).toBe(83.3);
    expect(i.gridImportWh).toBe(0);
  });

  it('handles gaps exceeding maxGapSeconds by leaving them uncovered', () => {
    // 2 hour gap between samples
    const samples = [
      sample('2026-06-21T10:00:00Z', { solar: 1000 }),
      sample('2026-06-21T12:00:00Z', { solar: 1000 }), // gap > 3600s
      sample('2026-06-21T12:05:00Z', { solar: 1000 }), // normal step
    ];

    const intervals = powerSamplesToEnergyIntervals(samples, { maxGapSeconds: 3600 });
    // First step 10:00 to 12:00 is omitted due to gap
    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.intervalStart).toBe('2026-06-21T12:00:00Z');
    expect(intervals[0]?.intervalEnd).toBe('2026-06-21T12:05:00Z');
  });

  it('supports bucketing into fixed intervals (e.g. 900s / 15m)', () => {
    const samples = [
      sample('2026-06-21T12:00:00Z', { solar: 1200 }),
      sample('2026-06-21T12:05:00Z', { solar: 1200 }),
      sample('2026-06-21T12:10:00Z', { solar: 1200 }),
      sample('2026-06-21T12:15:00Z', { solar: 1200 }),
    ];

    const intervals = powerSamplesToEnergyIntervals(samples, { bucketSeconds: 900 });
    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.intervalStart).toBe('2026-06-21T12:00:00Z');
    expect(intervals[0]?.intervalEnd).toBe('2026-06-21T12:15:00Z');
    expect(intervals[0]?.resolutionSeconds).toBe(900);
    // 1200 W for 15 min (900 s) = 1200 * 0.25 = 300 Wh
    expect(intervals[0]?.solarGeneratedWh).toBe(300);
  });
});
