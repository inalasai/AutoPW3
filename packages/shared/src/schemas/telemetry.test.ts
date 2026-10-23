import { describe, expect, it } from 'vitest';
import {
  DemoLiveReadingSchema,
  EnergyIntervalSchema,
  EnergyQuerySchema,
  EnergySeriesPointSchema,
  LiveReadingSchema,
  PersistedPowerSampleSchema,
  PowerQuerySchema,
  PowerSampleSchema,
} from './telemetry';

const sample = {
  sampledAt: '2026-10-22T10:00:00Z',
  receivedAt: '2026-10-22T10:00:02Z',
  timestampOrigin: 'PROVIDER',
  solarPowerW: 3200,
  batteryPowerW: -1500,
  gridPowerW: -200,
  loadPowerW: 1500,
  batterySocPercent: 64.5,
  gridStatus: 'ON_GRID',
  quality: 'OK',
  source: 'TESLA',
};

describe('PowerSampleSchema', () => {
  it('accepts a consistent charging-and-exporting reading', () => {
    expect(PowerSampleSchema.safeParse(sample).success).toBe(true);
  });

  it('rejects SOC 120 and negative SOC', () => {
    expect(PowerSampleSchema.safeParse({ ...sample, batterySocPercent: 120 }).success).toBe(false);
    expect(PowerSampleSchema.safeParse({ ...sample, batterySocPercent: -1 }).success).toBe(false);
  });

  it('rejects negative solar and negative load (both are >= 0 by convention)', () => {
    expect(PowerSampleSchema.safeParse({ ...sample, solarPowerW: -1 }).success).toBe(false);
    expect(PowerSampleSchema.safeParse({ ...sample, loadPowerW: -1 }).success).toBe(false);
  });

  it('allows negative battery and grid power (charging, exporting)', () => {
    expect(
      PowerSampleSchema.safeParse({ ...sample, batteryPowerW: -5000, gridPowerW: -4000 }).success,
    ).toBe(true);
  });

  it('represents a missing field as null, and refuses a missing key', () => {
    expect(PowerSampleSchema.safeParse({ ...sample, gridPowerW: null }).success).toBe(true);
    const { gridPowerW: _omitted, ...withoutGrid } = sample;
    expect(PowerSampleSchema.safeParse(withoutGrid).success).toBe(false);
  });

  it('requires a UTC instant, a known quality and a known source', () => {
    expect(
      PowerSampleSchema.safeParse({ ...sample, sampledAt: '2026-10-22T10:00:00+01:00' }).success,
    ).toBe(false);
    expect(PowerSampleSchema.safeParse({ ...sample, quality: 'GOOD' }).success).toBe(false);
    expect(PowerSampleSchema.safeParse({ ...sample, source: 'SOLAREDGE' }).success).toBe(false);
  });

  it('rejects numbers sent as strings', () => {
    expect(PowerSampleSchema.safeParse({ ...sample, solarPowerW: '3200' }).success).toBe(false);
  });
});

describe('demo versus live (rule 5)', () => {
  it('lets a persisted sample be TESLA only: DEMO can never be written to live tables', () => {
    expect(PersistedPowerSampleSchema.safeParse(sample).success).toBe(true);
    expect(PersistedPowerSampleSchema.safeParse({ ...sample, source: 'DEMO' }).success).toBe(false);
  });

  it('lets an API reading carry DEMO, and a demo response must say DEMO', () => {
    const live = { ...sample, source: 'DEMO', ageSeconds: 3, freshness: 'FRESH' };
    expect(LiveReadingSchema.safeParse(live).success).toBe(true);
    expect(DemoLiveReadingSchema.safeParse(live).success).toBe(true);
    expect(DemoLiveReadingSchema.safeParse({ ...live, source: 'TESLA' }).success).toBe(false);
  });

  it('reports freshness and a stale fallback with its budget state', () => {
    const live = {
      ...sample,
      ageSeconds: 5400,
      freshness: 'STALE',
      budget: { state: 'EXHAUSTED' },
    };
    expect(LiveReadingSchema.safeParse(live).success).toBe(true);
    expect(LiveReadingSchema.safeParse({ ...live, freshness: 'OLD' }).success).toBe(false);
    expect(LiveReadingSchema.safeParse({ ...live, ageSeconds: -1 }).success).toBe(false);
  });
});

const interval = {
  intervalStart: '2026-10-25T00:00:00Z',
  intervalEnd: '2026-10-25T00:15:00Z',
  resolutionSeconds: 900,
  solarGeneratedWh: 0,
  homeConsumedWh: 120.5,
  gridImportWh: 120.5,
  gridExportWh: 0,
  batteryChargedWh: null,
  batteryDischargedWh: null,
  source: 'TESLA',
  quality: 'OK',
};

describe('EnergyIntervalSchema', () => {
  it('accepts provider energy with nulls for fields the provider did not supply', () => {
    expect(EnergyIntervalSchema.safeParse(interval).success).toBe(true);
  });

  it('rejects negative energy, an empty or reversed interval and a zero resolution', () => {
    expect(EnergyIntervalSchema.safeParse({ ...interval, gridExportWh: -1 }).success).toBe(false);
    expect(
      EnergyIntervalSchema.safeParse({ ...interval, intervalEnd: interval.intervalStart }).success,
    ).toBe(false);
    expect(
      EnergyIntervalSchema.safeParse({ ...interval, intervalEnd: '2026-10-24T23:00:00Z' }).success,
    ).toBe(false);
    expect(EnergyIntervalSchema.safeParse({ ...interval, resolutionSeconds: 0 }).success).toBe(
      false,
    );
  });

  it('accepts DERIVED quality but never a DEMO source', () => {
    expect(EnergyIntervalSchema.safeParse({ ...interval, quality: 'DERIVED' }).success).toBe(true);
    expect(EnergyIntervalSchema.safeParse({ ...interval, source: 'DEMO' }).success).toBe(false);
  });
});

describe('EnergySeriesPointSchema', () => {
  const point = {
    start: '2026-10-25T00:00:00Z',
    end: '2026-10-26T00:00:00Z',
    localDate: '2026-10-25',
    solarGeneratedWh: 5000,
    homeConsumedWh: 9000,
    gridImportWh: 4500,
    gridExportWh: 500,
    batteryChargedWh: null,
    batteryDischargedWh: null,
    completeness: 0.96,
    resolutionSecondsMin: 900,
    resolutionSecondsMax: 3600,
    quality: 'OK',
  };

  it('reports the real resolution and completeness', () => {
    expect(EnergySeriesPointSchema.safeParse(point).success).toBe(true);
  });

  it('rejects completeness above 1, an inverted resolution range and a reversed bucket', () => {
    expect(EnergySeriesPointSchema.safeParse({ ...point, completeness: 1.01 }).success).toBe(false);
    expect(
      EnergySeriesPointSchema.safeParse({ ...point, resolutionSecondsMin: 7200 }).success,
    ).toBe(false);
    expect(EnergySeriesPointSchema.safeParse({ ...point, end: point.start }).success).toBe(false);
  });
});

describe('query ranges', () => {
  it('caps raw power at 7 days and requires to after from', () => {
    const base = { limit: 50 };
    expect(
      PowerQuerySchema.safeParse({
        ...base,
        from: '2026-10-01T00:00:00Z',
        to: '2026-10-08T00:00:00Z',
      }).success,
    ).toBe(true);
    expect(
      PowerQuerySchema.safeParse({
        ...base,
        from: '2026-10-01T00:00:00Z',
        to: '2026-10-09T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      PowerQuerySchema.safeParse({
        ...base,
        from: '2026-10-02T00:00:00Z',
        to: '2026-10-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('applies a per-resolution cap on energy queries', () => {
    const q = (resolution: string, to: string) =>
      EnergyQuerySchema.safeParse({ from: '2026-01-01T00:00:00Z', to, resolution }).success;
    expect(q('interval', '2026-02-01T00:00:00Z')).toBe(true); // 31 days
    expect(q('interval', '2026-02-02T00:00:00Z')).toBe(false); // 32 days
    expect(q('hourly', '2026-04-03T00:00:00Z')).toBe(true); // 92 days
    expect(q('hourly', '2026-04-04T00:00:00Z')).toBe(false);
    expect(q('weekly', '2026-01-08T00:00:00Z')).toBe(false);
  });
});
