import type {
  PricePoint,
  Tariff,
  TariffProblem,
  TariffProblemCode,
  TariffSlot,
} from '@autopw3/shared';
import { isKnownTimeZone, parseInstantMs } from '../telemetry/timestamps';
import { allMonthDayKeys, minuteText, seasonContainsKey } from './calendar';
import { effectiveSlotSet } from './select';
import type { TariffDefinition } from './types';

/**
 * Save-time validation of tariffs and price points (docs/TARIFF_ENGINE.md section 5). These functions look for
 * the problems the structural schemas cannot: overlaps, uncovered times, ambiguous precedence and mixed
 * currencies or zones. They assume the input already passed `TariffSchema`/`CreateTariffRequestSchema` (field
 * formats, tax and price-mode consistency) and return an empty list when nothing is wrong. They never throw for
 * bad data and never change it. Messages describe the problem without echoing user text beyond tariff names.
 */

const MAX_MESSAGE = 500;
const MAX_PATH = 200;

function problem(code: TariffProblemCode, path: string, message: string): TariffProblem {
  return {
    code,
    path: path.slice(0, MAX_PATH),
    message: message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE - 3)}...` : message,
  };
}

/** The parts of `[0, 1440)` that no slot covers, as `[start, end)` pairs in order. Overlaps do not hide gaps. */
export function uncoveredMinutes(slots: readonly TariffSlot[]): [number, number][] {
  const sorted = [...slots].sort((a, b) => a.startMinute - b.startMinute);
  const gaps: [number, number][] = [];
  let cursor = 0;
  for (const slot of sorted) {
    if (slot.startMinute > cursor) gaps.push([cursor, slot.startMinute]);
    cursor = Math.max(cursor, slot.endMinute);
  }
  if (cursor < 1440) gaps.push([cursor, 1440]);
  return gaps;
}

function describeGaps(gaps: readonly [number, number][]): string {
  const shown = gaps.slice(0, 5).map(([a, b]) => `${minuteText(a)} to ${minuteText(b)}`);
  return gaps.length > 5 ? `${shown.join(', ')} and ${gaps.length - 5} more` : shown.join(', ');
}

/** Overlap and coverage of one list of slots (the base slots, one season's slots or one override's slots). */
function checkSlots(slots: readonly TariffSlot[], path: string, out: TariffProblem[]): void {
  const groups = ['ALL', 'WEEKDAY', 'WEEKEND'] as const;
  for (const dayType of groups) {
    const indexed = slots
      .map((slot, index) => ({ slot, index }))
      .filter((e) => e.slot.dayType === dayType)
      .sort((a, b) => a.slot.startMinute - b.slot.startMinute);
    let furthestEnd = 0;
    for (const { slot, index } of indexed) {
      if (slot.startMinute < furthestEnd) {
        out.push(
          problem(
            'SLOT_OVERLAP',
            `${path}[${index}]`,
            `Slot starting ${minuteText(slot.startMinute)} overlaps an earlier ${dayType} slot (before ${minuteText(furthestEnd)}).`,
          ),
        );
      }
      furthestEnd = Math.max(furthestEnd, slot.endMinute);
    }
  }

  const weekdaySet = effectiveSlotSet(slots, 'WEEKDAY');
  const weekendSet = effectiveSlotSet(slots, 'WEEKEND');
  // With only `ALL` slots both day types use the same set, so one message is enough.
  const sameSet = slots.every((s) => s.dayType === 'ALL');
  const checks: [string, readonly TariffSlot[]][] = sameSet
    ? [['every day', weekdaySet]]
    : [
        ['weekdays', weekdaySet],
        ['weekends', weekendSet],
      ];
  for (const [label, set] of checks) {
    const gaps = uncoveredMinutes(set);
    if (gaps.length > 0) {
      out.push(
        problem('COVERAGE_GAP', path, `No rate for ${label} between ${describeGaps(gaps)}.`),
      );
    }
  }
}

function checkTimeOfUse(tariff: TariffDefinition, out: TariffProblem[]): void {
  const { slots, seasons } = tariff;
  const keys = allMonthDayKeys();

  for (let j = 1; j < seasons.length; j += 1) {
    const later = seasons[j];
    if (later === undefined) continue;
    for (let i = 0; i < j; i += 1) {
      const earlier = seasons[i];
      if (earlier === undefined) continue;
      if (keys.some((k) => seasonContainsKey(earlier, k) && seasonContainsKey(later, k))) {
        out.push(
          problem(
            'SEASON_OVERLAP',
            `seasons[${j}]`,
            `Season "${later.name}" overlaps season "${earlier.name}".`,
          ),
        );
        break;
      }
    }
  }

  if (slots.length === 0 && seasons.length === 0) {
    out.push(problem('COVERAGE_GAP', 'slots', 'A TIME_OF_USE tariff has no slots.'));
    return;
  }

  const uncoveredDays = keys.filter((k) => !seasons.some((s) => seasonContainsKey(s, k))).length;
  if (seasons.length > 0 && uncoveredDays > 0 && slots.length === 0) {
    out.push(
      problem(
        'SEASON_GAP',
        'seasons',
        `${uncoveredDays} day(s) of the year are in no season and the tariff has no all-year slots.`,
      ),
    );
  }
  if (slots.length > 0) checkSlots(slots, 'slots', out);
  seasons.forEach((season, i) => {
    if (season.slots.length > 0) {
      checkSlots(season.slots, `seasons[${i}].slots`, out);
    } else if (slots.length === 0) {
      out.push(
        problem(
          'COVERAGE_GAP',
          `seasons[${i}].slots`,
          `Season "${season.name}" has no slots and there are no all-year slots to fall back on.`,
        ),
      );
    }
  });
}

/**
 * Problems in one tariff version: unknown zone, overlapping slots, times with no rate (per day type, in every
 * schedule that can apply), overlapping seasons, dates in no season without all-year slots, date overrides of
 * equal priority that cover the same date, and levies on an export tariff. A slot of `WEEKDAY` or `WEEKEND`
 * replacing `ALL` slots is precedence, not an overlap.
 */
export function validateTariff(tariff: TariffDefinition): TariffProblem[] {
  const out: TariffProblem[] = [];

  if (!isKnownTimeZone(tariff.timezone)) {
    out.push(problem('TIMEZONE_UNKNOWN', 'timezone', 'The timezone is not a known IANA zone.'));
  }
  if (tariff.priceMode === 'TIME_OF_USE') checkTimeOfUse(tariff, out);

  tariff.overrides.forEach((override, i) => {
    if (override.slots.length === 0) {
      out.push(
        problem(
          'COVERAGE_GAP',
          `overrides[${i}].slots`,
          `Override "${override.name}" has no slots; it replaces the whole day, so it needs slots covering it.`,
        ),
      );
    } else {
      checkSlots(override.slots, `overrides[${i}].slots`, out);
    }
    for (let k = 0; k < i; k += 1) {
      const other = tariff.overrides[k];
      if (
        other !== undefined &&
        other.priority === override.priority &&
        other.dateFrom < override.dateTo &&
        override.dateFrom < other.dateTo
      ) {
        out.push(
          problem(
            'OVERRIDE_PRIORITY_TIE',
            `overrides[${i}].priority`,
            `Override "${override.name}" has the same priority as "${other.name}" and shares dates with it.`,
          ),
        );
        break;
      }
    }
  });

  if (tariff.direction === 'EXPORT') {
    tariff.levies.forEach((levy, i) => {
      out.push(
        problem(
          'LEVY_ON_EXPORT',
          `levies[${i}]`,
          `Levy "${levy.name}" is on an export tariff; levies apply to imports only and would be ignored.`,
        ),
      );
    });
  }
  return out;
}

const FAR_FUTURE = '9999-99-99';

/**
 * Problems across the versions a site can use, plus each version's own problems with paths prefixed
 * `tariffs[i].`: versions of the same site scope and direction whose effective dates overlap, and versions that
 * disagree on timezone or currency (a site has one of each, and amounts of two currencies cannot be added).
 * Pass the tariffs that can apply to one site: its own and the household defaults.
 */
export function validateTariffSet(tariffs: readonly Tariff[]): TariffProblem[] {
  const out: TariffProblem[] = [];
  tariffs.forEach((tariff, i) => {
    for (const p of validateTariff(tariff)) {
      out.push({ ...p, path: `tariffs[${i}].${p.path}`.slice(0, MAX_PATH) });
    }
  });

  for (let j = 1; j < tariffs.length; j += 1) {
    const later = tariffs[j];
    if (later === undefined) continue;
    for (let i = 0; i < j; i += 1) {
      const earlier = tariffs[i];
      if (
        earlier !== undefined &&
        earlier.direction === later.direction &&
        earlier.siteId === later.siteId &&
        earlier.effectiveFrom < (later.effectiveTo ?? FAR_FUTURE) &&
        later.effectiveFrom < (earlier.effectiveTo ?? FAR_FUTURE)
      ) {
        out.push(
          problem(
            'EFFECTIVE_DATE_OVERLAP',
            `tariffs[${j}].effectiveFrom`,
            `Version ${later.version} overlaps version ${earlier.version} in effective dates for the same direction and site.`,
          ),
        );
        break;
      }
    }
  }

  const first = tariffs[0];
  if (first !== undefined) {
    tariffs.forEach((t, i) => {
      if (t.timezone !== first.timezone) {
        out.push(
          problem(
            'TIMEZONE_MISMATCH',
            `tariffs[${i}].timezone`,
            'Tariffs of one site must use the same timezone.',
          ),
        );
      }
      if (t.currency !== first.currency) {
        out.push(
          problem(
            'CURRENCY_MISMATCH',
            `tariffs[${i}].currency`,
            'Tariffs of one site must use the same currency.',
          ),
        );
      }
    });
  }
  return out;
}

/**
 * Overlapping dynamic prices of one tariff. Each price point must own its span: two prices for one instant make
 * the rate ambiguous. Points with an unreadable instant are left to the schema to reject.
 */
export function validatePricePoints(
  points: readonly PricePoint[],
  path = 'pricePoints',
): TariffProblem[] {
  const out: TariffProblem[] = [];
  const parsed = points.flatMap((p, index) => {
    const startMs = parseInstantMs(p.intervalStart);
    const endMs = parseInstantMs(p.intervalEnd);
    return startMs === null || endMs === null ? [] : [{ index, startMs, endMs }];
  });
  parsed.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  let furthestEnd = Number.NEGATIVE_INFINITY;
  for (const p of parsed) {
    if (p.startMs < furthestEnd) {
      out.push(
        problem(
          'PRICE_POINT_OVERLAP',
          `${path}[${p.index}]`,
          'This price overlaps an earlier price point.',
        ),
      );
    }
    furthestEnd = Math.max(furthestEnd, p.endMs);
  }
  return out;
}
