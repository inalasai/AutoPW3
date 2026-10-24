import type { Tariff, TariffSlot } from '@autopw3/shared';
import { describe, expect, it } from 'vitest';
import { localDay } from './calendar';
import {
  DAY_NIGHT_IMPORT_EXAMPLE,
  DAY_NIGHT_PEAK_IMPORT_EXAMPLE,
  DAY_NIGHT_VERSION_1_EXAMPLE,
  DAY_NIGHT_VERSION_2_EXAMPLE,
  DYNAMIC_IMPORT_EXAMPLE,
  EXPORT_PER_KWH_EXAMPLE,
  FLAT_IMPORT_EXAMPLE,
  SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE,
  halfHourlyPricePointsForDay,
  halfHourlyPricePointsForDays,
} from './fixtures';
import { indexPricePoints } from './observations';
import { resolveTariffRate } from './resolve';
import { MAX_SPLIT_DAYS, findCoverageGaps, splitIntervalAtBoundaries } from './split';
import { ms, variant } from './test-helpers';
import type { RateResult, RateSegment } from './types';

function slot(start: number, end: number, rate: string, label: string): TariffSlot {
  return { dayType: 'ALL', startMinute: start, endMinute: end, ratePerKwh: rate, label };
}

/** Segment edges as ISO text and the rate or problem code of each, for readable expectations. */
function outline(segments: readonly RateSegment[]): [string, string, string][] {
  const iso = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');
  return segments.map((s) => [
    iso(s.startMs),
    iso(s.endMs),
    s.result.ok ? s.result.ratePerKwh : s.result.code,
  ]);
}

describe('splitIntervalAtBoundaries: ordinary days (Europe/Dublin, winter)', () => {
  it('splits a day and night day into night, day, night at the slot edges', () => {
    const segments = splitIntervalAtBoundaries(
      ms('2026-01-15T00:00:00Z'),
      ms('2026-01-16T00:00:00Z'),
      [DAY_NIGHT_IMPORT_EXAMPLE],
      'IMPORT',
    );
    expect(outline(segments)).toEqual([
      ['2026-01-15T00:00:00Z', '2026-01-15T08:00:00Z', '0.180000'],
      ['2026-01-15T08:00:00Z', '2026-01-15T23:00:00Z', '0.350000'],
      ['2026-01-15T23:00:00Z', '2026-01-16T00:00:00Z', '0.180000'],
    ]);
  });

  it('joins a night that crosses midnight into one segment', () => {
    const segments = splitIntervalAtBoundaries(
      ms('2026-01-15T22:00:00Z'),
      ms('2026-01-16T09:00:00Z'),
      [DAY_NIGHT_IMPORT_EXAMPLE],
      'IMPORT',
    );
    expect(outline(segments)).toEqual([
      ['2026-01-15T22:00:00Z', '2026-01-15T23:00:00Z', '0.350000'],
      ['2026-01-15T23:00:00Z', '2026-01-16T08:00:00Z', '0.180000'],
      ['2026-01-16T08:00:00Z', '2026-01-16T09:00:00Z', '0.350000'],
    ]);
  });

  it('start is inclusive and end is exclusive: an interval ending at a slot edge has one rate', () => {
    expect(
      outline(
        splitIntervalAtBoundaries(
          ms('2026-01-15T07:00:00Z'),
          ms('2026-01-15T08:00:00Z'),
          [DAY_NIGHT_IMPORT_EXAMPLE],
          'IMPORT',
        ),
      ),
    ).toEqual([['2026-01-15T07:00:00Z', '2026-01-15T08:00:00Z', '0.180000']]);
    expect(
      outline(
        splitIntervalAtBoundaries(
          ms('2026-01-15T08:00:00Z'),
          ms('2026-01-15T09:00:00Z'),
          [DAY_NIGHT_IMPORT_EXAMPLE],
          'IMPORT',
        ),
      ),
    ).toEqual([['2026-01-15T08:00:00Z', '2026-01-15T09:00:00Z', '0.350000']]);
  });

  it('gives one segment for a flat tariff however long the range', () => {
    const segments = splitIntervalAtBoundaries(
      ms('2026-01-01T00:00:00Z'),
      ms('2026-02-01T00:00:00Z'),
      [FLAT_IMPORT_EXAMPLE],
      'IMPORT',
    );
    expect(segments).toHaveLength(1);
  });

  it('works on a range that is a single millisecond', () => {
    const t = ms('2026-01-15T08:00:00Z');
    const segments = splitIntervalAtBoundaries(t, t + 1, [DAY_NIGHT_IMPORT_EXAMPLE], 'IMPORT');
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      startMs: t,
      endMs: t + 1,
      result: { ok: true, ratePerKwh: '0.350000' },
    });
  });
});

describe('splitIntervalAtBoundaries: daylight saving (Europe/Dublin)', () => {
  it('spring forward 2026-03-29 (23 hours): night 7 h, day 15 h, night 1 h', () => {
    const day = localDay('2026-03-29', 'Europe/Dublin');
    const segments = splitIntervalAtBoundaries(
      day.startMs,
      day.endMs,
      [DAY_NIGHT_IMPORT_EXAMPLE],
      'IMPORT',
    );
    expect(outline(segments)).toEqual([
      ['2026-03-29T00:00:00Z', '2026-03-29T07:00:00Z', '0.180000'],
      ['2026-03-29T07:00:00Z', '2026-03-29T22:00:00Z', '0.350000'],
      ['2026-03-29T22:00:00Z', '2026-03-29T23:00:00Z', '0.180000'],
    ]);
    const hours = segments.map((s) => (s.endMs - s.startMs) / 3_600_000);
    expect(hours).toEqual([7, 15, 1]);
  });

  it('fall back 2026-10-25 (25 hours): night 9 h, day 15 h, night 1 h', () => {
    const day = localDay('2026-10-25', 'Europe/Dublin');
    const segments = splitIntervalAtBoundaries(
      day.startMs,
      day.endMs,
      [DAY_NIGHT_IMPORT_EXAMPLE],
      'IMPORT',
    );
    expect(outline(segments)).toEqual([
      ['2026-10-24T23:00:00Z', '2026-10-25T08:00:00Z', '0.180000'],
      ['2026-10-25T08:00:00Z', '2026-10-25T23:00:00Z', '0.350000'],
      ['2026-10-25T23:00:00Z', '2026-10-26T00:00:00Z', '0.180000'],
    ]);
    expect(segments.map((s) => (s.endMs - s.startMs) / 3_600_000)).toEqual([9, 15, 1]);
  });

  it('a slot edge in the skipped hour never happens: night ends when the clocks jump', () => {
    const edge = variant(DAY_NIGHT_IMPORT_EXAMPLE, {
      slots: [slot(0, 90, '0.100000', 'Early'), slot(90, 1440, '0.300000', 'Rest')],
    });
    const day = localDay('2026-03-29', 'Europe/Dublin');
    expect(outline(splitIntervalAtBoundaries(day.startMs, day.endMs, [edge], 'IMPORT'))).toEqual([
      ['2026-03-29T00:00:00Z', '2026-03-29T01:00:00Z', '0.100000'],
      ['2026-03-29T01:00:00Z', '2026-03-29T23:00:00Z', '0.300000'],
    ]);
  });

  it('a slot edge in the repeated hour happens twice', () => {
    const edge = variant(DAY_NIGHT_IMPORT_EXAMPLE, {
      slots: [slot(0, 90, '0.100000', 'Early'), slot(90, 1440, '0.300000', 'Rest')],
    });
    const day = localDay('2026-10-25', 'Europe/Dublin');
    expect(outline(splitIntervalAtBoundaries(day.startMs, day.endMs, [edge], 'IMPORT'))).toEqual([
      ['2026-10-24T23:00:00Z', '2026-10-25T00:30:00Z', '0.100000'],
      ['2026-10-25T00:30:00Z', '2026-10-25T01:00:00Z', '0.300000'],
      ['2026-10-25T01:00:00Z', '2026-10-25T01:30:00Z', '0.100000'],
      ['2026-10-25T01:30:00Z', '2026-10-26T00:00:00Z', '0.300000'],
    ]);
  });

  it('works in a second zone: America/New_York 2026-03-08 has a 23-hour day', () => {
    const nyTariff = variant(DAY_NIGHT_IMPORT_EXAMPLE, { timezone: 'America/New_York' });
    const day = localDay('2026-03-08', 'America/New_York');
    const segments = splitIntervalAtBoundaries(day.startMs, day.endMs, [nyTariff], 'IMPORT');
    // Local 08:00 EDT is 12:00Z; local 23:00 EDT is 03:00Z the next day; midnight EDT is 04:00Z.
    expect(outline(segments)).toEqual([
      ['2026-03-08T05:00:00Z', '2026-03-08T12:00:00Z', '0.180000'],
      ['2026-03-08T12:00:00Z', '2026-03-09T03:00:00Z', '0.350000'],
      ['2026-03-09T03:00:00Z', '2026-03-09T04:00:00Z', '0.180000'],
    ]);
  });
});

describe('splitIntervalAtBoundaries: other changes of rate', () => {
  it('splits where an effective-dated version takes over, at local midnight', () => {
    const segments = splitIntervalAtBoundaries(
      ms('2026-10-31T20:00:00Z'),
      ms('2026-11-01T10:00:00Z'),
      [DAY_NIGHT_VERSION_1_EXAMPLE, DAY_NIGHT_VERSION_2_EXAMPLE],
      'IMPORT',
    );
    expect(outline(segments)).toEqual([
      ['2026-10-31T20:00:00Z', '2026-11-01T00:00:00Z', '0.340000'],
      ['2026-11-01T00:00:00Z', '2026-11-01T08:00:00Z', '0.200000'],
      ['2026-11-01T08:00:00Z', '2026-11-01T10:00:00Z', '0.380000'],
    ]);
    const versions = segments.map((s) => (s.result.ok ? s.result.version : 0));
    expect(versions).toEqual([1, 2, 2]);
  });

  it('splits at local midnight when the day type changes (Friday to Saturday, winter)', () => {
    const segments = splitIntervalAtBoundaries(
      ms('2027-01-15T22:00:00Z'),
      ms('2027-01-16T02:00:00Z'),
      [SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE],
      'IMPORT',
    );
    expect(outline(segments)).toEqual([
      ['2027-01-15T22:00:00Z', '2027-01-16T00:00:00Z', '0.380000'],
      ['2027-01-16T00:00:00Z', '2027-01-16T02:00:00Z', '0.280000'],
    ]);
  });

  it('splits at the start and end of a date override', () => {
    const segments = splitIntervalAtBoundaries(
      ms('2026-12-23T23:00:00Z'),
      ms('2026-12-27T01:00:00Z'),
      [SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE],
      'IMPORT',
    );
    expect(outline(segments)).toEqual([
      ['2026-12-23T23:00:00Z', '2026-12-24T00:00:00Z', '0.380000'],
      ['2026-12-24T00:00:00Z', '2026-12-25T00:00:00Z', '0.150000'],
      ['2026-12-25T00:00:00Z', '2026-12-26T00:00:00Z', '0.100000'],
      ['2026-12-26T00:00:00Z', '2026-12-27T00:00:00Z', '0.150000'],
      ['2026-12-27T00:00:00Z', '2026-12-27T01:00:00Z', '0.280000'],
    ]);
  });

  it('splits at every dynamic price edge and joins neighbours with the same price', () => {
    const t = DYNAMIC_IMPORT_EXAMPLE;
    const varied = indexPricePoints([
      { tariffId: t.id, pricePoints: halfHourlyPricePointsForDay('2026-01-15', 'Europe/Dublin') },
    ]);
    expect(
      outline(
        splitIntervalAtBoundaries(
          ms('2026-01-15T00:00:00Z'),
          ms('2026-01-15T02:00:00Z'),
          [t],
          'IMPORT',
          {
            priceObservations: varied,
          },
        ),
      ),
    ).toEqual([
      ['2026-01-15T00:00:00Z', '2026-01-15T00:30:00Z', '0.100000'],
      ['2026-01-15T00:30:00Z', '2026-01-15T01:00:00Z', '0.105000'],
      ['2026-01-15T01:00:00Z', '2026-01-15T01:30:00Z', '0.110000'],
      ['2026-01-15T01:30:00Z', '2026-01-15T02:00:00Z', '0.115000'],
    ]);

    const constant = indexPricePoints([
      {
        tariffId: t.id,
        pricePoints: halfHourlyPricePointsForDay('2026-01-15', 'Europe/Dublin', () => 120_000),
      },
    ]);
    expect(
      splitIntervalAtBoundaries(
        ms('2026-01-15T00:00:00Z'),
        ms('2026-01-15T02:00:00Z'),
        [t],
        'IMPORT',
        {
          priceObservations: constant,
        },
      ),
    ).toHaveLength(1);
  });

  it('splits an interval that starts and ends inside a dynamic price', () => {
    const t = DYNAMIC_IMPORT_EXAMPLE;
    const obs = indexPricePoints([
      { tariffId: t.id, pricePoints: halfHourlyPricePointsForDay('2026-01-15', 'Europe/Dublin') },
    ]);
    expect(
      outline(
        splitIntervalAtBoundaries(
          ms('2026-01-15T00:10:00Z'),
          ms('2026-01-15T00:40:00Z'),
          [t],
          'IMPORT',
          {
            priceObservations: obs,
          },
        ),
      ),
    ).toEqual([
      ['2026-01-15T00:10:00Z', '2026-01-15T00:30:00Z', '0.100000'],
      ['2026-01-15T00:30:00Z', '2026-01-15T00:40:00Z', '0.105000'],
    ]);
  });

  it('keeps import and export apart: only the asked direction is split', () => {
    const both = [DAY_NIGHT_IMPORT_EXAMPLE, EXPORT_PER_KWH_EXAMPLE];
    const imp = splitIntervalAtBoundaries(
      ms('2026-01-15T00:00:00Z'),
      ms('2026-01-16T00:00:00Z'),
      both,
      'IMPORT',
    );
    const exp = splitIntervalAtBoundaries(
      ms('2026-01-15T00:00:00Z'),
      ms('2026-01-16T00:00:00Z'),
      both,
      'EXPORT',
    );
    expect(imp).toHaveLength(3);
    expect(exp).toHaveLength(1);
  });
});

describe('splitIntervalAtBoundaries: agrees with a minute-by-minute scan', () => {
  const key = (r: RateResult): string =>
    r.ok ? `${r.tariffId}|${r.ratePerKwh}|${r.source}|${r.label}|${r.scheduleName}` : r.code;

  function expectScanAgrees(
    tariffs: readonly Tariff[],
    fromMs: number,
    toMs: number,
    options = {},
  ) {
    const segments = splitIntervalAtBoundaries(fromMs, toMs, tariffs, 'IMPORT', options);
    let index = 0;
    for (let t = fromMs; t < toMs; t += 60_000) {
      while (segments[index] !== undefined && (segments[index] as RateSegment).endMs <= t)
        index += 1;
      const segment = segments[index] as RateSegment;
      expect(segment.startMs).toBeLessThanOrEqual(t);
      expect(key(resolveTariffRate(t, tariffs, 'IMPORT', options))).toBe(key(segment.result));
      // The last millisecond of the minute must agree too.
      expect(key(resolveTariffRate(t + 59_999, tariffs, 'IMPORT', options))).toBe(
        key(
          (segments.find((s) => s.startMs <= t + 59_999 && t + 59_999 < s.endMs) as RateSegment)
            .result,
        ),
      );
    }
  }

  const ranges: [string, string, string][] = [
    ['spring forward week', '2026-03-27T00:00:00Z', '2026-03-31T00:00:00Z'],
    ['fall back week', '2026-10-23T00:00:00Z', '2026-10-27T00:00:00Z'],
    ['season change and wrap', '2027-03-30T12:00:00Z', '2027-04-02T12:00:00Z'],
    ['Christmas overrides', '2026-12-23T12:00:00Z', '2026-12-28T12:00:00Z'],
  ];
  const tariffs: [string, Tariff][] = [
    ['flat', FLAT_IMPORT_EXAMPLE],
    ['day/night', DAY_NIGHT_IMPORT_EXAMPLE],
    ['day/night/peak', DAY_NIGHT_PEAK_IMPORT_EXAMPLE],
    ['seasonal weekday/weekend with overrides', SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE],
  ];
  for (const [rangeName, from, to] of ranges) {
    for (const [tariffName, tariff] of tariffs) {
      it(`${tariffName}, ${rangeName}`, () => {
        expectScanAgrees([tariff], ms(from), ms(to));
      });
    }
  }

  it('New York day/night over both of its clock changes', () => {
    const ny = variant(DAY_NIGHT_PEAK_IMPORT_EXAMPLE, { timezone: 'America/New_York' });
    expectScanAgrees([ny], ms('2026-03-07T00:00:00Z'), ms('2026-03-10T00:00:00Z'));
    expectScanAgrees([ny], ms('2026-10-31T00:00:00Z'), ms('2026-11-03T00:00:00Z'));
  });

  it('dynamic prices across the spring-forward day (46 points)', () => {
    const t = DYNAMIC_IMPORT_EXAMPLE;
    const obs = indexPricePoints([
      {
        tariffId: t.id,
        pricePoints: halfHourlyPricePointsForDays('2026-03-28', '2026-03-31', 'Europe/Dublin'),
      },
    ]);
    expectScanAgrees([t], ms('2026-03-28T00:00:00Z'), ms('2026-03-30T22:00:00Z'), {
      priceObservations: obs,
    });
  });
});

describe('findCoverageGaps', () => {
  it('returns nothing when every instant has a rate', () => {
    expect(
      findCoverageGaps(
        ms('2026-01-15T00:00:00Z'),
        ms('2026-01-17T00:00:00Z'),
        [DAY_NIGHT_IMPORT_EXAMPLE],
        'IMPORT',
      ),
    ).toEqual([]);
  });

  it('finds the part of each day that no slot covers', () => {
    const gappy = variant(DAY_NIGHT_IMPORT_EXAMPLE, { slots: [slot(0, 480, '0.180000', 'Night')] });
    const gaps = findCoverageGaps(
      ms('2026-01-15T00:00:00Z'),
      ms('2026-01-16T12:00:00Z'),
      [gappy],
      'IMPORT',
    );
    expect(
      gaps.map((g) => [new Date(g.startMs).toISOString(), new Date(g.endMs).toISOString(), g.code]),
    ).toEqual([
      ['2026-01-15T08:00:00.000Z', '2026-01-16T00:00:00.000Z', 'TARIFF_GAP'],
      ['2026-01-16T08:00:00.000Z', '2026-01-16T12:00:00.000Z', 'TARIFF_GAP'],
    ]);
  });

  it('finds dates before the first version and after an ended version', () => {
    const gaps = findCoverageGaps(
      ms('2026-10-31T12:00:00Z'),
      ms('2026-11-02T12:00:00Z'),
      [DAY_NIGHT_VERSION_1_EXAMPLE],
      'IMPORT',
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      startMs: ms('2026-11-01T00:00:00Z'),
      endMs: ms('2026-11-02T12:00:00Z'),
      code: 'NO_TARIFF_FOR_DATE',
    });
  });

  it('finds the part of a dynamic range with no price, and all of it when there are no observations', () => {
    const t = DYNAMIC_IMPORT_EXAMPLE;
    const obs = indexPricePoints([
      { tariffId: t.id, pricePoints: halfHourlyPricePointsForDay('2026-01-15', 'Europe/Dublin') },
    ]);
    const gaps = findCoverageGaps(
      ms('2026-01-15T12:00:00Z'),
      ms('2026-01-16T12:00:00Z'),
      [t],
      'IMPORT',
      {
        priceObservations: obs,
      },
    );
    expect(gaps).toEqual([
      {
        startMs: ms('2026-01-16T00:00:00Z'),
        endMs: ms('2026-01-16T12:00:00Z'),
        code: 'NO_PRICE_POINT',
        message: expect.any(String) as string,
      },
    ]);
    expect(
      findCoverageGaps(ms('2026-01-15T12:00:00Z'), ms('2026-01-15T13:00:00Z'), [t], 'IMPORT'),
    ).toHaveLength(1);
  });

  it('reports a missing export tariff as a gap over the whole range, not as zero', () => {
    const gaps = findCoverageGaps(
      ms('2026-01-15T00:00:00Z'),
      ms('2026-01-16T00:00:00Z'),
      [DAY_NIGHT_IMPORT_EXAMPLE],
      'EXPORT',
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.code).toBe('NO_TARIFF_FOR_DATE');
  });
});

describe('input checks', () => {
  const t = [DAY_NIGHT_IMPORT_EXAMPLE];
  it('refuses an empty or reversed range, inexact instants and a range that is too long', () => {
    const a = ms('2026-01-15T00:00:00Z');
    expect(() => splitIntervalAtBoundaries(a, a, t, 'IMPORT')).toThrow(RangeError);
    expect(() => splitIntervalAtBoundaries(a, a - 1, t, 'IMPORT')).toThrow(RangeError);
    expect(() => splitIntervalAtBoundaries(a + 0.5, a + 10, t, 'IMPORT')).toThrow(RangeError);
    expect(() =>
      splitIntervalAtBoundaries(a, a + (MAX_SPLIT_DAYS + 1) * 86_400_000, t, 'IMPORT'),
    ).toThrow(RangeError);
    expect(() =>
      splitIntervalAtBoundaries(
        a,
        a + MAX_SPLIT_DAYS * 86_400_000,
        [FLAT_IMPORT_EXAMPLE],
        'IMPORT',
      ),
    ).not.toThrow();
  });

  it('a range of 400 days on a time-of-use tariff stays fast and covers the range exactly', () => {
    const a = ms('2026-01-01T00:00:00Z');
    const b = a + MAX_SPLIT_DAYS * 86_400_000;
    const started = Date.now();
    const segments = splitIntervalAtBoundaries(a, b, [DAY_NIGHT_PEAK_IMPORT_EXAMPLE], 'IMPORT');
    const elapsed = Date.now() - started;
    expect(segments[0]?.startMs).toBe(a);
    expect(segments[segments.length - 1]?.endMs).toBe(b);
    expect(elapsed).toBeLessThan(5000); // generous bound; typically well under a second
  });
});
