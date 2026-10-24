import { EnergyIntervalSchema, PowerSampleSchema } from '@autopw3/shared';
import { describe, expect, it } from 'vitest';
import { normaliseEnergyInterval, normalisePowerReading } from './normalise';
import type { RawPowerReading } from './types';

const RECEIVED = '2026-06-21T12:00:05Z';
const good: RawPowerReading = {
  sampledAt: '2026-06-21T12:00:00Z',
  solarPowerW: 3000,
  batteryPowerW: -1000,
  gridPowerW: -500,
  loadPowerW: 1500,
  batterySocPercent: 50,
  gridStatus: 'SystemGridConnected',
};

function run(raw: RawPowerReading, receivedAt: string | number | Date = RECEIVED) {
  return normalisePowerReading(raw, { source: 'DEMO', receivedAt });
}

describe('a clean reading', () => {
  it('becomes an OK sample that the shared schema accepts', () => {
    const { sample, issues } = run(good);
    expect(issues).toEqual([]);
    expect(sample).toEqual({
      sampledAt: '2026-06-21T12:00:00Z',
      receivedAt: RECEIVED,
      timestampOrigin: 'PROVIDER',
      solarPowerW: 3000,
      batteryPowerW: -1000,
      gridPowerW: -500,
      loadPowerW: 1500,
      batterySocPercent: 50,
      gridStatus: 'SystemGridConnected',
      quality: 'OK',
      source: 'DEMO',
    });
    expect(PowerSampleSchema.safeParse(sample).success).toBe(true);
  });

  it('stamps the source it was told, never one it guessed', () => {
    expect(
      normalisePowerReading(good, { source: 'TESLA', receivedAt: RECEIVED }).sample.source,
    ).toBe('TESLA');
    expect(run(good).sample.source).toBe('DEMO');
  });

  it('keeps the signs it is given: this layer does not flip anything', () => {
    const { sample } = run(good);
    expect(sample.batteryPowerW).toBe(-1000); // charging stays negative
    expect(sample.gridPowerW).toBe(-500); // exporting stays negative
  });

  it('is the same every time for the same input', () => {
    expect(run(good)).toEqual(run(good));
  });
});

describe('timestamps', () => {
  it('converts an offset time to UTC', () => {
    const { sample } = run({ ...good, sampledAt: '2026-06-21T13:00:00+01:00' });
    expect(sample.sampledAt).toBe('2026-06-21T12:00:00Z');
    expect(sample.timestampOrigin).toBe('PROVIDER');
  });

  it('uses the receive time and says so when the sample time is missing (PARTIAL)', () => {
    const { sample, issues } = run({ ...good, sampledAt: undefined });
    expect(sample.sampledAt).toBe(RECEIVED);
    expect(sample.timestampOrigin).toBe('RECEIVED');
    expect(sample.quality).toBe('PARTIAL');
    expect(issues.map((i) => i.code)).toEqual(['TIMESTAMP_MISSING']);
  });

  it('treats an unreadable sample time as SUSPECT, not as missing', () => {
    for (const bad of ['yesterday', '2026-06-21T12:00:00', 'NaN', '', 12.5]) {
      const { sample, issues } = run({ ...good, sampledAt: bad });
      expect(sample.timestampOrigin).toBe('RECEIVED');
      expect(sample.quality).toBe('SUSPECT');
      expect(issues.map((i) => i.code)).toContain('TIMESTAMP_INVALID');
    }
  });

  it('flags a sample time ahead of the receive time beyond the skew allowance', () => {
    const ahead = run({ ...good, sampledAt: '2026-06-21T12:05:05Z' }); // 300 s ahead
    expect(ahead.sample.quality).toBe('SUSPECT');
    expect(ahead.issues.find((i) => i.code === 'TIMESTAMP_IN_FUTURE')?.observed).toBe(300);
    const withinSkew = run({ ...good, sampledAt: '2026-06-21T12:01:05Z' }); // 60 s ahead
    expect(withinSkew.sample.quality).toBe('OK');
  });

  it('has a configurable skew allowance', () => {
    const raw = { ...good, sampledAt: '2026-06-21T12:05:05Z' };
    const tolerant = normalisePowerReading(raw, {
      source: 'DEMO',
      receivedAt: RECEIVED,
      maxFutureSkewSeconds: 600,
    });
    expect(tolerant.sample.quality).toBe('OK');
  });

  it('requires a readable receive time', () => {
    expect(() => run(good, 'not a time')).toThrow(RangeError);
  });

  it('accepts the receive time as a Date or epoch milliseconds', () => {
    const ms = Date.parse(RECEIVED);
    expect(run(good, new Date(ms)).sample.receivedAt).toBe(RECEIVED);
    expect(run(good, ms).sample.receivedAt).toBe(RECEIVED);
  });
});

describe('invalid values are flagged and emptied, never corrected', () => {
  it('turns negative solar into null and marks the reading SUSPECT', () => {
    const { sample, issues } = run({ ...good, solarPowerW: -150 });
    expect(sample.solarPowerW).toBeNull();
    expect(sample.quality).toBe('SUSPECT');
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'SOLAR_NEGATIVE', field: 'solarPowerW', observed: -150 }),
    );
    expect(PowerSampleSchema.safeParse(sample).success).toBe(true);
  });

  it('turns negative load into null', () => {
    const { sample } = run({ ...good, loadPowerW: -10 });
    expect(sample.loadPowerW).toBeNull();
    expect(sample.quality).toBe('SUSPECT');
  });

  it('turns a battery level outside 0 to 100 into null (a fraction mistaken for percent is not guessed)', () => {
    for (const soc of [-1, 100.5, 130, 1e9]) {
      const { sample } = run({ ...good, batterySocPercent: soc });
      expect(sample.batterySocPercent).toBeNull();
      expect(sample.quality).toBe('SUSPECT');
    }
    expect(run({ ...good, batterySocPercent: 0 }).sample.batterySocPercent).toBe(0);
    expect(run({ ...good, batterySocPercent: 100 }).sample.batterySocPercent).toBe(100);
  });

  it('turns NaN and infinities into null with VALUE_NOT_FINITE', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const { sample, issues } = run({ ...good, loadPowerW: bad });
      expect(sample.loadPowerW).toBeNull();
      expect(issues.map((i) => i.code)).toContain('VALUE_NOT_FINITE');
      expect(sample.quality).toBe('SUSPECT');
    }
  });

  it('does not coerce strings: "2000" is not a number, whatever it looks like', () => {
    const { sample, issues } = run({ ...good, batteryPowerW: '2000' });
    expect(sample.batteryPowerW).toBeNull();
    expect(issues.map((i) => i.code)).toContain('VALUE_NOT_A_NUMBER');
    for (const bad of [true, {}, [], 'x']) {
      expect(run({ ...good, gridPowerW: bad }).sample.gridPowerW).toBeNull();
    }
  });

  it('keeps an implausibly large power but marks the reading SUSPECT (it can be represented)', () => {
    const { sample, issues } = run({ ...good, batteryPowerW: 250_000 });
    expect(sample.batteryPowerW).toBe(250_000);
    expect(sample.quality).toBe('SUSPECT');
    expect(issues.map((i) => i.code)).toContain('POWER_IMPLAUSIBLE_MAGNITUDE');
  });

  it('keeps values that fail the balance but marks the reading SUSPECT', () => {
    const { sample, issues } = run({ ...good, loadPowerW: 4000 });
    expect(sample.loadPowerW).toBe(4000);
    expect(sample.quality).toBe('SUSPECT');
    expect(issues.map((i) => i.code)).toEqual(['BALANCE_MISMATCH']);
  });

  it('reports every problem, not just the first', () => {
    const { issues } = run({
      ...good,
      solarPowerW: -150,
      batterySocPercent: 130,
      loadPowerW: Number.NaN,
    });
    expect(issues.map((i) => i.code).sort()).toEqual([
      'SOC_OUT_OF_RANGE',
      'SOLAR_NEGATIVE',
      'VALUE_NOT_FINITE',
    ]);
  });
});

describe('missing values are null, never zero', () => {
  it('leaves absent fields null and marks the reading PARTIAL', () => {
    const { sample, issues } = run({ sampledAt: good.sampledAt, solarPowerW: 2400 });
    expect(sample.solarPowerW).toBe(2400);
    expect(sample.batteryPowerW).toBeNull();
    expect(sample.gridPowerW).toBeNull();
    expect(sample.loadPowerW).toBeNull();
    expect(sample.batterySocPercent).toBeNull();
    expect(sample.quality).toBe('PARTIAL');
    expect(issues.filter((i) => i.code === 'FIELD_MISSING').map((i) => i.field)).toEqual([
      'batteryPowerW',
      'gridPowerW',
      'loadPowerW',
      'batterySocPercent',
    ]);
    expect(PowerSampleSchema.safeParse(sample).success).toBe(true);
  });

  it('treats an explicit null like an absent field', () => {
    const { sample } = run({ ...good, loadPowerW: null });
    expect(sample.loadPowerW).toBeNull();
    expect(sample.quality).toBe('PARTIAL');
  });

  it('keeps a real zero as zero', () => {
    const { sample } = run({
      ...good,
      solarPowerW: 0,
      batteryPowerW: 0,
      gridPowerW: 0,
      loadPowerW: 0,
    });
    expect(sample.solarPowerW).toBe(0);
    expect(sample.quality).toBe('OK');
  });

  it('does not require a grid status, and bounds a long one', () => {
    expect(run({ ...good, gridStatus: undefined }).sample.gridStatus).toBeNull();
    expect(run({ ...good, gridStatus: '   ' }).sample.gridStatus).toBeNull();
    expect(run({ ...good, gridStatus: 'x'.repeat(200) }).sample.gridStatus).toHaveLength(64);
    expect(run({ ...good, gridStatus: 5 }).sample.gridStatus).toBeNull();
  });
});

describe('normaliseEnergyInterval', () => {
  const good = {
    intervalStart: '2026-06-21T12:00:00Z',
    intervalEnd: '2026-06-21T12:15:00Z',
    solarGeneratedWh: 1000,
    homeConsumedWh: 400,
    gridImportWh: 0,
    gridExportWh: 350,
    batteryChargedWh: 250,
    batteryDischargedWh: 0,
  };

  it('gives an OK interval whose length is the real resolution', () => {
    const { interval, issues } = normaliseEnergyInterval(good, { source: 'DEMO' });
    expect(issues).toEqual([]);
    expect(interval).toMatchObject({ resolutionSeconds: 900, quality: 'OK', source: 'DEMO' });
  });

  it('accepts a live interval against the shared schema', () => {
    const { interval } = normaliseEnergyInterval(good, { source: 'TESLA' });
    expect(EnergyIntervalSchema.safeParse(interval).success).toBe(true);
  });

  it('refuses an interval that does not end after it starts', () => {
    for (const bad of [
      { ...good, intervalEnd: good.intervalStart },
      { ...good, intervalEnd: '2026-06-21T11:00:00Z' },
      { ...good, intervalStart: undefined },
      { ...good, intervalEnd: 'later' },
    ]) {
      const { interval, issues } = normaliseEnergyInterval(bad, { source: 'DEMO' });
      expect(interval).toBeNull();
      expect(issues.map((i) => i.code)).toEqual(['INTERVAL_INVALID']);
    }
  });

  it('nulls negative energy and marks the interval SUSPECT', () => {
    const { interval } = normaliseEnergyInterval({ ...good, gridImportWh: -5 }, { source: 'DEMO' });
    expect(interval?.gridImportWh).toBeNull();
    expect(interval?.quality).toBe('SUSPECT');
  });

  it('marks an unbalanced interval SUSPECT but keeps the numbers', () => {
    const { interval, issues } = normaliseEnergyInterval(
      { ...good, homeConsumedWh: 900 },
      { source: 'DEMO' },
    );
    expect(interval?.homeConsumedWh).toBe(900);
    expect(interval?.quality).toBe('SUSPECT');
    expect(issues.map((i) => i.code)).toEqual(['ENERGY_BALANCE_MISMATCH']);
  });

  it('leaves absent flows null (PARTIAL) and never zero', () => {
    const { interval } = normaliseEnergyInterval(
      { intervalStart: good.intervalStart, intervalEnd: good.intervalEnd, solarGeneratedWh: 5 },
      { source: 'DEMO' },
    );
    expect(interval?.gridImportWh).toBeNull();
    expect(interval?.quality).toBe('PARTIAL');
  });
});
