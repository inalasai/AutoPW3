import type { DataSource, EnergyResolution, EnergySeriesPoint } from '@autopw3/shared';
import { parseInstantMs } from './timestamps';
import type { DataIssue, PowerSampleOf, TimeGap } from './types';

/**
 * The telemetry provider interface. Everything that supplies readings, the demo provider now and the Tesla
 * adapter later (TASK-15), implements `TelemetryProvider<S>` for its own `source`. Callers (the Worker's
 * `/live`, `/power` and `/energy` routes, ingestion) depend on this interface, not on a provider.
 *
 * Contract every implementation must keep:
 *  - Output is already in the project convention (`@autopw3/shared` constants/signs.ts). Provider-native names,
 *    signs and units are converted inside the implementation, nowhere else.
 *  - Every sample carries `source: S`, a UTC `sampledAt`, a quality flag, and unit-explicit fields. A missing
 *    value is `null`, never 0.
 *  - Series state their real resolution and are never resampled to finer data than the provider has (rule 9).
 *    Gaps are reported, not filled.
 *  - Ranges are half-open `[from, to)` and checked against `MAX_RANGE_DAYS` (API contract section 1).
 *  - Nothing is persisted here. The interface reads; ingestion decides what to store (live `TESLA` data only).
 *  - Methods are asynchronous because the live adapter does I/O. Failures are thrown as `TelemetryProviderError`.
 */

/** The fields of a snapshot a provider may or may not supply. */
export type TelemetryField =
  | 'solarPowerW'
  | 'batteryPowerW'
  | 'gridPowerW'
  | 'loadPowerW'
  | 'batterySocPercent'
  | 'gridStatus';

/** Whether a provider supplies a field. `UNVERIFIED` means nobody has confirmed it against real data. */
export type FieldSupport = 'SUPPORTED' | 'UNSUPPORTED' | 'UNVERIFIED';

/**
 * How far a provider's behaviour has been confirmed. `SYNTHETIC` is the demo provider (made-up, labelled);
 * `UNVERIFIED` is a real provider nobody has checked against a live site (the Tesla adapter's state until Q-06).
 */
export type TelemetryVerification = 'SYNTHETIC' | 'VERIFIED' | 'MOCK_ONLY' | 'UNVERIFIED';

/** What a provider can do. The UI and ingestion read this; they never assume it. */
export interface TelemetryCapabilities {
  readonly source: DataSource;
  /** True when every reading is made up. The UI shows the demo indicator and nothing is persisted. */
  readonly synthetic: boolean;
  readonly verification: TelemetryVerification;
  readonly live: {
    readonly supported: boolean;
    /** Seconds between fresh readings at the provider, or null when not known. */
    readonly nativeCadenceSeconds: number | null;
    readonly cadenceVerified: boolean;
  };
  readonly powerSeries: {
    readonly supported: boolean;
    /** Real spacing of the power snapshots, or null when not known. */
    readonly resolutionSeconds: number | null;
    readonly maxRangeDays: number;
  };
  readonly energySeries: {
    readonly resolutions: readonly EnergyResolution[];
    /** Real length of the finest energy interval the provider returns, or null when not known. */
    readonly nativeIntervalSeconds: number | null;
    readonly maxRangeDays: Readonly<Record<EnergyResolution, number>>;
  };
  readonly fields: Readonly<Record<TelemetryField, FieldSupport>>;
}

export interface LiveSnapshotRequest {
  readonly siteId: string;
}

export interface PowerSeriesRequest {
  readonly siteId: string;
  /** Inclusive start instant (UTC, with zone). */
  readonly from: string;
  /** Exclusive end instant. */
  readonly to: string;
}

export interface EnergySeriesRequest {
  readonly siteId: string;
  readonly from: string;
  readonly to: string;
  readonly resolution: EnergyResolution;
  /**
   * The site's IANA timezone. `daily` buckets are local calendar days in this zone (23, 24 or 25 hours on a DST
   * day); `interval` and `hourly` buckets are aligned to UTC and do not depend on it.
   */
  readonly timezone: string;
}

export interface LiveSnapshotResult<S extends DataSource> {
  readonly source: S;
  readonly sample: PowerSampleOf<S>;
  /** What normalisation flagged. Empty for a clean reading. */
  readonly issues: readonly DataIssue[];
}

export interface PowerSeriesResult<S extends DataSource> {
  readonly source: S;
  /** The real spacing of the samples, in seconds. */
  readonly resolutionSeconds: number;
  /** Samples in `[from, to)`, ascending, one per instant. */
  readonly samples: readonly PowerSampleOf<S>[];
  readonly gaps: readonly TimeGap[];
  /** Covered time divided by requested time, from 0 to 1. Never rounded up. */
  readonly completeness: number;
}

export interface EnergySeriesResult<S extends DataSource> {
  readonly source: S;
  readonly resolution: EnergyResolution;
  /** One point per bucket overlapping the request. Same shape as the API's `items`. */
  readonly items: readonly EnergySeriesPoint[];
}

export interface TelemetryProvider<S extends DataSource> {
  /** The source stamped on everything this provider returns. */
  readonly source: S;
  getCapabilities(): TelemetryCapabilities;
  getLiveSnapshot(request: LiveSnapshotRequest): Promise<LiveSnapshotResult<S>>;
  getPowerSeries(request: PowerSeriesRequest): Promise<PowerSeriesResult<S>>;
  getEnergySeries(request: EnergySeriesRequest): Promise<EnergySeriesResult<S>>;
}

export const TELEMETRY_PROVIDER_ERROR_CODES = [
  'UNAVAILABLE',
  'RATE_LIMITED',
  'BUDGET_EXHAUSTED',
  'NOT_AUTHORISED',
  'INVALID_REQUEST',
  'RANGE_INVALID',
  'RANGE_TOO_LARGE',
  'UNSUPPORTED_RESOLUTION',
  'OUT_OF_COVERAGE',
] as const;
export type TelemetryProviderErrorCode = (typeof TELEMETRY_PROVIDER_ERROR_CODES)[number];

/** A provider could not answer. Carries a code and a short message, never provider payloads or credentials. */
export class TelemetryProviderError extends Error {
  readonly code: TelemetryProviderErrorCode;

  constructor(code: TelemetryProviderErrorCode, message: string) {
    super(message);
    this.name = 'TelemetryProviderError';
    this.code = code;
  }
}

/**
 * Validate a requested range `[from, to)` and return it as epoch milliseconds. Throws `RANGE_INVALID` for an
 * unreadable instant or `to` not after `from`, and `RANGE_TOO_LARGE` beyond `maxDays`.
 */
export function checkRange(
  from: string,
  to: string,
  maxDays: number,
): { readonly fromMs: number; readonly toMs: number } {
  const fromMs = parseInstantMs(from);
  const toMs = parseInstantMs(to);
  if (fromMs === null || toMs === null) {
    throw new TelemetryProviderError(
      'RANGE_INVALID',
      'from and to must be UTC instants with a zone',
    );
  }
  if (toMs <= fromMs) {
    throw new TelemetryProviderError('RANGE_INVALID', 'to must be after from');
  }
  if (toMs - fromMs > maxDays * 86_400_000) {
    throw new TelemetryProviderError('RANGE_TOO_LARGE', `range must not exceed ${maxDays} days`);
  }
  return { fromMs, toMs };
}
