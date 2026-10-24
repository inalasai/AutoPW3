import type { DayType, TariffSeason } from '@autopw3/shared';
import {
  addLocalDays,
  dayOfWeek,
  localDayBounds,
  localParts,
  utcOffsetMinutes,
} from '../telemetry/timestamps';

/**
 * Calendar helpers for tariffs: local dates, day types, seasons, and the conversion of a local wall-clock minute
 * to UTC instants across a DST change. Recurring schedules are always local minutes plus an IANA zone, never a
 * fixed UTC offset (rule 7). The zone arithmetic is built on `Intl` through `telemetry/timestamps`.
 */

const MS_PER_MINUTE = 60_000;

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** The local date and the minute after local midnight of an instant in a zone (one `Intl` lookup). */
export function localDateAndMinute(
  ms: number,
  timeZone: string,
): { readonly localDate: string; readonly localMinute: number } {
  const p = localParts(ms, timeZone);
  return {
    localDate: `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`,
    localMinute: p.hour * 60 + p.minute,
  };
}

/** `WEEKEND` for Saturday and Sunday and `WEEKDAY` otherwise, by the local calendar date (ENERGY_ACCOUNTING 5). */
export function dayTypeOf(localDate: string): Exclude<DayType, 'ALL'> {
  const d = dayOfWeek(localDate);
  return d === 0 || d === 6 ? 'WEEKEND' : 'WEEKDAY';
}

/** `month * 100 + day` of a `YYYY-MM-DD` date, so calendar positions compare as plain integers (301 is 1 March). */
export function monthDayKey(localDate: string): number {
  return Number(localDate.slice(5, 7)) * 100 + Number(localDate.slice(8, 10));
}

/**
 * True when the date falls in the season's inclusive month/day range. A range whose start is after its end
 * wraps the year end (1 Nov to 28 Feb). The test uses month and day only, so it is the same every year,
 * including 29 February.
 */
export function inSeason(
  season: Pick<TariffSeason, 'startMonth' | 'startDay' | 'endMonth' | 'endDay'>,
  localDate: string,
): boolean {
  return seasonContainsKey(season, monthDayKey(localDate));
}

/** Every `month * 100 + day` of a leap year (366 values), the domain over which seasons are checked. */
export function allMonthDayKeys(): number[] {
  const keys: number[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const days = new Date(Date.UTC(2000, m, 0)).getUTCDate();
    for (let d = 1; d <= days; d += 1) keys.push(m * 100 + d);
  }
  return keys;
}

/** Membership of a `month * 100 + day` key in a season; also used for whole-year analysis in validation. */
export function seasonContainsKey(
  season: Pick<TariffSeason, 'startMonth' | 'startDay' | 'endMonth' | 'endDay'>,
  key: number,
): boolean {
  const start = season.startMonth * 100 + season.startDay;
  const end = season.endMonth * 100 + season.endDay;
  return start <= end ? key >= start && key <= end : key >= start || key <= end;
}

/** "08:30" for 510. Used in messages only. */
export function minuteText(minute: number): string {
  return `${pad(Math.floor(minute / 60), 2)}:${pad(minute % 60, 2)}`;
}

/** The local dates `[fromDate, toDate)` in order. Pure calendar arithmetic. */
export function localDatesBetween(fromDate: string, toDateExclusive: string): string[] {
  const dates: string[] = [];
  let d = fromDate;
  while (d < toDateExclusive) {
    dates.push(d);
    d = addLocalDays(d, 1);
  }
  return dates;
}

/** One local calendar day in a zone, with its DST change if it has one. */
export interface LocalDay {
  /** First instant of the local date. */
  readonly startMs: number;
  /** First instant of the next local date. The day is `[startMs, endMs)`: 23, 24 or 25 hours. */
  readonly endMs: number;
  /** The instant the clocks change inside this day, or `null`. */
  readonly transitionMs: number | null;
  /** Clock change in minutes at `transitionMs`: +60 spring forward, -60 fall back, 0 when there is none. */
  readonly deltaMinutes: number;
}

const dayCache = new Map<string, LocalDay>();
const DAY_CACHE_LIMIT = 4096;

/** The span of a local date in a zone and where its clock change is. Cached; the result depends only on the arguments. */
export function localDay(localDate: string, timeZone: string): LocalDay {
  const key = `${timeZone}|${localDate}`;
  const cached = dayCache.get(key);
  if (cached !== undefined) return cached;

  const { startMs, endMs } = localDayBounds(localDate, timeZone);
  const offsetAtStart = utcOffsetMinutes(startMs, timeZone);
  const offsetAtEnd = utcOffsetMinutes(endMs - MS_PER_MINUTE, timeZone);
  let transitionMs: number | null = null;
  let deltaMinutes = 0;
  if (offsetAtStart !== offsetAtEnd) {
    // Clock changes happen on whole minutes; find the first minute that already has the new offset.
    let lo = startMs / MS_PER_MINUTE;
    let hi = (endMs - MS_PER_MINUTE) / MS_PER_MINUTE;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (utcOffsetMinutes(mid * MS_PER_MINUTE, timeZone) === offsetAtEnd) hi = mid;
      else lo = mid + 1;
    }
    transitionMs = lo * MS_PER_MINUTE;
    deltaMinutes = offsetAtEnd - offsetAtStart;
  }
  const day: LocalDay = { startMs, endMs, transitionMs, deltaMinutes };
  if (dayCache.size >= DAY_CACHE_LIMIT) dayCache.clear();
  dayCache.set(key, day);
  return day;
}

/**
 * The UTC instants at which the wall clock of the day reads `minute` (0 to 1439), in order.
 * - Normal day: exactly one instant.
 * - Spring forward (clocks skip an hour): a minute inside the skipped hour never happens, so none.
 * - Fall back (an hour repeats): a minute inside the repeated hour happens twice, so two.
 * The caller decides what that means; for pricing, both occurrences are priced by their local minute.
 */
export function instantsOfLocalMinute(day: LocalDay, minute: number): number[] {
  if (!Number.isInteger(minute) || minute < 0 || minute >= 1440) {
    throw new RangeError('minute must be a whole number from 0 to 1439');
  }
  const before = day.startMs + minute * MS_PER_MINUTE;
  if (day.transitionMs === null) return before < day.endMs ? [before] : [];
  const after = before - day.deltaMinutes * MS_PER_MINUTE;
  const out: number[] = [];
  if (before < day.transitionMs) out.push(before);
  if (after >= day.transitionMs && after < day.endMs) out.push(after);
  return out.sort((a, b) => a - b);
}
