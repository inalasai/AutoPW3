import type { Tariff, TariffSlot } from '@autopw3/shared';
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
  halfHourlyPricePointsForDay,
} from './fixtures';
import { Decimal } from './money';
import { indexPricePoints } from './observations';
import { priceInterval, type IntervalPrice } from './price';
import { ms, variant } from './test-helpers';

function slot(start: number, end: number, rate: string, label: string): TariffSlot {
  return { dayType: 'ALL', startMinute: start, endMinute: end, ratePerKwh: rate, label };
}

function iv(from: string, to: string, energyWh: string | number) {
  return { startMs: ms(from), endMs: ms(to), energyWh };
}

/** The priced result, failing the test (with the status) when the interval was not priced. */
function priced(result: IntervalPrice) {
  if (result.status !== 'PRICED' && result.status !== 'ESTIMATE') {
    throw new Error(`expected a price, got ${result.status}`);
  }
  return result;
}

/** A flat import tariff with a given rate, tax mode and VAT, for exact hand calculation. */
function flat(
  rate: string,
  taxMode: Tariff['taxMode'],
  vat: string | null,
  extra: Partial<Tariff> = {},
): Tariff {
  return variant(FLAT_IMPORT_EXAMPLE, {
    flatRatePerKwh: rate,
    taxMode,
    vatRatePercent: vat,
    standingChargePerDay: null,
    ...extra,
  });
}

const HOUR = ['2026-06-15T12:00:00Z', '2026-06-15T13:00:00Z'] as const;

describe('a priced import interval (hand-calculated)', () => {
  it('2 kWh at 0.300000 with 23 percent VAT on top', () => {
    const p = priced(priceInterval(iv(...HOUR, 2000), [FLAT_IMPORT_EXAMPLE], 'IMPORT'));
    expect(p.status).toBe('PRICED');
    expect(p.currency).toBe('EUR');
    expect(p.energyKwh).toBe('2');
    expect(p.parts).toHaveLength(1);
    expect(p.parts[0]).toMatchObject({
      ratePerKwh: '0.300000',
      energyKwh: '2',
      source: 'FLAT',
      version: 1,
    });
    expect(p.amounts).toEqual({
      baseAmount: '0.6', // 2 x 0.30
      levyAmount: '0',
      vatAmount: '0.138', // 0.6 x 23 / 100
      totalAmount: '0.738', // 0.6 + 0.138
      amountExcludingVat: '0.6',
    });
  });

  it('is exact where floating point is not: 3 kWh at 0.1 is 0.3, not 0.30000000000000004', () => {
    const p = priced(priceInterval(iv(...HOUR, 3000), [flat('0.100000', 'NONE', null)], 'IMPORT'));
    expect(p.amounts.baseAmount).toBe('0.3');
    expect(p.amounts.totalAmount).toBe('0.3');
    expect(0.1 * 3).not.toBe(0.3);
  });

  it('keeps the tiniest amounts without an exponent: 1 Wh at 0.000001 is 0.000000001', () => {
    const p = priced(priceInterval(iv(...HOUR, 1), [flat('0.000001', 'NONE', null)], 'IMPORT'));
    expect(p.amounts.baseAmount).toBe('0.000000001');
  });

  it('zero energy is a priced zero, not a missing price', () => {
    const p = priced(priceInterval(iv(...HOUR, 0), [FLAT_IMPORT_EXAMPLE], 'IMPORT'));
    expect(p.amounts).toEqual({
      baseAmount: '0',
      levyAmount: '0',
      vatAmount: '0',
      totalAmount: '0',
      amountExcludingVat: '0',
    });
  });

  it('accepts energy as a string or a finite number and gives the same price', () => {
    const a = priceInterval(iv(...HOUR, '1234.5'), [FLAT_IMPORT_EXAMPLE], 'IMPORT');
    const b = priceInterval(iv(...HOUR, 1234.5), [FLAT_IMPORT_EXAMPLE], 'IMPORT');
    expect(a).toEqual(b);
  });
});

describe('VAT: inclusive and exclusive with the same stated rate (hand-calculated, 25 percent)', () => {
  const kwh1000 = iv(...HOUR, 1000);

  it('EXCLUSIVE: 0.50 stated, VAT 0.125 added, 0.625 payable', () => {
    const p = priced(priceInterval(kwh1000, [flat('0.500000', 'EXCLUSIVE', '25.0000')], 'IMPORT'));
    expect(p.amounts).toEqual({
      baseAmount: '0.5',
      levyAmount: '0',
      vatAmount: '0.125',
      totalAmount: '0.625',
      amountExcludingVat: '0.5',
    });
  });

  it('INCLUSIVE: 0.50 stated includes VAT of 0.10, so 0.40 before VAT and 0.50 payable', () => {
    const p = priced(priceInterval(kwh1000, [flat('0.500000', 'INCLUSIVE', '25.0000')], 'IMPORT'));
    expect(p.amounts).toEqual({
      baseAmount: '0.5',
      levyAmount: '0',
      vatAmount: '0.1', // 0.5 - 0.5 / 1.25
      totalAmount: '0.5',
      amountExcludingVat: '0.4',
    });
  });

  it('NONE: no VAT at all', () => {
    const p = priced(priceInterval(kwh1000, [flat('0.500000', 'NONE', null)], 'IMPORT'));
    expect(p.amounts.vatAmount).toBe('0');
    expect(p.amounts.totalAmount).toBe('0.5');
  });

  it('a taxed tariff without a VAT rate is refused, not priced as untaxed', () => {
    const broken = flat('0.500000', 'EXCLUSIVE', null);
    expect(() => priceInterval(kwh1000, [broken], 'IMPORT')).toThrow(RangeError);
  });
});

describe('levies', () => {
  it('a per-kWh levy outside VAT adds to the total but not to the taxable amount', () => {
    // 3 kWh in the day slot of the peak tariff: 3 x 0.34 = 1.02; levy 3 x 0.01 = 0.03 (not taxable);
    // VAT 23% of 1.02 = 0.2346; payable 1.02 + 0.03 + 0.2346 = 1.2846.
    const p = priced(
      priceInterval(
        iv('2026-01-15T09:00:00Z', '2026-01-15T10:00:00Z', 3000),
        [DAY_NIGHT_PEAK_IMPORT_EXAMPLE],
        'IMPORT',
      ),
    );
    expect(p.amounts).toEqual({
      baseAmount: '1.02',
      levyAmount: '0.03',
      vatAmount: '0.2346',
      totalAmount: '1.2846',
      amountExcludingVat: '1.05',
    });
    // Only the per-kWh levy appears on an energy interval; the per-day levy belongs to the day.
    expect(p.parts[0]?.levyLines).toEqual([
      { name: 'EXAMPLE levy per kWh', amount: '0.03', taxable: false },
    ]);
  });

  it('under INCLUSIVE tax a taxable levy is inside the VAT and a non-taxable one is outside it', () => {
    // 1 kWh at 0.50, taxable levy 0.25, non-taxable levy 0.10, all stated with VAT of 25 percent included.
    // Taxable amount 0.75, VAT inside = 0.75 - 0.75 / 1.25 = 0.15, payable = 0.50 + 0.35 = 0.85.
    const t = flat('0.500000', 'INCLUSIVE', '25.0000', {
      levies: [
        { name: 'Taxable', kind: 'PER_KWH', amount: '0.250000', taxable: true },
        { name: 'Not taxable', kind: 'PER_KWH', amount: '0.100000', taxable: false },
      ],
    });
    const p = priced(priceInterval(iv(...HOUR, 1000), [t], 'IMPORT'));
    expect(p.amounts).toEqual({
      baseAmount: '0.5',
      levyAmount: '0.35',
      vatAmount: '0.15',
      totalAmount: '0.85',
      amountExcludingVat: '0.7',
    });
  });
});

describe('export', () => {
  it('pays kWh x rate when the model is PER_KWH (0.5 kWh at 0.10 is 0.05)', () => {
    const p = priced(priceInterval(iv(...HOUR, 500), [EXPORT_PER_KWH_EXAMPLE], 'EXPORT'));
    expect(p.exportPaymentModel).toBe('PER_KWH');
    expect(p.amounts).toEqual({
      baseAmount: '0.05',
      levyAmount: '0',
      vatAmount: '0',
      totalAmount: '0.05',
      amountExcludingVat: '0.05',
    });
  });

  it('an explicit NONE pays exactly zero and says so', () => {
    const p = priced(priceInterval(iv(...HOUR, 500), [EXPORT_NONE_EXAMPLE], 'EXPORT'));
    expect(p.exportPaymentModel).toBe('NONE');
    expect(p.amounts.baseAmount).toBe('0');
    expect(p.amounts.totalAmount).toBe('0');
  });

  it('import and export are priced independently from the same list', () => {
    const both = [FLAT_IMPORT_EXAMPLE, EXPORT_PER_KWH_EXAMPLE];
    const imp = priced(priceInterval(iv(...HOUR, 1000), both, 'IMPORT'));
    const exp = priced(priceInterval(iv(...HOUR, 1000), both, 'EXPORT'));
    expect(imp.parts[0]?.ratePerKwh).toBe('0.300000');
    expect(exp.parts[0]?.ratePerKwh).toBe('0.100000');
    expect(imp.exportPaymentModel).toBeNull();
  });

  it('a missing export tariff leaves the interval unpriced, never zero', () => {
    const r = priceInterval(iv(...HOUR, 1000), [FLAT_IMPORT_EXAMPLE], 'EXPORT');
    expect(r).toMatchObject({ status: 'UNPRICED', direction: 'EXPORT' });
    if (r.status === 'UNPRICED') expect(r.gaps[0]?.code).toBe('NO_TARIFF_FOR_DATE');
  });

  it('levies on an export tariff are not applied (validateTariff reports them)', () => {
    const odd = variant(EXPORT_PER_KWH_EXAMPLE, {
      levies: [{ name: 'Odd', kind: 'PER_KWH', amount: '0.5', taxable: true }],
    });
    const p = priced(priceInterval(iv(...HOUR, 1000), [odd], 'EXPORT'));
    expect(p.amounts.levyAmount).toBe('0');
    expect(p.parts[0]?.levyLines).toEqual([]);
  });

  it('an export tariff with its own tax mode applies it to the credit', () => {
    const taxed = variant(EXPORT_PER_KWH_EXAMPLE, {
      flatRatePerKwh: '0.500000',
      taxMode: 'EXCLUSIVE',
      vatRatePercent: '25.0000',
    });
    const p = priced(priceInterval(iv(...HOUR, 1000), [taxed], 'EXPORT'));
    expect(p.amounts).toMatchObject({
      baseAmount: '0.5',
      vatAmount: '0.125',
      totalAmount: '0.625',
    });
  });
});

describe('negative prices', () => {
  it('a negative dynamic import price gives a negative amount (the buyer is paid to import)', () => {
    const t = DYNAMIC_IMPORT_EXAMPLE;
    const obs = indexPricePoints([
      {
        tariffId: t.id,
        pricePoints: halfHourlyPricePointsForDay('2026-01-15', 'Europe/Dublin', () => -25_000),
      },
    ]);
    const p = priced(
      priceInterval(iv('2026-01-15T00:00:00Z', '2026-01-15T00:30:00Z', 2000), [t], 'IMPORT', {
        priceObservations: obs,
      }),
    );
    // 2 kWh x -0.025 = -0.05; VAT 23% added on top = -0.0115; payable -0.0615.
    expect(p.amounts).toEqual({
      baseAmount: '-0.05',
      levyAmount: '0',
      vatAmount: '-0.0115',
      totalAmount: '-0.0615',
      amountExcludingVat: '-0.05',
    });
    expect(p.parts[0]?.source).toBe('DYNAMIC');
  });

  it('a negative export price is a negative credit: the exporter pays', () => {
    const t = variant(EXPORT_PER_KWH_EXAMPLE, { flatRatePerKwh: '-0.050000' });
    const p = priced(priceInterval(iv(...HOUR, 1000), [t], 'EXPORT'));
    expect(p.amounts.totalAmount).toBe('-0.05');
  });
});

describe('an interval with more than one rate (Q-08)', () => {
  const across = iv('2026-01-15T07:00:00Z', '2026-01-15T09:00:00Z', 2000); // night until 08:00, then day

  it('is not priced by default: UNPRICEABLE_AT_RESOLUTION, with the segments that explain why', () => {
    const r = priceInterval(across, [DAY_NIGHT_IMPORT_EXAMPLE], 'IMPORT');
    expect(r.status).toBe('UNPRICEABLE_AT_RESOLUTION');
    if (r.status === 'UNPRICEABLE_AT_RESOLUTION') {
      expect(r.segments).toHaveLength(2);
      expect(r.segments.map((s) => s.endMs)).toEqual([
        ms('2026-01-15T08:00:00Z'),
        ms('2026-01-15T09:00:00Z'),
      ]);
    }
  });

  it('STRICT is the default and can be asked for', () => {
    expect(
      priceInterval(across, [DAY_NIGHT_IMPORT_EXAMPLE], 'IMPORT', { mode: 'STRICT' }).status,
    ).toBe('UNPRICEABLE_AT_RESOLUTION');
  });

  it('PRORATA_ESTIMATE shares the energy by time and labels the result ESTIMATE', () => {
    // 2 kWh over 2 h: 1 kWh in the night hour at 0.18 and 1 kWh in the day hour at 0.35 = 0.53 (VAT 13.5% included).
    const p = priced(
      priceInterval(across, [DAY_NIGHT_IMPORT_EXAMPLE], 'IMPORT', { mode: 'PRORATA_ESTIMATE' }),
    );
    expect(p.status).toBe('ESTIMATE');
    expect(p.parts.map((x) => [x.energyKwh, x.ratePerKwh, x.label])).toEqual([
      ['1', '0.180000', 'Night'],
      ['1', '0.350000', 'Day'],
    ]);
    expect(p.amounts.baseAmount).toBe('0.53');
    expect(p.amounts.totalAmount).toBe('0.53'); // inclusive: VAT is inside
    // VAT inside 0.53 at 13.5 percent, by an independent formula: 0.53 x 0.135 / 1.135.
    const expectedVat = new Decimal('0.53').times('0.135').div('1.135');
    expect(new Decimal(p.amounts.vatAmount).minus(expectedVat).abs().lt('1e-24')).toBe(true);
  });

  it('unequal shares: 3 kWh over 90 minutes, 30 minutes of night and 60 of day', () => {
    const p = priced(
      priceInterval(
        iv('2026-01-15T07:30:00Z', '2026-01-15T09:00:00Z', 3000),
        [DAY_NIGHT_IMPORT_EXAMPLE],
        'IMPORT',
        {
          mode: 'PRORATA_ESTIMATE',
        },
      ),
    );
    expect(p.parts.map((x) => x.energyKwh)).toEqual(['1', '2']);
    expect(p.amounts.baseAmount).toBe('0.88'); // 1 x 0.18 + 2 x 0.35
  });

  it('shares that do not divide evenly still add up to the whole energy exactly', () => {
    // 1 kWh over 3 hours: 1 h of night (07:00 is 7:00-08:00) and 2 h of day.
    const p = priced(
      priceInterval(
        iv('2026-01-15T07:00:00Z', '2026-01-15T10:00:00Z', 1000),
        [DAY_NIGHT_IMPORT_EXAMPLE],
        'IMPORT',
        {
          mode: 'PRORATA_ESTIMATE',
        },
      ),
    );
    const sum = p.parts.reduce((s, x) => s.plus(x.energyKwh), new Decimal(0));
    expect(sum.eq(1)).toBe(true);
    expect(p.parts[0]?.energyKwh).toBe('0.3333333333333333333333333333');
  });

  it('a boundary at the very end of the interval does not make it mixed', () => {
    const p = priced(
      priceInterval(
        iv('2026-01-15T07:00:00Z', '2026-01-15T08:00:00Z', 1000),
        [DAY_NIGHT_IMPORT_EXAMPLE],
        'IMPORT',
      ),
    );
    expect(p.status).toBe('PRICED');
    expect(p.parts[0]?.ratePerKwh).toBe('0.180000');
  });

  it('two slots with the same rate do not make an interval mixed', () => {
    const same = variant(DAY_NIGHT_IMPORT_EXAMPLE, {
      slots: [slot(0, 720, '0.200000', 'Morning'), slot(720, 1440, '0.200000', 'Afternoon')],
    });
    const p = priced(
      priceInterval(iv('2026-01-15T11:00:00Z', '2026-01-15T13:00:00Z', 1000), [same], 'IMPORT'),
    );
    expect(p.status).toBe('PRICED');
    expect(p.parts).toHaveLength(1);
  });

  it('the same rate under a different tariff version is a different basis: not priced', () => {
    const v2SameRate = variant(DAY_NIGHT_VERSION_2_EXAMPLE, {
      slots: [slot(0, 1440, '0.340000', 'All day')],
    });
    const r = priceInterval(
      iv('2026-10-31T23:00:00Z', '2026-11-01T01:00:00Z', 1000),
      [DAY_NIGHT_VERSION_1_EXAMPLE, v2SameRate],
      'IMPORT',
    );
    expect(r.status).toBe('UNPRICEABLE_AT_RESOLUTION');
  });

  it('the shortened night on the spring-forward day is one rate when the interval stays inside it', () => {
    const p = priced(
      priceInterval(
        iv('2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z', 1000),
        [DAY_NIGHT_IMPORT_EXAMPLE],
        'IMPORT',
      ),
    );
    expect(p.parts[0]?.ratePerKwh).toBe('0.180000'); // 00:30 GMT to 02:30 BST, all night
  });

  it('the repeated hour on the fall-back day is one rate when the interval stays inside the night', () => {
    const p = priced(
      priceInterval(
        iv('2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z', 1000),
        [DAY_NIGHT_IMPORT_EXAMPLE],
        'IMPORT',
      ),
    );
    expect(p.parts[0]?.ratePerKwh).toBe('0.180000'); // 01:30 BST to 01:30 GMT, all night
  });

  it('prices across the fall-back day in the right proportions: 9 hours of night, not 8', () => {
    // 25-hour local day, 1 kWh per hour: 9 h night at 0.18, 15 h day at 0.35, 1 h night at 0.18.
    const day = [ms('2026-10-24T23:00:00Z'), ms('2026-10-26T00:00:00Z')] as const;
    const p = priced(
      priceInterval(
        { startMs: day[0], endMs: day[1], energyWh: 25_000 },
        [DAY_NIGHT_IMPORT_EXAMPLE],
        'IMPORT',
        {
          mode: 'PRORATA_ESTIMATE',
        },
      ),
    );
    expect(p.parts.map((x) => x.energyKwh)).toEqual(['9', '15', '1']);
    expect(p.amounts.baseAmount).toBe('7.05'); // 9 x 0.18 + 15 x 0.35 + 1 x 0.18 = 1.62 + 5.25 + 0.18
  });
});

describe('problems are never priced', () => {
  const gappy = variant(DAY_NIGHT_IMPORT_EXAMPLE, { slots: [slot(0, 480, '0.180000', 'Night')] });

  it('an interval touching a gap is UNPRICED and lists the gap', () => {
    const r = priceInterval(
      iv('2026-01-15T07:00:00Z', '2026-01-15T09:00:00Z', 1000),
      [gappy],
      'IMPORT',
    );
    expect(r.status).toBe('UNPRICED');
    if (r.status === 'UNPRICED') {
      expect(r.gaps).toEqual([
        {
          startMs: ms('2026-01-15T08:00:00Z'),
          endMs: ms('2026-01-15T09:00:00Z'),
          code: 'TARIFF_GAP',
          message: expect.any(String) as string,
        },
      ]);
    }
  });

  it('prorata mode does not estimate over a gap either', () => {
    const r = priceInterval(
      iv('2026-01-15T07:00:00Z', '2026-01-15T09:00:00Z', 1000),
      [gappy],
      'IMPORT',
      {
        mode: 'PRORATA_ESTIMATE',
      },
    );
    expect(r.status).toBe('UNPRICED');
  });

  it('a dynamic interval with no price is NO_PRICE_POINT', () => {
    const r = priceInterval(iv(...HOUR, 1000), [DYNAMIC_IMPORT_EXAMPLE], 'IMPORT');
    expect(r).toMatchObject({ status: 'UNPRICED' });
    if (r.status === 'UNPRICED') expect(r.gaps[0]?.code).toBe('NO_PRICE_POINT');
  });
});

describe('input checks', () => {
  it('refuses negative, non-finite and malformed energy', () => {
    expect(() => priceInterval(iv(...HOUR, -1), [FLAT_IMPORT_EXAMPLE], 'IMPORT')).toThrow(
      RangeError,
    );
    expect(() => priceInterval(iv(...HOUR, Number.NaN), [FLAT_IMPORT_EXAMPLE], 'IMPORT')).toThrow(
      RangeError,
    );
    expect(() => priceInterval(iv(...HOUR, 'abc'), [FLAT_IMPORT_EXAMPLE], 'IMPORT')).toThrow(
      RangeError,
    );
  });

  it('refuses an empty or reversed interval', () => {
    expect(() => priceInterval(iv(HOUR[0], HOUR[0], 1), [FLAT_IMPORT_EXAMPLE], 'IMPORT')).toThrow(
      RangeError,
    );
    expect(() => priceInterval(iv(HOUR[1], HOUR[0], 1), [FLAT_IMPORT_EXAMPLE], 'IMPORT')).toThrow(
      RangeError,
    );
  });

  it('refuses an interval that spans two currencies instead of adding them', () => {
    const gbp = variant(DAY_NIGHT_VERSION_2_EXAMPLE, { currency: 'GBP' });
    expect(() =>
      priceInterval(
        iv('2026-10-31T23:00:00Z', '2026-11-01T01:00:00Z', 1000),
        [DAY_NIGHT_VERSION_1_EXAMPLE, gbp],
        'IMPORT',
        {
          mode: 'PRORATA_ESTIMATE',
        },
      ),
    ).toThrow(RangeError);
  });
});
