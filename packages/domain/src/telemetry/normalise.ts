import type { DataSource } from '@autopw3/shared';
import { formatInstant, parseInstantMs } from './timestamps';
import type {
  DataIssue,
  DataIssueCode,
  EnergyIntervalOf,
  PowerSampleOf,
  RawEnergyInterval,
  RawPowerReading,
} from './types';
import {
  inspectEnergyValues,
  inspectPowerValues,
  qualityFromIssues,
  type EnergyValues,
  type PowerValues,
  type ValidationOptions,
} from './validation';

/**
 * Normalisation: a reading in the project's convention but unchecked (`RawPowerReading`) becomes a schema-valid
 * sample with a quality flag and a list of issues. Provider-native names, signs and units are NOT handled here:
 * that is the adapter's job (`apps/worker/src/providers/tesla`, TASK-15), and it hands over a `RawPowerReading`.
 *
 * Rules:
 *  - Nothing is silently corrected. A value that cannot be represented in the shared schema (negative solar or
 *    load, a battery level outside 0 to 100, NaN, Infinity, a string) becomes `null` and the reading `SUSPECT`,
 *    with an issue naming the field and the observed number. A value that is representable but doubtful (implausible
 *    magnitude, failed balance) is kept and the reading is `SUSPECT`.
 *  - Strings are never coerced to numbers: "2000" is `VALUE_NOT_A_NUMBER`, because a provider that starts sending
 *    strings has probably also changed units.
 *  - A missing field is `null`, never 0 (rule 8, 9). The reading is `PARTIAL`.
 *  - A reading with no usable timestamp takes the receive time and says so (`timestampOrigin: 'RECEIVED'`).
 *  - A timestamp later than the receive time by more than the skew allowance is `TIMESTAMP_IN_FUTURE` (`SUSPECT`).
 */

/** How far a provider timestamp may be ahead of the receive time before it is called a future timestamp. */
export const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 120;

export interface NormaliseOptions<S extends DataSource> {
  /** Where the reading came from. Stamped on the result, never inferred. */
  readonly source: S;
  /** When it was received: an instant with a zone, a `Date`, or epoch milliseconds. Required. */
  readonly receivedAt: Date | string | number;
  readonly validation?: ValidationOptions;
  readonly maxFutureSkewSeconds?: number;
}

export interface NormalisedPowerReading<S extends DataSource> {
  readonly sample: PowerSampleOf<S>;
  readonly issues: readonly DataIssue[];
}

interface FieldRead {
  readonly value: number | null;
  readonly issue: DataIssue | null;
  readonly missing: boolean;
}

function readNumber(raw: unknown, field: string): FieldRead {
  if (raw === undefined || raw === null) return { value: null, issue: null, missing: true };
  if (typeof raw !== 'number') {
    return {
      value: null,
      issue: {
        code: 'VALUE_NOT_A_NUMBER',
        field,
        observed: null,
        message: `${field} must be a number (strings are not coerced)`,
      },
      missing: false,
    };
  }
  if (!Number.isFinite(raw)) {
    return {
      value: null,
      issue: {
        code: 'VALUE_NOT_FINITE',
        field,
        observed: null,
        message: `${field} must be a finite number`,
      },
      missing: false,
    };
  }
  return { value: raw, issue: null, missing: false };
}

/** Issue codes whose value cannot be represented in the shared schema, so the value is set to `null`. */
const UNREPRESENTABLE: ReadonlySet<DataIssueCode> = new Set<DataIssueCode>([
  'SOLAR_NEGATIVE',
  'LOAD_NEGATIVE',
  'SOC_OUT_OF_RANGE',
  'ENERGY_NEGATIVE',
]);

function requireInstantMs(value: Date | string | number, name: string): number {
  const ms = parseInstantMs(value);
  if (ms === null) throw new RangeError(`${name} must be a valid instant with a zone`);
  return ms;
}

/** Normalise one power reading. Pure; the receive time is an input, so the result never depends on the clock. */
export function normalisePowerReading<S extends DataSource>(
  raw: RawPowerReading,
  options: NormaliseOptions<S>,
): NormalisedPowerReading<S> {
  const receivedMs = requireInstantMs(options.receivedAt, 'receivedAt');
  const skewMs = (options.maxFutureSkewSeconds ?? DEFAULT_MAX_FUTURE_SKEW_SECONDS) * 1000;
  const issues: DataIssue[] = [];

  // Timestamp.
  let sampledMs = receivedMs;
  let timestampOrigin: 'PROVIDER' | 'RECEIVED' = 'RECEIVED';
  if (raw.sampledAt === undefined || raw.sampledAt === null) {
    issues.push({
      code: 'TIMESTAMP_MISSING',
      field: 'sampledAt',
      observed: null,
      message: 'No sample time; the receive time is used',
    });
  } else {
    const parsed = parseInstantMs(raw.sampledAt);
    if (parsed === null) {
      issues.push({
        code: 'TIMESTAMP_INVALID',
        field: 'sampledAt',
        observed: null,
        message: 'Sample time is not an ISO 8601 instant with a zone; the receive time is used',
      });
    } else {
      sampledMs = parsed;
      timestampOrigin = 'PROVIDER';
      if (parsed > receivedMs + skewMs) {
        issues.push({
          code: 'TIMESTAMP_IN_FUTURE',
          field: 'sampledAt',
          observed: Math.round((parsed - receivedMs) / 1000),
          message: 'Sample time is later than the receive time (seconds ahead are in `observed`)',
        });
      }
    }
  }

  // Values.
  const reads = {
    solarPowerW: readNumber(raw.solarPowerW, 'solarPowerW'),
    batteryPowerW: readNumber(raw.batteryPowerW, 'batteryPowerW'),
    gridPowerW: readNumber(raw.gridPowerW, 'gridPowerW'),
    loadPowerW: readNumber(raw.loadPowerW, 'loadPowerW'),
    batterySocPercent: readNumber(raw.batterySocPercent, 'batterySocPercent'),
  };
  for (const [field, read] of Object.entries(reads)) {
    if (read.issue !== null) issues.push(read.issue);
    else if (read.missing) {
      issues.push({
        code: 'FIELD_MISSING',
        field,
        observed: null,
        message: `${field} was not supplied`,
      });
    }
  }
  const inspected: PowerValues = {
    solarPowerW: reads.solarPowerW.value,
    batteryPowerW: reads.batteryPowerW.value,
    gridPowerW: reads.gridPowerW.value,
    loadPowerW: reads.loadPowerW.value,
    batterySocPercent: reads.batterySocPercent.value,
  };
  const valueIssues = inspectPowerValues(inspected, options.validation);
  issues.push(...valueIssues);

  const nulled = new Set(
    valueIssues
      .filter((i) => UNREPRESENTABLE.has(i.code) && i.field !== null)
      .map((i) => i.field as string),
  );
  const keep = (field: keyof PowerValues): number | null =>
    nulled.has(field) ? null : inspected[field];
  const final: PowerValues = {
    solarPowerW: keep('solarPowerW'),
    batteryPowerW: keep('batteryPowerW'),
    gridPowerW: keep('gridPowerW'),
    loadPowerW: keep('loadPowerW'),
    batterySocPercent: keep('batterySocPercent'),
  };
  const anyMissing = Object.values(final).some((v) => v === null);

  const gridStatus =
    typeof raw.gridStatus === 'string' && raw.gridStatus.trim().length > 0
      ? raw.gridStatus.trim().slice(0, 64)
      : null;

  const sample: PowerSampleOf<S> = {
    sampledAt: formatInstant(sampledMs),
    receivedAt: formatInstant(receivedMs),
    timestampOrigin,
    ...final,
    gridStatus,
    quality: qualityFromIssues(issues, anyMissing),
    source: options.source,
  };
  return { sample, issues };
}

export interface NormalisedEnergyInterval<S extends DataSource> {
  /** `null` when the interval itself is unusable (no readable start and end, or end not after start). */
  readonly interval: EnergyIntervalOf<S> | null;
  readonly issues: readonly DataIssue[];
}

/** Normalise one energy interval `[intervalStart, intervalEnd)`. Same rules as `normalisePowerReading`. */
export function normaliseEnergyInterval<S extends DataSource>(
  raw: RawEnergyInterval,
  options: { readonly source: S; readonly validation?: ValidationOptions },
): NormalisedEnergyInterval<S> {
  const startMs = parseInstantMs(raw.intervalStart);
  const endMs = parseInstantMs(raw.intervalEnd);
  if (startMs === null || endMs === null || endMs <= startMs) {
    return {
      interval: null,
      issues: [
        {
          code: 'INTERVAL_INVALID',
          field: null,
          observed: null,
          message: 'An interval needs a readable start and an end after the start',
        },
      ],
    };
  }
  const durationSeconds = Math.round((endMs - startMs) / 1000);
  const issues: DataIssue[] = [];
  const reads = {
    solarGeneratedWh: readNumber(raw.solarGeneratedWh, 'solarGeneratedWh'),
    homeConsumedWh: readNumber(raw.homeConsumedWh, 'homeConsumedWh'),
    gridImportWh: readNumber(raw.gridImportWh, 'gridImportWh'),
    gridExportWh: readNumber(raw.gridExportWh, 'gridExportWh'),
    batteryChargedWh: readNumber(raw.batteryChargedWh, 'batteryChargedWh'),
    batteryDischargedWh: readNumber(raw.batteryDischargedWh, 'batteryDischargedWh'),
  };
  for (const [field, read] of Object.entries(reads)) {
    if (read.issue !== null) issues.push(read.issue);
    else if (read.missing) {
      issues.push({
        code: 'FIELD_MISSING',
        field,
        observed: null,
        message: `${field} was not supplied`,
      });
    }
  }
  const inspected: EnergyValues = {
    solarGeneratedWh: reads.solarGeneratedWh.value,
    homeConsumedWh: reads.homeConsumedWh.value,
    gridImportWh: reads.gridImportWh.value,
    gridExportWh: reads.gridExportWh.value,
    batteryChargedWh: reads.batteryChargedWh.value,
    batteryDischargedWh: reads.batteryDischargedWh.value,
  };
  const valueIssues = inspectEnergyValues(inspected, durationSeconds, options.validation);
  issues.push(...valueIssues);
  const nulled = new Set(
    valueIssues
      .filter((i) => UNREPRESENTABLE.has(i.code) && i.field !== null)
      .map((i) => i.field as string),
  );
  const keep = (field: keyof EnergyValues): number | null =>
    nulled.has(field) ? null : inspected[field];
  const final: EnergyValues = {
    solarGeneratedWh: keep('solarGeneratedWh'),
    homeConsumedWh: keep('homeConsumedWh'),
    gridImportWh: keep('gridImportWh'),
    gridExportWh: keep('gridExportWh'),
    batteryChargedWh: keep('batteryChargedWh'),
    batteryDischargedWh: keep('batteryDischargedWh'),
  };
  const anyMissing = Object.values(final).some((v) => v === null);
  const interval: EnergyIntervalOf<S> = {
    intervalStart: formatInstant(startMs),
    intervalEnd: formatInstant(endMs),
    resolutionSeconds: durationSeconds,
    ...final,
    source: options.source,
    quality: qualityFromIssues(issues, anyMissing),
  };
  return { interval, issues };
}
