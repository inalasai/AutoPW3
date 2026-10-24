import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dayTypeOf, instantsOfLocalMinute, localDay } from './calendar';
import { localDateAndMinute } from './calendar';
import {
  DAY_NIGHT_IMPORT_EXAMPLE,
  DAY_NIGHT_PEAK_IMPORT_EXAMPLE,
  EXPORT_PER_KWH_EXAMPLE,
  FLAT_IMPORT_EXAMPLE,
  SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE,
} from './fixtures';
import { Decimal } from './money';
import { priceInterval } from './price';
import { resolveTariffRate } from './resolve';
import { findCoverageGaps, splitIntervalAtBoundaries } from './split';
import { ms, variant } from './test-helpers';
import { validateTariff } from './validate';

/**
 * Property-based tests (fast-check) with a fixed seed so every run, local or CI, tries the same cases.
 * Each property states a rule that must hold for every input, not just the hand-picked examples.
 */
const RUNS = 150;
const config = (seed: number): fc.Parameters<unknown> => ({
  seed,
  numRuns: RUNS,
  endOnFailure: true,
});

const ZONES = ['Europe/Dublin', 'America/New_York', 'Australia/Sydney', 'UTC'] as const;
const zoneArb = fc.constantFrom(...ZONES);
const dateArb = fc
  .integer({ min: 0, max: 729 })
  .map((n) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10));

const T0 = ms('2026-01-01T00:00:00Z');
const HOUR = 3_600_000;
/** An interval starting anywhere in 2026-2027 and lasting from 1 ms to 72 hours. */
const intervalArb = fc
  .tuple(fc.integer({ min: 0, max: 730 * 24 * 60 }), fc.integer({ min: 1, max: 72 * HOUR }))
  .map(([startMinutes, length]) => ({
    startMs: T0 + startMinutes * 60_000,
    endMs: T0 + startMinutes * 60_000 + length,
  }));

const TARIFF_SETS = {
  'day/night/peak + export': [DAY_NIGHT_PEAK_IMPORT_EXAMPLE, EXPORT_PER_KWH_EXAMPLE],
  'seasonal with overrides': [SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE],
  flat: [FLAT_IMPORT_EXAMPLE],
} as const;

describe('local days', () => {
  it('every day is 23, 24 or 25 hours and consecutive days meet exactly', () => {
    fc.assert(
      fc.property(dateArb, zoneArb, (date, zone) => {
        const day = localDay(date, zone);
        const next = localDay(
          new Date(Date.parse(`${date}T12:00:00Z`) + 24 * HOUR).toISOString().slice(0, 10),
          zone,
        );
        const hours = (day.endMs - day.startMs) / HOUR;
        expect([23, 24, 25]).toContain(hours);
        expect(next.startMs).toBe(day.endMs);
        expect(day.deltaMinutes === 0).toBe(day.transitionMs === null);
        // Clocks forward (+60) lose an hour; clocks back (-60) gain one.
        expect(hours).toBe(24 - day.deltaMinutes / 60);
      }),
      config(101),
    );
  });

  it('a local minute has 0, 1 or 2 instants, and each instant reads back as that minute', () => {
    fc.assert(
      fc.property(dateArb, zoneArb, fc.integer({ min: 0, max: 1439 }), (date, zone, minute) => {
        const day = localDay(date, zone);
        const instants = instantsOfLocalMinute(day, minute);
        expect(instants.length).toBeLessThanOrEqual(2);
        if (instants.length === 0) expect(day.deltaMinutes).toBeGreaterThan(0);
        if (instants.length === 2) expect(day.deltaMinutes).toBeLessThan(0);
        for (const instant of instants) {
          expect(instant).toBeGreaterThanOrEqual(day.startMs);
          expect(instant).toBeLessThan(day.endMs);
          expect(localDateAndMinute(instant, zone)).toEqual({
            localDate: date,
            localMinute: minute,
          });
        }
      }),
      config(102),
    );
  });

  it('every instant of a day reads back as that date, and the first and last instants bound it', () => {
    fc.assert(
      fc.property(
        dateArb,
        zoneArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (date, zone, fraction) => {
          const day = localDay(date, zone);
          const t = day.startMs + Math.floor(fraction * (day.endMs - day.startMs - 1));
          expect(localDateAndMinute(t, zone).localDate).toBe(date);
          expect(localDateAndMinute(day.endMs, zone).localDate).not.toBe(date);
          expect(localDateAndMinute(day.startMs - 1, zone).localDate).not.toBe(date);
        },
      ),
      config(103),
    );
  });

  it('day type depends only on the local date', () => {
    fc.assert(
      fc.property(dateArb, (date) => {
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
        expect(dayTypeOf(date)).toBe(weekday === 0 || weekday === 6 ? 'WEEKEND' : 'WEEKDAY');
      }),
      config(104),
    );
  });
});

describe.each(Object.entries(TARIFF_SETS))('splitting and resolving: %s', (_name, tariffs) => {
  it('segments tile the interval with no gap, overlap or empty piece', () => {
    fc.assert(
      fc.property(intervalArb, (iv) => {
        const segments = splitIntervalAtBoundaries(iv.startMs, iv.endMs, tariffs, 'IMPORT');
        expect(segments.length).toBeGreaterThan(0);
        expect(segments[0]?.startMs).toBe(iv.startMs);
        expect(segments.at(-1)?.endMs).toBe(iv.endMs);
        for (let i = 0; i < segments.length; i += 1) {
          const s = segments[i];
          expect(s && s.endMs > s.startMs).toBe(true);
          if (i > 0) expect(s?.startMs).toBe(segments[i - 1]?.endMs);
        }
      }),
      config(201),
    );
  });

  it('inside a segment every instant resolves to the segment result, and the next segment starts where the rate changes', () => {
    fc.assert(
      fc.property(intervalArb, (iv) => {
        const segments = splitIntervalAtBoundaries(iv.startMs, iv.endMs, tariffs, 'IMPORT');
        segments.forEach((seg, i) => {
          const probes = [
            seg.startMs,
            seg.endMs - 1,
            seg.startMs + Math.floor((seg.endMs - seg.startMs) / 2),
          ];
          for (const t of probes) {
            const r = resolveTariffRate(t, tariffs, 'IMPORT');
            if (seg.result.ok) {
              expect(r.ok && r.ratePerKwh === seg.result.ratePerKwh).toBe(true);
            } else {
              expect(!r.ok && r.code === seg.result.code).toBe(true);
            }
          }
          const next = segments[i + 1];
          if (next !== undefined && seg.result.ok && next.result.ok) {
            const same =
              seg.result.tariffId === next.result.tariffId &&
              seg.result.source === next.result.source &&
              seg.result.label === next.result.label &&
              seg.result.scheduleName === next.result.scheduleName &&
              new Decimal(seg.result.ratePerKwh).eq(next.result.ratePerKwh);
            expect(same).toBe(false);
          }
        });
      }),
      config(202),
    );
  });

  it('a fully covered interval has no coverage gaps', () => {
    fc.assert(
      fc.property(intervalArb, (iv) => {
        expect(findCoverageGaps(iv.startMs, iv.endMs, tariffs, 'IMPORT').length).toBe(
          tariffs.some((t) => t.direction === 'IMPORT') ? 0 : 1,
        );
      }),
      config(203),
    );
  });

  it('splitting an interval at any instant and joining the pieces gives the same coverage as the whole', () => {
    fc.assert(
      fc.property(
        intervalArb,
        fc.double({ min: 0.001, max: 0.999, noNaN: true }),
        (iv, fraction) => {
          const cut = iv.startMs + Math.max(1, Math.floor(fraction * (iv.endMs - iv.startMs)));
          fc.pre(cut > iv.startMs && cut < iv.endMs);
          const whole = splitIntervalAtBoundaries(iv.startMs, iv.endMs, tariffs, 'IMPORT');
          const left = splitIntervalAtBoundaries(iv.startMs, cut, tariffs, 'IMPORT');
          const right = splitIntervalAtBoundaries(cut, iv.endMs, tariffs, 'IMPORT');
          const rateAt = (segments: typeof whole, t: number) => {
            const seg = segments.find((s) => s.startMs <= t && t < s.endMs);
            return seg?.result.ok
              ? seg.result.ratePerKwh
              : seg?.result.ok === false
                ? seg.result.code
                : 'none';
          };
          for (const t of [iv.startMs, cut - 1, cut, iv.endMs - 1]) {
            const part = t < cut ? left : right;
            expect(rateAt(part, t)).toBe(rateAt(whole, t));
          }
        },
      ),
      config(204),
    );
  });
});

describe('pricing', () => {
  const rateArb = fc.integer({ min: 0, max: 2_000_000 }).map((micro) => {
    const whole = Math.floor(micro / 1_000_000);
    return `${whole}.${String(micro % 1_000_000).padStart(6, '0')}`;
  });
  const whArb = fc.integer({ min: 0, max: 50_000_000 });
  const half = (n: number) => ({
    startMs: ms('2026-06-15T12:00:00Z'),
    endMs: ms('2026-06-15T12:00:00Z') + n * 60_000,
  });

  it('total = base + levies + VAT, exactly, for any rate and energy', () => {
    fc.assert(
      fc.property(rateArb, whArb, (rate, wh) => {
        const t = variant(DAY_NIGHT_PEAK_IMPORT_EXAMPLE, {
          slots: [],
          priceMode: 'FLAT',
          flatRatePerKwh: rate,
        });
        const r = priceInterval({ ...half(30), energyWh: wh }, [t], 'IMPORT');
        if (r.status !== 'PRICED') throw new Error(`status ${r.status}`);
        const a = r.amounts;
        expect(
          new Decimal(a.baseAmount).plus(a.levyAmount).plus(a.vatAmount).eq(a.totalAmount),
        ).toBe(true);
        expect(new Decimal(a.totalAmount).minus(a.vatAmount).eq(a.amountExcludingVat)).toBe(true);
      }),
      config(301),
    );
  });

  it('EXCLUSIVE VAT is the rate times the base; INCLUSIVE VAT is inside it and never changes the total', () => {
    fc.assert(
      fc.property(rateArb, whArb, (rate, wh) => {
        const ex = variant(FLAT_IMPORT_EXAMPLE, { flatRatePerKwh: rate });
        const inc = variant(FLAT_IMPORT_EXAMPLE, {
          flatRatePerKwh: rate,
          taxMode: 'INCLUSIVE',
          vatRatePercent: '13.5',
        });
        const a = priceInterval({ ...half(30), energyWh: wh }, [ex], 'IMPORT');
        const b = priceInterval({ ...half(30), energyWh: wh }, [inc], 'IMPORT');
        if (a.status !== 'PRICED' || b.status !== 'PRICED') throw new Error('not priced');
        expect(
          new Decimal(a.amounts.vatAmount).eq(new Decimal(a.amounts.baseAmount).times('0.23')),
        ).toBe(true);
        expect(b.amounts.totalAmount).toBe(b.amounts.baseAmount);
        const vatInside = new Decimal(b.amounts.baseAmount).minus(
          new Decimal(b.amounts.baseAmount).div('1.135'),
        );
        expect(new Decimal(b.amounts.vatAmount).minus(vatInside).abs().lt('1e-20')).toBe(true);
      }),
      config(302),
    );
  });

  it('pricing is additive in energy: price(a) + price(b) = price(a + b) in one slot', () => {
    fc.assert(
      fc.property(rateArb, whArb, whArb, (rate, a, b) => {
        const t = variant(FLAT_IMPORT_EXAMPLE, { flatRatePerKwh: rate });
        const price = (wh: number) => {
          const r = priceInterval({ ...half(30), energyWh: wh }, [t], 'IMPORT');
          if (r.status !== 'PRICED') throw new Error('not priced');
          return new Decimal(r.amounts.totalAmount);
        };
        expect(
          price(a)
            .plus(price(b))
            .eq(price(a + b)),
        ).toBe(true);
      }),
      config(303),
    );
  });

  it('a priced total is the sum of its parts, and the parts carry all the energy (pro-rata over any interval)', () => {
    fc.assert(
      fc.property(intervalArb, whArb, (iv, wh) => {
        const r = priceInterval({ ...iv, energyWh: wh }, [DAY_NIGHT_IMPORT_EXAMPLE], 'IMPORT', {
          mode: 'PRORATA_ESTIMATE',
        });
        if (r.status !== 'PRICED' && r.status !== 'ESTIMATE') throw new Error(`status ${r.status}`);
        const baseOfParts = r.parts.reduce((s, p) => s.plus(p.amounts.baseAmount), new Decimal(0));
        expect(baseOfParts.eq(r.amounts.baseAmount)).toBe(true);
        const energyOfParts = r.parts.reduce((s, p) => s.plus(p.energyKwh), new Decimal(0));
        expect(energyOfParts.minus(new Decimal(wh).div(1000)).abs().lt('1e-18')).toBe(true);
        expect(r.parts[0]?.startMs).toBe(iv.startMs);
        expect(r.parts.at(-1)?.endMs).toBe(iv.endMs);
      }),
      config(304),
    );
  });

  it('export is never charged VAT or levies, and a NONE model pays exactly zero', () => {
    fc.assert(
      fc.property(rateArb, whArb, (rate, wh) => {
        const paid = variant(EXPORT_PER_KWH_EXAMPLE, { flatRatePerKwh: rate });
        const r = priceInterval({ ...half(30), energyWh: wh }, [paid], 'EXPORT');
        if (r.status !== 'PRICED') throw new Error('not priced');
        expect(r.amounts.levyAmount).toBe('0');
        expect(new Decimal(r.amounts.baseAmount).eq(new Decimal(wh).div(1000).times(rate))).toBe(
          true,
        );
        const none = variant(EXPORT_PER_KWH_EXAMPLE, { exportPaymentModel: 'NONE' });
        const z = priceInterval({ ...half(30), energyWh: wh }, [none], 'EXPORT');
        if (z.status !== 'PRICED') throw new Error('not priced');
        expect(z.amounts.totalAmount).toBe('0');
      }),
      config(305),
    );
  });
});

describe('validation', () => {
  it('a set of slots that tile the day with random cut points is always valid, and removing a cut piece is always a gap', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 1439 }), { minLength: 1, maxLength: 8 }),
        (cuts) => {
          const edges = [0, ...[...cuts].sort((a, b) => a - b), 1440];
          const slots = edges.slice(0, -1).map((start, i) => ({
            dayType: 'ALL' as const,
            startMinute: start,
            endMinute: edges[i + 1] ?? 1440,
            ratePerKwh: '0.200000',
            label: null,
          }));
          expect(validateTariff(variant(DAY_NIGHT_IMPORT_EXAMPLE, { slots }))).toEqual([]);
          const missing = variant(DAY_NIGHT_IMPORT_EXAMPLE, { slots: slots.slice(1) });
          expect(validateTariff(missing).map((p) => p.code)).toEqual(['COVERAGE_GAP']);
        },
      ),
      config(401),
    );
  });
});
