import { DEFAULT_STALE_AFTER_SECONDS, freshnessOf } from '@autopw3/domain';
import type { Clock } from '@autopw3/domain';
import type { Repository } from '../../db/repository';
import type { ITeslaClient } from '../../providers/tesla/client';
import { TeslaAuthError, TeslaRateLimitError } from '../../providers/tesla/client';
import type { TokenStore } from '../tokens/store';
import type { LiveFetchResult } from './types';

export interface LiveFetcherDependencies {
  readonly repo: Repository;
  readonly tokenStore: TokenStore;
  readonly teslaClient: ITeslaClient;
  readonly clock?: Clock;
  readonly staleAfterSeconds?: number;
}

export async function fetchAndPersistLiveStatus(
  siteId: string,
  deps: LiveFetcherDependencies,
): Promise<LiveFetchResult> {
  const clock = deps.clock ?? { now: () => new Date() };
  const staleThreshold = deps.staleAfterSeconds ?? DEFAULT_STALE_AFTER_SECONDS;
  const nowUtc = clock.now().toISOString();

  const site = await deps.repo.getSite(siteId);
  if (!site) {
    return { success: false, error: 'Site not found' };
  }

  const householdId = await deps.repo.getHouseholdIdForSite(siteId);
  if (!householdId) {
    return { success: false, error: 'Site has no associated household' };
  }

  const tokens = await deps.tokenStore.getTokens(householdId);
  if (!tokens) {
    await deps.repo.updateSiteConnectionState(siteId, 'ERROR');
    await deps.repo.updateSyncState(siteId, 'LIVE', {
      lastAttemptAt: nowUtc,
      lastStatus: 'FAILED',
      lastErrorCode: 'MISSING_OR_INACTIVE_CREDENTIALS',
      consecutiveFailures: 1,
    });
    return { success: false, error: 'Tesla credentials not active or not found' };
  }

  const providerSiteId = (await deps.repo.getProviderSiteId(siteId)) ?? site.id;

  const todayStr = nowUtc.substring(0, 10);

  try {
    const rawReading = await deps.teslaClient.getLiveStatus(
      tokens.regionBaseUrl,
      providerSiteId,
      tokens.accessToken,
    );

    await deps.repo.recordProviderUsage(householdId, 'DATA', true, todayStr);

    const sample = deps.teslaClient.normaliseLiveStatus(rawReading, nowUtc);
    await deps.repo.recordPowerSample(siteId, sample);

    const freshnessResult = freshnessOf(sample.sampledAt, clock.now(), {
      staleAfterSeconds: staleThreshold,
    });

    const targetConnectionState = freshnessResult.freshness === 'FRESH' ? 'LIVE' : 'STALE';
    await deps.repo.updateSiteConnectionState(siteId, targetConnectionState);

    await deps.repo.updateSyncState(siteId, 'LIVE', {
      lastAttemptAt: nowUtc,
      lastSuccessAt: nowUtc,
      lastStatus: 'SUCCESS',
      lastErrorCode: null,
      latestSampleAt: sample.sampledAt,
      consecutiveFailures: 0,
    });

    return {
      success: true,
      sample,
      quality: sample.quality,
      freshness: freshnessResult.freshness,
    };
  } catch (err: unknown) {
    await deps.repo.recordProviderUsage(householdId, 'DATA', false, todayStr);

    const existingSync = await deps.repo.getSyncState(siteId, 'LIVE');
    const failures = (existingSync?.consecutiveFailures ?? 0) + 1;

    let errorCode = 'API_ERROR';
    if (err instanceof TeslaRateLimitError) {
      errorCode = 'RATE_LIMITED';
    } else if (err instanceof TeslaAuthError) {
      errorCode = 'UNAUTHORIZED';
    }

    await deps.repo.updateSyncState(siteId, 'LIVE', {
      lastAttemptAt: nowUtc,
      lastStatus: 'FAILED',
      lastErrorCode: errorCode,
      consecutiveFailures: failures,
    });

    if (failures >= 3 || errorCode === 'UNAUTHORIZED') {
      await deps.repo.updateSiteConnectionState(siteId, 'ERROR');
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown live fetch error',
    };
  }
}
