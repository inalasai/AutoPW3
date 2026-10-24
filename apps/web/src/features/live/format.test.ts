import { describe, expect, it } from 'vitest';
import { buildFlowModel } from './flow-model';
import type { FlowSample } from './flow-model';
import {
  formatAge,
  formatClockTime,
  formatKilowatts,
  formatPercent,
  summariseFlows,
} from './format';

const sample = (overrides: Partial<FlowSample> = {}): FlowSample => ({
  solarPowerW: 3800,
  batteryPowerW: -2400,
  gridPowerW: -700,
  loadPowerW: 700,
  batterySocPercent: 58,
  quality: 'OK',
  ...overrides,
});

describe('formatKilowatts', () => {
  it('prints two decimals from watts, as a magnitude', () => {
    expect(formatKilowatts(3800)).toBe('3.80');
    expect(formatKilowatts(0)).toBe('0.00');
    expect(formatKilowatts(5)).toBe('0.01');
    expect(formatKilowatts(4)).toBe('0.00');
    expect(formatKilowatts(1234)).toBe('1.23');
    expect(formatKilowatts(1235)).toBe('1.24');
    expect(formatKilowatts(100)).toBe('0.10');
    expect(formatKilowatts(250_000)).toBe('250.00');
  });

  it('drops the sign: direction is shown in words', () => {
    expect(formatKilowatts(-2400)).toBe('2.40');
    expect(formatKilowatts(-0)).toBe('0.00');
  });

  it('is null for no value, never zero', () => {
    expect(formatKilowatts(null)).toBeNull();
    expect(formatKilowatts(Number.NaN)).toBeNull();
    expect(formatKilowatts(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('formatPercent', () => {
  it('rounds down to a whole number, so it always agrees with the state word', () => {
    expect(formatPercent(58)).toBe('58');
    expect(formatPercent(57.6)).toBe('57');
    expect(formatPercent(14.9)).toBe('14');
    expect(formatPercent(99.9)).toBe('99');
    expect(formatPercent(0)).toBe('0');
    expect(formatPercent(null)).toBeNull();
    expect(formatPercent(Number.NaN)).toBeNull();
  });
});

describe('formatAge', () => {
  it('uses the largest sensible unit', () => {
    expect(formatAge(0)).toBe('just now');
    expect(formatAge(4)).toBe('just now');
    expect(formatAge(5)).toBe('5 s ago');
    expect(formatAge(59)).toBe('59 s ago');
    expect(formatAge(60)).toBe('1 min ago');
    expect(formatAge(3599)).toBe('59 min ago');
    expect(formatAge(3600)).toBe('1 h ago');
    expect(formatAge(47 * 3600)).toBe('47 h ago');
    expect(formatAge(48 * 3600)).toBe('2 d ago');
  });

  it('says so when there is no timestamp', () => {
    expect(formatAge(null)).toBe('no timestamp');
    expect(formatAge(-1)).toBe('no timestamp');
    expect(formatAge(Number.NaN)).toBe('no timestamp');
  });
});

describe('formatClockTime', () => {
  it('prints the time of day in the given zone, with DST applied', () => {
    expect(formatClockTime('2026-06-21T12:00:05Z', 'UTC')).toBe('12:00:05');
    expect(formatClockTime('2026-06-21T12:00:05Z', 'Europe/Dublin')).toBe('13:00:05');
    expect(formatClockTime('2026-12-21T12:00:05Z', 'Europe/Dublin')).toBe('12:00:05');
  });

  it('is null for an unreadable instant or zone', () => {
    expect(formatClockTime('garbage', 'UTC')).toBeNull();
    expect(formatClockTime('2026-06-21T12:00:05Z', 'Not/AZone')).toBeNull();
  });
});

describe('summariseFlows (the screen-reader sentence)', () => {
  it('names every node, its action and its size, then the battery level', () => {
    const text = summariseFlows(buildFlowModel({ sample: sample(), freshness: 'FRESH' }));
    expect(text).toBe(
      'Solar generating 3.80 kilowatts. Battery charging 2.40 kilowatts. Grid exporting 0.70 kilowatts. Home using 0.70 kilowatts. Battery level 58 percent.',
    );
  });

  it('follows a sign flip', () => {
    const text = summariseFlows(
      buildFlowModel({
        sample: sample({ batteryPowerW: 1900, gridPowerW: 300, solarPowerW: 0, loadPowerW: 2200 }),
        freshness: 'FRESH',
      }),
    );
    expect(text).toContain('Battery discharging 1.90 kilowatts');
    expect(text).toContain('Grid importing 0.30 kilowatts');
    expect(text).toContain('Solar idle, 0.00 kilowatts');
  });

  it('never says a number it does not have', () => {
    const text = summariseFlows(
      buildFlowModel({
        sample: sample({ loadPowerW: null, batterySocPercent: null }),
        freshness: 'FRESH',
      }),
    );
    expect(text).toContain('Home no data.');
    expect(text).toContain('Battery level unknown.');
  });

  it('warns first when the data is stale, suspect or absent', () => {
    expect(summariseFlows(buildFlowModel({ sample: sample(), freshness: 'STALE' }))).toMatch(
      /^Data is stale, showing the last reading\. Solar generating/,
    );
    expect(
      summariseFlows(
        buildFlowModel({ sample: sample({ quality: 'SUSPECT' }), freshness: 'FRESH' }),
      ),
    ).toMatch(/^This reading was flagged as unreliable\./);
    expect(summariseFlows(buildFlowModel({ sample: null, freshness: 'UNAVAILABLE' }))).toBe(
      'No current energy data.',
    );
  });

  it('says low and critical battery levels in words', () => {
    expect(
      summariseFlows(
        buildFlowModel({ sample: sample({ batterySocPercent: 12 }), freshness: 'FRESH' }),
      ),
    ).toContain('Battery level 12 percent, low.');
    expect(
      summariseFlows(
        buildFlowModel({ sample: sample({ batterySocPercent: 3 }), freshness: 'FRESH' }),
      ),
    ).toContain('Battery level 3 percent, critically low.');
  });
});
