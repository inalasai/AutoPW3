import { normaliseEnergyInterval } from '@autopw3/domain';
import type { Clock } from '@autopw3/domain';
import type { EnergyInterval } from '@autopw3/shared';
import type { Repository } from '../../db/repository';
import type { ITeslaClient } from '../../providers/tesla/client';
import { TeslaAuthError, TeslaRateLimitError } from '../../providers/tesla/client';
import type { TokenStore } from '../tokens/store';
import type { HistoricalSyncResult } from './types';

export interface HistoricalSyncDependencies {
  readonly repo: Repository;
  readonly tokenStore: TokenStore;
  readonly teslaClient: ITeslaClient;
  readonly clock?: Clock;
  readonly batchDays?: number;
}

export async function syncHistoricalIntervalsForSite(
  siteId: string,
  deps: HistoricalSyncDependencies,
): Promise<HistoricalSyncResult> {
  const clock = deps.clock ?? { now: () => new Date() };
  const now = clock.now();
  const nowUtc = now.toISOString();
  const batchDays = deps.batchDays ?? 7;

  const site = await deps.repo.getSite(siteId);
  if (!site) {
    return {
      siteId,
      success: false,
      intervalsSynced: 0,
      cursorAdvancedTo: null,
      status: 'FAILED',
      error: 'Site not found',
    };
  }

  const householdId = await deps.repo.getHouseholdIdForSite(siteId);
  if (!householdId) {
    return {
      siteId,
      success: false,
      intervalsSynced: 0,
      cursorAdvancedTo: null,
      status: 'FAILED',
      error: 'Site has no associated household',
    };
  }

  const tokens = await deps.tokenStore.getTokens(householdId);
  if (!tokens) {
    await deps.repo.updateSyncState(siteId, 'HISTORY', {
      lastAttemptAt: nowUtc,
      lastStatus: 'FAILED',
      lastErrorCode: 'MISSING_OR_INACTIVE_CREDENTIALS',
      consecutiveFailures: 1,
    });
    return {
      siteId,
      success: false,
      intervalsSynced: 0,
      cursorAdvancedTo: null,
      status: 'FAILED',
      error: 'Active Tesla credentials not found',
    };
  }

  const syncState = await deps.repo.getSyncState(siteId, 'HISTORY');
  let fromInstant: Date;

  if (syncState?.cursor?.lastCompletedIntervalEnd) {
    fromInstant = new Date(syncState.cursor.lastCompletedIntervalEnd);
  } else {
    // Default initial backfill: up to batchDays in the past
    fromInstant = new Date(now.getTime() - batchDays * 24 * 60 * 60 * 1000);
  }

  const toInstant = new Date(
    Math.min(fromInstant.getTime() + batchDays * 24 * 60 * 60 * 1000, now.getTime()),
  );

  if (toInstant.getTime() <= fromInstant.getTime()) {
    return {
      siteId,
      success: true,
      intervalsSynced: 0,
      cursorAdvancedTo: fromInstant.toISOString(),
      status: 'SKIPPED',
    };
  }

  const fromStr = fromInstant.toISOString();
  const toStr = toInstant.toISOString();
  const providerSiteId = (await deps.repo.getProviderSiteId(siteId)) ?? site.id;

  try {
    const rawHistory = await deps.teslaClient.getCalendarHistory(
      tokens.regionBaseUrl,
      providerSiteId,
      tokens.accessToken,
      {
        startDate: fromStr.substring(0, 10),
        endDate: toStr.substring(0, 10),
        period: 'day',
      },
    );

    await deps.repo.recordProviderUsage(householdId, 'DATA', true);

    const timeSeries = Array.isArray((rawHistory as Record<string, unknown>)['time_series'])
      ? ((rawHistory as Record<string, unknown>)['time_series'] as Record<string, unknown>[])
      : [];

    const validIntervals: EnergyInterval[] = [];
    for (const entry of timeSeries) {
      const timestamp = String(entry['timestamp'] ?? fromStr);
      const startMs = Date.parse(timestamp);
      const endMs = startMs + 86400 * 1000;
      const solarGen = entry['solar_energy_exported'] ?? entry['solar_generated_wh'] ?? null;
      const gridImp = entry['grid_energy_imported'] ?? entry['grid_import_wh'] ?? null;
      const batteryDis = entry['battery_energy_exported'] ?? entry['battery_discharged_wh'] ?? null;

      const consumerGrid = (entry['consumer_energy_imported_from_grid'] as number) || 0;
      const consumerSolar = (entry['consumer_energy_imported_from_solar'] as number) || 0;
      const consumerBatt = (entry['consumer_energy_imported_from_battery'] as number) || 0;
      const homeSum = consumerGrid + consumerSolar + consumerBatt;
      const homeConsumedWh = entry['home_consumed_wh'] ?? (homeSum > 0 ? homeSum : null);

      const expSolar = (entry['grid_energy_exported_from_solar'] as number) || 0;
      const expBatt = (entry['grid_energy_exported_from_battery'] as number) || 0;
      const expSum = expSolar + expBatt;
      const gridExportWh = entry['grid_export_wh'] ?? (expSum > 0 ? expSum : null);

      const chgSolar = (entry['battery_energy_imported_from_solar'] as number) || 0;
      const chgGrid = (entry['battery_energy_imported_from_grid'] as number) || 0;
      const chgSum = chgSolar + chgGrid;
      const batteryChargedWh = entry['battery_charged_wh'] ?? (chgSum > 0 ? chgSum : null);

      const rawInterval = {
        intervalStart: timestamp,
        intervalEnd: new Date(endMs).toISOString(),
        solarGeneratedWh: solarGen as unknown,
        homeConsumedWh: homeConsumedWh as unknown,
        gridImportWh: gridImp as unknown,
        gridExportWh: gridExportWh as unknown,
        batteryChargedWh: batteryChargedWh as unknown,
        batteryDischargedWh: batteryDis as unknown,
      };

      const normalised = normaliseEnergyInterval(rawInterval, { source: 'TESLA' });
      if (normalised.interval) {
        validIntervals.push(normalised.interval as EnergyInterval);
      }
    }

    if (validIntervals.length > 0) {
      await deps.repo.recordEnergyIntervals(siteId, validIntervals);
    }

    await deps.repo.updateSyncState(siteId, 'HISTORY', {
      lastAttemptAt: nowUtc,
      lastSuccessAt: nowUtc,
      lastStatus: 'SUCCESS',
      lastErrorCode: null,
      cursor: { lastCompletedIntervalEnd: toStr },
      consecutiveFailures: 0,
    });

    return {
      siteId,
      success: true,
      intervalsSynced: validIntervals.length,
      cursorAdvancedTo: toStr,
      status: 'SUCCESS',
    };
  } catch (err: unknown) {
    await deps.repo.recordProviderUsage(householdId, 'DATA', false);

    const existingSync = await deps.repo.getSyncState(siteId, 'HISTORY');
    const failures = (existingSync?.consecutiveFailures ?? 0) + 1;

    let errorCode = 'API_ERROR';
    if (err instanceof TeslaRateLimitError) {
      errorCode = 'RATE_LIMITED';
    } else if (err instanceof TeslaAuthError) {
      errorCode = 'UNAUTHORIZED';
    }

    await deps.repo.updateSyncState(siteId, 'HISTORY', {
      lastAttemptAt: nowUtc,
      lastStatus: 'FAILED',
      lastErrorCode: errorCode,
      consecutiveFailures: failures,
    });

    return {
      siteId,
      success: false,
      intervalsSynced: 0,
      cursorAdvancedTo: null,
      status: 'FAILED',
      error: err instanceof Error ? err.message : 'Unknown historical sync error',
    };
  }
}

/**
 * Runs historical sync for a batch of sites with strict failure isolation:
 * failure on one site does not abort syncing the remaining sites.
 */
export async function syncHistoricalIntervalsBatch(
  siteIds: readonly string[],
  deps: HistoricalSyncDependencies,
): Promise<readonly HistoricalSyncResult[]> {
  const results: HistoricalSyncResult[] = [];
  for (const siteId of siteIds) {
    try {
      const res = await syncHistoricalIntervalsForSite(siteId, deps);
      results.push(res);
    } catch (err: unknown) {
      results.push({
        siteId,
        success: false,
        intervalsSynced: 0,
        cursorAdvancedTo: null,
        status: 'FAILED',
        error: err instanceof Error ? err.message : 'Uncaught error in site sync',
      });
    }
  }
  return results;
}
