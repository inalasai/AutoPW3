import type { PricePoint, PricingFlag, Tariff, TariffDirection } from '@autopw3/shared';

/**
 * Types of the tariff engine (docs/TARIFF_ENGINE.md). The engine works on the shared `Tariff` and `PricePoint`
 * types, so the Worker, the web app and the database all describe a tariff in one way. Instants are epoch
 * milliseconds (UTC); local dates are `YYYY-MM-DD` in the tariff's own zone; minutes are local minutes after
 * midnight. Money and rates are decimal strings (rule 8): the engine never returns a JavaScript number for money.
 */

export type { PricePoint, Tariff, TariffDirection };

/** A tariff definition before it has an id: what `POST /tariffs` and `POST /tariffs/{id}/validate` carry. */
export type TariffDefinition = Omit<Tariff, 'id' | 'tariffKey' | 'version' | 'createdAt'>;

/** Where the rate of an instant came from, in precedence order (highest first). */
export const RATE_SOURCES = ['OVERRIDE', 'DYNAMIC', 'SEASON', 'BASE', 'FLAT'] as const;
export type RateSource = (typeof RATE_SOURCES)[number];

/**
 * Why no rate could be found. The first three are the shared pricing flags (ENERGY_ACCOUNTING sections 5 and 6);
 * `AMBIGUOUS_TARIFF` means the data itself is inconsistent (overlapping versions, seasons, slots, overrides of
 * equal priority or price points) and `validateTariffSet` would have rejected it. A problem is never a zero rate.
 */
export type RateProblemCode =
  Extract<PricingFlag, 'NO_TARIFF_FOR_DATE' | 'TARIFF_GAP' | 'NO_PRICE_POINT'> | 'AMBIGUOUS_TARIFF';

export interface ResolvedRate {
  readonly ok: true;
  /** The rate exactly as the tariff states it (a decimal string, for example "0.350000"). May be negative for a dynamic price. */
  readonly ratePerKwh: string;
  readonly currency: string;
  readonly tariffId: string;
  readonly tariffKey: string;
  readonly version: number;
  readonly source: RateSource;
  /** Label of the slot that matched, if it has one. */
  readonly label: string | null;
  /** Name of the override or season that supplied the slot; `null` for base slots, flat and dynamic rates. */
  readonly scheduleName: string | null;
  /** The instant's date and minute in the tariff's zone. */
  readonly localDate: string;
  readonly localMinute: number;
}

export interface RateProblem {
  readonly ok: false;
  readonly code: RateProblemCode;
  readonly message: string;
  /** Local date in the zone of the tariff that was tried, or `null` when no tariff was selected. */
  readonly localDate: string | null;
}

export type RateResult = ResolvedRate | RateProblem;

/** One dynamic price for `[startMs, endMs)`, with the rate as the decimal string it arrived as. */
export interface IndexedPricePoint {
  readonly startMs: number;
  readonly endMs: number;
  readonly ratePerKwh: string;
}

/**
 * Dynamic prices of each tariff, indexed by tariff id and sorted by start. Built by `indexPricePoints`; kept apart
 * from the recurring tariff definition on purpose (observations are dated data, not a schedule).
 */
export interface PriceObservations {
  readonly points: ReadonlyMap<string, readonly IndexedPricePoint[]>;
  /** Tariff ids whose price points overlap each other; instants inside an overlap are `AMBIGUOUS_TARIFF`. */
  readonly overlapping: ReadonlySet<string>;
}

export interface TariffLookupOptions {
  /**
   * The site being priced. A site-specific tariff version in force beats the household default (`siteId = null`)
   * for the same direction. Omitted or `null`: only household defaults are considered, so a site-only tariff
   * gives `NO_TARIFF_FOR_DATE` rather than being picked by accident.
   */
  readonly siteId?: string | null;
  /** Dynamic prices, separate from the recurring definition (rule: observations are not part of a tariff). */
  readonly priceObservations?: PriceObservations;
}

/** A half-open span `[startMs, endMs)` with the rate result that holds for all of it. */
export interface RateSegment {
  readonly startMs: number;
  readonly endMs: number;
  readonly result: RateResult;
}

/** A span with no usable rate. */
export interface CoverageGap {
  readonly startMs: number;
  readonly endMs: number;
  readonly code: RateProblemCode;
  readonly message: string;
}
