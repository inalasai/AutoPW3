import type { EnergyResolution } from '@autopw3/shared';
import { MAX_RANGE_DAYS } from '@autopw3/shared';
import { addLocalDays, formatInstant, localDayBounds } from '@autopw3/domain';
import type { DateRangeState, RangePreset } from './types';

export const DEFAULT_TIMEZONE = 'Europe/Dublin';
export const DEFAULT_ANCHOR_DATE = '2026-06-21';

/**
 * Calculates start and end calendar dates for standard presets.
 */
export function resolvePresetDates(
  preset: RangePreset,
  anchorDate: string = DEFAULT_ANCHOR_DATE,
): { startDate: string; endDate: string } {
  switch (preset) {
    case 'day':
      return { startDate: anchorDate, endDate: anchorDate };
    case 'week': {
      // 7 local calendar days (e.g., if anchor is 2026-10-24, 2026-10-24 through 2026-10-30)
      return { startDate: anchorDate, endDate: addLocalDays(anchorDate, 6) };
    }
    case 'month': {
      // Calendar month of anchorDate (YYYY-MM-01 to end of month)
      const parts = anchorDate.split('-');
      const year = parseInt(parts[0] ?? '2026', 10);
      const month = parseInt(parts[1] ?? '6', 10);
      const start = `${parts[0]}-${String(month).padStart(2, '0')}-01`;
      // Number of days in month
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const end = `${parts[0]}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
      return { startDate: start, endDate: end };
    }
    case 'year': {
      const year = anchorDate.split('-')[0] ?? '2026';
      return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
    }
    case 'custom':
      return { startDate: anchorDate, endDate: anchorDate };
  }
}

/**
 * Resolves DateRangeState from a preset or custom dates in the site's timezone.
 */
export function resolveDateRange(
  preset: RangePreset,
  timezone: string = DEFAULT_TIMEZONE,
  anchorDate: string = DEFAULT_ANCHOR_DATE,
  customStart?: string,
  customEnd?: string,
): DateRangeState {
  const { startDate, endDate } =
    preset === 'custom' && customStart && customEnd
      ? { startDate: customStart, endDate: customEnd }
      : resolvePresetDates(preset, anchorDate);

  const startBounds = localDayBounds(startDate, timezone);
  const endBounds = localDayBounds(endDate, timezone);

  return {
    preset,
    startDate,
    endDate,
    timezone,
    from: formatInstant(startBounds.startMs),
    to: formatInstant(endBounds.endMs),
  };
}

/**
 * Calculates number of local calendar days between two dates inclusive.
 */
export function countLocalDays(startDate: string, endDate: string): number {
  const s = new Date(`${startDate}T00:00:00Z`).getTime();
  const e = new Date(`${endDate}T00:00:00Z`).getTime();
  if (e < s) return 1;
  return Math.round((e - s) / (24 * 3600 * 1000)) + 1;
}

/**
 * Determines permissible resolutions for the given range according to telemetry capabilities.
 * Rule: Never fabricate finer resolution than raw telemetry, and obey MAX_RANGE_DAYS.
 */
export function getAvailableResolutions(
  _preset: RangePreset,
  startDate: string,
  endDate: string,
): readonly EnergyResolution[] {
  const dayCount = countLocalDays(startDate, endDate);

  if (dayCount <= 1) {
    return ['interval', 'hourly'];
  }
  if (dayCount <= 7) {
    return ['hourly', 'interval', 'daily'];
  }
  if (dayCount <= MAX_RANGE_DAYS.interval) {
    return ['daily', 'hourly', 'interval'];
  }
  if (dayCount <= MAX_RANGE_DAYS.hourly) {
    return ['daily', 'hourly'];
  }
  return ['daily'];
}

/**
 * Returns the recommended default resolution for a preset.
 */
export function getDefaultResolution(preset: RangePreset): EnergyResolution {
  switch (preset) {
    case 'day':
      return 'interval';
    case 'week':
      return 'hourly';
    case 'month':
    case 'year':
      return 'daily';
    case 'custom':
      return 'daily';
  }
}
