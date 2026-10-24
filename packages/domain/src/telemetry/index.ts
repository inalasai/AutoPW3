export type {
  DataIssue,
  DataIssueCode,
  DemoEnergyInterval,
  DemoPowerSample,
  EnergyIntervalOf,
  LiveEnergyInterval,
  LivePowerSample,
  PowerSampleOf,
  RawEnergyInterval,
  RawPowerReading,
  TimeGap,
} from './types';
export { DATA_ISSUE_CODES, SUSPECT_ISSUE_CODES } from './types';

export {
  addLocalDays,
  dayOfWeek,
  formatInstant,
  isKnownTimeZone,
  localDateOf,
  localDayBounds,
  localMinuteOfDay,
  localParts,
  normaliseTimestamp,
  parseInstantMs,
  utcOffsetMinutes,
} from './timestamps';
export type { LocalParts } from './timestamps';

export {
  DEFAULT_MAX_PLAUSIBLE_POWER_W,
  balanceToleranceW,
  energyBalanceResidualWh,
  energyBalanceToleranceWh,
  inspectEnergyValues,
  inspectPowerValues,
  powerBalanceHolds,
  qualityFromIssues,
  resolveValidationOptions,
} from './validation';
export type {
  EnergyValues,
  PowerValues,
  ResolvedValidationOptions,
  ValidationOptions,
} from './validation';

export {
  DEFAULT_MAX_FUTURE_SKEW_SECONDS,
  normaliseEnergyInterval,
  normalisePowerReading,
} from './normalise';
export type {
  NormaliseOptions,
  NormalisedEnergyInterval,
  NormalisedPowerReading,
} from './normalise';

export {
  coverageFraction,
  dedupeBySampledAt,
  detectGaps,
  detectGapsInRange,
  sortBySampledAt,
} from './series';
export type { DedupeKey, GapOptions, HasSampledAt, TimeRange } from './series';

export {
  DEFAULT_FUTURE_SKEW_SECONDS,
  DEFAULT_STALE_AFTER_SECONDS,
  freshnessOf,
  toDemoLiveReading,
  toLiveReading,
} from './freshness';
export type { FreshnessOptions, FreshnessResult } from './freshness';

export { DEFAULT_LOW_BATTERY_PERCENT, describeFlows } from './flows';
export type { FlowInputs, FlowSummary } from './flows';

export {
  DemoDataInLivePathError,
  acceptForLiveIngestion,
  assertLiveSource,
  requireLiveSamples,
  selectAccountableSamples,
} from './guards';

export { TELEMETRY_PROVIDER_ERROR_CODES, TelemetryProviderError, checkRange } from './provider';
export type {
  EnergySeriesRequest,
  EnergySeriesResult,
  FieldSupport,
  LiveSnapshotRequest,
  LiveSnapshotResult,
  PowerSeriesRequest,
  PowerSeriesResult,
  TelemetryCapabilities,
  TelemetryField,
  TelemetryProvider,
  TelemetryProviderErrorCode,
  TelemetryVerification,
} from './provider';

export { createDemoTelemetryProvider } from './demo-provider';
export type { DemoProviderOptions } from './demo-provider';
