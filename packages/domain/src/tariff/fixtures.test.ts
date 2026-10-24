import { PricePointSchema, TariffSchema } from '@autopw3/shared';
import { describe, expect, it } from 'vitest';
import {
  DYNAMIC_IMPORT_EXAMPLE,
  TARIFF_EXAMPLES,
  TARIFF_FIXTURE_NOTICE,
  halfHourlyPricePointsForDay,
  halfHourlyPricePointsForDays,
  rateFromMicro,
} from './fixtures';
import { indexPricePoints } from './observations';
import { priceInterval } from './price';
import { ms } from './test-helpers';
import { validatePricePoints } from './validate';

describe('tariff example fixtures', () => {
  const entries = Object.entries(TARIFF_EXAMPLES);

  it('has the nine documented examples', () => {
    expect(entries.map(([name]) => name).sort()).toEqual([
      'DAY_NIGHT_IMPORT',
      'DAY_NIGHT_PEAK_IMPORT',
      'DAY_NIGHT_VERSION_1',
      'DAY_NIGHT_VERSION_2',
      'DYNAMIC_IMPORT',
      'EXPORT_NONE',
      'EXPORT_PER_KWH',
      'FLAT_IMPORT',
      'SEASONAL_WEEKDAY_WEEKEND_IMPORT',
    ]);
  });

  it.each(entries)('%s passes the shared TariffSchema', (_name, tariff) => {
    expect(TariffSchema.safeParse(tariff).success).toBe(true);
  });

  it.each(entries)('%s is labelled as an example, never as a real tariff', (_name, tariff) => {
    expect(tariff.name.startsWith('EXAMPLE')).toBe(true);
    expect(tariff.name).not.toMatch(/\b(ESB|Electric Ireland|Bord Gais|Octopus|Tesla)\b/i);
  });

  it('carries a notice that says the values are illustrative', () => {
    expect(TARIFF_FIXTURE_NOTICE).toContain('ILLUSTRATIVE EXAMPLE');
  });

  it('uses unique ids so versions never collide in a lookup', () => {
    const ids = entries.map(([, t]) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps day/night versions 1 and 2 on one key and in sequence', () => {
    const v1 = TARIFF_EXAMPLES.DAY_NIGHT_VERSION_1;
    const v2 = TARIFF_EXAMPLES.DAY_NIGHT_VERSION_2;
    expect(v1.tariffKey).toBe(v2.tariffKey);
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v1.effectiveTo).toBe(v2.effectiveFrom);
  });
});

describe('rateFromMicro', () => {
  it('writes millionths as a six-digit decimal string', () => {
    expect(rateFromMicro(0)).toBe('0.000000');
    expect(rateFromMicro(1)).toBe('0.000001');
    expect(rateFromMicro(135_000)).toBe('0.135000');
    expect(rateFromMicro(1_250_000)).toBe('1.250000');
    expect(rateFromMicro(-25_000)).toBe('-0.025000');
  });

  it('refuses fractions and unsafe numbers', () => {
    expect(() => rateFromMicro(0.5)).toThrow(RangeError);
    expect(() => rateFromMicro(Number.NaN)).toThrow(RangeError);
    expect(() => rateFromMicro(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });
});

describe('halfHourlyPricePointsForDay', () => {
  it('has 48 points on a normal day, 46 on spring forward and 50 on fall back (Europe/Dublin)', () => {
    expect(halfHourlyPricePointsForDay('2026-06-15', 'Europe/Dublin')).toHaveLength(48);
    expect(halfHourlyPricePointsForDay('2026-03-29', 'Europe/Dublin')).toHaveLength(46);
    expect(halfHourlyPricePointsForDay('2026-10-25', 'Europe/Dublin')).toHaveLength(50);
  });

  it('points are back to back, cover exactly the local day and pass the schema', () => {
    const points = halfHourlyPricePointsForDay('2026-10-25', 'Europe/Dublin');
    expect(points[0]?.intervalStart).toBe('2026-10-24T23:00:00Z');
    expect(points.at(-1)?.intervalEnd).toBe('2026-10-26T00:00:00Z');
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i]?.intervalStart).toBe(points[i - 1]?.intervalEnd);
    }
    for (const p of points) expect(PricePointSchema.safeParse(p).success).toBe(true);
    expect(validatePricePoints(points)).toEqual([]);
  });

  it('takes the price of each point from the function given', () => {
    const points = halfHourlyPricePointsForDay('2026-06-15', 'Europe/Dublin', (i) => i * 1000);
    expect(points[0]?.ratePerKwh).toBe('0.000000');
    expect(points[47]?.ratePerKwh).toBe('0.047000');
  });

  it('spans several days in order without gaps', () => {
    const points = halfHourlyPricePointsForDays('2026-03-28', '2026-03-31', 'Europe/Dublin');
    expect(points).toHaveLength(48 + 46 + 48);
    expect(validatePricePoints(points)).toEqual([]);
  });

  it('prices a whole spring-forward day with the dynamic example, one rate per half hour', () => {
    const points = halfHourlyPricePointsForDay('2026-03-29', 'Europe/Dublin', () => 200_000);
    const observations = indexPricePoints([
      { tariffId: DYNAMIC_IMPORT_EXAMPLE.id, pricePoints: points },
    ]);
    const day = { startMs: ms('2026-03-29T00:00:00Z'), endMs: ms('2026-03-29T23:00:00Z') };
    expect(day.endMs - day.startMs).toBe(23 * 3_600_000);
    const r = priceInterval({ ...day, energyWh: 23_000 }, [DYNAMIC_IMPORT_EXAMPLE], 'IMPORT', {
      priceObservations: observations,
    });
    // 23 kWh at 0.20 EUR/kWh is 4.60 EUR before VAT, on a day with only 23 hours.
    expect(r.status).toBe('PRICED');
    if (r.status === 'PRICED') expect(r.amounts.baseAmount).toBe('4.6');
  });
});
