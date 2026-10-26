import { formatInstant, localDateOf, localDayBounds } from '@autopw3/domain';
import type { EnergyInterval, EnergySeriesPoint, IntervalQuality } from '@autopw3/shared';
import type { Repository } from '../../db/repository';
import type { RollupComputationResult } from './types';

/**
 * Groups energy intervals into whole UTC hours and computes hourly rollups.
 */
export function computeHourlyRollupsFromIntervals(
  intervals: readonly EnergyInterval[],
): readonly EnergySeriesPoint[] {
  if (intervals.length === 0) return [];

  // Map by whole UTC hour instant string
  const hourlyBuckets = new Map<string, EnergyInterval[]>();

  for (const interval of intervals) {
    const start = new Date(interval.intervalStart);
    // Align to whole UTC hour
    start.setUTCMinutes(0, 0, 0);
    const bucketStartUtc = start.toISOString();

    const bucket = hourlyBuckets.get(bucketStartUtc);
    if (bucket) {
      bucket.push(interval);
    } else {
      hourlyBuckets.set(bucketStartUtc, [interval]);
    }
  }

  const results: EnergySeriesPoint[] = [];

  for (const [bucketStart, items] of hourlyBuckets.entries()) {
    const startMs = Date.parse(bucketStart);
    const endMs = startMs + 3600 * 1000;
    const bucketEnd = new Date(endMs).toISOString();

    let solarGeneratedWh = 0;
    let homeConsumedWh = 0;
    let gridImportWh = 0;
    let gridExportWh = 0;
    let batteryChargedWh = 0;
    let batteryDischargedWh = 0;

    let hasSolar = false;
    let hasHome = false;
    let hasImport = false;
    let hasExport = false;
    let hasCharged = false;
    let hasDischarged = false;

    let coveredSeconds = 0;
    let resMin: number | null = null;
    let resMax: number | null = null;
    let worstQuality: IntervalQuality = 'OK';

    for (const item of items) {
      if (item.solarGeneratedWh !== null) {
        solarGeneratedWh += item.solarGeneratedWh;
        hasSolar = true;
      }
      if (item.homeConsumedWh !== null) {
        homeConsumedWh += item.homeConsumedWh;
        hasHome = true;
      }
      if (item.gridImportWh !== null) {
        gridImportWh += item.gridImportWh;
        hasImport = true;
      }
      if (item.gridExportWh !== null) {
        gridExportWh += item.gridExportWh;
        hasExport = true;
      }
      if (item.batteryChargedWh !== null) {
        batteryChargedWh += item.batteryChargedWh;
        hasCharged = true;
      }
      if (item.batteryDischargedWh !== null) {
        batteryDischargedWh += item.batteryDischargedWh;
        hasDischarged = true;
      }

      coveredSeconds += item.resolutionSeconds;
      if (resMin === null || item.resolutionSeconds < resMin) {
        resMin = item.resolutionSeconds;
      }
      if (resMax === null || item.resolutionSeconds > resMax) {
        resMax = item.resolutionSeconds;
      }

      if (item.quality === 'SUSPECT') {
        worstQuality = 'SUSPECT';
      } else if (item.quality === 'PARTIAL' && worstQuality !== 'SUSPECT') {
        worstQuality = 'PARTIAL';
      } else if (
        item.quality === 'DERIVED' &&
        worstQuality !== 'SUSPECT' &&
        worstQuality !== 'PARTIAL'
      ) {
        worstQuality = 'DERIVED';
      }
    }

    const completeness = Math.min(1, Math.max(0, coveredSeconds / 3600));

    results.push({
      start: bucketStart,
      end: bucketEnd,
      solarGeneratedWh: hasSolar ? Math.round(solarGeneratedWh * 1000) / 1000 : null,
      homeConsumedWh: hasHome ? Math.round(homeConsumedWh * 1000) / 1000 : null,
      gridImportWh: hasImport ? Math.round(gridImportWh * 1000) / 1000 : null,
      gridExportWh: hasExport ? Math.round(gridExportWh * 1000) / 1000 : null,
      batteryChargedWh: hasCharged ? Math.round(batteryChargedWh * 1000) / 1000 : null,
      batteryDischargedWh: hasDischarged ? Math.round(batteryDischargedWh * 1000) / 1000 : null,
      completeness: Math.round(completeness * 10000) / 10000,
      resolutionSecondsMin: resMin,
      resolutionSecondsMax: resMax,
      quality: worstQuality,
    });
  }

  return results.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Computes daily rollups for site-local calendar days respecting DST changes (23h, 24h, 25h).
 */
export function computeDailyRollupsFromIntervals(
  intervals: readonly EnergyInterval[],
  timezone: string,
): readonly EnergySeriesPoint[] {
  if (intervals.length === 0) return [];

  // Group intervals by local date string (YYYY-MM-DD)
  const dailyGroups = new Map<string, EnergyInterval[]>();

  for (const interval of intervals) {
    const startMs = Date.parse(interval.intervalStart);
    const localDate = localDateOf(startMs, timezone);
    const group = dailyGroups.get(localDate);
    if (group) {
      group.push(interval);
    } else {
      dailyGroups.set(localDate, [interval]);
    }
  }

  const results: EnergySeriesPoint[] = [];

  for (const [localDate, items] of dailyGroups.entries()) {
    const bounds = localDayBounds(localDate, timezone);
    const dayDurationSeconds = (bounds.endMs - bounds.startMs) / 1000;

    let solarGeneratedWh = 0;
    let homeConsumedWh = 0;
    let gridImportWh = 0;
    let gridExportWh = 0;
    let batteryChargedWh = 0;
    let batteryDischargedWh = 0;

    let hasSolar = false;
    let hasHome = false;
    let hasImport = false;
    let hasExport = false;
    let hasCharged = false;
    let hasDischarged = false;

    let coveredSeconds = 0;
    let resMin: number | null = null;
    let resMax: number | null = null;
    let worstQuality: IntervalQuality = 'OK';

    for (const item of items) {
      if (item.solarGeneratedWh !== null) {
        solarGeneratedWh += item.solarGeneratedWh;
        hasSolar = true;
      }
      if (item.homeConsumedWh !== null) {
        homeConsumedWh += item.homeConsumedWh;
        hasHome = true;
      }
      if (item.gridImportWh !== null) {
        gridImportWh += item.gridImportWh;
        hasImport = true;
      }
      if (item.gridExportWh !== null) {
        gridExportWh += item.gridExportWh;
        hasExport = true;
      }
      if (item.batteryChargedWh !== null) {
        batteryChargedWh += item.batteryChargedWh;
        hasCharged = true;
      }
      if (item.batteryDischargedWh !== null) {
        batteryDischargedWh += item.batteryDischargedWh;
        hasDischarged = true;
      }

      coveredSeconds += item.resolutionSeconds;
      if (resMin === null || item.resolutionSeconds < resMin) {
        resMin = item.resolutionSeconds;
      }
      if (resMax === null || item.resolutionSeconds > resMax) {
        resMax = item.resolutionSeconds;
      }

      if (item.quality === 'SUSPECT') {
        worstQuality = 'SUSPECT';
      } else if (item.quality === 'PARTIAL' && worstQuality !== 'SUSPECT') {
        worstQuality = 'PARTIAL';
      } else if (
        item.quality === 'DERIVED' &&
        worstQuality !== 'SUSPECT' &&
        worstQuality !== 'PARTIAL'
      ) {
        worstQuality = 'DERIVED';
      }
    }

    const completeness = Math.min(1, Math.max(0, coveredSeconds / dayDurationSeconds));

    results.push({
      start: formatInstant(bounds.startMs),
      end: formatInstant(bounds.endMs),
      localDate,
      solarGeneratedWh: hasSolar ? Math.round(solarGeneratedWh * 1000) / 1000 : null,
      homeConsumedWh: hasHome ? Math.round(homeConsumedWh * 1000) / 1000 : null,
      gridImportWh: hasImport ? Math.round(gridImportWh * 1000) / 1000 : null,
      gridExportWh: hasExport ? Math.round(gridExportWh * 1000) / 1000 : null,
      batteryChargedWh: hasCharged ? Math.round(batteryChargedWh * 1000) / 1000 : null,
      batteryDischargedWh: hasDischarged ? Math.round(batteryDischargedWh * 1000) / 1000 : null,
      completeness: Math.round(completeness * 10000) / 10000,
      resolutionSecondsMin: resMin,
      resolutionSecondsMax: resMax,
      quality: worstQuality,
    });
  }

  return results.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Recomputes and saves rollups for a site over a given date range.
 * Completely idempotent: rerunning over the same range re-derives identical rollups.
 */
export async function recomputeRollups(
  siteId: string,
  from: string,
  to: string,
  repo: Repository,
): Promise<RollupComputationResult> {
  const site = await repo.getSite(siteId);
  if (!site) {
    throw new Error(`Site ${siteId} not found`);
  }

  const intervals = await repo.queryEnergyIntervals(siteId, from, to);

  const hourlyRollups = computeHourlyRollupsFromIntervals(intervals);
  const dailyRollups = computeDailyRollupsFromIntervals(intervals, site.timezone);

  if (hourlyRollups.length > 0) {
    await repo.saveHourlyRollups(siteId, hourlyRollups);
  }
  if (dailyRollups.length > 0) {
    await repo.saveDailyRollups(siteId, dailyRollups);
  }

  return {
    siteId,
    hourlyRollups,
    dailyRollups,
  };
}
