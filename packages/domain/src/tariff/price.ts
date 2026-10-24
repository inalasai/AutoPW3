import type { Tariff, TariffDirection } from '@autopw3/shared';
import {
  addBreakdowns,
  energyCharge,
  serialiseBreakdown,
  ZERO_BREAKDOWN,
  type AmountBreakdown,
  type DecimalBreakdown,
  type LevyLine,
} from './charges';
import { Decimal, decimalFrom, energyWhFrom, exact, whToKwh } from './money';
import { splitIntervalAtBoundaries } from './split';
import type {
  CoverageGap,
  RateSegment,
  RateSource,
  ResolvedRate,
  TariffLookupOptions,
} from './types';

/**
 * Pricing an energy interval (ENERGY_ACCOUNTING sections 5 and 6, Q-08).
 *
 * An interval is priced at one rate only when one rate holds for all of it. If more than one distinct rate
 * applies, the energy cannot be placed within the interval from what the provider reported, so by default the
 * interval is `UNPRICEABLE_AT_RESOLUTION` (rule 9: never fabricate finer data). `PRORATA_ESTIMATE` is opt-in:
 * energy is shared across the rate segments in proportion to their duration and the result is labelled
 * `ESTIMATE`. A gap in coverage is `UNPRICED` in both modes; it is never a zero.
 */

export const PRICING_MODES = ['STRICT', 'PRORATA_ESTIMATE'] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

export interface PriceIntervalInput {
  readonly startMs: number;
  readonly endMs: number;
  /** Energy in watt-hours, not negative. A decimal string, or a finite number (converted exactly through its text). */
  readonly energyWh: string | number;
}

export interface PriceIntervalOptions extends TariffLookupOptions {
  /** Default `STRICT`. */
  readonly mode?: PricingMode;
}

/** The part of an interval priced at one rate. */
export interface PricedPart {
  readonly startMs: number;
  readonly endMs: number;
  /** Energy attributed to this part, in kWh (exact). */
  readonly energyKwh: string;
  readonly ratePerKwh: string;
  readonly tariffId: string;
  readonly tariffKey: string;
  readonly version: number;
  readonly source: RateSource;
  readonly label: string | null;
  readonly levyLines: readonly LevyLine[];
  readonly amounts: AmountBreakdown;
}

interface PricedBase {
  readonly direction: TariffDirection;
  readonly currency: string;
  readonly energyKwh: string;
  /** For an export interval, the payment model of the tariff (`NONE` means exactly zero credit, by choice). */
  readonly exportPaymentModel: 'PER_KWH' | 'NONE' | null;
  readonly parts: readonly PricedPart[];
  /** The sum of the parts, unrounded. */
  readonly amounts: AmountBreakdown;
}

export type IntervalPrice =
  | (PricedBase & { readonly status: 'PRICED' })
  | (PricedBase & { readonly status: 'ESTIMATE' })
  | {
      readonly status: 'UNPRICEABLE_AT_RESOLUTION';
      readonly direction: TariffDirection;
      /** The distinct rates found inside the interval, so a caller can show why it was not priced. */
      readonly segments: readonly RateSegment[];
    }
  | {
      readonly status: 'UNPRICED';
      readonly direction: TariffDirection;
      readonly gaps: readonly CoverageGap[];
    };

function sameBasis(a: ResolvedRate, b: ResolvedRate): boolean {
  return a.tariffId === b.tariffId && new Decimal(a.ratePerKwh).eq(b.ratePerKwh);
}

function pricePart(
  tariff: Tariff,
  direction: TariffDirection,
  rate: ResolvedRate,
  startMs: number,
  endMs: number,
  kwh: Decimal,
): {
  part: PricedPart;
  breakdown: DecimalBreakdown;
  exportPaymentModel: 'PER_KWH' | 'NONE' | null;
} {
  const charge = energyCharge(tariff, direction, kwh, decimalFrom(rate.ratePerKwh));
  return {
    breakdown: charge.breakdown,
    exportPaymentModel: charge.exportPaymentModel,
    part: {
      startMs,
      endMs,
      energyKwh: exact(kwh),
      ratePerKwh: rate.ratePerKwh,
      tariffId: rate.tariffId,
      tariffKey: rate.tariffKey,
      version: rate.version,
      source: rate.source,
      label: rate.label,
      levyLines: charge.levyLines,
      amounts: serialiseBreakdown(charge.breakdown),
    },
  };
}

/**
 * Price one energy interval for one direction. Energy is a non-negative amount in Wh; the rate may be negative.
 * Throws `RangeError` for an empty or inexact range, negative or non-finite energy, a range over
 * `MAX_SPLIT_DAYS`, or tariff versions of different currencies inside one interval (data `validateTariffSet`
 * rejects).
 */
export function priceInterval(
  input: PriceIntervalInput,
  tariffs: readonly Tariff[],
  direction: TariffDirection,
  options: PriceIntervalOptions = {},
): IntervalPrice {
  const energyWh = energyWhFrom(input.energyWh);
  const segments = splitIntervalAtBoundaries(
    input.startMs,
    input.endMs,
    tariffs,
    direction,
    options,
  );

  const gaps: CoverageGap[] = [];
  for (const s of segments) {
    if (!s.result.ok) {
      gaps.push({
        startMs: s.startMs,
        endMs: s.endMs,
        code: s.result.code,
        message: s.result.message,
      });
    }
  }
  if (gaps.length > 0) return { status: 'UNPRICED', direction, gaps };

  const resolved = segments.flatMap((s) => (s.result.ok ? [{ segment: s, rate: s.result }] : []));
  const first = resolved[0];
  if (first === undefined) return { status: 'UNPRICED', direction, gaps };

  const singleBasis = resolved.every((r) => sameBasis(r.rate, first.rate));
  const mode = options.mode ?? 'STRICT';
  if (!singleBasis && mode === 'STRICT') {
    return { status: 'UNPRICEABLE_AT_RESOLUTION', direction, segments };
  }

  const byId = new Map(tariffs.map((t) => [t.id, t]));
  const tariffOf = (rate: ResolvedRate): Tariff => {
    const t = byId.get(rate.tariffId);
    if (t === undefined) throw new RangeError('resolved tariff is missing from the list');
    return t;
  };
  if (new Set(resolved.map((r) => r.rate.currency)).size > 1) {
    throw new RangeError('the interval spans versions with different currencies');
  }

  const kwh = whToKwh(energyWh);
  const totalMs = input.endMs - input.startMs;
  const pieces = singleBasis
    ? [{ startMs: input.startMs, endMs: input.endMs, rate: first.rate }]
    : resolved.map((r) => ({ startMs: r.segment.startMs, endMs: r.segment.endMs, rate: r.rate }));

  const parts: PricedPart[] = [];
  let sum: DecimalBreakdown = ZERO_BREAKDOWN;
  let exportPaymentModel: 'PER_KWH' | 'NONE' | null = null;
  let allocated = new Decimal(0);
  for (const [index, piece] of pieces.entries()) {
    const isLast = index === pieces.length - 1;
    // Shares add up to the whole: the last piece takes the remainder, so no energy appears or vanishes.
    const share = isLast
      ? kwh.minus(allocated)
      : kwh.times(piece.endMs - piece.startMs).div(totalMs);
    allocated = allocated.plus(share);
    const priced = pricePart(
      tariffOf(piece.rate),
      direction,
      piece.rate,
      piece.startMs,
      piece.endMs,
      share,
    );
    parts.push(priced.part);
    sum = addBreakdowns(sum, priced.breakdown);
    exportPaymentModel = priced.exportPaymentModel;
  }

  return {
    status: singleBasis ? 'PRICED' : 'ESTIMATE',
    direction,
    currency: first.rate.currency,
    energyKwh: exact(kwh),
    exportPaymentModel,
    parts,
    amounts: serialiseBreakdown(sum),
  };
}
