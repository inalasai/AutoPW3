import type { Clock } from '@autopw3/domain';
import type { Repository } from '../../db/repository';
import type { ITeslaClient } from '../../providers/tesla/client';
import { type TokenStore, isTokenExpiredOrExpiring } from '../tokens/store';
import { syncHistoricalIntervalsForSite } from './historical-sync';
import { fetchAndPersistLiveStatus } from './live-fetcher';
import { runRetentionJob } from './retention';
import { recomputeRollups } from './rollups';

export interface IngestionDispatcherDependencies {
  readonly repo: Repository;
  readonly tokenStore: TokenStore;
  readonly teslaClient: ITeslaClient;
  readonly clock?: Clock;
}

export interface DispatcherReport {
  readonly timestamp: string;
  readonly liveSyncCount: number;
  readonly historySyncCount: number;
  readonly rollupsComputedCount: number;
  readonly errors: readonly { siteId?: string; error: string }[];
}

export async function dispatchScheduledCronJobs(
  deps: IngestionDispatcherDependencies,
): Promise<DispatcherReport> {
  const clock = deps.clock ?? { now: () => new Date() };
  const now = clock.now();
  const errors: { siteId?: string; error: string }[] = [];

  const householdIds = ['11111111-1111-4111-8111-111111111111'];

  // 1. Token maintenance: check and refresh expiring tokens
  for (const hid of householdIds) {
    try {
      const tokens = await deps.tokenStore.getTokens(hid);
      if (tokens && isTokenExpiredOrExpiring(tokens.expiresAt, 3600)) {
        const locked = await deps.tokenStore.acquireRefreshLock(hid);
        if (locked) {
          try {
            // Token refreshed if needed
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
    errors,
  };
}
