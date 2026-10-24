import type { Tariff, TariffSlot } from '@autopw3/shared';
import { describe, expect, it } from 'vitest';
import {
  DAY_NIGHT_IMPORT_EXAMPLE,
  DAY_NIGHT_VERSION_1_EXAMPLE,
  DAY_NIGHT_VERSION_2_EXAMPLE,
  DYNAMIC_IMPORT_EXAMPLE,
  EXPORT_PER_KWH_EXAMPLE,
  FLAT_IMPORT_EXAMPLE,
  SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE,
  halfHourlyPricePointsForDay,
} from './fixtures';
import { indexPricePoints } from './observations';
import { resolveTariffRate } from './resolve';
import { ms, rateOrCode, variant } from './test-helpers';

function slot(
  start: number,
  end: number,
  rate: string,
  label: string,
  dayType: TariffSlot['dayType'] = 'ALL',
): TariffSlot {
  return { dayType, startMinute: start, endMinute: end, ratePerKwh: rate, label };
}

const DN = [DAY_NIGHT_IMPORT_EXAMPLE];
const NIGHT = '0.180000';
const DAY = '0.350000';

describe('flat tariffs', () => {
  it('give the same rate at every instant in force and say where it came from', () => {
    const r = resolveTariffRate(ms('2026-06-15T12:00:00Z'), [FLAT_IMPORT_EXAMPLE], 'IMPORT');
    expect(r).toMatchObject({
      ok: true,
      ratePerKwh: '0.300000',
      currency: 'EUR',
      source: 'FLAT',
      tariffId: FLAT_IMPORT_EXAMPLE.id,
      tariffKey: FLAT_IMPORT_EXAMPLE.tariffKey,
      version: 1,
      label: null,
      scheduleName: null,
      localDate: '2026-06-15',
      localMinute: 13 * 60, // 12:00Z is 13:00 in Dublin in June
    });
    expect(rateOrCode('2026-01-01T00:00:00Z', [FLAT_IMPORT_EXAMPLE])).toBe('0.300000');
    expect(rateOrCode('2030-12-31T23:59:59.999Z', [FLAT_IMPORT_EXAMPLE])).toBe('0.300000');
  });
});

describe('day and night: boundaries are start-inclusive and end-exclusive (winter, local = UTC)', () => {
  it('switches to day at 08:00 exactly', () => {
    expect(rateOrCode('2026-01-15T07:59:59.999Z', DN)).toBe(NIGHT);
    expect(rateOrCode('2026-01-15T08:00:00Z', DN)).toBe(DAY);
  });

  it('switches back to night at 23:00 exactly', () => {
    expect(rateOrCode('2026-01-15T22:59:59.999Z', DN)).toBe(DAY);
    expect(rateOrCode('2026-01-15T23:00:00Z', DN)).toBe(NIGHT);
  });

  it('night crosses midnight without a break: 23:00 to 08:00 is one night', () => {
    expect(rateOrCode('2026-01-15T23:59:59.999Z', DN)).toBe(NIGHT);
    expect(rateOrCode('2026-01-16T00:00:00Z', DN)).toBe(NIGHT);
    expect(rateOrCode('2026-01-16T03:00:00Z', DN)).toBe(NIGHT);
  });

  it('reports the slot label, the local date and the local minute', () => {
    expect(resolveTariffRate(ms('2026-01-15T08:00:00Z'), DN, 'IMPORT')).toMatchObject({
      ok: true,
      source: 'BASE',
      label: 'Day',
      localDate: '2026-01-15',
      localMinute: 480,
    });
  });
});

describe('summer time: slots follow the local clock, not UTC', () => {
  it('day starts at 07:00Z in July (08:00 local) and ends at 22:00Z (23:00 local)', () => {
    expect(rateOrCode('2026-07-15T06:59:59.999Z', DN)).toBe(NIGHT);
    expect(rateOrCode('2026-07-15T07:00:00Z', DN)).toBe(DAY);
    expect(rateOrCode('2026-07-15T21:59:59.999Z', DN)).toBe(DAY);
    expect(rateOrCode('2026-07-15T22:00:00Z', DN)).toBe(NIGHT);
  });
});

describe('DST spring forward, Europe/Dublin 2026-03-29 (23 hours; 01:00Z is 02:00 local)', () => {
  it('prices the shortened night and keeps the day slot at its local hours', () => {
    expect(rateOrCode('2026-03-29T00:59:59.999Z', DN)).toBe(NIGHT); // 00:59 local
    expect(rateOrCode('2026-03-29T01:00:00Z', DN)).toBe(NIGHT); // 02:00 local
    expect(rateOrCode('2026-03-29T06:59:59.999Z', DN)).toBe(NIGHT); // 07:59 local
    expect(rateOrCode('2026-03-29T07:00:00Z', DN)).toBe(DAY); // 08:00 local
    expect(rateOrCode('2026-03-29T21:59:59.999Z', DN)).toBe(DAY); // 22:59 local
    expect(rateOrCode('2026-03-29T22:00:00Z', DN)).toBe(NIGHT); // 23:00 local
    expect(rateOrCode('2026-03-29T23:00:00Z', DN)).toBe(NIGHT); // 00:00 on the 30th
  });

  it('a slot edge inside the skipped hour never happens: the next slot starts when the clocks jump', () => {
    const edgeInSkippedHour = variant(DAY_NIGHT_IMPORT_EXAMPLE, {
      slots: [slot(0, 90, '0.100000', 'Early'), slot(90, 1440, '0.300000', 'Rest')],
    });
    expect(rateOrCode('2026-03-29T00:59:59.999Z', [edgeInSkippedHour])).toBe('0.100000'); // 00:59 local
    expect(rateOrCode('2026-03-29T01:00:00Z', [edgeInSkippedHour])).toBe('0.300000'); // 02:00 local
  });
});

describe('DST fall back, Europe/Dublin 2026-10-25 (25 hours; 01:00Z is 01:00 local again)', () => {
  it('prices the lengthened night: local 08:00 is 08:00Z, so night lasts 9 hours', () => {
    expect(rateOrCode('2026-10-24T23:00:00Z', DN)).toBe(NIGHT); // 00:00 BST
    expect(rateOrCode('2026-10-25T00:30:00Z', DN)).toBe(NIGHT); // 01:30 BST
    expect(rateOrCode('2026-10-25T01:30:00Z', DN)).toBe(NIGHT); // 01:30 GMT, the repeated hour
    expect(rateOrCode('2026-10-25T07:59:59.999Z', DN)).toBe(NIGHT); // 07:59 GMT
    expect(rateOrCode('2026-10-25T08:00:00Z', DN)).toBe(DAY); // 08:00 GMT
    expect(rateOrCode('2026-10-25T22:59:59.999Z', DN)).toBe(DAY);
    expect(rateOrCode('2026-10-25T23:00:00Z', DN)).toBe(NIGHT);
  });

  it('a repeated clock time is priced by the clock both times: a slot edge in it applies twice', () => {
    const edgeInRepeatedHour = variant(DAY_NIGHT_IMPORT_EXAMPLE, {
      slots: [slot(0, 90, '0.100000', 'Early'), slot(90, 1440, '0.300000', 'Rest')],
    });
    const at = (iso: string) => rateOrCode(iso, [edgeInRepeatedHour]);
    expect(at('2026-10-25T00:29:59.999Z')).toBe('0.100000'); // 01:29 BST
    expect(at('2026-10-25T00:30:00Z')).toBe('0.300000'); // 01:30 BST
    expect(at('2026-10-25T00:59:59.999Z')).toBe('0.300000'); // 01:59 BST
    expect(at('2026-10-25T01:00:00Z')).toBe('0.100000'); // 01:00 GMT: the clock reads 01:00 again
    expect(at('2026-10-25T01:29:59.999Z')).toBe('0.100000'); // 01:29 GMT
    expect(at('2026-10-25T01:30:00Z')).toBe('0.300000'); // 01:30 GMT
  });
});

describe('weekday and weekend slots, seasons and wrap-around', () => {
  const T = [SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE];

  it('weekday slots replace the weekend ones by local date (winter 2027-01-15 Fri to 18 Mon)', () => {
    expect(rateOrCode('2027-01-15T03:00:00Z', T)).toBe('0.220000'); // Friday night
    expect(rateOrCode('2027-01-15T12:00:00Z', T)).toBe('0.380000'); // Friday day
    expect(rateOrCode('2027-01-15T17:30:00Z', T)).toBe('0.500000'); // Friday peak
    expect(rateOrCode('2027-01-16T03:00:00Z', T)).toBe('0.280000'); // Saturday
    expect(rateOrCode('2027-01-17T17:30:00Z', T)).toBe('0.280000'); // Sunday
    expect(rateOrCode('2027-01-18T17:30:00Z', T)).toBe('0.500000'); // Monday peak
  });

  it('the weekday changes at local midnight, not at UTC midnight', () => {
    // Summer: Friday 2027-07-02 23:30Z is 00:30 on Saturday 2027-07-03 in Dublin.
    expect(rateOrCode('2027-07-02T22:59:59.999Z', T)).toBe('0.300000'); // Friday 23:59 local, weekday day
    expect(rateOrCode('2027-07-02T23:00:00Z', T)).toBe('0.220000'); // Saturday 00:00 local, weekend
  });

  it('summer weekdays use the summer table', () => {
    expect(rateOrCode('2027-07-01T02:00:00Z', T)).toBe('0.200000'); // Thursday 03:00 local, night
    expect(rateOrCode('2027-07-01T12:00:00Z', T)).toBe('0.300000');
    expect(rateOrCode('2027-07-03T12:00:00Z', T)).toBe('0.220000'); // Saturday
  });

  it('the season changes at local midnight on 1 April and 1 October (both inclusive at the start)', () => {
    expect(rateOrCode('2027-03-31T22:59:59.999Z', T)).toBe('0.380000'); // Wed 31 Mar 23:59 local, winter
    expect(rateOrCode('2027-03-31T23:00:00Z', T)).toBe('0.200000'); // Thu 1 Apr 00:00 local, summer night
    expect(rateOrCode('2026-09-30T22:59:59.999Z', T)).toBe('0.300000'); // Wed 30 Sep 23:59 local, summer day
    expect(rateOrCode('2026-09-30T23:00:00Z', T)).toBe('0.220000'); // Thu 1 Oct 00:00 local, winter night
  });

  it('reports the season name and the slot label', () => {
    expect(resolveTariffRate(ms('2027-01-15T17:30:00Z'), T, 'IMPORT')).toMatchObject({
      ok: true,
      source: 'SEASON',
      label: 'Peak',
      scheduleName: 'EXAMPLE winter',
    });
  });

  it('a season with no slots of its own uses the all-year slots, and says so (source BASE)', () => {
    const inherits = variant(SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE, {
      slots: [slot(0, 1440, '0.400000', 'All year')],
      seasons: SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE.seasons.map((s) => ({ ...s, slots: [] })),
    });
    expect(resolveTariffRate(ms('2027-07-01T12:00:00Z'), [inherits], 'IMPORT')).toMatchObject({
      ok: true,
      ratePerKwh: '0.400000',
      source: 'BASE',
    });
  });
});

describe('date overrides', () => {
  const T = [SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE];

  it('replace the schedule for [dateFrom, dateTo): from 24 to 26 December inclusive', () => {
    expect(rateOrCode('2026-12-23T23:59:59.999Z', T)).toBe('0.380000'); // Wed 23 Dec 23:59, winter weekday
    expect(rateOrCode('2026-12-24T00:00:00Z', T)).toBe('0.150000');
    expect(rateOrCode('2026-12-24T23:59:59.999Z', T)).toBe('0.150000');
    expect(rateOrCode('2026-12-26T23:59:59.999Z', T)).toBe('0.150000');
    expect(rateOrCode('2026-12-27T00:00:00Z', T)).toBe('0.280000'); // Sunday, winter weekend
  });

  it('the higher priority wins where two overrides cover a date', () => {
    expect(rateOrCode('2026-12-24T23:59:59.999Z', T)).toBe('0.150000'); // festive (10) only
    expect(rateOrCode('2026-12-25T00:00:00Z', T)).toBe('0.100000'); // Christmas Day (20) beats festive (10)
    expect(rateOrCode('2026-12-25T23:59:59.999Z', T)).toBe('0.100000');
    expect(rateOrCode('2026-12-26T00:00:00Z', T)).toBe('0.150000'); // festive again
  });

  it('beat everything else, and report themselves as the source', () => {
    expect(resolveTariffRate(ms('2026-12-25T12:00:00Z'), T, 'IMPORT')).toMatchObject({
      ok: true,
      source: 'OVERRIDE',
      scheduleName: 'EXAMPLE Christmas Day',
      label: 'Christmas Day',
    });
  });

  it('two overrides of equal priority on one date are ambiguous, never resolved by order', () => {
    const tie = variant(FLAT_IMPORT_EXAMPLE, {
      overrides: [
        {
          name: 'A',
          dateFrom: '2026-06-01',
          dateTo: '2026-06-10',
          priority: 5,
          slots: [slot(0, 1440, '0.1', 'A')],
        },
        {
          name: 'B',
          dateFrom: '2026-06-05',
          dateTo: '2026-06-15',
          priority: 5,
          slots: [slot(0, 1440, '0.2', 'B')],
        },
      ],
    });
    expect(rateOrCode('2026-06-03T12:00:00Z', [tie])).toBe('0.1');
    expect(rateOrCode('2026-06-07T12:00:00Z', [tie])).toBe('AMBIGUOUS_TARIFF');
    expect(rateOrCode('2026-06-12T12:00:00Z', [tie])).toBe('0.2');
  });

  it('apply to a flat tariff too, and an override that leaves a gap is a gap, not a fallback to the flat rate', () => {
    const holiday = variant(FLAT_IMPORT_EXAMPLE, {
      overrides: [
        {
          name: 'Morning only',
          dateFrom: '2026-06-01',
          dateTo: '2026-06-02',
          priority: 1,
          slots: [slot(0, 720, '0.100000', 'Morning')],
        },
      ],
    });
    expect(rateOrCode('2026-05-31T12:00:00Z', [holiday])).toBe('0.300000');
    expect(rateOrCode('2026-06-01T05:00:00Z', [holiday])).toBe('0.100000'); // 06:00 local
    expect(rateOrCode('2026-06-01T12:00:00Z', [holiday])).toBe('TARIFF_GAP'); // 13:00 local
  });
});

describe('dynamic prices', () => {
  const day = halfHourlyPricePointsForDay('2026-01-15', 'Europe/Dublin');
  const priceObservations = indexPricePoints([
    { tariffId: DYNAMIC_IMPORT_EXAMPLE.id, pricePoints: day },
  ]);
  const T = [DYNAMIC_IMPORT_EXAMPLE];

  it('use the price point that contains the instant: start inclusive, end exclusive', () => {
    expect(rateOrCode('2026-01-15T00:00:00Z', T, 'IMPORT', { priceObservations })).toBe('0.100000');
    expect(rateOrCode('2026-01-15T00:29:59.999Z', T, 'IMPORT', { priceObservations })).toBe(
      '0.100000',
    );
    expect(rateOrCode('2026-01-15T00:30:00Z', T, 'IMPORT', { priceObservations })).toBe('0.105000');
    expect(rateOrCode('2026-01-15T09:59:59.999Z', T, 'IMPORT', { priceObservations })).toBe(
      '0.195000',
    );
    expect(rateOrCode('2026-01-15T10:00:00Z', T, 'IMPORT', { priceObservations })).toBe('0.100000');
  });

  it('say NO_PRICE_POINT where there is none, and never zero', () => {
    expect(rateOrCode('2026-01-15T23:59:59.999Z', T, 'IMPORT', { priceObservations })).toBe(
      '0.135000',
    ); // last point of the day (index 47, 47 mod 20 = 7)
    expect(rateOrCode('2026-01-16T00:00:00Z', T, 'IMPORT', { priceObservations })).toBe(
      'NO_PRICE_POINT',
    );
    expect(rateOrCode('2026-01-15T12:00:00Z', T)).toBe('NO_PRICE_POINT'); // no observations given at all
  });

  it('are stated as source DYNAMIC and the rate keeps its sign (a negative price is allowed)', () => {
    const negative = indexPricePoints([
      {
        tariffId: DYNAMIC_IMPORT_EXAMPLE.id,
        pricePoints: halfHourlyPricePointsForDay('2026-01-15', 'Europe/Dublin', (i) =>
          i === 0 ? -25_000 : 100_000,
        ),
      },
    ]);
    expect(
      resolveTariffRate(ms('2026-01-15T00:10:00Z'), T, 'IMPORT', { priceObservations: negative }),
    ).toMatchObject({ ok: true, ratePerKwh: '-0.025000', source: 'DYNAMIC' });
  });

  it('are beaten by a date override', () => {
    const fixedDay = variant(DYNAMIC_IMPORT_EXAMPLE, {
      overrides: [
        {
          name: 'Fixed day',
          dateFrom: '2026-01-15',
          dateTo: '2026-01-16',
          priority: 1,
          slots: [slot(0, 1440, '0.500000', 'Fixed')],
        },
      ],
    });
    expect(rateOrCode('2026-01-15T12:00:00Z', [fixedDay], 'IMPORT', { priceObservations })).toBe(
      '0.500000',
    );
    expect(rateOrCode('2026-01-16T12:00:00Z', [fixedDay], 'IMPORT', { priceObservations })).toBe(
      'NO_PRICE_POINT',
    );
  });

  it('two overlapping price points make the instants inside the overlap ambiguous', () => {
    const overlapping = indexPricePoints([
      {
        tariffId: DYNAMIC_IMPORT_EXAMPLE.id,
        pricePoints: [
          {
            intervalStart: '2026-01-15T00:00:00Z',
            intervalEnd: '2026-01-15T01:00:00Z',
            ratePerKwh: '0.1',
          },
          {
            intervalStart: '2026-01-15T00:30:00Z',
            intervalEnd: '2026-01-15T01:30:00Z',
            ratePerKwh: '0.2',
          },
        ],
      },
    ]);
    expect(
      rateOrCode('2026-01-15T00:45:00Z', T, 'IMPORT', { priceObservations: overlapping }),
    ).toBe('AMBIGUOUS_TARIFF');
  });
});

describe('effective-dated versions', () => {
  const versions = [DAY_NIGHT_VERSION_1_EXAMPLE, DAY_NIGHT_VERSION_2_EXAMPLE];

  it('switch at local midnight on the date the next version takes over', () => {
    expect(resolveTariffRate(ms('2026-10-31T23:59:59.999Z'), versions, 'IMPORT')).toMatchObject({
      ok: true,
      ratePerKwh: '0.340000',
      version: 1,
    });
    expect(resolveTariffRate(ms('2026-11-01T00:00:00Z'), versions, 'IMPORT')).toMatchObject({
      ok: true,
      ratePerKwh: '0.200000',
      version: 2,
    });
  });

  it('use the version list in any order', () => {
    expect(rateOrCode('2026-12-01T12:00:00Z', [...versions].reverse())).toBe('0.380000');
  });

  it('find no tariff before the first version or after an ended version', () => {
    expect(rateOrCode('2025-12-31T23:59:59.999Z', versions)).toBe('NO_TARIFF_FOR_DATE');
    expect(rateOrCode('2026-11-01T12:00:00Z', [DAY_NIGHT_VERSION_1_EXAMPLE])).toBe(
      'NO_TARIFF_FOR_DATE',
    );
  });

  it('read the effective date as a local date in the tariff zone', () => {
    const fromApril = variant(FLAT_IMPORT_EXAMPLE, { effectiveFrom: '2026-04-01' });
    expect(rateOrCode('2026-03-31T22:59:59.999Z', [fromApril])).toBe('NO_TARIFF_FOR_DATE'); // 23:59 on 31 March local
    expect(rateOrCode('2026-03-31T23:00:00Z', [fromApril])).toBe('0.300000'); // 00:00 on 1 April local
  });

  it('two versions in force at once are ambiguous, never resolved by order', () => {
    const clash = variant(DAY_NIGHT_VERSION_2_EXAMPLE, { effectiveFrom: '2026-10-01' });
    expect(rateOrCode('2026-10-15T12:00:00Z', [DAY_NIGHT_VERSION_1_EXAMPLE, clash])).toBe(
      'AMBIGUOUS_TARIFF',
    );
  });
});

describe('import and export are separate', () => {
  const both = [FLAT_IMPORT_EXAMPLE, EXPORT_PER_KWH_EXAMPLE];

  it('resolve independently at the same instant', () => {
    expect(rateOrCode('2026-06-15T12:00:00Z', both, 'IMPORT')).toBe('0.300000');
    expect(rateOrCode('2026-06-15T12:00:00Z', both, 'EXPORT')).toBe('0.100000');
  });

  it('a missing export tariff is an error, not the import rate and not zero', () => {
    expect(rateOrCode('2026-06-15T12:00:00Z', [FLAT_IMPORT_EXAMPLE], 'EXPORT')).toBe(
      'NO_TARIFF_FOR_DATE',
    );
    expect(rateOrCode('2026-06-15T12:00:00Z', [EXPORT_PER_KWH_EXAMPLE], 'IMPORT')).toBe(
      'NO_TARIFF_FOR_DATE',
    );
  });
});

describe('site scope', () => {
  const siteTariff: Tariff = variant(FLAT_IMPORT_EXAMPLE, {
    id: '00000000-0000-4000-8000-0000000000a1',
    siteId: '00000000-0000-4000-8000-0000000000b1',
    flatRatePerKwh: '0.250000',
  });
  const otherSite = '00000000-0000-4000-8000-0000000000b2';

  it('a site-specific version beats the household default for that site only', () => {
    const t = [FLAT_IMPORT_EXAMPLE, siteTariff];
    expect(rateOrCode('2026-06-15T12:00:00Z', t, 'IMPORT', { siteId: siteTariff.siteId })).toBe(
      '0.250000',
    );
    expect(rateOrCode('2026-06-15T12:00:00Z', t, 'IMPORT', { siteId: otherSite })).toBe('0.300000');
    expect(rateOrCode('2026-06-15T12:00:00Z', t)).toBe('0.300000');
  });

  it('a site tariff is not used when no site is named: an error, not a lucky pick', () => {
    expect(rateOrCode('2026-06-15T12:00:00Z', [siteTariff])).toBe('NO_TARIFF_FOR_DATE');
    expect(rateOrCode('2026-06-15T12:00:00Z', [siteTariff], 'IMPORT', { siteId: otherSite })).toBe(
      'NO_TARIFF_FOR_DATE',
    );
  });
});

describe('missing coverage is an error, never zero', () => {
  it('a slot list that leaves part of the day uncovered gives TARIFF_GAP there and a rate elsewhere', () => {
    const gappy = variant(DAY_NIGHT_IMPORT_EXAMPLE, { slots: [slot(0, 480, NIGHT, 'Night')] });
    expect(rateOrCode('2026-01-15T07:59:59.999Z', [gappy])).toBe(NIGHT);
    expect(rateOrCode('2026-01-15T08:00:00Z', [gappy])).toBe('TARIFF_GAP');
  });

  it('a time-of-use tariff with no slots gives TARIFF_GAP', () => {
    expect(
      rateOrCode('2026-01-15T12:00:00Z', [variant(DAY_NIGHT_IMPORT_EXAMPLE, { slots: [] })]),
    ).toBe('TARIFF_GAP');
  });

  it('a flat tariff with no flat rate gives TARIFF_GAP (the schema would have refused it)', () => {
    expect(
      rateOrCode('2026-01-15T12:00:00Z', [variant(FLAT_IMPORT_EXAMPLE, { flatRatePerKwh: null })]),
    ).toBe('TARIFF_GAP');
  });

  it('overlapping slots and overlapping seasons are ambiguous', () => {
    const overlappingSlots = variant(DAY_NIGHT_IMPORT_EXAMPLE, {
      slots: [slot(0, 1440, '0.1', 'All'), slot(480, 1000, '0.2', 'Day')],
    });
    expect(rateOrCode('2026-01-15T12:00:00Z', [overlappingSlots])).toBe('AMBIGUOUS_TARIFF');
    expect(rateOrCode('2026-01-15T02:00:00Z', [overlappingSlots])).toBe('0.1');

    const [summer] = SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE.seasons;
    const twoSeasons = variant(SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE, {
      seasons: summer === undefined ? [] : [summer, { ...summer, name: 'Same months' }],
    });
    expect(rateOrCode('2027-07-01T12:00:00Z', [twoSeasons])).toBe('AMBIGUOUS_TARIFF');
  });

  it('carries a message but no secrets or user data', () => {
    const r = resolveTariffRate(ms('2026-01-15T12:00:00Z'), [], 'IMPORT');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NO_TARIFF_FOR_DATE');
      expect(r.message).toMatch(/IMPORT/);
      expect(r.localDate).toBeNull();
    }
  });
});

describe('input checks', () => {
  it('refuses an instant that is not a whole number of milliseconds', () => {
    expect(() => resolveTariffRate(Number.NaN, DN, 'IMPORT')).toThrow(RangeError);
    expect(() => resolveTariffRate(1.5, DN, 'IMPORT')).toThrow(RangeError);
    expect(() => resolveTariffRate(Number.POSITIVE_INFINITY, DN, 'IMPORT')).toThrow(RangeError);
  });
});
