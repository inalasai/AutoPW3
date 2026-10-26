import type { CreateTariffRequest, Tariff, TariffSlot } from '@autopw3/shared';
import type { TariffFormState, WindowDefinition } from './types';

/** Parses "HH:MM" (00:00 to 24:00) into minutes after midnight (0 to 1440). */
export function timeToMinutes(time: string): number {
  const parts = time.trim().split(':');
  if (parts.length !== 2) return 0;
  const hours = Number.parseInt(parts[0] ?? '0', 10);
  const minutes = Number.parseInt(parts[1] ?? '0', 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  return Math.min(1440, Math.max(0, hours * 60 + minutes));
}

/** Formats minutes after midnight (0 to 1440) to "HH:MM". */
export function minutesToTime(minutes: number): string {
  const clamped = Math.min(1440, Math.max(0, minutes));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Decomposes a window definition into one or two valid `TariffSlot`s.
 * If a window crosses midnight (e.g. 23:00 to 08:00), it returns two slots:
 * [1380, 1440) and [0, 480).
 */
export function windowToSlots(win: WindowDefinition): TariffSlot[] {
  const start = timeToMinutes(win.startTime);
  const end = timeToMinutes(win.endTime);
  const label = win.label.trim() === '' ? null : win.label.trim();

  // If start and end are equal, we cannot form a non-zero interval
  if (start === end) {
    return [];
  }

  // Normal window (does not cross midnight)
  if (start < end) {
    return [
      {
        dayType: win.dayType,
        startMinute: start,
        endMinute: end,
        ratePerKwh: win.ratePerKwh,
        label,
      },
    ];
  }

  // Crossing midnight: start > end (e.g. 23:00 [1380] to 08:00 [480])
  const slots: TariffSlot[] = [];
  if (start < 1440) {
    slots.push({
      dayType: win.dayType,
      startMinute: start,
      endMinute: 1440,
      ratePerKwh: win.ratePerKwh,
      label,
    });
  }
  if (end > 0) {
    slots.push({
      dayType: win.dayType,
      startMinute: 0,
      endMinute: end,
      ratePerKwh: win.ratePerKwh,
      label,
    });
  }
  return slots;
}

/** Converts multiple windows into slots, sorting them canonically. */
export function windowsToSlots(windows: readonly WindowDefinition[]): TariffSlot[] {
  const slots = windows.flatMap(windowToSlots);
  return slots.sort((a, b) => a.startMinute - b.startMinute);
}

/**
 * Reconstructs user-friendly windows from slots. Pairs split midnight slots
 * [start, 1440) and [0, end) back into a single [start, end) window when properties match.
 */
export function slotsToWindows(slots: readonly TariffSlot[]): WindowDefinition[] {
  const result: WindowDefinition[] = [];
  const handledIndices = new Set<number>();

  // Pass 1: find midnight-crossing pairs (one slot with endMinute === 1440 and another with startMinute === 0)
  for (let i = 0; i < slots.length; i += 1) {
    if (handledIndices.has(i)) continue;
    const s = slots[i];
    if (s === undefined) continue;

    if (s.endMinute === 1440) {
      const pairIndex = slots.findIndex(
        (other, idx) =>
          idx !== i &&
          !handledIndices.has(idx) &&
          other.startMinute === 0 &&
          other.dayType === s.dayType &&
          other.ratePerKwh === s.ratePerKwh &&
          other.label === s.label,
      );

      if (pairIndex !== -1) {
        const paired = slots[pairIndex];
        if (paired !== undefined) {
          handledIndices.add(i);
          handledIndices.add(pairIndex);
          result.push({
            id: `win-${result.length + 1}`,
            dayType: s.dayType,
            startTime: minutesToTime(s.startMinute),
            endTime: minutesToTime(paired.endMinute),
            ratePerKwh: s.ratePerKwh,
            label: s.label ?? '',
          });
        }
      }
    }
  }

  // Pass 2: all remaining un-paired slots
  for (let i = 0; i < slots.length; i += 1) {
    if (handledIndices.has(i)) continue;
    const s = slots[i];
    if (s === undefined) continue;

    handledIndices.add(i);
    result.push({
      id: `win-${result.length + 1}`,
      dayType: s.dayType,
      startTime: minutesToTime(s.startMinute),
      endTime: minutesToTime(s.endMinute),
      ratePerKwh: s.ratePerKwh,
      label: s.label ?? '',
    });
  }

  return result;
}

/** Creates default initial form state. */
export function createDefaultFormState(siteId: string | null = null): TariffFormState {
  return {
    siteId,
    name: 'New Electricity Tariff',
    direction: 'IMPORT',
    priceMode: 'TIME_OF_USE',
    currency: 'EUR',
    timezone: 'Europe/Dublin',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: '',
    taxMode: 'NONE',
    vatRatePercent: '',
    flatRatePerKwh: '',
    standingChargePerDay: '0.600000',
    exportPaymentModel: '',
    windows: [
      {
        id: 'win-1',
        dayType: 'ALL',
        startTime: '00:00',
        endTime: '08:00',
        ratePerKwh: '0.180000',
        label: 'Night',
      },
      {
        id: 'win-2',
        dayType: 'ALL',
        startTime: '08:00',
        endTime: '23:00',
        ratePerKwh: '0.350000',
        label: 'Day',
      },
      {
        id: 'win-3',
        dayType: 'ALL',
        startTime: '23:00',
        endTime: '24:00',
        ratePerKwh: '0.180000',
        label: 'Night',
      },
    ],
    seasons: [],
    overrides: [],
    levies: [],
  };
}

/** Converts stored Tariff to TariffFormState. */
export function tariffToFormState(tariff: Tariff): TariffFormState {
  return {
    id: tariff.id,
    tariffKey: tariff.tariffKey,
    version: tariff.version,
    siteId: tariff.siteId,
    name: tariff.name,
    direction: tariff.direction,
    priceMode: tariff.priceMode,
    currency: tariff.currency,
    timezone: tariff.timezone,
    effectiveFrom: tariff.effectiveFrom,
    effectiveTo: tariff.effectiveTo ?? '',
    taxMode: tariff.taxMode,
    vatRatePercent: tariff.vatRatePercent ?? '',
    flatRatePerKwh: tariff.flatRatePerKwh ?? '',
    standingChargePerDay: tariff.standingChargePerDay ?? '',
    exportPaymentModel: tariff.exportPaymentModel ?? '',
    windows: slotsToWindows(tariff.slots),
    seasons: [...tariff.seasons],
    overrides: [...tariff.overrides],
    levies: [...tariff.levies],
  };
}

/** Converts form state into CreateTariffRequest payload. */
export function formStateToCreateRequest(state: TariffFormState): CreateTariffRequest {
  const slots = state.priceMode === 'TIME_OF_USE' ? windowsToSlots(state.windows) : [];

  return {
    ...(state.tariffKey !== undefined ? { tariffKey: state.tariffKey } : {}),
    siteId: state.siteId,
    name: state.name.trim(),
    direction: state.direction,
    priceMode: state.priceMode,
    currency: state.currency.trim().toUpperCase(),
    timezone: state.timezone.trim(),
    effectiveFrom: state.effectiveFrom.trim(),
    effectiveTo: state.effectiveTo.trim() === '' ? null : state.effectiveTo.trim(),
    taxMode: state.taxMode,
    vatRatePercent:
      state.taxMode !== 'NONE' && state.vatRatePercent.trim() !== ''
        ? state.vatRatePercent.trim()
        : null,
    flatRatePerKwh:
      state.priceMode === 'FLAT' && state.flatRatePerKwh.trim() !== ''
        ? state.flatRatePerKwh.trim()
        : null,
    standingChargePerDay:
      state.direction === 'IMPORT' && state.standingChargePerDay.trim() !== ''
        ? state.standingChargePerDay.trim()
        : null,
    exportPaymentModel:
      state.direction === 'EXPORT' && state.exportPaymentModel !== ''
        ? state.exportPaymentModel
        : null,
    slots,
    seasons: state.priceMode === 'TIME_OF_USE' ? state.seasons : [],
    overrides: state.overrides,
    levies: state.direction === 'IMPORT' ? state.levies : [],
  };
}
