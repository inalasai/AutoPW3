import type { DayType, Tariff, TariffDirection, TariffSlot } from '@autopw3/shared';
import { inSeason } from './calendar';

/**
 * Selection rules of the tariff engine (precedence in docs/TARIFF_ENGINE.md, D-068):
 *
 * 1. Version: the one in force on the local date (in its own zone), site-specific before household default.
 * 2. Schedule for that date: date override (highest priority), else dynamic price points (`DYNAMIC`), else
 *    the season containing the date, else the all-year slots, else the flat rate.
 * 3. Within a slot schedule: slots of the date's day type (`WEEKDAY` or `WEEKEND`) replace the `ALL` slots; then
 *    the slot whose `[startMinute, endMinute)` contains the minute.
 *
 * Nothing here substitutes a rate: every failure to find one is reported to the caller.
 */

/** True when `localDate` is in `[effectiveFrom, effectiveTo)`. Plain string comparison is correct for `YYYY-MM-DD`. */
export function isInForce(
  tariff: Pick<Tariff, 'effectiveFrom' | 'effectiveTo'>,
  localDate: string,
): boolean {
  return (
    localDate >= tariff.effectiveFrom &&
    (tariff.effectiveTo === null || localDate < tariff.effectiveTo)
  );
}

export type Schedule =
  | { readonly kind: 'OVERRIDE'; readonly name: string; readonly slots: readonly TariffSlot[] }
  | { readonly kind: 'SEASON'; readonly name: string; readonly slots: readonly TariffSlot[] }
  | { readonly kind: 'BASE'; readonly slots: readonly TariffSlot[] }
  | { readonly kind: 'DYNAMIC' }
  | { readonly kind: 'FLAT' }
  | { readonly kind: 'AMBIGUOUS'; readonly reason: string };

/**
 * What decides the rate on a local date, in precedence order. An override covers `[dateFrom, dateTo)`. A season
 * with no slots of its own uses the all-year slots (documented inheritance, not a zero).
 */
export function scheduleFor(tariff: Tariff, localDate: string): Schedule {
  const overrides = tariff.overrides.filter((o) => localDate >= o.dateFrom && localDate < o.dateTo);
  if (overrides.length > 0) {
    const top = Math.max(...overrides.map((o) => o.priority));
    const winners = overrides.filter((o) => o.priority === top);
    const winner = winners[0];
    if (winners.length > 1 || winner === undefined) {
      return { kind: 'AMBIGUOUS', reason: 'two date overrides of equal priority cover this date' };
    }
    return { kind: 'OVERRIDE', name: winner.name, slots: winner.slots };
  }
  if (tariff.priceMode === 'DYNAMIC') return { kind: 'DYNAMIC' };
  if (tariff.priceMode === 'FLAT') return { kind: 'FLAT' };

  const seasons = tariff.seasons.filter((s) => inSeason(s, localDate));
  if (seasons.length > 1) {
    return { kind: 'AMBIGUOUS', reason: 'two seasons cover this date' };
  }
  const season = seasons[0];
  if (season !== undefined && season.slots.length > 0) {
    return { kind: 'SEASON', name: season.name, slots: season.slots };
  }
  return { kind: 'BASE', slots: tariff.slots };
}

/**
 * The slots that apply on a day of the given type: those written for that exact day type if there are any,
 * otherwise those written for `ALL`. The two sets never mix, so a `WEEKEND` slot can replace `ALL` slots
 * without being an overlap with them.
 */
export function effectiveSlotSet(
  slots: readonly TariffSlot[],
  dayType: Exclude<DayType, 'ALL'>,
): readonly TariffSlot[] {
  const specific = slots.filter((s) => s.dayType === dayType);
  return specific.length > 0 ? specific : slots.filter((s) => s.dayType === 'ALL');
}

export type SlotPick =
  | { readonly kind: 'SLOT'; readonly slot: TariffSlot }
  | { readonly kind: 'GAP' }
  | { readonly kind: 'AMBIGUOUS' };

/** The slot of the effective set that contains a local minute. */
export function pickSlot(
  slots: readonly TariffSlot[],
  dayType: Exclude<DayType, 'ALL'>,
  minute: number,
): SlotPick {
  const matches = effectiveSlotSet(slots, dayType).filter(
    (s) => minute >= s.startMinute && minute < s.endMinute,
  );
  const first = matches[0];
  if (first === undefined) return { kind: 'GAP' };
  return matches.length > 1 ? { kind: 'AMBIGUOUS' } : { kind: 'SLOT', slot: first };
}

export type VersionSelection =
  | { readonly kind: 'FOUND'; readonly tariff: Tariff; readonly localDate: string }
  | { readonly kind: 'NONE' }
  | { readonly kind: 'AMBIGUOUS' };

/**
 * Pick the tariff version in force. `localDateOf` gives the local date in each candidate's own zone, which is
 * how the effective dates are defined. A site-specific version beats the household default; a default is used
 * only when no site-specific version is in force. More than one version in force in the same scope is
 * inconsistent data (the database forbids it) and is reported, not resolved by guessing.
 */
export function selectVersion(
  tariffs: readonly Tariff[],
  direction: TariffDirection,
  siteId: string | null,
  localDateOf: (tariff: Tariff) => string,
): VersionSelection {
  const inForce: { tariff: Tariff; localDate: string }[] = [];
  for (const tariff of tariffs) {
    if (tariff.direction !== direction) continue;
    if (tariff.siteId !== null && tariff.siteId !== siteId) continue;
    const localDate = localDateOf(tariff);
    if (isInForce(tariff, localDate)) inForce.push({ tariff, localDate });
  }
  const specific = inForce.filter((c) => c.tariff.siteId !== null);
  const pool = specific.length > 0 ? specific : inForce;
  const first = pool[0];
  if (first === undefined) return { kind: 'NONE' };
  if (pool.length > 1) return { kind: 'AMBIGUOUS' };
  return { kind: 'FOUND', tariff: first.tariff, localDate: first.localDate };
}
