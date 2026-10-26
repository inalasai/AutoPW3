import type { DataSource, EnergyResolution } from '@autopw3/shared';
import type { AccountingResult } from '@autopw3/domain';

export type RangePreset = 'day' | 'week' | 'month' | 'year' | 'custom';

export type AnalyticsView = 'energy' | 'cost';

export type DisplayMode = 'chart' | 'table';

export interface DateRangeState {
  readonly preset: RangePreset;
  /** Inclusive UTC ISO start instant. */
  readonly from: string;
  /** Exclusive UTC ISO end instant. */
  readonly to: string;
  /** IANA site timezone, e.g. 'Europe/Dublin'. */
  readonly timezone: string;
  /** Local start calendar date (YYYY-MM-DD). */
  readonly startDate: string;
  /** Local end calendar date (YYYY-MM-DD). */
  readonly endDate: string;
}

export interface EnergyChartPoint {
  readonly timestamp: string;
  readonly label: string;
  readonly solarKwh: number;
  readonly homeKwh: number;
  readonly gridImportKwh: number;
  readonly gridExportKwh: number;
  readonly batteryChargedKwh: number;
  readonly batteryDischargedKwh: number;
  readonly isGap: boolean;
}

export interface CostChartPoint {
  readonly timestamp: string;
  readonly label: string;
  readonly importCost: number;
  readonly exportCredit: number;
  readonly netCost: number;
  readonly isGap: boolean;
}

export interface AnalyticsData {
  readonly range: DateRangeState;
  readonly resolution: EnergyResolution;
  readonly availableResolutions: readonly EnergyResolution[];
  readonly accounting: AccountingResult | null;
  readonly energyPoints: readonly EnergyChartPoint[];
  readonly costPoints: readonly CostChartPoint[];
  readonly source: DataSource;
  readonly loading: boolean;
  readonly error: string | null;
}
