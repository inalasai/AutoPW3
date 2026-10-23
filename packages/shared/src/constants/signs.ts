/**
 * Units and sign convention: the single definition in code (docs/ENERGY_ACCOUNTING.md section 2).
 *
 * | Quantity | Field              | Unit | Sign / range                                |
 * | Solar    | solarPowerW        | W    | >= 0 (generation)                           |
 * | Battery  | batteryPowerW      | W    | > 0 DISCHARGING (supplying the site), < 0 CHARGING |
 * | Grid     | gridPowerW         | W    | > 0 IMPORTING, < 0 EXPORTING                |
 * | Load     | loadPowerW         | W    | >= 0                                        |
 * | Battery  | batterySocPercent  | %    | 0 to 100                                    |
 * | Energy   | ...Wh              | Wh   | >= 0 for every directional flow             |
 *
 * Balance: loadPowerW is approximately solarPowerW + batteryPowerW + gridPowerW.
 *
 * Provider-native signs are UNVERIFIED (docs/research/SIGN_CONVENTION_FINDING.md). Conversion to this
 * convention happens only at the provider adapter (apps/worker/src/providers/tesla), never here or in the UI.
 */

export const POWER_UNIT = 'W' as const;
export const ENERGY_UNIT = 'Wh' as const;
export const PERCENT_RANGE = { min: 0, max: 100 } as const;

/**
 * Proposed tolerance for the instantaneous balance check (ENERGY_ACCOUNTING section 2). A proposal, not a fact:
 * tune it only after real data is observed. Failing the check sets quality SUSPECT, which accounting excludes.
 */
export const BALANCE_TOLERANCE_FLOOR_W = 100;
export const BALANCE_TOLERANCE_PERCENT = 5;

export type BatteryDirection = 'DISCHARGING' | 'CHARGING' | 'IDLE';
export type GridDirection = 'IMPORTING' | 'EXPORTING' | 'IDLE';

/** Battery flow direction from the sign of `batteryPowerW` (> 0 discharging, < 0 charging). */
export function batteryDirection(batteryPowerW: number): BatteryDirection {
  if (batteryPowerW > 0) return 'DISCHARGING';
  if (batteryPowerW < 0) return 'CHARGING';
  return 'IDLE';
}

/** Grid flow direction from the sign of `gridPowerW` (> 0 importing, < 0 exporting). */
export function gridDirection(gridPowerW: number): GridDirection {
  if (gridPowerW > 0) return 'IMPORTING';
  if (gridPowerW < 0) return 'EXPORTING';
  return 'IDLE';
}

/** Magnitude imported from the grid in W (0 when exporting or idle). */
export function gridImportW(gridPowerW: number): number {
  return gridPowerW > 0 ? gridPowerW : 0;
}

/** Magnitude exported to the grid in W (0 when importing or idle). */
export function gridExportW(gridPowerW: number): number {
  return gridPowerW < 0 ? -gridPowerW : 0;
}

/** Magnitude the battery is supplying in W (0 when charging or idle). */
export function batteryDischargeW(batteryPowerW: number): number {
  return batteryPowerW > 0 ? batteryPowerW : 0;
}

/** Magnitude going into the battery in W (0 when discharging or idle). */
export function batteryChargeW(batteryPowerW: number): number {
  return batteryPowerW < 0 ? -batteryPowerW : 0;
}

/**
 * Residual of the instantaneous balance: `loadPowerW - (solarPowerW + batteryPowerW + gridPowerW)`.
 * Near zero for a consistent reading. The pass/fail decision (tolerance) belongs to packages/domain.
 */
export function powerBalanceResidualW(flows: {
  solarPowerW: number;
  batteryPowerW: number;
  gridPowerW: number;
  loadPowerW: number;
}): number {
  return flows.loadPowerW - (flows.solarPowerW + flows.batteryPowerW + flows.gridPowerW);
}
