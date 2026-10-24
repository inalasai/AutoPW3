import type { PricePoint } from '@autopw3/shared';
import { parseInstantMs } from '../telemetry/timestamps';
import type { IndexedPricePoint, PriceObservations } from './types';

/**
 * Dynamic price observations (any resolution, for example half-hourly), indexed for fast lookup. A price point
 * is dated data supplied from outside; the tariff definition never contains one.
 */

export interface PricePointsOfTariff {
  readonly tariffId: string;
  readonly pricePoints: readonly PricePoint[];
}

/**
 * Parse and sort the price points of each tariff. Throws `RangeError` for an instant that cannot be read or an
 * empty interval: parse the points with `PricePointSchema` first (the API and the database already do).
 * Overlapping points are kept and remembered, so lookups inside the overlap report `AMBIGUOUS_TARIFF` instead of
 * picking one; `validatePricePoints` is how a caller finds them before saving.
 */
export function indexPricePoints(entries: readonly PricePointsOfTariff[]): PriceObservations {
  const points = new Map<string, IndexedPricePoint[]>();
  for (const entry of entries) {
    const list = points.get(entry.tariffId) ?? [];
    for (const p of entry.pricePoints) {
      const startMs = parseInstantMs(p.intervalStart);
      const endMs = parseInstantMs(p.intervalEnd);
      if (startMs === null || endMs === null || endMs <= startMs) {
        throw new RangeError('a price point has an unreadable or empty interval');
      }
      list.push({ startMs, endMs, ratePerKwh: p.ratePerKwh });
    }
    points.set(entry.tariffId, list);
  }
  const overlapping = new Set<string>();
  for (const [id, list] of points) {
    list.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    for (let i = 1; i < list.length; i += 1) {
      const previous = list[i - 1];
      const current = list[i];
      if (previous !== undefined && current !== undefined && current.startMs < previous.endMs) {
        overlapping.add(id);
        break;
      }
    }
  }
  return { points, overlapping };
}

export type PricePointLookup =
  | { readonly kind: 'POINT'; readonly point: IndexedPricePoint }
  | { readonly kind: 'NONE' }
  | { readonly kind: 'AMBIGUOUS' };

/** The price point whose `[start, end)` contains the instant. Binary search unless the tariff has overlaps. */
export function findPricePoint(
  observations: PriceObservations | undefined,
  tariffId: string,
  atMs: number,
): PricePointLookup {
  const list = observations?.points.get(tariffId);
  if (list === undefined || list.length === 0) return { kind: 'NONE' };

  if (observations?.overlapping.has(tariffId) === true) {
    const hits = list.filter((p) => atMs >= p.startMs && atMs < p.endMs);
    const only = hits[0];
    if (only === undefined) return { kind: 'NONE' };
    return hits.length > 1 ? { kind: 'AMBIGUOUS' } : { kind: 'POINT', point: only };
  }

  // Last point that starts at or before the instant.
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const candidate = list[mid];
    if (candidate !== undefined && candidate.startMs <= atMs) lo = mid + 1;
    else hi = mid;
  }
  const point = list[lo - 1];
  return point !== undefined && atMs < point.endMs ? { kind: 'POINT', point } : { kind: 'NONE' };
}

/** Price points of a tariff that overlap `[startMs, endMs)`, for finding the boundaries inside a range. */
export function pricePointsOverlapping(
  observations: PriceObservations | undefined,
  tariffId: string,
  startMs: number,
  endMs: number,
): readonly IndexedPricePoint[] {
  const list = observations?.points.get(tariffId);
  if (list === undefined) return [];
  return list.filter((p) => p.startMs < endMs && p.endMs > startMs);
}
