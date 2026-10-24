import { batteryDirection, gridDirection } from '@autopw3/shared';
import type { BatteryDirection, GridDirection } from '@autopw3/shared';

/**
 * Plain-language classification of one power snapshot, from the signs in the project convention
 * (battery > 0 discharging, grid > 0 importing). The Live View (TASK-09) uses it to pick labels and arrows;
 * it makes no decision about control. A missing input gives `null`, never a guess.
 */

/** A battery at or below this level is called low. Tunable; the default is a display choice, not a provider fact. */
export const DEFAULT_LOW_BATTERY_PERCENT = 15;

export interface FlowInputs {
  readonly solarPowerW: number | null;
  readonly batteryPowerW: number | null;
  readonly gridPowerW: number | null;
  readonly loadPowerW: number | null;
  readonly batterySocPercent: number | null;
}

export interface FlowSummary {
  readonly battery: BatteryDirection | null;
  readonly grid: GridDirection | null;
  /** Solar is producing more than the site is using. */
  readonly solarSurplus: boolean | null;
  /** The battery level is at or below the low-battery threshold. */
  readonly lowBattery: boolean | null;
}

export function describeFlows(
  inputs: FlowInputs,
  options?: { readonly lowBatteryPercent?: number },
): FlowSummary {
  const lowAt = options?.lowBatteryPercent ?? DEFAULT_LOW_BATTERY_PERCENT;
  return {
    battery: inputs.batteryPowerW === null ? null : batteryDirection(inputs.batteryPowerW),
    grid: inputs.gridPowerW === null ? null : gridDirection(inputs.gridPowerW),
    solarSurplus:
      inputs.solarPowerW === null || inputs.loadPowerW === null
        ? null
        : inputs.solarPowerW > inputs.loadPowerW,
    lowBattery: inputs.batterySocPercent === null ? null : inputs.batterySocPercent <= lowAt,
  };
}
