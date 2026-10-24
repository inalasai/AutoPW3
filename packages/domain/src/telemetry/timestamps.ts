/**
 * Time helpers for telemetry (rule 7). Pure: they take instants and zone names as arguments and never read the
 * system clock. Local-day logic uses `Intl` with an IANA zone, never a fixed UTC offset, so a local day is 23, 24
 * or 25 hours long as the zone dictates. TASK-10 (tariffs) picks the library for recurring local schedules; this
 * file needs only "what local date is this instant" and "when does that local day start".
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** Plausible range for an epoch-millisecond number: 2000-01-01 to 2100-01-01. Rejects epoch seconds by mistake. */
const MIN_EPOCH_MS = Date.UTC(2000, 0, 1);
const MAX_EPOCH_MS = Date.UTC(2100, 0, 1);

/**
 * ISO 8601 date-time with an explicit zone designator (`Z` or `+hh:mm`). A string with no zone is ambiguous
 * (is it UTC, the site, the server?) and is refused instead of guessed.
 */
const ISO_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * Epoch milliseconds for an instant given as an ISO string with a zone, a `Date`, or a number of epoch
 * milliseconds. Returns `null` for anything else (missing, malformed, no zone, impossible date, out of range).
 */
export function parseInstantMs(input: unknown): number | null {
  if (input instanceof Date) {
    const ms = input.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || !Number.isInteger(input)) return null;
    return input >= MIN_EPOCH_MS && input < MAX_EPOCH_MS ? input : null;
  }
  if (typeof input !== 'string') return null;

  const m = ISO_WITH_ZONE.exec(input);
  if (m === null) return null;
  const [, y, mo, d, h, mi, s, , zone] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s === undefined ? 0 : Number(s);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (zone !== undefined && zone !== 'Z') {
    const zh = Number(zone.slice(1, 3));
    const zm = Number(zone.slice(4, 6));
    if (zh > 23 || zm > 59) return null;
  }
  const ms = Date.parse(input);
  return Number.isFinite(ms) ? ms : null;
}

/** UTC instant string `YYYY-MM-DDTHH:mm:ssZ` (milliseconds only when non-zero), as the shared schemas expect. */
export function formatInstant(ms: number): string {
  const iso = new Date(ms).toISOString();
  return iso.endsWith('.000Z') ? `${iso.slice(0, -5)}Z` : iso;
}

/** Normalise any accepted instant input to a UTC string, or `null` when it cannot be read. */
export function normaliseTimestamp(input: unknown): string | null {
  const ms = parseInstantMs(input);
  return ms === null ? null : formatInstant(ms);
}

// --- local time in an IANA zone ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(timeZone, created);
  return created;
}

export interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** Wall-clock parts of an instant in a zone. Throws `RangeError` for an unknown zone. */
export function localParts(ms: number, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part === undefined ? 0 : Number(part.value);
  };
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

/** Offset of the zone from UTC in minutes at an instant (positive east of Greenwich). */
export function utcOffsetMinutes(ms: number, timeZone: string): number {
  const p = localParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MS_PER_MINUTE);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** `YYYY-MM-DD` of the instant in the zone. */
export function localDateOf(ms: number, timeZone: string): string {
  const p = localParts(ms, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`;
}

/** Minutes after local midnight (0 to 1439) of the instant in the zone. */
export function localMinuteOfDay(ms: number, timeZone: string): number {
  const p = localParts(ms, timeZone);
  return p.hour * 60 + p.minute;
}

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The date `days` after (or before, when negative) a `YYYY-MM-DD` date. Pure calendar arithmetic. */
export function addLocalDays(localDate: string, days: number): string {
  const m = LOCAL_DATE.exec(localDate);
  if (m === null) throw new RangeError('localDate must be YYYY-MM-DD');
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(base + days * MS_PER_DAY);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

/** Day of the week for a `YYYY-MM-DD` date: 0 = Sunday to 6 = Saturday. */
export function dayOfWeek(localDate: string): number {
  const m = LOCAL_DATE.exec(localDate);
  if (m === null) throw new RangeError('localDate must be YYYY-MM-DD');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

/**
 * The half-open UTC span `[startMs, endMs)` of a local calendar day in a zone: from the first instant whose local
 * date is `localDate` to the first instant whose local date is the next day. The span is 23, 24 or 25 hours on
 * days with a DST change. Found by bisection over whole minutes, so it needs no fixed offset and no assumption
 * about when the zone changes its clocks. (A zone that changes its clocks across midnight and moves the date
 * backwards is not supported; Europe/Dublin and all common zones are fine.)
 */
export function localDayBounds(
  localDate: string,
  timeZone: string,
): { readonly startMs: number; readonly endMs: number } {
  const m = LOCAL_DATE.exec(localDate);
  if (m === null) throw new RangeError('localDate must be YYYY-MM-DD');
  const utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const firstInstantOnOrAfter = (date: string, guessMs: number): number => {
    // Local midnight is within 14 hours of UTC midnight of the same date in every zone; use 26 for margin.
    let lo = Math.floor((guessMs - 26 * 3_600_000) / MS_PER_MINUTE);
    let hi = Math.floor((guessMs + 26 * 3_600_000) / MS_PER_MINUTE);
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (localDateOf(mid * MS_PER_MINUTE, timeZone) >= date) hi = mid;
      else lo = mid + 1;
    }
    return lo * MS_PER_MINUTE;
  };
  const startMs = firstInstantOnOrAfter(localDate, utcMidnight);
  const endMs = firstInstantOnOrAfter(addLocalDays(localDate, 1), utcMidnight + MS_PER_DAY);
  return { startMs, endMs };
}

/** True when `timeZone` is a zone name the runtime knows. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}
