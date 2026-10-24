import type { Tariff, TariffDirection } from '@autopw3/shared';
import { addLocalDays } from '../telemetry/timestamps';
import {
  dayTypeOf,
  instantsOfLocalMinute,
  localDateAndMinute,
  localDay,
  type LocalDay,
} from './calendar';
import { Decimal } from './money';
import { pricePointsOverlapping } from './observations';
import { resolveTariffRate } from './resolve';
import { effectiveSlotSet, isInForce, scheduleFor } from './select';
import type { CoverageGap, RateResult, RateSegment, TariffLookupOptions } from './types';

/**
 * Splitting a time range at every instant where the rate can change, and finding where there is no rate.
 * Boundaries are collected from exactly the schedule the resolver would use on each local day, so a segment
 * has one rate result throughout (checked against a minute-by-minute scan in the tests).
 */

/** Longest range the splitter accepts. A longer span is a caller error, not a slow request. */
export const MAX_SPLIT_DAYS = 400;
const MS_PER_DAY = 86_400_000;

function sameResult(a: RateResult, b: RateResult): boolean {
  if (!a.ok || !b.ok) return !a.ok && !b.ok && a.code === b.code;
  return (
    a.tariffId === b.tariffId &&
    a.source === b.source &&
    a.label === b.label &&
    a.scheduleName === b.scheduleName &&
    new Decimal(a.ratePerKwh).eq(b.ratePerKwh)
  );
}

function localDatesCovering(startMs: number, endMs: number, timeZone: string): string[] {
  const first = localDateAndMinute(startMs, timeZone).localDate;
  const last = localDateAndMinute(endMs - 1, timeZone).localDate;
  const dates: string[] = [];
  for (let d = first; d <= last; d = addLocalDays(d, 1)) dates.push(d);
  return dates;
}

function addScheduleBoundaries(
  out: Set<number>,
  tariff: Tariff,
  localDate: string,
  day: LocalDay,
): void {
  const schedule = scheduleFor(tariff, localDate);
  if (schedule.kind !== 'OVERRIDE' && schedule.kind !== 'SEASON' && schedule.kind !== 'BASE')
    return;
  for (const slot of effectiveSlotSet(schedule.slots, dayTypeOf(localDate))) {
    for (const minute of [slot.startMinute, slot.endMinute]) {
      if (minute <= 0 || minute >= 1440) continue; // midnight is already a day boundary
      for (const instant of instantsOfLocalMinute(day, minute)) out.add(instant);
    }
  }
}

function boundariesIn(
  startMs: number,
  endMs: number,
  tariffs: readonly Tariff[],
  direction: TariffDirection,
  options: TariffLookupOptions,
): number[] {
  const siteId = options.siteId ?? null;
  const out = new Set<number>([startMs, endMs]);
  for (const tariff of tariffs) {
    if (tariff.direction !== direction) continue;
    if (tariff.siteId !== null && tariff.siteId !== siteId) continue;
    for (const localDate of localDatesCovering(startMs, endMs, tariff.timezone)) {
      if (!isInForce(tariff, localDate)) continue;
      const day = localDay(localDate, tariff.timezone);
      out.add(day.startMs);
      out.add(day.endMs);
      if (day.transitionMs !== null) out.add(day.transitionMs);
      addScheduleBoundaries(out, tariff, localDate, day);
    }
    if (tariff.priceMode === 'DYNAMIC') {
      for (const point of pricePointsOverlapping(
        options.priceObservations,
        tariff.id,
        startMs,
        endMs,
      )) {
        out.add(point.startMs);
        out.add(point.endMs);
      }
    }
  }
  return [...out].filter((t) => t >= startMs && t <= endMs).sort((a, b) => a - b);
}

/**
 * Split `[startMs, endMs)` into the longest spans that each have one rate result: at local midnights, at the
 * instant the clocks change, at every slot edge of the schedule in force that day, at version, season and
 * override changes, and at dynamic price edges. Neighbouring spans with the same result are joined, so a flat
 * tariff gives one segment however long the range. A span with no rate is a segment whose result is a problem.
 * Segments are contiguous, in order, and cover the range exactly. Throws `RangeError` for an empty range, an
 * inexact instant, or a range longer than `MAX_SPLIT_DAYS`.
 */
export function splitIntervalAtBoundaries(
  startMs: number,
  endMs: number,
  tariffs: readonly Tariff[],
  direction: TariffDirection,
  options: TariffLookupOptions = {},
): RateSegment[] {
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs)) {
    throw new RangeError('start and end must be whole numbers of milliseconds');
  }
  if (endMs <= startMs) throw new RangeError('the range must end after it starts');
  if (endMs - startMs > MAX_SPLIT_DAYS * MS_PER_DAY) {
    throw new RangeError(`the range is longer than ${MAX_SPLIT_DAYS} days`);
  }

  const bounds = boundariesIn(startMs, endMs, tariffs, direction, options);
  const segments: RateSegment[] = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const from = bounds[i];
    const to = bounds[i + 1];
    if (from === undefined || to === undefined || to <= from) continue;
    const result = resolveTariffRate(from, tariffs, direction, options);
    const last = segments[segments.length - 1];
    if (last !== undefined && sameResult(last.result, result)) {
      segments[segments.length - 1] = { startMs: last.startMs, endMs: to, result: last.result };
    } else {
      segments.push({ startMs: from, endMs: to, result });
    }
  }
  return segments;
}

/**
 * The parts of `[startMs, endMs)` that have no usable rate, merged where adjacent with the same reason. An empty
 * list means every instant of the range has a rate. Never reports a gap as priced at zero.
 */
export function findCoverageGaps(
  startMs: number,
  endMs: number,
  tariffs: readonly Tariff[],
  direction: TariffDirection,
  options: TariffLookupOptions = {},
): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const segment of splitIntervalAtBoundaries(startMs, endMs, tariffs, direction, options)) {
    if (segment.result.ok) continue;
    const last = gaps[gaps.length - 1];
    if (last !== undefined && last.code === segment.result.code && last.endMs === segment.startMs) {
      gaps[gaps.length - 1] = { ...last, endMs: segment.endMs };
    } else {
      gaps.push({
        startMs: segment.startMs,
        endMs: segment.endMs,
        code: segment.result.code,
        message: segment.result.message,
      });
    }
  }
  return gaps;
}
