import type { DemoLiveReading, Freshness, LiveReading, PowerSample } from '@autopw3/shared';
import { parseInstantMs } from './timestamps';
import type { DemoPowerSample } from './types';

/**
 * Stale detection. Age is computed from an injected `now`, never read from the system clock, so tests and the
 * demo provider are deterministic. A reading older than the threshold is `STALE`; no reading, or one dated in
 * the future, is `UNAVAILABLE` (it cannot honestly be called fresh). Freshness is computed, never stored.
 */

/** Default staleness threshold: 3600 s, which must exceed the background interval (docs/SYSTEM_ARCHITECTURE.md). */
export const DEFAULT_STALE_AFTER_SECONDS = 3600;

/** Default allowance for a clock that runs slightly ahead before a timestamp counts as being in the future. */
export const DEFAULT_FUTURE_SKEW_SECONDS = 120;

export interface FreshnessOptions {
  /** A reading older than this many seconds is stale. Default 3600. Must be positive. */
  readonly staleAfterSeconds?: number;
  /** A timestamp this far ahead of `now` is still accepted as "just now". Default 120. */
  readonly maxFutureSkewSeconds?: number;
}

export interface FreshnessResult {
  /** Whole seconds since `sampledAt`, at least 0. `null` when there is no readable timestamp. */
  readonly ageSeconds: number | null;
  readonly freshness: Freshness;
}

/**
 * Freshness of a reading sampled at `sampledAt`, judged at `now`.
 * `age > staleAfterSeconds` is `STALE`; an age exactly equal to the threshold is still `FRESH`.
 */
export function freshnessOf(
  sampledAt: string | null,
  now: Date,
  options?: FreshnessOptions,
): FreshnessResult {
  const staleAfter = options?.staleAfterSeconds ?? DEFAULT_STALE_AFTER_SECONDS;
  const skew = options?.maxFutureSkewSeconds ?? DEFAULT_FUTURE_SKEW_SECONDS;
  if (!Number.isFinite(staleAfter) || staleAfter <= 0) {
    throw new RangeError('staleAfterSeconds must be a positive number');
  }
  if (!Number.isFinite(skew) || skew < 0) {
    throw new RangeError('maxFutureSkewSeconds must be a number of at least 0');
  }
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new RangeError('now must be a valid Date');
  const sampledMs = sampledAt === null ? null : parseInstantMs(sampledAt);
  if (sampledMs === null) return { ageSeconds: null, freshness: 'UNAVAILABLE' };
  const ageMs = nowMs - sampledMs;
  if (ageMs < -skew * 1000) return { ageSeconds: 0, freshness: 'UNAVAILABLE' };
  const ageSeconds = Math.max(0, Math.floor(ageMs / 1000));
  return { ageSeconds, freshness: ageSeconds > staleAfter ? 'STALE' : 'FRESH' };
}

/** A sample as the live endpoint returns it: the sample plus its age and freshness at `now`. */
export function toLiveReading(
  sample: PowerSample,
  now: Date,
  options?: FreshnessOptions,
): LiveReading {
  const { ageSeconds, freshness } = freshnessOf(sample.sampledAt, now, options);
  return { ...sample, ageSeconds: ageSeconds ?? 0, freshness };
}

/** As `toLiveReading`, for a demo sample: the result's `source` is the literal `'DEMO'`. */
export function toDemoLiveReading(
  sample: DemoPowerSample,
  now: Date,
  options?: FreshnessOptions,
): DemoLiveReading {
  const { ageSeconds, freshness } = freshnessOf(sample.sampledAt, now, options);
  return { ...sample, source: 'DEMO', ageSeconds: ageSeconds ?? 0, freshness };
}
