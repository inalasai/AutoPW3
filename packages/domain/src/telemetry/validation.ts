import {
  BALANCE_TOLERANCE_FLOOR_W,
  BALANCE_TOLERANCE_PERCENT,
  PERCENT_RANGE,
  powerBalanceResidualW,
} from '@autopw3/shared';
import type { PowerQuality } from '@autopw3/shared';
import { SUSPECT_ISSUE_CODES } from './types';
import type { DataIssue } from './types';

/**
 * Data-quality checks for telemetry (docs/ENERGY_ACCOUNTING.md section 2). These inspect values and report; they
 * never change a value. Deciding what to do with a flagged value (null it, keep it) is the normaliser's job, and
 * `SUSPECT` readings are stored and shown with a warning but excluded from accounting.
 */

/** Above this a home reading is treated as implausible (a unit mix-up such as mW read as W). Tunable. */
export const DEFAULT_MAX_PLAUSIBLE_POWER_W = 100_000;

export interface ValidationOptions {
  /** Balance tolerance floor in W. Default: the shared proposal (100 W). */
  readonly balanceToleranceFloorW?: number;
  /** Balance tolerance as a percentage of load. Default: the shared proposal (5). */
  readonly balanceTolerancePercent?: number;
  /** Largest power magnitude accepted as plausible for one home. Default 100 kW. */
  readonly maxPlausiblePowerW?: number;
}

export interface ResolvedValidationOptions {
  readonly balanceToleranceFloorW: number;
  readonly balanceTolerancePercent: number;
  readonly maxPlausiblePowerW: number;
}

export function resolveValidationOptions(options?: ValidationOptions): ResolvedValidationOptions {
  const resolved = {
    balanceToleranceFloorW: options?.balanceToleranceFloorW ?? BALANCE_TOLERANCE_FLOOR_W,
    balanceTolerancePercent: options?.balanceTolerancePercent ?? BALANCE_TOLERANCE_PERCENT,
    maxPlausiblePowerW: options?.maxPlausiblePowerW ?? DEFAULT_MAX_PLAUSIBLE_POWER_W,
  };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be a finite number of at least 0`);
    }
  }
  return resolved;
}

/** The five instantaneous values of a power snapshot. `null` means missing. */
export interface PowerValues {
  readonly solarPowerW: number | null;
  readonly batteryPowerW: number | null;
  readonly gridPowerW: number | null;
  readonly loadPowerW: number | null;
  readonly batterySocPercent: number | null;
}

/** The six energy flows of an interval. `null` means the provider did not supply the field. */
export interface EnergyValues {
  readonly solarGeneratedWh: number | null;
  readonly homeConsumedWh: number | null;
  readonly gridImportWh: number | null;
  readonly gridExportWh: number | null;
  readonly batteryChargedWh: number | null;
  readonly batteryDischargedWh: number | null;
}

function issue(
  code: DataIssue['code'],
  field: string | null,
  observed: number | null,
  message: string,
): DataIssue {
  return { code, field, observed, message };
}

/**
 * Allowed difference between load and the sum of the sources: `max(floor, percent of load)`, in W.
 * Failing it is a data-quality finding (`SUSPECT`), never an automatic correction.
 */
export function balanceToleranceW(loadPowerW: number, options?: ValidationOptions): number {
  const o = resolveValidationOptions(options);
  return Math.max(
    o.balanceToleranceFloorW,
    (o.balanceTolerancePercent / 100) * Math.abs(loadPowerW),
  );
}

/**
 * True when `loadPowerW` is within tolerance of `solarPowerW + batteryPowerW + gridPowerW`. With any of the four
 * missing the balance cannot be judged, and this returns `null` (not true: absence of evidence is not a pass).
 */
export function powerBalanceHolds(
  values: Pick<PowerValues, 'solarPowerW' | 'batteryPowerW' | 'gridPowerW' | 'loadPowerW'>,
  options?: ValidationOptions,
): boolean | null {
  const { solarPowerW, batteryPowerW, gridPowerW, loadPowerW } = values;
  if (
    solarPowerW === null ||
    batteryPowerW === null ||
    gridPowerW === null ||
    loadPowerW === null
  ) {
    return null;
  }
  const residual = powerBalanceResidualW({ solarPowerW, batteryPowerW, gridPowerW, loadPowerW });
  return Math.abs(residual) <= balanceToleranceW(loadPowerW, options);
}

/** Check one power snapshot's values. Reports problems; changes nothing. */
export function inspectPowerValues(values: PowerValues, options?: ValidationOptions): DataIssue[] {
  const o = resolveValidationOptions(options);
  const issues: DataIssue[] = [];
  const { solarPowerW, batteryPowerW, gridPowerW, loadPowerW, batterySocPercent } = values;

  if (solarPowerW !== null && solarPowerW < 0) {
    issues.push(
      issue('SOLAR_NEGATIVE', 'solarPowerW', solarPowerW, 'Solar generation cannot be negative'),
    );
  }
  if (loadPowerW !== null && loadPowerW < 0) {
    issues.push(issue('LOAD_NEGATIVE', 'loadPowerW', loadPowerW, 'Site load cannot be negative'));
  }
  if (
    batterySocPercent !== null &&
    (batterySocPercent < PERCENT_RANGE.min || batterySocPercent > PERCENT_RANGE.max)
  ) {
    issues.push(
      issue(
        'SOC_OUT_OF_RANGE',
        'batterySocPercent',
        batterySocPercent,
        `Battery level must be between ${PERCENT_RANGE.min} and ${PERCENT_RANGE.max} percent`,
      ),
    );
  }
  const powers: Array<[string, number | null]> = [
    ['solarPowerW', solarPowerW],
    ['batteryPowerW', batteryPowerW],
    ['gridPowerW', gridPowerW],
    ['loadPowerW', loadPowerW],
  ];
  for (const [field, value] of powers) {
    if (value !== null && Math.abs(value) > o.maxPlausiblePowerW) {
      issues.push(
        issue(
          'POWER_IMPLAUSIBLE_MAGNITUDE',
          field,
          value,
          `Power magnitude above ${o.maxPlausiblePowerW} W is not plausible for a home (unit mix-up?)`,
        ),
      );
    }
  }
  if (powerBalanceHolds(values, options) === false) {
    issues.push(
      issue(
        'BALANCE_MISMATCH',
        null,
        loadPowerW === null || solarPowerW === null || batteryPowerW === null || gridPowerW === null
          ? null
          : powerBalanceResidualW({ solarPowerW, batteryPowerW, gridPowerW, loadPowerW }),
        'Load differs from solar + battery + grid by more than the tolerance',
      ),
    );
  }
  return issues;
}

/** Residual of the energy balance over an interval, in Wh: `home - (solar + import - export + discharged - charged)`. */
export function energyBalanceResidualWh(values: {
  readonly solarGeneratedWh: number;
  readonly homeConsumedWh: number;
  readonly gridImportWh: number;
  readonly gridExportWh: number;
  readonly batteryChargedWh: number;
  readonly batteryDischargedWh: number;
}): number {
  return (
    values.homeConsumedWh -
    (values.solarGeneratedWh +
      values.gridImportWh -
      values.gridExportWh +
      values.batteryDischargedWh -
      values.batteryChargedWh)
  );
}

/**
 * Energy tolerance for an interval: the power tolerance applied over the interval's duration, in Wh
 * (`max(floorW * hours, percent of home consumption)`), the same logic as the power check (section 2).
 */
export function energyBalanceToleranceWh(
  homeConsumedWh: number,
  durationSeconds: number,
  options?: ValidationOptions,
): number {
  const o = resolveValidationOptions(options);
  const hours = durationSeconds / 3600;
  return Math.max(
    o.balanceToleranceFloorW * hours,
    (o.balanceTolerancePercent / 100) * Math.abs(homeConsumedWh),
  );
}

/** Check one energy interval's values over `durationSeconds`. Reports problems; changes nothing. */
export function inspectEnergyValues(
  values: EnergyValues,
  durationSeconds: number,
  options?: ValidationOptions,
): DataIssue[] {
  const o = resolveValidationOptions(options);
  const issues: DataIssue[] = [];
  const entries = Object.entries(values) as Array<[string, number | null]>;
  const maxWh = (o.maxPlausiblePowerW * durationSeconds) / 3600;
  for (const [field, value] of entries) {
    if (value === null) continue;
    if (value < 0) {
      issues.push(
        issue(
          'ENERGY_NEGATIVE',
          field,
          value,
          'Energy flows are non-negative; direction is in the name',
        ),
      );
    } else if (value > maxWh) {
      issues.push(
        issue(
          'ENERGY_IMPLAUSIBLE_MAGNITUDE',
          field,
          value,
          'Energy above the plausible maximum for this interval (unit mix-up?)',
        ),
      );
    }
  }
  const {
    solarGeneratedWh,
    homeConsumedWh,
    gridImportWh,
    gridExportWh,
    batteryChargedWh,
    batteryDischargedWh,
  } = values;
  if (
    solarGeneratedWh !== null &&
    homeConsumedWh !== null &&
    gridImportWh !== null &&
    gridExportWh !== null &&
    batteryChargedWh !== null &&
    batteryDischargedWh !== null
  ) {
    const residual = energyBalanceResidualWh({
      solarGeneratedWh,
      homeConsumedWh,
      gridImportWh,
      gridExportWh,
      batteryChargedWh,
      batteryDischargedWh,
    });
    if (Math.abs(residual) > energyBalanceToleranceWh(homeConsumedWh, durationSeconds, options)) {
      issues.push(
        issue(
          'ENERGY_BALANCE_MISMATCH',
          null,
          residual,
          'Home consumption differs from solar + import - export + discharged - charged by more than the tolerance',
        ),
      );
    }
  }
  return issues;
}

/**
 * Quality flag for a reading: `SUSPECT` when any issue is one of the suspect codes; else `PARTIAL` when anything
 * is missing or flagged; else `OK`. (`DERIVED` applies only to energy integrated from power, not to a reading.)
 */
export function qualityFromIssues(
  issues: readonly DataIssue[],
  anyValueMissing: boolean,
): PowerQuality {
  if (issues.some((i) => SUSPECT_ISSUE_CODES.has(i.code))) return 'SUSPECT';
  if (issues.length > 0 || anyValueMissing) return 'PARTIAL';
  return 'OK';
}
