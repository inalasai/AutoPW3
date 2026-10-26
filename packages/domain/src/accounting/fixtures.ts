import type { Tariff } from '@autopw3/shared';
import {
  EXPORT_NONE_EXAMPLE,
  EXPORT_PER_KWH_EXAMPLE,
  FLAT_IMPORT_EXAMPLE,
} from '../tariff/fixtures';
import type { LiveEnergyInterval } from '../telemetry/types';

/**
 * Golden accounting test fixtures with hand-calculated expected values (TASK-11).
 *
 * All financial values are calculated independently and verified without floating-point math.
 */

function createInterval(
  start: string,
  end: string,
  resSeconds: number,
  flows: {
    solar?: number;
    home?: number;
    gridImport?: number;
    gridExport?: number;
    batteryCharged?: number;
    batteryDischarged?: number;
  },
  quality: 'OK' | 'PARTIAL' | 'SUSPECT' | 'DERIVED' = 'OK',
): LiveEnergyInterval {
  return {
    intervalStart: start,
    intervalEnd: end,
    resolutionSeconds: resSeconds,
    solarGeneratedWh: flows.solar ?? null,
    homeConsumedWh: flows.home ?? null,
    gridImportWh: flows.gridImport ?? null,
    gridExportWh: flows.gridExport ?? null,
    batteryChargedWh: flows.batteryCharged ?? null,
    batteryDischargedWh: flows.batteryDischarged ?? null,
    source: 'TESLA',
    quality,
  };
}

/**
 * Fixture 1: Section 8 Worked Illustration from ENERGY_ACCOUNTING.md
 * - 1 interval: 2 kWh import (2000 Wh), 0.5 kWh export (500 Wh)
 * - Tariffs: FLAT_IMPORT_EXAMPLE (0.30/kWh, standing 0.60/day, 23% excl VAT)
 *            EXPORT_PER_KWH_EXAMPLE (0.10/kWh, 0% VAT)
 * - Hand calculations:
 *   * Import base: 2.0 * 0.30 = 0.600000
 *   * Standing base: 0.600000
 *   * Taxable amount: 0.60 + 0.60 = 1.200000
 *   * VAT (23%): 1.20 * 0.23 = 0.276000
 *   * Export credit: 0.5 * 0.10 = 0.050000
 *   * Unrounded net cost: 0.60 + 0.60 + 0.276 - 0.05 = 1.426000
 *   * Rounded lines:
 *     Import base: 0.60, Standing: 0.60, VAT: 0.28, Export: 0.05
 *     Displayed Net: 0.60 + 0.60 + 0.28 - 0.05 = 1.43
 */
export const SECTION_8_FIXTURE = {
  period: {
    from: '2026-06-21T00:00:00Z',
    to: '2026-06-22T00:00:00Z',
    timezone: 'Europe/Dublin',
  },
  tariffs: [FLAT_IMPORT_EXAMPLE, EXPORT_PER_KWH_EXAMPLE] as readonly Tariff[],
  intervals: [
    createInterval('2026-06-21T12:00:00Z', '2026-06-21T13:00:00Z', 3600, {
      solar: 1500,
      home: 3000,
      gridImport: 2000,
      gridExport: 500,
      batteryCharged: 0,
      batteryDischarged: 1000,
    }),
  ] as readonly LiveEnergyInterval[],
  expected: {
    energy: {
      solarWh: '1500',
      homeWh: '3000',
      gridImportWh: '2000',
      gridExportWh: '500',
      batteryChargedWh: '0',
      batteryDischargedWh: '1000',
      netGridWh: '1500',
      netBatteryWh: '1000',
    },
    costs: {
      importBase: '0.6',
      standingBase: '0.6',
      vatAmount: '0.276',
      exportTotal: '0.05',
      unroundedNetTotal: '1.426',
      roundedImportTotal: '0.74', // 0.60 base + 0.138 vat
      roundedStandingTotal: '0.74', // 0.60 base + 0.138 vat
      roundedExportTotal: '0.05',
      roundedDisplayedNetTotal: '1.43',
    },
  },
};

/**
 * Fixture 2: DST Spring-Forward (23-Hour Day)
 * - 2026-03-29 in Europe/Dublin: 23 hours (82,800 seconds)
 * - Tests standing charge applies once per local calendar day regardless of 23h length.
 */
export const DST_SPRING_FORWARD_FIXTURE = {
  period: {
    from: '2026-03-29T00:00:00Z',
    to: '2026-03-29T23:00:00Z', // 23 UTC hours = 1 local day in Dublin
    timezone: 'Europe/Dublin',
  },
  tariffs: [FLAT_IMPORT_EXAMPLE] as readonly Tariff[],
  intervals: [
    createInterval('2026-03-29T00:00:00Z', '2026-03-29T01:00:00Z', 3600, { gridImport: 1000 }),
    createInterval('2026-03-29T01:00:00Z', '2026-03-29T02:00:00Z', 3600, { gridImport: 1000 }),
  ] as readonly LiveEnergyInterval[],
  expected: {
    expectedSeconds: 82800,
    coveredSeconds: 7200,
    standingChargeDays: 1,
    standingChargeBase: '0.6',
  },
};

/**
 * Fixture 3: DST Fall-Back (25-Hour Day)
 * - 2026-10-25 in Europe/Dublin: 25 hours (90,000 seconds)
 * - Tests standing charge applies once per local calendar day regardless of 25h length.
 */
export const DST_FALL_BACK_FIXTURE = {
  period: {
    from: '2026-10-24T23:00:00Z',
    to: '2026-10-26T00:00:00Z', // 25 UTC hours = 1 local day in Dublin
    timezone: 'Europe/Dublin',
  },
  tariffs: [FLAT_IMPORT_EXAMPLE] as readonly Tariff[],
  intervals: [
    createInterval('2026-10-25T00:00:00Z', '2026-10-25T01:00:00Z', 3600, { gridImport: 1500 }),
  ] as readonly LiveEnergyInterval[],
  expected: {
    expectedSeconds: 90000,
    coveredSeconds: 3600,
    standingChargeDays: 1,
    standingChargeBase: '0.6',
  },
};

/**
 * Fixture 4: Data Gaps (Completeness reduction, no silent extrapolation)
 * - 24-hour day (86,400s), but only 12 hours of intervals present (43,200s).
 * - Completeness must be exactly 0.50 (50%).
 * - Energy and costs must reflect ONLY the 12 hours present.
 */
export const DATA_GAPS_FIXTURE = {
  period: {
    from: '2026-06-21T00:00:00Z',
    to: '2026-06-22T00:00:00Z',
    timezone: 'Europe/Dublin',
  },
  tariffs: [FLAT_IMPORT_EXAMPLE] as readonly Tariff[],
  intervals: [
    createInterval('2026-06-21T00:00:00Z', '2026-06-21T06:00:00Z', 21600, { gridImport: 6000 }),
    createInterval('2026-06-21T12:00:00Z', '2026-06-21T18:00:00Z', 21600, { gridImport: 6000 }),
  ] as readonly LiveEnergyInterval[],
  expected: {
    expectedSeconds: 86400,
    coveredSeconds: 43200,
    completenessRatio: 0.5,
    totalImportWh: '12000',
  },
};

/**
 * Fixture 5: Mid-Range Tariff Version Change
 * - Two intervals spanning a version change on 2026-11-01.
 * - Version 1: 0.30/kWh, standing 0.60
 * - Version 2: 0.35/kWh, standing 0.70
 */
const TARIFF_V1: Tariff = {
  ...FLAT_IMPORT_EXAMPLE,
  id: '00000000-0000-4000-8000-000000000091',
  effectiveFrom: '2026-10-01',
  effectiveTo: '2026-11-01',
  version: 1,
  flatRatePerKwh: '0.300000',
  standingChargePerDay: '0.600000',
};

const TARIFF_V2: Tariff = {
  ...FLAT_IMPORT_EXAMPLE,
  id: '00000000-0000-4000-8000-000000000092',
  effectiveFrom: '2026-11-01',
  effectiveTo: null,
  version: 2,
  flatRatePerKwh: '0.350000',
  standingChargePerDay: '0.700000',
};

export const MID_RANGE_TARIFF_FIXTURE = {
  period: {
    from: '2026-10-31T00:00:00Z',
    to: '2026-11-02T00:00:00Z',
    timezone: 'Europe/Dublin',
  },
  tariffs: [TARIFF_V1, TARIFF_V2] as readonly Tariff[],
  intervals: [
    createInterval('2026-10-31T12:00:00Z', '2026-10-31T13:00:00Z', 3600, { gridImport: 1000 }), // V1: 1 kWh * 0.30 = 0.30
    createInterval('2026-11-01T12:00:00Z', '2026-11-01T13:00:00Z', 3600, { gridImport: 1000 }), // V2: 1 kWh * 0.35 = 0.35
  ] as readonly LiveEnergyInterval[],
  expected: {
    importEnergyBase: '0.65', // 0.30 + 0.35
    standingChargeBase: '1.3', // 0.60 + 0.70
  },
};

/**
 * Fixture 6: SUSPECT Interval Exclusion
 * - 3 intervals provided: two OK (1000 Wh each), one SUSPECT (5000 Wh).
 * - Total import must be exactly 2000 Wh (SUSPECT completely excluded from totals).
 * - excludedSuspectIntervals must be 1.
 */
export const SUSPECT_EXCLUSION_FIXTURE = {
  period: {
    from: '2026-06-21T00:00:00Z',
    to: '2026-06-21T03:00:00Z',
    timezone: 'Europe/Dublin',
  },
  tariffs: [FLAT_IMPORT_EXAMPLE] as readonly Tariff[],
  intervals: [
    createInterval(
      '2026-06-21T00:00:00Z',
      '2026-06-21T01:00:00Z',
      3600,
      { gridImport: 1000 },
      'OK',
    ),
    createInterval(
      '2026-06-21T01:00:00Z',
      '2026-06-21T02:00:00Z',
      3600,
      { gridImport: 5000 },
      'SUSPECT',
    ),
    createInterval(
      '2026-06-21T02:00:00Z',
      '2026-06-21T03:00:00Z',
      3600,
      { gridImport: 1000 },
      'OK',
    ),
  ] as readonly LiveEnergyInterval[],
  expected: {
    accountedIntervals: 2,
    excludedSuspectIntervals: 1,
    totalImportWh: '2000',
  },
};

/**
 * Fixture 7: Export-Only Scenario (Independent export credit)
 * - 2000 Wh export, 0 import.
 * - Evaluates with EXPORT_PER_KWH_EXAMPLE vs EXPORT_NONE_EXAMPLE.
 */
export const EXPORT_ONLY_FIXTURE = {
  period: {
    from: '2026-06-21T12:00:00Z',
    to: '2026-06-21T14:00:00Z',
    timezone: 'Europe/Dublin',
  },
  intervals: [
    createInterval('2026-06-21T12:00:00Z', '2026-06-21T14:00:00Z', 7200, { gridExport: 2000 }),
  ] as readonly LiveEnergyInterval[],
  tariffsPerKwh: [EXPORT_PER_KWH_EXAMPLE] as readonly Tariff[],
  tariffsNone: [EXPORT_NONE_EXAMPLE] as readonly Tariff[],
  expected: {
    exportWh: '2000',
    exportCreditPerKwh: '0.2', // 2.0 * 0.10
    exportCreditNone: '0',
  },
};
