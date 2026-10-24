import type { PowerQuality } from '@autopw3/shared';
import { formatInstant, parseInstantMs } from './timestamps';
import type { TimeGap } from './types';

/**
 * Series utilities: sort, deduplicate, find gaps, measure coverage. They work on any object with a `sampledAt`
 * instant, so they serve live samples, demo samples and (later) rows read back from the database.
 * Intervals are half-open `[start, end)` (rule 7). Nothing is interpolated: a gap stays a gap (rule 9).
 */

export interface HasSampledAt {
  readonly sampledAt: string;
}

export interface DedupeKey extends HasSampledAt {
  readonly receivedAt: string;
  readonly quality: PowerQuality;
}

function msOf(sampledAt: string): number {
  // Unreadable instants sort last. Normalised samples always parse, so this only matters for raw input.
  return parseInstantMs(sampledAt) ?? Number.POSITIVE_INFINITY;
}

/** A new array ordered by `sampledAt` ascending. Stable: equal instants keep their input order. */
export function sortBySampledAt<T extends HasSampledAt>(samples: readonly T[]): T[] {
  return samples
    .map((sample, index) => ({ sample, index, ms: msOf(sample.sampledAt) }))
    .sort((a, b) => (a.ms === b.ms ? a.index - b.index : a.ms < b.ms ? -1 : 1))
    .map((entry) => entry.sample);
}

const QUALITY_RANK: Record<PowerQuality, number> = { OK: 0, PARTIAL: 1, SUSPECT: 2 };

/**
 * Remove samples that share a `sampledAt` instant, returning the rest in time order. Which one wins, in order:
 * the later `receivedAt` (a late or corrected delivery replaces the earlier one, docs/ENERGY_ACCOUNTING.md section 4),
 * then the better quality (`OK` before `PARTIAL` before `SUSPECT`), then the one later in the input.
 */
export function dedupeBySampledAt<T extends DedupeKey>(
  samples: readonly T[],
): { readonly items: T[]; readonly dropped: number } {
  const winners = new Map<number, { sample: T; index: number }>();
  samples.forEach((sample, index) => {
    const ms = msOf(sample.sampledAt);
    const current = winners.get(ms);
    if (current === undefined) {
      winners.set(ms, { sample, index });
      return;
    }
    const received = msOf(sample.receivedAt);
    const currentReceived = msOf(current.sample.receivedAt);
    let replace: boolean;
    if (received !== currentReceived) replace = received > currentReceived;
    else if (sample.quality !== current.sample.quality) {
      replace = QUALITY_RANK[sample.quality] < QUALITY_RANK[current.sample.quality];
    } else replace = true;
    if (replace) winners.set(ms, { sample, index });
  });
  const items = sortBySampledAt([...winners.values()].map((w) => w.sample));
  return { items, dropped: samples.length - items.length };
}

export interface GapOptions {
  /** Spacing between samples when nothing is missing, in seconds. Required: it is the provider's real cadence. */
  readonly expectedIntervalSeconds: number;
  /**
   * The largest spacing still treated as continuous (hold-last), in seconds. Default `2 * expectedIntervalSeconds`
   * (docs/ENERGY_ACCOUNTING.md section 4). A larger spacing is a gap and is left uncovered.
   */
  readonly maxGapSeconds?: number;
}

function resolveGapOptions(options: GapOptions): {
  readonly expectedMs: number;
  readonly maxGapMs: number;
} {
  const expected = options.expectedIntervalSeconds;
  if (!Number.isFinite(expected) || expected <= 0) {
    throw new RangeError('expectedIntervalSeconds must be a positive number');
  }
  const maxGap = options.maxGapSeconds ?? 2 * expected;
  if (!Number.isFinite(maxGap) || maxGap < expected) {
    throw new RangeError('maxGapSeconds must be at least expectedIntervalSeconds');
  }
  return { expectedMs: expected * 1000, maxGapMs: maxGap * 1000 };
}

function makeGap(fromMs: number, toMs: number, expectedMs: number): TimeGap {
  return {
    from: formatInstant(fromMs),
    to: formatInstant(toMs),
    seconds: Math.round((toMs - fromMs) / 1000),
    missingSamples: Math.max(0, Math.round((toMs - fromMs) / expectedMs) - 1),
  };
}

/**
 * Gaps between consecutive samples: every pair whose spacing exceeds `maxGapSeconds`. Each gap is the half-open
 * span from one sample to the next. Samples need not be sorted; duplicates are harmless.
 */
export function detectGaps<T extends HasSampledAt>(
  samples: readonly T[],
  options: GapOptions,
): TimeGap[] {
  const { expectedMs, maxGapMs } = resolveGapOptions(options);
  const times = sortBySampledAt(samples)
    .map((s) => msOf(s.sampledAt))
    .filter(Number.isFinite);
  const gaps: TimeGap[] = [];
  for (let i = 1; i < times.length; i += 1) {
    const prev = times[i - 1];
    const next = times[i];
    if (prev === undefined || next === undefined) continue;
    if (next - prev > maxGapMs) gaps.push(makeGap(prev, next, expectedMs));
  }
  return gaps;
}

export interface TimeRange {
  /** Inclusive start instant. */
  readonly from: string;
  /** Exclusive end instant. */
  readonly to: string;
}

function rangeMs(range: TimeRange): { fromMs: number; toMs: number } {
  const fromMs = parseInstantMs(range.from);
  const toMs = parseInstantMs(range.to);
  if (fromMs === null || toMs === null || toMs <= fromMs) {
    throw new RangeError('range needs a start and an end after the start');
  }
  return { fromMs, toMs };
}

/**
 * Gaps over a requested range `[from, to)`: the gaps between samples, plus a leading gap when the first sample
 * starts late and a trailing gap when the last sample's cover ends before `to`. A sample covers the `expected`
 * interval after it. With no samples at all the whole range is one gap.
 */
export function detectGapsInRange<T extends HasSampledAt>(
  samples: readonly T[],
  range: TimeRange,
  options: GapOptions,
): TimeGap[] {
  const { expectedMs, maxGapMs } = resolveGapOptions(options);
  const { fromMs, toMs } = rangeMs(range);
  const times = sortBySampledAt(samples)
    .map((s) => msOf(s.sampledAt))
    .filter((ms) => Number.isFinite(ms) && ms >= fromMs && ms < toMs);
  if (times.length === 0) return [makeGap(fromMs, toMs, expectedMs)];
  const gaps: TimeGap[] = [];
  const first = times[0];
  if (first !== undefined && first - fromMs > maxGapMs)
    gaps.push(makeGap(fromMs, first, expectedMs));
  for (let i = 1; i < times.length; i += 1) {
    const prev = times[i - 1];
    const next = times[i];
    if (prev === undefined || next === undefined) continue;
    if (next - prev > maxGapMs) gaps.push(makeGap(prev, next, expectedMs));
  }
  const last = times[times.length - 1];
  if (last !== undefined && toMs - (last + expectedMs) > 0 && toMs - last > maxGapMs) {
    gaps.push(makeGap(last + expectedMs, toMs, expectedMs));
  }
  return gaps;
}

/**
 * Fraction of `[from, to)` that is covered by samples, from 0 to 1. A sample covers the time up to the next
 * sample when the spacing is at most `maxGapSeconds` (hold-last), and only `expectedIntervalSeconds` otherwise;
 * the last sample covers `expectedIntervalSeconds`. Never rounded up.
 */
export function coverageFraction<T extends HasSampledAt>(
  samples: readonly T[],
  range: TimeRange,
  options: GapOptions,
): number {
  const { expectedMs, maxGapMs } = resolveGapOptions(options);
  const { fromMs, toMs } = rangeMs(range);
  const times = sortBySampledAt(samples)
    .map((s) => msOf(s.sampledAt))
    .filter(Number.isFinite);
  const unique = [...new Set(times)];
  let covered = 0;
  for (let i = 0; i < unique.length; i += 1) {
    const start = unique[i];
    if (start === undefined) continue;
    const next = unique[i + 1];
    const span = next !== undefined && next - start <= maxGapMs ? next - start : expectedMs;
    const clippedStart = Math.max(start, fromMs);
    const clippedEnd = Math.min(start + span, toMs);
    if (clippedEnd > clippedStart) covered += clippedEnd - clippedStart;
  }
  return Math.min(1, covered / (toMs - fromMs));
}
