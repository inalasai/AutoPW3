import type { Tariff, TariffDirection } from '@autopw3/shared';
import { dayTypeOf, localDateAndMinute } from './calendar';
import { findPricePoint } from './observations';
import { pickSlot, scheduleFor, selectVersion } from './select';
import type { RateProblem, RateProblemCode, RateResult, TariffLookupOptions } from './types';

/** Local date and minute of one instant in each zone seen so far, so a lookup asks `Intl` once per zone. */
export type LocalClock = (timeZone: string) => { localDate: string; localMinute: number };

export function localClockAt(atMs: number): LocalClock {
  const seen = new Map<string, { localDate: string; localMinute: number }>();
  return (timeZone) => {
    const known = seen.get(timeZone);
    if (known !== undefined) return known;
    const created = localDateAndMinute(atMs, timeZone);
    seen.set(timeZone, created);
    return created;
  };
}

function problem(code: RateProblemCode, message: string, localDate: string | null): RateProblem {
  return { ok: false, code, message, localDate };
}

function resolveInVersion(
  atMs: number,
  tariff: Tariff,
  local: LocalClock,
  options: TariffLookupOptions,
): RateResult {
  const { localDate, localMinute } = local(tariff.timezone);
  const schedule = scheduleFor(tariff, localDate);
  const base = {
    ok: true,
    currency: tariff.currency,
    tariffId: tariff.id,
    tariffKey: tariff.tariffKey,
    version: tariff.version,
    localDate,
    localMinute,
  } as const;

  switch (schedule.kind) {
    case 'AMBIGUOUS':
      return problem('AMBIGUOUS_TARIFF', schedule.reason, localDate);

    case 'FLAT':
      if (tariff.flatRatePerKwh === null) {
        return problem('TARIFF_GAP', 'A FLAT tariff has no flat rate', localDate);
      }
      return {
        ...base,
        ratePerKwh: tariff.flatRatePerKwh,
        source: 'FLAT',
        label: null,
        scheduleName: null,
      };

    case 'DYNAMIC': {
      const found = findPricePoint(options.priceObservations, tariff.id, atMs);
      if (found.kind === 'NONE') {
        return problem('NO_PRICE_POINT', 'No dynamic price covers this instant', localDate);
      }
      if (found.kind === 'AMBIGUOUS') {
        return problem('AMBIGUOUS_TARIFF', 'Two dynamic prices cover this instant', localDate);
      }
      return {
        ...base,
        ratePerKwh: found.point.ratePerKwh,
        source: 'DYNAMIC',
        label: null,
        scheduleName: null,
      };
    }

    case 'OVERRIDE':
    case 'SEASON':
    case 'BASE': {
      const picked = pickSlot(schedule.slots, dayTypeOf(localDate), localMinute);
      if (picked.kind === 'GAP') {
        return problem('TARIFF_GAP', 'No slot covers this local time', localDate);
      }
      if (picked.kind === 'AMBIGUOUS') {
        return problem('AMBIGUOUS_TARIFF', 'Two slots cover this local time', localDate);
      }
      return {
        ...base,
        ratePerKwh: picked.slot.ratePerKwh,
        source: schedule.kind,
        label: picked.slot.label,
        scheduleName: schedule.kind === 'BASE' ? null : schedule.name,
      };
    }
  }
}

/**
 * The rate in force at an instant for one direction (docs/TARIFF_ENGINE.md section 3).
 *
 * `tariffs` is every version the caller has for the site (both directions are fine; `direction` selects). The
 * result is either the rate with where it came from, or a problem naming why there is none. Missing coverage is
 * never a zero rate (rule 8). Throws `RangeError` only for an instant that is not a whole number of
 * milliseconds.
 */
export function resolveTariffRate(
  atMs: number,
  tariffs: readonly Tariff[],
  direction: TariffDirection,
  options: TariffLookupOptions = {},
): RateResult {
  if (!Number.isSafeInteger(atMs))
    throw new RangeError('atMs must be a whole number of milliseconds');
  const local = localClockAt(atMs);
  const selection = selectVersion(
    tariffs,
    direction,
    options.siteId ?? null,
    (t) => local(t.timezone).localDate,
  );
  if (selection.kind === 'NONE') {
    return problem(
      'NO_TARIFF_FOR_DATE',
      `No ${direction} tariff version is in force at this instant`,
      null,
    );
  }
  if (selection.kind === 'AMBIGUOUS') {
    return problem(
      'AMBIGUOUS_TARIFF',
      `More than one ${direction} tariff version is in force at this instant`,
      null,
    );
  }
  return resolveInVersion(atMs, selection.tariff, local, options);
}
