import { useCallback, useEffect, useState } from 'react';
import type { EnergyResolution, Tariff } from '@autopw3/shared';
import {
  accountForPeriod,
  calculatePeriodCosts,
  defaultDemoSiteModel,
  demoEnergyIntervals,
} from '@autopw3/domain';
import { defaultInMemoryTariffRepository } from '../tariffs/repository';
import type { TariffRepository } from '../tariffs/types';
import { aggregateSeries } from './aggregation';
import {
  DEFAULT_ANCHOR_DATE,
  DEFAULT_TIMEZONE,
  getAvailableResolutions,
  getDefaultResolution,
  resolveDateRange,
} from './range';
import type { AnalyticsData, DateRangeState, RangePreset } from './types';

export interface UseAnalyticsOptions {
  readonly initialPreset?: RangePreset;
  readonly timezone?: string;
  readonly anchorDate?: string;
  readonly initialResolution?: EnergyResolution;
  readonly repository?: TariffRepository;
}

export function useAnalyticsData(options: UseAnalyticsOptions = {}): AnalyticsData & {
  readonly setPreset: (preset: RangePreset, customAnchor?: string) => void;
  readonly setCustomRange: (startDate: string, endDate: string) => void;
  readonly setResolution: (resolution: EnergyResolution) => void;
  readonly refresh: () => void;
} {
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const initialPreset = options.initialPreset ?? 'day';
  const anchorDate = options.anchorDate ?? DEFAULT_ANCHOR_DATE;
  const repository = options.repository ?? defaultInMemoryTariffRepository;

  const [range, setRange] = useState<DateRangeState>(() =>
    resolveDateRange(initialPreset, timezone, anchorDate),
  );

  const [resolution, setResolutionState] = useState<EnergyResolution>(
    () => options.initialResolution ?? getDefaultResolution(initialPreset),
  );

  const [data, setData] = useState<
    Omit<AnalyticsData, 'range' | 'resolution' | 'availableResolutions'>
  >({
    accounting: null,
    energyPoints: [],
    costPoints: [],
    source: 'DEMO',
    loading: true,
    error: null,
  });

  const availableResolutions = getAvailableResolutions(
    range.preset,
    range.startDate,
    range.endDate,
  );

  const loadData = useCallback(async () => {
    setData((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const model = defaultDemoSiteModel();
      const fromMs = Date.parse(range.from);
      const toMs = Date.parse(range.to);

      if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) {
        throw new Error('Invalid date range');
      }

      // Generate intervals for range
      const intervals = demoEnergyIntervals(model, fromMs, toMs);

      // Load active tariffs
      let tariffs: Tariff[] = [];
      try {
        tariffs = await repository.listTariffs();
      } catch {
        tariffs = [];
      }

      const period = {
        from: range.from,
        to: range.to,
        timezone: range.timezone,
      };

      // Real domain accounting engine
      const accounting = accountForPeriod({
        intervals,
        tariffs,
        period,
        options: { context: 'DEMO' },
      });

      // Cost details
      const costCalc =
        tariffs.length > 0
          ? calculatePeriodCosts(intervals, tariffs, period, { context: 'DEMO' })
          : null;

      // Aggregate into chart points
      const { energyPoints, costPoints } = aggregateSeries(
        intervals,
        costCalc?.intervalDetails ?? [],
        resolution,
        range.timezone,
        tariffs,
      );

      setData({
        accounting,
        energyPoints,
        costPoints,
        source: 'DEMO',
        loading: false,
        error: null,
      });
    } catch (err) {
      setData({
        accounting: null,
        energyPoints: [],
        costPoints: [],
        source: 'DEMO',
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load analytics data',
      });
    }
  }, [range, resolution, repository]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const setPreset = useCallback(
    (newPreset: RangePreset, customAnchor?: string) => {
      const newRange = resolveDateRange(newPreset, timezone, customAnchor ?? anchorDate);
      setRange(newRange);
      const newAvail = getAvailableResolutions(newPreset, newRange.startDate, newRange.endDate);
      if (!newAvail.includes(resolution)) {
        setResolutionState(getDefaultResolution(newPreset));
      }
    },
    [timezone, anchorDate, resolution],
  );

  const setCustomRange = useCallback(
    (startDate: string, endDate: string) => {
      const newRange = resolveDateRange('custom', timezone, anchorDate, startDate, endDate);
      setRange(newRange);
      const newAvail = getAvailableResolutions('custom', startDate, endDate);
      if (!newAvail.includes(resolution)) {
        setResolutionState(getDefaultResolution('custom'));
      }
    },
    [timezone, anchorDate, resolution],
  );

  const setResolution = useCallback(
    (newRes: EnergyResolution) => {
      if (availableResolutions.includes(newRes)) {
        setResolutionState(newRes);
      }
    },
    [availableResolutions],
  );

  return {
    range,
    resolution,
    availableResolutions,
    accounting: data.accounting,
    energyPoints: data.energyPoints,
    costPoints: data.costPoints,
    source: data.source,
    loading: data.loading,
    error: data.error,
    setPreset,
    setCustomRange,
    setResolution,
    refresh: loadData,
  };
}
