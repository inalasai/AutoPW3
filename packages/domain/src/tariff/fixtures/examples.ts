import type { PricePoint, Tariff, TariffSlot } from '@autopw3/shared';
import { addLocalDays, formatInstant } from '../../telemetry/timestamps';
import { localDay } from '../calendar';

/**
 * Example tariffs for tests, the demo and the tariff screens (TASK-10).
 *
 * EVERY RATE, LEVY, STANDING CHARGE AND VAT FIGURE HERE IS AN ILLUSTRATIVE EXAMPLE. It is not a real supplier's
 * price, not current, and not a claim about any Irish tariff (open question Q-09). Names start with
 * "EXAMPLE" so they cannot be mistaken for a real plan on screen. Currency EUR, zone Europe/Dublin.
 *
 * Each fixture parses with `TariffSchema`; the tests check that.
 */

export const TARIFF_FIXTURE_NOTICE =
  'ILLUSTRATIVE EXAMPLE values only: not a real supplier tariff and not current.';

const CREATED_AT = '2026-01-01T00:00:00Z';

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function slot(
  startMinute: number,
  endMinute: number,
  ratePerKwh: string,
  label: string,
  dayType: TariffSlot['dayType'] = 'ALL',
): TariffSlot {
  return { dayType, startMinute, endMinute, ratePerKwh, label };
}

const BASE: Omit<Tariff, 'id' | 'tariffKey' | 'name' | 'direction' | 'priceMode'> = {
  siteId: null,
  currency: 'EUR',
  timezone: 'Europe/Dublin',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  taxMode: 'NONE',
  vatRatePercent: null,
  flatRatePerKwh: null,
  standingChargePerDay: null,
  exportPaymentModel: null,
  slots: [],
  seasons: [],
  overrides: [],
  levies: [],
  createdAt: CREATED_AT,
  version: 1,
};

/** Flat import rate, 23 percent VAT added on top (the worked illustration of ENERGY_ACCOUNTING section 8). */
export const FLAT_IMPORT_EXAMPLE: Tariff = {
  ...BASE,
  id: id(1),
  tariffKey: id(101),
  name: 'EXAMPLE flat import',
  direction: 'IMPORT',
  priceMode: 'FLAT',
  flatRatePerKwh: '0.300000',
  standingChargePerDay: '0.600000',
  taxMode: 'EXCLUSIVE',
  vatRatePercent: '23.0000',
};

/** Flat export rate paid per kWh, no VAT on the credit (Q-09: the export tax treatment is not assumed). */
export const EXPORT_PER_KWH_EXAMPLE: Tariff = {
  ...BASE,
  id: id(2),
  tariffKey: id(102),
  name: 'EXAMPLE export paid per kWh',
  direction: 'EXPORT',
  priceMode: 'FLAT',
  flatRatePerKwh: '0.100000',
  exportPaymentModel: 'PER_KWH',
};

/** An export tariff that pays nothing, stated explicitly: the credit is exactly zero by choice, not by default. */
export const EXPORT_NONE_EXAMPLE: Tariff = {
  ...BASE,
  id: id(3),
  tariffKey: id(103),
  name: 'EXAMPLE export not paid',
  direction: 'EXPORT',
  priceMode: 'FLAT',
  flatRatePerKwh: '0.100000',
  exportPaymentModel: 'NONE',
};

/**
 * Day and night import. Night is 23:00 to 08:00, so it crosses midnight and is written as two slots (a slot may
 * not wrap: `endMinute` must exceed `startMinute`). VAT is included in the stated prices.
 */
export const DAY_NIGHT_IMPORT_EXAMPLE: Tariff = {
  ...BASE,
  id: id(4),
  tariffKey: id(104),
  name: 'EXAMPLE day and night import',
  direction: 'IMPORT',
  priceMode: 'TIME_OF_USE',
  standingChargePerDay: '0.600000',
  taxMode: 'INCLUSIVE',
  vatRatePercent: '13.5000',
  slots: [
    slot(0, 480, '0.180000', 'Night'),
    slot(480, 1380, '0.350000', 'Day'),
    slot(1380, 1440, '0.180000', 'Night'),
  ],
};

/** Day, night and a two-hour peak, with a per-kWh levy outside VAT and a taxable per-day levy; VAT on top. */
export const DAY_NIGHT_PEAK_IMPORT_EXAMPLE: Tariff = {
  ...BASE,
  id: id(5),
  tariffKey: id(105),
  name: 'EXAMPLE day, night and peak import',
  direction: 'IMPORT',
  priceMode: 'TIME_OF_USE',
  standingChargePerDay: '0.650000',
  taxMode: 'EXCLUSIVE',
  vatRatePercent: '23.0000',
  slots: [
    slot(0, 480, '0.200000', 'Night'),
    slot(480, 1020, '0.340000', 'Day'),
    slot(1020, 1140, '0.480000', 'Peak'),
    slot(1140, 1380, '0.340000', 'Day'),
    slot(1380, 1440, '0.200000', 'Night'),
  ],
  levies: [
    { name: 'EXAMPLE levy per kWh', kind: 'PER_KWH', amount: '0.010000', taxable: false },
    { name: 'EXAMPLE levy per day', kind: 'PER_DAY', amount: '0.020000', taxable: true },
  ],
};

const SUMMER_WEEKDAY: TariffSlot[] = [
  slot(0, 480, '0.200000', 'Night', 'WEEKDAY'),
  slot(480, 1440, '0.300000', 'Day', 'WEEKDAY'),
];
const SUMMER_WEEKEND: TariffSlot[] = [slot(0, 1440, '0.220000', 'Weekend', 'WEEKEND')];
const WINTER_WEEKDAY: TariffSlot[] = [
  slot(0, 480, '0.220000', 'Night', 'WEEKDAY'),
  slot(480, 1020, '0.380000', 'Day', 'WEEKDAY'),
  slot(1020, 1140, '0.500000', 'Peak', 'WEEKDAY'),
  slot(1140, 1440, '0.380000', 'Day', 'WEEKDAY'),
];
const WINTER_WEEKEND: TariffSlot[] = [slot(0, 1440, '0.280000', 'Weekend', 'WEEKEND')];

/**
 * Seasonal weekday and weekend import with two date overrides. Summer is 1 April to 30 September, winter is
 * 1 October to 31 March (it wraps the year end). On 25 December two overrides overlap and the higher priority
 * wins; neither is a validation error because their priorities differ.
 */
export const SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE: Tariff = {
  ...BASE,
  id: id(6),
  tariffKey: id(106),
  name: 'EXAMPLE seasonal weekday and weekend import',
  direction: 'IMPORT',
  priceMode: 'TIME_OF_USE',
  standingChargePerDay: '0.600000',
  seasons: [
    {
      name: 'EXAMPLE summer',
      startMonth: 4,
      startDay: 1,
      endMonth: 9,
      endDay: 30,
      slots: [...SUMMER_WEEKDAY, ...SUMMER_WEEKEND],
    },
    {
      name: 'EXAMPLE winter',
      startMonth: 10,
      startDay: 1,
      endMonth: 3,
      endDay: 31,
      slots: [...WINTER_WEEKDAY, ...WINTER_WEEKEND],
    },
  ],
  overrides: [
    {
      name: 'EXAMPLE festive period',
      dateFrom: '2026-12-24',
      dateTo: '2026-12-27',
      priority: 10,
      slots: [slot(0, 1440, '0.150000', 'Festive')],
    },
    {
      name: 'EXAMPLE Christmas Day',
      dateFrom: '2026-12-25',
      dateTo: '2026-12-26',
      priority: 20,
      slots: [slot(0, 1440, '0.100000', 'Christmas Day')],
    },
  ],
};

/**
 * Dynamic import: the rate comes from half-hourly price points supplied separately
 * (`halfHourlyPricePointsForDay`), never from this definition.
 */
export const DYNAMIC_IMPORT_EXAMPLE: Tariff = {
  ...BASE,
  id: id(7),
  tariffKey: id(107),
  name: 'EXAMPLE dynamic half-hourly import',
  direction: 'IMPORT',
  priceMode: 'DYNAMIC',
  standingChargePerDay: '0.600000',
  taxMode: 'EXCLUSIVE',
  vatRatePercent: '23.0000',
};

/** Two versions of one day and night tariff: the second takes over at the start of 1 November 2026. */
export const DAY_NIGHT_VERSION_1_EXAMPLE: Tariff = {
  ...BASE,
  id: id(8),
  tariffKey: id(108),
  name: 'EXAMPLE day and night import, version 1',
  direction: 'IMPORT',
  priceMode: 'TIME_OF_USE',
  effectiveTo: '2026-11-01',
  standingChargePerDay: '0.600000',
  slots: [slot(0, 480, '0.180000', 'Night'), slot(480, 1440, '0.340000', 'Day')],
};

export const DAY_NIGHT_VERSION_2_EXAMPLE: Tariff = {
  ...DAY_NIGHT_VERSION_1_EXAMPLE,
  id: id(9),
  version: 2,
  name: 'EXAMPLE day and night import, version 2',
  effectiveFrom: '2026-11-01',
  effectiveTo: null,
  standingChargePerDay: '0.700000',
  slots: [slot(0, 480, '0.200000', 'Night'), slot(480, 1440, '0.380000', 'Day')],
};

/** Every example tariff, by a stable name. */
export const TARIFF_EXAMPLES = {
  FLAT_IMPORT: FLAT_IMPORT_EXAMPLE,
  EXPORT_PER_KWH: EXPORT_PER_KWH_EXAMPLE,
  EXPORT_NONE: EXPORT_NONE_EXAMPLE,
  DAY_NIGHT_IMPORT: DAY_NIGHT_IMPORT_EXAMPLE,
  DAY_NIGHT_PEAK_IMPORT: DAY_NIGHT_PEAK_IMPORT_EXAMPLE,
  SEASONAL_WEEKDAY_WEEKEND_IMPORT: SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE,
  DYNAMIC_IMPORT: DYNAMIC_IMPORT_EXAMPLE,
  DAY_NIGHT_VERSION_1: DAY_NIGHT_VERSION_1_EXAMPLE,
  DAY_NIGHT_VERSION_2: DAY_NIGHT_VERSION_2_EXAMPLE,
} as const satisfies Record<string, Tariff>;

/** A rate in millionths of a currency unit per kWh as the decimal string the schemas use (integer arithmetic only). */
export function rateFromMicro(micro: number): string {
  if (!Number.isSafeInteger(micro)) throw new RangeError('micro must be a whole number');
  const sign = micro < 0 ? '-' : '';
  const abs = Math.abs(micro);
  return `${sign}${Math.floor(abs / 1_000_000)}.${String(abs % 1_000_000).padStart(6, '0')}`;
}

/**
 * Half-hourly dynamic prices for one local day: one point per 30 minutes from the first instant of the local date
 * to the first instant of the next, so the day has 48 points, 46 on a spring-forward day and 50 on a fall-back
 * day. `rateMicroAt(index)` gives each price in millionths per kWh; the default is a repeating example pattern.
 * Negative values are allowed here for engine tests (the stored schema does not accept them yet, L-086).
 */
export function halfHourlyPricePointsForDay(
  localDate: string,
  timeZone: string,
  rateMicroAt: (index: number) => number = (i) => 100_000 + 5_000 * (i % 20),
): PricePoint[] {
  const { startMs, endMs } = localDay(localDate, timeZone);
  const step = 30 * 60_000;
  const points: PricePoint[] = [];
  for (let t = startMs, i = 0; t < endMs; t += step, i += 1) {
    points.push({
      intervalStart: formatInstant(t),
      intervalEnd: formatInstant(Math.min(t + step, endMs)),
      ratePerKwh: rateFromMicro(rateMicroAt(i)),
    });
  }
  return points;
}

/** Price points for the local dates `[fromDate, toDate)`. */
export function halfHourlyPricePointsForDays(
  fromDate: string,
  toDate: string,
  timeZone: string,
  rateMicroAt?: (index: number) => number,
): PricePoint[] {
  const out: PricePoint[] = [];
  for (let d = fromDate; d < toDate; d = addLocalDays(d, 1)) {
    out.push(...halfHourlyPricePointsForDay(d, timeZone, rateMicroAt));
  }
  return out;
}
