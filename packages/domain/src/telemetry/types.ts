import type {
  DataSource,
  EnergyInterval,
  PersistedPowerSample,
  PowerSample,
} from '@autopw3/shared';

/**
 * Telemetry types for packages/domain. The sample shapes are the shared ones (`PowerSample`, `EnergyInterval`);
 * this file only narrows them by `source` so that demo and live data are different types.
 *
 * Signs and units are the project convention in `@autopw3/shared` (constants/signs.ts):
 * solarPowerW >= 0, batteryPowerW > 0 discharging, gridPowerW > 0 importing, loadPowerW >= 0, batterySocPercent
 * 0 to 100, energy in Wh. A missing value is `null`, never 0.
 */

/** A power snapshot that is synthetic. `source` is the literal `'DEMO'`. Never persisted, never accounted. */
export type DemoPowerSample = Omit<PowerSample, 'source'> & { readonly source: 'DEMO' };

/**
 * A power snapshot from the live provider (`source: 'TESLA'`). Same type as the persisted shape, so the only
 * samples that type-check as live are the ones the database would accept (rule 5, D-017).
 */
export type LivePowerSample = PersistedPowerSample;

/** A power snapshot of a known source. */
export type PowerSampleOf<S extends DataSource> = Omit<PowerSample, 'source'> & {
  readonly source: S;
};

/** An energy interval `[intervalStart, intervalEnd)` of a known source. The shared `EnergyInterval` is `TESLA` only. */
export type EnergyIntervalOf<S extends DataSource> = Omit<EnergyInterval, 'source'> & {
  readonly source: S;
};

/** A synthetic energy interval. Never persisted, never accounted. */
export type DemoEnergyInterval = EnergyIntervalOf<'DEMO'>;

/** A live energy interval. */
export type LiveEnergyInterval = EnergyInterval;

/**
 * Machine-readable reasons a reading was flagged. A reading with any code in `SUSPECT_ISSUE_CODES` is `SUSPECT`;
 * a reading whose only codes are `FIELD_MISSING` or `TIMESTAMP_MISSING` is `PARTIAL`.
 */
export const DATA_ISSUE_CODES = [
  'TIMESTAMP_MISSING',
  'TIMESTAMP_INVALID',
  'TIMESTAMP_IN_FUTURE',
  'FIELD_MISSING',
  'VALUE_NOT_FINITE',
  'VALUE_NOT_A_NUMBER',
  'SOLAR_NEGATIVE',
  'LOAD_NEGATIVE',
  'SOC_OUT_OF_RANGE',
  'POWER_IMPLAUSIBLE_MAGNITUDE',
  'BALANCE_MISMATCH',
  'ENERGY_NEGATIVE',
  'ENERGY_IMPLAUSIBLE_MAGNITUDE',
  'ENERGY_BALANCE_MISMATCH',
  'INTERVAL_INVALID',
] as const;
export type DataIssueCode = (typeof DATA_ISSUE_CODES)[number];

/** Codes that make a reading `SUSPECT`. Everything else only makes it `PARTIAL`. */
export const SUSPECT_ISSUE_CODES: ReadonlySet<DataIssueCode> = new Set<DataIssueCode>([
  'TIMESTAMP_INVALID',
  'TIMESTAMP_IN_FUTURE',
  'VALUE_NOT_FINITE',
  'VALUE_NOT_A_NUMBER',
  'SOLAR_NEGATIVE',
  'LOAD_NEGATIVE',
  'SOC_OUT_OF_RANGE',
  'POWER_IMPLAUSIBLE_MAGNITUDE',
  'BALANCE_MISMATCH',
  'ENERGY_NEGATIVE',
  'ENERGY_IMPLAUSIBLE_MAGNITUDE',
  'ENERGY_BALANCE_MISMATCH',
  'INTERVAL_INVALID',
]);

/** One thing wrong with a reading. Carries no secrets and no raw provider payload. */
export interface DataIssue {
  readonly code: DataIssueCode;
  /** The field concerned (`solarPowerW`), or null when the issue is about the reading as a whole. */
  readonly field: string | null;
  /** The offending number when it is one (never a string from the provider), else null. */
  readonly observed: number | null;
  /** Short English text for logs and tests. Not shown to users as-is. */
  readonly message: string;
}

/**
 * A reading in the project's convention that has not been checked yet. A provider adapter converts native
 * fields, signs and units to this shape (the only place provider signs are handled); `normalisePowerReading`
 * then validates it. Values are `unknown` on purpose: provider JSON can hold strings, NaN or nothing.
 */
export interface RawPowerReading {
  readonly sampledAt?: unknown;
  readonly solarPowerW?: unknown;
  readonly batteryPowerW?: unknown;
  readonly gridPowerW?: unknown;
  readonly loadPowerW?: unknown;
  readonly batterySocPercent?: unknown;
  readonly gridStatus?: unknown;
}

/** An energy interval in the project's convention that has not been checked yet. */
export interface RawEnergyInterval {
  readonly intervalStart?: unknown;
  readonly intervalEnd?: unknown;
  readonly solarGeneratedWh?: unknown;
  readonly homeConsumedWh?: unknown;
  readonly gridImportWh?: unknown;
  readonly gridExportWh?: unknown;
  readonly batteryChargedWh?: unknown;
  readonly batteryDischargedWh?: unknown;
}

/** A half-open span of time with no usable samples: `[from, to)`, as UTC instants. */
export interface TimeGap {
  readonly from: string;
  readonly to: string;
  readonly seconds: number;
  /** How many samples at the expected spacing would have fitted in the gap. */
  readonly missingSamples: number;
}
