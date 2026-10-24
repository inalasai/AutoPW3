import type { Tariff } from '@autopw3/shared';
import { describe, expect, it } from 'vitest';
import { MAX_CHARGE_DAYS, chargesForLocalDates } from './charges';
import {
  DAY_NIGHT_IMPORT_EXAMPLE,
  DAY_NIGHT_PEAK_IMPORT_EXAMPLE,
  DAY_NIGHT_VERSION_1_EXAMPLE,
  DAY_NIGHT_VERSION_2_EXAMPLE,
  EXPORT_PER_KWH_EXAMPLE,
  FLAT_IMPORT_EXAMPLE,
} from './fixtures';
import { Decimal, roundToMinorUnit } from './money';
import { priceInterval } from './price';
import { ms, variant } from './test-helpers';

function ok(result: ReturnType<typeof chargesForLocalDates>) {
  if (!result.ok)
    throw new Error(`expected charges, got problems ${JSON.stringify(result.problems)}`);
  return result;
}

describe('standing charge: each local date is charged once, whatever its length', () => {
  it('four days across the spring-forward day (23 hours) cost four standing charges', () => {
    const r = ok(chargesForLocalDates('2026-03-28', '2026-04-01', [FLAT_IMPORT_EXAMPLE]));
    expect(r.days.map((d) => d.localDate)).toEqual([
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
    ]);
    for (const d of r.days) {
      expect(d.standingChargeAmount).toBe('0.6');
      expect(d.amounts).toEqual({
        baseAmount: '0.6',
        levyAmount: '0',
        vatAmount: '0.138',
        totalAmount: '0.738',
        amountExcludingVat: '0.6',
      });
    }
    expect(r.totals).toEqual({
      baseAmount: '2.4',
      levyAmount: '0',
      vatAmount: '0.552',
      totalAmount: '2.952',
      amountExcludingVat: '2.4',
    });
    expect(r.currency).toBe('EUR');
  });

  it('three days across the fall-back day (25 hours) cost three standing charges', () => {
    const r = ok(chargesForLocalDates('2026-10-24', '2026-10-27', [FLAT_IMPORT_EXAMPLE]));
    expect(r.days).toHaveLength(3);
    expect(r.totals.baseAmount).toBe('1.8');
  });

  it('the end date is exclusive and a one-day range is one charge', () => {
    expect(
      ok(chargesForLocalDates('2026-10-25', '2026-10-26', [FLAT_IMPORT_EXAMPLE])).days,
    ).toHaveLength(1);
  });

  it('uses the version in force on each date: 0.60 until 31 October, 0.70 from 1 November', () => {
    const r = ok(
      chargesForLocalDates('2026-10-30', '2026-11-03', [
        DAY_NIGHT_VERSION_1_EXAMPLE,
        DAY_NIGHT_VERSION_2_EXAMPLE,
      ]),
    );
    expect(
      r.days.map((d) => [
        d.localDate,
        d.standingChargeAmount,
        d.tariffId === DAY_NIGHT_VERSION_1_EXAMPLE.id ? 1 : 2,
      ]),
    ).toEqual([
      ['2026-10-30', '0.6', 1],
      ['2026-10-31', '0.6', 1],
      ['2026-11-01', '0.7', 2],
      ['2026-11-02', '0.7', 2],
    ]);
    expect(r.totals.baseAmount).toBe('2.6');
  });

  it('a tariff that states no standing charge has none: an explicit zero, not a missing value', () => {
    const none = variant(FLAT_IMPORT_EXAMPLE, {
      standingChargePerDay: null,
      taxMode: 'NONE',
      vatRatePercent: null,
    });
    const r = ok(chargesForLocalDates('2026-06-01', '2026-06-03', [none]));
    expect(r.totals.baseAmount).toBe('0');
    expect(r.days[0]?.standingChargeAmount).toBe('0');
  });

  it('a site-specific version beats the household default', () => {
    const siteId = '00000000-0000-4000-8000-0000000000b1';
    const site = variant(FLAT_IMPORT_EXAMPLE, {
      id: '00000000-0000-4000-8000-0000000000a1',
      siteId,
      standingChargePerDay: '0.500000',
    });
    const withSite = ok(
      chargesForLocalDates('2026-06-01', '2026-06-02', [FLAT_IMPORT_EXAMPLE, site], { siteId }),
    );
    expect(withSite.totals.baseAmount).toBe('0.5');
    const without = ok(
      chargesForLocalDates('2026-06-01', '2026-06-02', [FLAT_IMPORT_EXAMPLE, site]),
    );
    expect(without.totals.baseAmount).toBe('0.6');
  });
});

describe('VAT and per-day levies on a day', () => {
  it('EXCLUSIVE with a taxable per-day levy: (0.65 + 0.02) x 23% on top', () => {
    // Standing 0.65 and levy 0.02 are taxable: 0.67 x 0.23 = 0.1541; payable 0.65 + 0.02 + 0.1541 = 0.8241.
    const r = ok(chargesForLocalDates('2026-01-15', '2026-01-16', [DAY_NIGHT_PEAK_IMPORT_EXAMPLE]));
    expect(r.days[0]?.levyLines).toEqual([
      { name: 'EXAMPLE levy per day', amount: '0.02', taxable: true },
    ]);
    expect(r.totals).toEqual({
      baseAmount: '0.65',
      levyAmount: '0.02',
      vatAmount: '0.1541',
      totalAmount: '0.8241',
      amountExcludingVat: '0.67',
    });
  });

  it('INCLUSIVE: the standing charge contains its VAT and the total does not grow', () => {
    // 0.60 stated including 13.5% VAT: VAT inside = 0.6 - 0.6 / 1.135.
    const r = ok(chargesForLocalDates('2026-01-15', '2026-01-16', [DAY_NIGHT_IMPORT_EXAMPLE]));
    expect(r.totals.baseAmount).toBe('0.6');
    expect(r.totals.totalAmount).toBe('0.6');
    const expectedVat = new Decimal('0.6').times('0.135').div('1.135'); // independent formula
    expect(new Decimal(r.totals.vatAmount).minus(expectedVat).abs().lt('1e-25')).toBe(true);
    expect(
      new Decimal(r.totals.vatAmount).plus(r.totals.amountExcludingVat).eq(r.totals.totalAmount),
    ).toBe(true);
  });

  it('the per-kWh levy is not charged on a day', () => {
    const r = ok(chargesForLocalDates('2026-01-15', '2026-01-16', [DAY_NIGHT_PEAK_IMPORT_EXAMPLE]));
    expect(r.days[0]?.levyLines.map((l) => l.name)).toEqual(['EXAMPLE levy per day']);
  });
});

describe('worked illustration of ENERGY_ACCOUNTING section 8 (the figures there are examples)', () => {
  it('reproduces net 1.426 unrounded, and 1.43 as the sum of rounded lines', () => {
    // Import 2 kWh at 0.30, export 0.5 kWh at 0.10, standing charge 0.60 for one day, VAT 23% on top.
    const tariffs: Tariff[] = [FLAT_IMPORT_EXAMPLE, EXPORT_PER_KWH_EXAMPLE];
    const hour = { startMs: ms('2026-06-15T12:00:00Z'), endMs: ms('2026-06-15T13:00:00Z') };
    const imp = priceInterval({ ...hour, energyWh: 2000 }, tariffs, 'IMPORT');
    const exp = priceInterval({ ...hour, energyWh: 500 }, tariffs, 'EXPORT');
    const day = ok(chargesForLocalDates('2026-06-15', '2026-06-16', tariffs));
    if (imp.status !== 'PRICED' || exp.status !== 'PRICED') throw new Error('not priced');

    const importCost = new Decimal(imp.amounts.baseAmount); // 0.6
    const exportCredit = new Decimal(exp.amounts.baseAmount); // 0.05
    const standing = new Decimal(day.totals.baseAmount); // 0.6
    const vat = new Decimal(imp.amounts.vatAmount).plus(day.totals.vatAmount); // 0.138 + 0.138
    const net = new Decimal(imp.amounts.totalAmount)
      .plus(day.totals.totalAmount)
      .minus(exp.amounts.totalAmount);

    expect(importCost.toString()).toBe('0.6');
    expect(exportCredit.toString()).toBe('0.05');
    expect(standing.toString()).toBe('0.6');
    expect(vat.toString()).toBe('0.276');
    expect(net.toString()).toBe('1.426');

    // Rounded once per displayed line, then summed (ENERGY_ACCOUNTING section 7): 0.60 + 0.60 + 0.28 - 0.05.
    const lines = [
      roundToMinorUnit(importCost, 'EUR'),
      roundToMinorUnit(standing, 'EUR'),
      roundToMinorUnit(vat, 'EUR'),
      roundToMinorUnit(exportCredit.negated(), 'EUR'),
    ];
    expect(lines).toEqual(['0.60', '0.60', '0.28', '-0.05']);
    const displayedNet = lines.reduce((s, l) => s.plus(l), new Decimal(0));
    expect(displayedNet.toString()).toBe('1.43');
  });
});

describe('problems and input checks', () => {
  it('a date with no version in force makes the result a list of problems, never a zero charge', () => {
    const r = chargesForLocalDates('2025-12-30', '2026-01-02', [FLAT_IMPORT_EXAMPLE]);
    expect(r).toEqual({
      ok: false,
      problems: [
        { localDate: '2025-12-30', code: 'NO_TARIFF_FOR_DATE' },
        { localDate: '2025-12-31', code: 'NO_TARIFF_FOR_DATE' },
      ],
    });
  });

  it('only IMPORT versions carry a standing charge: an export tariff alone gives problems', () => {
    const r = chargesForLocalDates('2026-06-01', '2026-06-02', [EXPORT_PER_KWH_EXAMPLE]);
    expect(r.ok).toBe(false);
  });

  it('two versions in force on one date are reported as ambiguous', () => {
    const clash = variant(DAY_NIGHT_VERSION_2_EXAMPLE, { effectiveFrom: '2026-10-01' });
    const r = chargesForLocalDates('2026-10-15', '2026-10-16', [
      DAY_NIGHT_VERSION_1_EXAMPLE,
      clash,
    ]);
    expect(r).toEqual({
      ok: false,
      problems: [{ localDate: '2026-10-15', code: 'AMBIGUOUS_TARIFF' }],
    });
  });

  it('refuses malformed dates, an empty range and too many days', () => {
    expect(() => chargesForLocalDates('2026-6-1', '2026-06-02', [FLAT_IMPORT_EXAMPLE])).toThrow(
      RangeError,
    );
    expect(() => chargesForLocalDates('2026-06-01', '2026-06-01', [FLAT_IMPORT_EXAMPLE])).toThrow(
      RangeError,
    );
    expect(() => chargesForLocalDates('2026-06-02', '2026-06-01', [FLAT_IMPORT_EXAMPLE])).toThrow(
      RangeError,
    );
    expect(() => chargesForLocalDates('2026-01-01', '2030-01-01', [FLAT_IMPORT_EXAMPLE])).toThrow(
      RangeError,
    );
    expect(MAX_CHARGE_DAYS).toBe(1100);
  });

  it('refuses versions with different currencies instead of adding them', () => {
    const gbp = variant(DAY_NIGHT_VERSION_2_EXAMPLE, { currency: 'GBP' });
    expect(() =>
      chargesForLocalDates('2026-10-31', '2026-11-02', [DAY_NIGHT_VERSION_1_EXAMPLE, gbp]),
    ).toThrow(RangeError);
  });

  it('refuses a taxed tariff with no VAT rate', () => {
    const broken = variant(FLAT_IMPORT_EXAMPLE, { vatRatePercent: null });
    expect(() => chargesForLocalDates('2026-06-01', '2026-06-02', [broken])).toThrow(RangeError);
  });
});
