import {
  TariffProblemSchema,
  type PricePoint,
  type Tariff,
  type TariffSlot,
} from '@autopw3/shared';
import { describe, expect, it } from 'vitest';
import {
  DAY_NIGHT_IMPORT_EXAMPLE,
  DAY_NIGHT_PEAK_IMPORT_EXAMPLE,
  DAY_NIGHT_VERSION_1_EXAMPLE,
  DAY_NIGHT_VERSION_2_EXAMPLE,
  DYNAMIC_IMPORT_EXAMPLE,
  EXPORT_NONE_EXAMPLE,
  EXPORT_PER_KWH_EXAMPLE,
  FLAT_IMPORT_EXAMPLE,
  SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE,
  TARIFF_EXAMPLES,
} from './fixtures';
import { variant } from './test-helpers';
import {
  uncoveredMinutes,
  validatePricePoints,
  validateTariff,
  validateTariffSet,
} from './validate';

function slot(
  start: number,
  end: number,
  rate = '0.200000',
  dayType: TariffSlot['dayType'] = 'ALL',
): TariffSlot {
  return { dayType, startMinute: start, endMinute: end, ratePerKwh: rate, label: null };
}

const tou = (slots: TariffSlot[], extra: Partial<Tariff> = {}): Tariff =>
  variant(DAY_NIGHT_IMPORT_EXAMPLE, { slots, ...extra });

const codes = (problems: readonly { code: string }[]) => problems.map((p) => p.code);

describe('the example fixtures are valid', () => {
  for (const [name, tariff] of Object.entries(TARIFF_EXAMPLES)) {
    it(`${name} has no problems`, () => {
      expect(validateTariff(tariff)).toEqual([]);
    });
  }
});

describe('SLOT_OVERLAP', () => {
  it('rejects two slots of the same day type that share minutes, naming the later slot', () => {
    const problems = validateTariff(tou([slot(0, 600), slot(500, 1440)]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ code: 'SLOT_OVERLAP', path: 'slots[1]' });
  });

  it('is found even when the overlapping slot is listed first', () => {
    const problems = validateTariff(tou([slot(500, 1440), slot(0, 600)]));
    expect(problems[0]).toMatchObject({ code: 'SLOT_OVERLAP', path: 'slots[0]' });
  });

  it('a slot that merely touches the next one is not an overlap (half-open)', () => {
    expect(validateTariff(tou([slot(0, 600), slot(600, 1440)]))).toEqual([]);
  });

  it('is found inside a season and inside an override, with the right path', () => {
    const seasonal = validateTariff(
      variant(SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE, {
        seasons: SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE.seasons.map((s, i) =>
          i === 1 ? { ...s, slots: [slot(0, 1440, '0.1'), slot(100, 200, '0.2')] } : s,
        ),
      }),
    );
    expect(
      seasonal.some((p) => p.code === 'SLOT_OVERLAP' && p.path === 'seasons[1].slots[1]'),
    ).toBe(true);

    const overridden = validateTariff(
      variant(FLAT_IMPORT_EXAMPLE, {
        overrides: [
          {
            name: 'O',
            dateFrom: '2026-06-01',
            dateTo: '2026-06-02',
            priority: 1,
            slots: [slot(0, 800), slot(700, 1440)],
          },
        ],
      }),
    );
    expect(overridden.map((p) => [p.code, p.path])).toEqual([
      ['SLOT_OVERLAP', 'overrides[0].slots[1]'],
    ]);
  });

  it('weekday or weekend slots over ALL slots are precedence, not an overlap', () => {
    const slots = [slot(0, 1440, '0.2', 'ALL'), slot(0, 1440, '0.3', 'WEEKEND')];
    expect(validateTariff(tou(slots))).toEqual([]);
  });

  it('overlap within the weekend group is still an overlap', () => {
    const slots = [
      slot(0, 1440, '0.2', 'ALL'),
      slot(0, 900, '0.3', 'WEEKEND'),
      slot(800, 1440, '0.3', 'WEEKEND'),
    ];
    expect(codes(validateTariff(tou(slots)))).toEqual(['SLOT_OVERLAP']);
  });
});

describe('COVERAGE_GAP', () => {
  it('names the uncovered minutes of the day', () => {
    const problems = validateTariff(tou([slot(0, 480)]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ code: 'COVERAGE_GAP', path: 'slots' });
    expect(problems[0]?.message).toContain('every day');
    expect(problems[0]?.message).toContain('08:00 to 24:00');
  });

  it('finds a hole in the middle and at the start', () => {
    const problems = validateTariff(tou([slot(60, 480), slot(600, 1440)]));
    expect(problems[0]?.message).toContain('00:00 to 01:00');
    expect(problems[0]?.message).toContain('08:00 to 10:00');
  });

  it('weekday slots alone leave the weekend uncovered', () => {
    const problems = validateTariff(tou([slot(0, 1440, '0.2', 'WEEKDAY')]));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('weekends');
    expect(problems[0]?.message).toContain('00:00 to 24:00');
  });

  it('weekday and weekend slots that each cover the day are complete', () => {
    expect(
      validateTariff(tou([slot(0, 1440, '0.2', 'WEEKDAY'), slot(0, 1440, '0.3', 'WEEKEND')])),
    ).toEqual([]);
  });

  it('a time-of-use tariff with no slots and no seasons has a gap', () => {
    expect(codes(validateTariff(tou([])))).toEqual(['COVERAGE_GAP']);
  });

  it('a season with no slots needs all-year slots to fall back on', () => {
    const seasons = SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE.seasons.map((s) => ({
      ...s,
      slots: [],
    }));
    const without = validateTariff(variant(SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE, { seasons }));
    expect(without.map((p) => [p.code, p.path])).toEqual([
      ['COVERAGE_GAP', 'seasons[0].slots'],
      ['COVERAGE_GAP', 'seasons[1].slots'],
    ]);
    const withBase = validateTariff(
      variant(SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE, { seasons, slots: [slot(0, 1440)] }),
    );
    expect(withBase).toEqual([]);
  });

  it('an override with no slots or a gap is a gap: it replaces the whole day', () => {
    const base = { name: 'O', dateFrom: '2026-06-01', dateTo: '2026-06-02', priority: 1 };
    const empty = validateTariff(
      variant(FLAT_IMPORT_EXAMPLE, { overrides: [{ ...base, slots: [] }] }),
    );
    expect(empty.map((p) => [p.code, p.path])).toEqual([['COVERAGE_GAP', 'overrides[0].slots']]);
    const partial = validateTariff(
      variant(FLAT_IMPORT_EXAMPLE, { overrides: [{ ...base, slots: [slot(0, 720)] }] }),
    );
    expect(partial.map((p) => [p.code, p.path])).toEqual([['COVERAGE_GAP', 'overrides[0].slots']]);
  });

  it('long lists of gaps stay inside the message limit', () => {
    const many = Array.from({ length: 24 }, (_, i) => slot(i * 60, i * 60 + 30));
    const problems = validateTariff(tou(many));
    expect(problems[0]?.message.length).toBeLessThanOrEqual(500);
    expect(problems[0]?.message).toContain('more');
  });
});

describe('uncoveredMinutes', () => {
  it('is empty for a full day and lists every hole otherwise', () => {
    expect(uncoveredMinutes([slot(0, 1440)])).toEqual([]);
    expect(uncoveredMinutes([slot(100, 200), slot(300, 400)])).toEqual([
      [0, 100],
      [200, 300],
      [400, 1440],
    ]);
    expect(uncoveredMinutes([])).toEqual([[0, 1440]]);
  });

  it('overlapping slots do not hide a later gap', () => {
    expect(uncoveredMinutes([slot(0, 900), slot(100, 200)])).toEqual([[900, 1440]]);
  });
});

describe('seasons', () => {
  const season = (name: string, sm: number, sd: number, em: number, ed: number) => ({
    name,
    startMonth: sm,
    startDay: sd,
    endMonth: em,
    endDay: ed,
    slots: [slot(0, 1440)],
  });

  it('SEASON_OVERLAP when two seasons share a date, including across the year end', () => {
    const t = tou([], {
      seasons: [season('Winter', 10, 1, 3, 31), season('Late winter', 3, 1, 4, 30)],
    });
    const problems = validateTariff(t);
    expect(problems.some((p) => p.code === 'SEASON_OVERLAP' && p.path === 'seasons[1]')).toBe(true);
  });

  it('seasons that meet exactly are fine, including a wrap-around pair covering the whole year', () => {
    const t = tou([], { seasons: [season('Summer', 4, 1, 9, 30), season('Winter', 10, 1, 3, 31)] });
    expect(validateTariff(t)).toEqual([]);
  });

  it('SEASON_GAP when dates are in no season and there are no all-year slots', () => {
    const t = tou([], { seasons: [season('Summer', 4, 1, 9, 30)] });
    const problems = validateTariff(t);
    expect(problems.map((p) => [p.code, p.path])).toEqual([['SEASON_GAP', 'seasons']]);
    expect(problems[0]?.message).toContain('183 day(s)'); // 366 - 183 (1 Apr to 30 Sep is 183 days)
  });

  it('dates outside the seasons are fine when all-year slots exist', () => {
    const t = tou([slot(0, 1440)], { seasons: [season('Summer', 4, 1, 9, 30)] });
    expect(validateTariff(t)).toEqual([]);
  });
});

describe('OVERRIDE_PRIORITY_TIE', () => {
  const override = (name: string, from: string, to: string, priority: number) => ({
    name,
    dateFrom: from,
    dateTo: to,
    priority,
    slots: [slot(0, 1440)],
  });
  const withOverrides = (...o: ReturnType<typeof override>[]) =>
    variant(FLAT_IMPORT_EXAMPLE, { overrides: o });

  it('rejects equal priorities that share a date', () => {
    const problems = validateTariff(
      withOverrides(
        override('A', '2026-06-01', '2026-06-10', 5),
        override('B', '2026-06-09', '2026-06-20', 5),
      ),
    );
    expect(problems.map((p) => [p.code, p.path])).toEqual([
      ['OVERRIDE_PRIORITY_TIE', 'overrides[1].priority'],
    ]);
  });

  it('allows equal priorities that only touch: dateTo is exclusive', () => {
    expect(
      validateTariff(
        withOverrides(
          override('A', '2026-06-01', '2026-06-10', 5),
          override('B', '2026-06-10', '2026-06-20', 5),
        ),
      ),
    ).toEqual([]);
  });

  it('allows overlapping overrides of different priority', () => {
    expect(
      validateTariff(
        withOverrides(
          override('A', '2026-06-01', '2026-06-10', 5),
          override('B', '2026-06-05', '2026-06-20', 6),
        ),
      ),
    ).toEqual([]);
  });
});

describe('other tariff problems', () => {
  it('LEVY_ON_EXPORT for each levy on an export tariff', () => {
    const t = variant(EXPORT_PER_KWH_EXAMPLE, {
      levies: [
        { name: 'A', kind: 'PER_KWH', amount: '0.01', taxable: false },
        { name: 'B', kind: 'PER_DAY', amount: '0.01', taxable: false },
      ],
    });
    expect(validateTariff(t).map((p) => [p.code, p.path])).toEqual([
      ['LEVY_ON_EXPORT', 'levies[0]'],
      ['LEVY_ON_EXPORT', 'levies[1]'],
    ]);
  });

  it('TIMEZONE_UNKNOWN for a zone the runtime does not know', () => {
    const t = variant(FLAT_IMPORT_EXAMPLE, { timezone: 'Mars/Olympus_Mons' });
    expect(validateTariff(t)).toEqual([
      expect.objectContaining({ code: 'TIMEZONE_UNKNOWN', path: 'timezone' }) as unknown,
    ]);
  });

  it('flat and dynamic tariffs need no slots', () => {
    expect(validateTariff(FLAT_IMPORT_EXAMPLE)).toEqual([]);
    expect(validateTariff(DYNAMIC_IMPORT_EXAMPLE)).toEqual([]);
  });

  it('every problem fits the shared TariffProblemSchema (what the API returns)', () => {
    const many = [
      ...validateTariff(tou([slot(0, 600), slot(500, 1000)])),
      ...validateTariff(
        variant(EXPORT_PER_KWH_EXAMPLE, {
          timezone: 'Nowhere/Land',
          levies: [{ name: 'A', kind: 'PER_KWH', amount: '1', taxable: true }],
        }),
      ),
    ];
    expect(many.length).toBeGreaterThan(0);
    for (const p of many) expect(TariffProblemSchema.safeParse(p).success).toBe(true);
  });

  it('gives the same answer every time and does not change its input', () => {
    const before = JSON.stringify(DAY_NIGHT_PEAK_IMPORT_EXAMPLE);
    expect(validateTariff(DAY_NIGHT_PEAK_IMPORT_EXAMPLE)).toEqual(
      validateTariff(DAY_NIGHT_PEAK_IMPORT_EXAMPLE),
    );
    expect(JSON.stringify(DAY_NIGHT_PEAK_IMPORT_EXAMPLE)).toBe(before);
  });
});

describe('validateTariffSet', () => {
  it('accepts an import and an export tariff, and back-to-back versions', () => {
    expect(validateTariffSet([FLAT_IMPORT_EXAMPLE, EXPORT_PER_KWH_EXAMPLE])).toEqual([]);
    expect(
      validateTariffSet([
        DAY_NIGHT_VERSION_1_EXAMPLE,
        DAY_NIGHT_VERSION_2_EXAMPLE,
        EXPORT_NONE_EXAMPLE,
      ]),
    ).toEqual([]);
  });

  it('EFFECTIVE_DATE_OVERLAP when two import versions are in force on the same date', () => {
    const problems = validateTariffSet([FLAT_IMPORT_EXAMPLE, DAY_NIGHT_IMPORT_EXAMPLE]);
    expect(problems.map((p) => [p.code, p.path])).toEqual([
      ['EFFECTIVE_DATE_OVERLAP', 'tariffs[1].effectiveFrom'],
    ]);
  });

  it('overlap is by half-open dates: a version ending on the day another starts is fine', () => {
    expect(validateTariffSet([DAY_NIGHT_VERSION_1_EXAMPLE, DAY_NIGHT_VERSION_2_EXAMPLE])).toEqual(
      [],
    );
    const clash = variant(DAY_NIGHT_VERSION_2_EXAMPLE, { effectiveFrom: '2026-10-31' });
    expect(codes(validateTariffSet([DAY_NIGHT_VERSION_1_EXAMPLE, clash]))).toEqual([
      'EFFECTIVE_DATE_OVERLAP',
    ]);
  });

  it('an open-ended version overlaps anything later', () => {
    const later = variant(DAY_NIGHT_VERSION_2_EXAMPLE, {
      effectiveFrom: '2031-01-01',
      effectiveTo: null,
    });
    expect(codes(validateTariffSet([DAY_NIGHT_VERSION_2_EXAMPLE, later]))).toEqual([
      'EFFECTIVE_DATE_OVERLAP',
    ]);
  });

  it('different directions or different site scopes may overlap in dates', () => {
    const siteTariff = variant(FLAT_IMPORT_EXAMPLE, {
      id: '00000000-0000-4000-8000-0000000000a1',
      siteId: '00000000-0000-4000-8000-0000000000b1',
    });
    expect(validateTariffSet([FLAT_IMPORT_EXAMPLE, siteTariff])).toEqual([]);
  });

  it('CURRENCY_MISMATCH and TIMEZONE_MISMATCH name the tariff that disagrees', () => {
    const gbp = variant(EXPORT_PER_KWH_EXAMPLE, { currency: 'GBP' });
    expect(validateTariffSet([FLAT_IMPORT_EXAMPLE, gbp]).map((p) => [p.code, p.path])).toEqual([
      ['CURRENCY_MISMATCH', 'tariffs[1].currency'],
    ]);
    const ny = variant(EXPORT_PER_KWH_EXAMPLE, { timezone: 'America/New_York' });
    expect(validateTariffSet([FLAT_IMPORT_EXAMPLE, ny]).map((p) => [p.code, p.path])).toEqual([
      ['TIMEZONE_MISMATCH', 'tariffs[1].timezone'],
    ]);
  });

  it("includes each version's own problems under tariffs[i]", () => {
    const bad = tou([slot(0, 600), slot(500, 1440)], {
      id: '00000000-0000-4000-8000-0000000000c1',
      effectiveFrom: '2025-01-01',
      effectiveTo: '2026-01-01',
    });
    const problems = validateTariffSet([FLAT_IMPORT_EXAMPLE, bad]);
    expect(problems.map((p) => [p.code, p.path])).toEqual([
      ['SLOT_OVERLAP', 'tariffs[1].slots[1]'],
    ]);
  });

  it('an empty set has no problems', () => {
    expect(validateTariffSet([])).toEqual([]);
  });
});

describe('validatePricePoints', () => {
  const p = (start: string, end: string): PricePoint => ({
    intervalStart: start,
    intervalEnd: end,
    ratePerKwh: '0.1',
  });

  it('accepts back-to-back points, in any order', () => {
    const points = [
      p('2026-01-15T01:00:00Z', '2026-01-15T01:30:00Z'),
      p('2026-01-15T00:00:00Z', '2026-01-15T00:30:00Z'),
      p('2026-01-15T00:30:00Z', '2026-01-15T01:00:00Z'),
    ];
    expect(validatePricePoints(points)).toEqual([]);
  });

  it('PRICE_POINT_OVERLAP names the later point of an overlapping pair, whatever the order given', () => {
    const points = [
      p('2026-01-15T00:30:00Z', '2026-01-15T01:30:00Z'),
      p('2026-01-15T00:00:00Z', '2026-01-15T01:00:00Z'),
    ];
    expect(validatePricePoints(points).map((x) => [x.code, x.path])).toEqual([
      ['PRICE_POINT_OVERLAP', 'pricePoints[0]'],
    ]);
  });

  it('flags a duplicate and a point inside a longer one', () => {
    const points = [
      p('2026-01-15T00:00:00Z', '2026-01-15T03:00:00Z'),
      p('2026-01-15T00:00:00Z', '2026-01-15T03:00:00Z'),
      p('2026-01-15T01:00:00Z', '2026-01-15T01:30:00Z'),
    ];
    expect(validatePricePoints(points)).toHaveLength(2);
  });

  it('uses the given path prefix', () => {
    const points = [
      p('2026-01-15T00:00:00Z', '2026-01-15T01:00:00Z'),
      p('2026-01-15T00:30:00Z', '2026-01-15T01:30:00Z'),
    ];
    expect(validatePricePoints(points, 'body.pricePoints')[0]?.path).toBe('body.pricePoints[1]');
  });

  it('ignores a point whose instant cannot be read (the schema rejects it)', () => {
    expect(validatePricePoints([p('nope', '2026-01-15T01:00:00Z')])).toEqual([]);
  });
});
