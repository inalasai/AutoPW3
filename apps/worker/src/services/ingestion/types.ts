import type { EnergySeriesPoint, PersistedPowerSample, PowerQuality } from '@autopw3/shared';

export interface TelemetrySyncState {
  readonly siteId: string;
  readonly stream: 'LIVE' | 'HISTORY';
  readonly lastAttemptAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED' | null;
  readonly lastErrorCode: string | null;
  readonly cursor: {
    readonly lastCompletedIntervalEnd?: string;
    readonly [key: string]: unknown;
  } | null;
  readonly latestSampleAt: string | null;
  readonly consecutiveFailures: number;
}

export interface LiveFetchResult {
  readonly success: boolean;
  readonly sample?: PersistedPowerSample;
  readonly quality?: PowerQuality;
  readonly freshness?: 'FRESH' | 'STALE' | 'UNAVAILABLE';
  readonly error?: string;
}

export interface HistoricalSyncResult {
  readonly siteId: string;
  readonly success: boolean;
  readonly intervalsSynced: number;
  readonly cursorAdvancedTo: string | null;
  readonly status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  readonly error?: string;
}

export interface RollupComputationResult {
  readonly siteId: string;
  readonly hourlyRollups: readonly EnergySeriesPoint[];
  readonly dailyRollups: readonly EnergySeriesPoint[];
}

export interface RetentionResult {
  readonly dryRun: boolean;
  readonly rawMetricsDeleted: number;
  readonly jobsDeleted: number;
  readonly cutoffRawMetricsUtc: string;
  readonly cutoffJobsUtc: string;
}
