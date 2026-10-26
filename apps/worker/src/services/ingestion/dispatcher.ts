import type { Clock } from '@autopw3/domain';
import type { Repository } from '../../db/repository';
import type { ITeslaClient } from '../../providers/tesla/client';
import { refreshAccessToken } from '../../providers/tesla/oauth';
import { runAutomationForSite } from '../automation/runner';
import { isTokenExpiredOrExpiring, type TokenStore } from '../tokens/store';
import { syncHistoricalIntervalsForSite } from './historical-sync';
import { fetchAndPersistLiveStatus } from './live-fetcher';
import { runRetentionJob } from './retention';
import { recomputeRollups } from './rollups';

export interface IngestionDispatcherDependencies {
  readonly repo: Repository;
  readonly tokenStore: TokenStore;
  readonly teslaClient: ITeslaClient;
  readonly clock?: Clock | undefined;
  readonly teslaAuth?:
    | {
        readonly clientId: string;
        readonly clientSecret: string;
      }
    | undefined;
  readonly fetcher?: typeof fetch | undefined;
}

export interface DispatcherReport {
  readonly timestamp: string;
  readonly liveSyncCount: number;
  readonly historySyncCount: number;
  readonly rollupsComputedCount: number;
  readonly automationEvaluatedCount: number;
  readonly errors: readonly { siteId?: string; error: string }[];
}

export async function dispatchScheduledCronJobs(
  deps: IngestionDispatcherDependencies,
): Promise<DispatcherReport> {
  const clock = deps.clock ?? { now: () => new Date() };
  const now = clock.now();
  const errors: { siteId?: string; error: string }[] = [];

  const discoveredHouseholds = deps.repo.listAllHouseholdIds
    ? await deps.repo.listAllHouseholdIds()
    : [];
  const householdIds =
    discoveredHouseholds.length > 0
      ? discoveredHouseholds
      : ['11111111-1111-4111-8111-111111111111'];

  // 1. Token maintenance: check and refresh expiring tokens
  for (const hid of householdIds) {
    try {
      const tokens = await deps.tokenStore.getTokens(hid);
      if (tokens && isTokenExpiredOrExpiring(tokens.expiresAt, 3600)) {
        const locked = await deps.tokenStore.acquireRefreshLock(hid);
        if (locked) {
          try {
            if (deps.teslaAuth && tokens.refreshToken) {
              const refreshed = await refreshAccessToken(
                {
                  clientId: deps.teslaAuth.clientId,
                  clientSecret: deps.teslaAuth.clientSecret,
                  refreshToken: tokens.refreshToken,
                },
                deps.fetcher,
              );
              const newExpiresAt = Math.floor(Date.now() / 1000) + (refreshed.expires_in || 28800);
              await deps.tokenStore.saveTokens(hid, {
                accessToken: refreshed.access_token,
                refreshToken: refreshed.refresh_token,
                expiresAt: newExpiresAt,
                tokenType: refreshed.token_type,
                scope: refreshed.scope,
                regionBaseUrl: tokens.regionBaseUrl,
              });
              await deps.repo.setTeslaLink(hid, {
                state: 'ACTIVE',
                scopes: refreshed.scope.split(' ').filter(Boolean),
                lastRefreshAt: new Date(now).toISOString(),
              });
            }
          } catch (refreshErr) {
            await deps.repo.setTeslaLink(hid, {
              state: 'NEEDS_REAUTH',
              scopes: tokens.scope.split(' ').filter(Boolean),
              lastRefreshAt: new Date(now).toISOString(),
            });
            errors.push({
              error: `Token refresh failed for ${hid}: ${refreshErr instanceof Error ? refreshErr.message : String(refreshErr)}`,
            });
          } finally {
            await deps.tokenStore.releaseRefreshLock(hid);
          }
        }
      }
    } catch (err: unknown) {
      errors.push({
        error: `Token maintenance failed for ${hid}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // 2. Discover sites to sync (DEMO sites excluded, real TESLA sites only)
  // For in-memory repository or multi-household, list sites per household
  const sitesToSync: string[] = [];

  for (const hid of householdIds) {
    try {
      const sitesPage = await deps.repo.listSites(hid, 100);
      for (const site of sitesPage.items) {
        if (site.provider === 'TESLA') {
          sitesToSync.push(site.id);
        }
      }
    } catch (err: unknown) {
      errors.push({
        error: `Failed listing sites for household ${hid}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  let liveSyncCount = 0;
  let historySyncCount = 0;
  let rollupsComputedCount = 0;
  let automationEvaluatedCount = 0;

  // 3. Process each site with strict failure isolation
  for (const siteId of sitesToSync) {
    // 3a. Live fetch
    try {
      const liveRes = await fetchAndPersistLiveStatus(siteId, {
        repo: deps.repo,
        tokenStore: deps.tokenStore,
        teslaClient: deps.teslaClient,
        clock,
      });
      if (liveRes.success) {
        liveSyncCount++;
      } else if (liveRes.error) {
        errors.push({ siteId, error: liveRes.error });
      }
    } catch (err: unknown) {
      errors.push({
        siteId,
        error: `Live fetch threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 3b. Historical sync
    try {
      const histRes = await syncHistoricalIntervalsForSite(siteId, {
        repo: deps.repo,
        tokenStore: deps.tokenStore,
        teslaClient: deps.teslaClient,
        clock,
      });
      if (histRes.success && histRes.intervalsSynced > 0) {
        historySyncCount++;

        // 3c. Recompute rollups for recently touched range
        const fromUtc = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const toUtc = now.toISOString();
        await recomputeRollups(siteId, fromUtc, toUtc, deps.repo);
        rollupsComputedCount++;
      } else if (histRes.status === 'FAILED' && histRes.error) {
        errors.push({ siteId, error: histRes.error });
      }
    } catch (err: unknown) {
      errors.push({
        siteId,
        error: `History sync threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 3d. Tariff-aware automation rule evaluation and execution
    try {
      const autoRes = await runAutomationForSite(siteId, now, {
        repo: deps.repo,
        teslaClient: deps.teslaClient,
        tokenStore: deps.tokenStore,
        clock,
      });
      automationEvaluatedCount += autoRes.evaluatedCount;
      for (const err of autoRes.errors) {
        errors.push({ siteId, error: err });
      }
    } catch (err: unknown) {
      errors.push({
        siteId,
        error: `Automation run threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // 4. Daily retention cleanup (runs once a day or on schedule)
  try {
    await runRetentionJob(deps.repo, { dryRun: false, now });
  } catch (err: unknown) {
    errors.push({
      error: `Retention job threw: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return {
    timestamp: now.toISOString(),
    liveSyncCount,
    historySyncCount,
    rollupsComputedCount,
    automationEvaluatedCount,
    errors,
  };
}
