import { describe, expect, it } from 'vitest';
import { DemoDataInLivePathError } from '../telemetry/guards';
import type { DemoEnergyInterval, LiveEnergyInterval } from '../telemetry/types';
import { filterAccountableIntervals, requireLiveIntervals } from './guard';

describe('accounting guard', () => {
  const liveInterval: LiveEnergyInterval = {
    intervalStart: '2026-06-21T00:00:00Z',
    intervalEnd: '2026-06-21T01:00:00Z',
    resolutionSeconds: 3600,
    solarGeneratedWh: 1000,
    homeConsumedWh: 1000,
    gridImportWh: 0,
    gridExportWh: 0,
    batteryChargedWh: 0,
    batteryDischargedWh: 0,
    source: 'TESLA',
    quality: 'OK',
  };

  const demoInterval: DemoEnergyInterval = {
    ...liveInterval,
    source: 'DEMO',
  };

  it('requireLiveIntervals accepts live intervals', () => {
    const result = requireLiveIntervals([liveInterval]);
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe('TESLA');
  });

  it('requireLiveIntervals throws DemoDataInLivePathError on demo data', () => {
    expect(() => requireLiveIntervals([demoInterval])).toThrow(DemoDataInLivePathError);
  });

  it('filterAccountableIntervals in LIVE context rejects demo data', () => {
    expect(() => filterAccountableIntervals([demoInterval], 'LIVE')).toThrow(
      DemoDataInLivePathError,
    );
  });

  it('filterAccountableIntervals in DEMO context allows demo data', () => {
    const { accountable, excludedSuspectCount } = filterAccountableIntervals(
      [demoInterval],
      'DEMO',
    );
    expect(accountable).toHaveLength(1);
    expect(excludedSuspectCount).toBe(0);
  });

  it('filterAccountableIntervals excludes SUSPECT intervals and reports count', () => {
    const suspectInterval: LiveEnergyInterval = {
      ...liveInterval,
      quality: 'SUSPECT',
    };
    const { accountable, excludedSuspectCount } = filterAccountableIntervals(
      [liveInterval, suspectInterval],
      'LIVE',
    );
    expect(accountable).toHaveLength(1);
    expect(excludedSuspectCount).toBe(1);
  });
});
