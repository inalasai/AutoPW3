import type { Freshness, PowerQuality } from '@autopw3/shared';
import type { DataIssueCode, RawPowerReading } from '../telemetry/types';

/**
 * Named SYNTHETIC scenarios: single readings chosen to exercise one situation each, for the demo provider, the
 * Live View (TASK-09) and every later test that needs a known case. Each is a raw reading in the project's
 * signs, plus how old it is and what normalisation must make of it. All numbers are made up and labelled DEMO
 * when served.
 *
 * Age is relative to the instant the scenario is shown at, so a scenario stays "fresh" (or "stale") however it is
 * used: `sampledAt = now - ageSeconds`. Nothing here reads a clock.
 */

export const DEMO_SCENARIO_IDS = [
  'SOLAR_SURPLUS',
  'BATTERY_CHARGING',
  'BATTERY_DISCHARGING',
  'GRID_IMPORT',
  'GRID_EXPORT',
  'LOW_BATTERY',
  'MISSING_DATA',
  'STALE_DATA',
  'INVALID_READINGS',
] as const;
export type DemoScenarioId = (typeof DEMO_SCENARIO_IDS)[number];

export interface DemoScenario {
  readonly id: DemoScenarioId;
  readonly title: string;
  readonly description: string;
  /** Seconds between the sample time and the instant the scenario is shown at. */
  readonly ageSeconds: number;
  /** The reading, without `sampledAt` (it is derived from `ageSeconds`). */
  readonly raw: Omit<RawPowerReading, 'sampledAt'>;
  /** What normalising the reading must give. Tests hold the normaliser to this. */
  readonly expect: {
    readonly quality: PowerQuality;
    readonly freshness: Freshness;
    /** The distinct issue codes, sorted. Empty for a clean reading. */
    readonly issueCodes: readonly DataIssueCode[];
  };
}

const FRESH_AGE_SECONDS = 20;
const GRID = 'SystemGridConnected';

export const DEMO_SCENARIOS: Readonly<Record<DemoScenarioId, DemoScenario>> = {
  SOLAR_SURPLUS: {
    id: 'SOLAR_SURPLUS',
    title: 'Solar surplus',
    description:
      'Midday sun: solar exceeds the load, the battery takes most of it and the rest is exported.',
    ageSeconds: FRESH_AGE_SECONDS,
    raw: {
      solarPowerW: 3800,
      batteryPowerW: -2400,
      gridPowerW: -700,
      loadPowerW: 700,
      batterySocPercent: 58,
      gridStatus: GRID,
    },
    expect: { quality: 'OK', freshness: 'FRESH', issueCodes: [] },
  },
  BATTERY_CHARGING: {
    id: 'BATTERY_CHARGING',
    title: 'Battery charging',
    description:
      'Morning sun covers the load and the surplus charges the battery; nothing crosses the meter.',
    ageSeconds: FRESH_AGE_SECONDS,
    raw: {
      solarPowerW: 2500,
      batteryPowerW: -2000,
      gridPowerW: 0,
      loadPowerW: 500,
      batterySocPercent: 48,
      gridStatus: GRID,
    },
    expect: { quality: 'OK', freshness: 'FRESH', issueCodes: [] },
  },
  BATTERY_DISCHARGING: {
    id: 'BATTERY_DISCHARGING',
    title: 'Battery discharging',
    description: 'Evening, no sun: the battery supplies the whole load.',
    ageSeconds: FRESH_AGE_SECONDS,
    raw: {
      solarPowerW: 0,
      batteryPowerW: 1900,
      gridPowerW: 0,
      loadPowerW: 1900,
      batterySocPercent: 71,
      gridStatus: GRID,
    },
    expect: { quality: 'OK', freshness: 'FRESH', issueCodes: [] },
  },
  GRID_IMPORT: {
    id: 'GRID_IMPORT',
    title: 'Grid import',
    description:
      'A heavy load (oven and kettle) exceeds what the battery can deliver, so the grid tops it up.',
    ageSeconds: FRESH_AGE_SECONDS,
    raw: {
      solarPowerW: 300,
      batteryPowerW: 2500,
      gridPowerW: 300,
      loadPowerW: 3100,
      batterySocPercent: 35,
      gridStatus: GRID,
    },
    expect: { quality: 'OK', freshness: 'FRESH', issueCodes: [] },
  },
  GRID_EXPORT: {
    id: 'GRID_EXPORT',
    title: 'Grid export',
    description: 'Bright afternoon with a full battery: almost all solar goes to the grid.',
    ageSeconds: FRESH_AGE_SECONDS,
    raw: {
      solarPowerW: 4600,
      batteryPowerW: 0,
      gridPowerW: -4200,
      loadPowerW: 400,
      batterySocPercent: 100,
      gridStatus: GRID,
    },
    expect: { quality: 'OK', freshness: 'FRESH', issueCodes: [] },
  },
  LOW_BATTERY: {
    id: 'LOW_BATTERY',
    title: 'Low battery',
    description: 'Night, battery nearly empty: the whole load comes from the grid.',
    ageSeconds: FRESH_AGE_SECONDS,
    raw: {
      solarPowerW: 0,
      batteryPowerW: 0,
      gridPowerW: 900,
      loadPowerW: 900,
      batterySocPercent: 7,
      gridStatus: GRID,
    },
    expect: { quality: 'OK', freshness: 'FRESH', issueCodes: [] },
  },
  MISSING_DATA: {
    id: 'MISSING_DATA',
    title: 'Missing data',
    description:
      'The load and battery power were not supplied. They stay empty (never zero) and the reading is partial.',
    ageSeconds: FRESH_AGE_SECONDS,
    raw: {
      solarPowerW: 2400,
      gridPowerW: 300,
      batterySocPercent: 55,
      gridStatus: GRID,
    },
    expect: { quality: 'PARTIAL', freshness: 'FRESH', issueCodes: ['FIELD_MISSING'] },
  },
  STALE_DATA: {
    id: 'STALE_DATA',
    title: 'Stale data',
    description:
      'A clean reading that is 3.5 hours old: older than the default one-hour threshold.',
    ageSeconds: 12_600,
    raw: {
      solarPowerW: 1200,
      batteryPowerW: -300,
      gridPowerW: 0,
      loadPowerW: 900,
      batterySocPercent: 64,
      gridStatus: GRID,
    },
    expect: { quality: 'OK', freshness: 'STALE', issueCodes: [] },
  },
  INVALID_READINGS: {
    id: 'INVALID_READINGS',
    title: 'Negative and invalid readings',
    description:
      'Negative solar, an impossible battery level, a non-finite load and an implausibly large battery power. Unrepresentable values become empty and the reading is suspect.',
    ageSeconds: FRESH_AGE_SECONDS,
    raw: {
      solarPowerW: -150,
      batteryPowerW: 250_000,
      gridPowerW: 400,
      loadPowerW: Number.NaN,
      batterySocPercent: 130,
      gridStatus: GRID,
    },
    expect: {
      quality: 'SUSPECT',
      freshness: 'FRESH',
      issueCodes: [
        'POWER_IMPLAUSIBLE_MAGNITUDE',
        'SOC_OUT_OF_RANGE',
        'SOLAR_NEGATIVE',
        'VALUE_NOT_FINITE',
      ],
    },
  },
};
