import { useEffect, useState } from 'react';
import { TelemetryProviderError } from '@autopw3/domain';
import type { LiveSnapshotResult } from '@autopw3/domain';
import type { DataSource } from '@autopw3/shared';
import type { LiveProvider } from './create-provider';

export type LiveReadingStatus = 'loading' | 'ready' | 'error';

export interface LiveReadingState {
  readonly status: LiveReadingStatus;
  /** The last reading that arrived. Kept after a failed refresh, so the page can say it is old. */
  readonly result: LiveSnapshotResult<DataSource> | null;
  /** A short, safe sentence about the last failure, or `null`. */
  readonly error: string | null;
}

const LOADING: LiveReadingState = { status: 'loading', result: null, error: null };

/** A sentence for the person, from a provider failure. Provider messages and payloads are never shown. */
export function describeProviderError(error: unknown): string {
  if (error instanceof TelemetryProviderError) {
    switch (error.code) {
      case 'RATE_LIMITED':
      case 'BUDGET_EXHAUSTED':
        return 'The data source is limiting requests. The last reading is kept and the page will try again.';
      case 'NOT_AUTHORISED':
        return 'You are not allowed to read this site. Sign in again or ask an admin.';
      case 'OUT_OF_COVERAGE':
        return 'The demo data does not cover this moment.';
      default:
        return 'The data source did not answer. The last reading is kept and the page will try again.';
    }
  }
  return 'The data source did not answer. The last reading is kept and the page will try again.';
}

export interface UseLiveReadingOptions {
  readonly siteId: string;
  /** Time between requests, in milliseconds. */
  readonly pollIntervalMs: number;
}

/**
 * Poll a provider for the latest reading. One request at a time; the next is scheduled only after the last one
 * finishes. Nothing is requested while the tab is hidden (live data costs money, D-023), and a request is made
 * as soon as the tab is shown again. On unmount, or when the provider changes, timers and listeners are removed
 * and a late answer is ignored. A failed refresh keeps the last good reading.
 *
 * `provider` must be a stable object (memoised, not created in render): a new one starts the polling over.
 */
export function useLiveReading(
  provider: LiveProvider | null,
  { siteId, pollIntervalMs }: UseLiveReadingOptions,
): LiveReadingState {
  const [state, setState] = useState<LiveReadingState>(LOADING);

  useEffect(() => {
    setState(LOADING);
    if (provider === null) return undefined;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let lastRequestMs = Number.NEGATIVE_INFINITY;

    const schedule = (): void => {
      if (cancelled) return;
      timer = setTimeout(() => {
        void poll();
      }, pollIntervalMs);
    };

    const poll = async (): Promise<void> => {
      timer = undefined;
      if (cancelled || inFlight) return;
      if (document.visibilityState === 'hidden') {
        // Skip the request, keep the schedule; the visibility handler refreshes when the tab returns.
        schedule();
        return;
      }
      inFlight = true;
      lastRequestMs = Date.now();
      try {
        const result = await provider.getLiveSnapshot({ siteId });
        if (!cancelled) setState({ status: 'ready', result, error: null });
      } catch (error) {
        if (!cancelled) {
          setState((previous) => ({
            status: 'error',
            result: previous.result,
            error: describeProviderError(error),
          }));
        }
      } finally {
        inFlight = false;
        schedule();
      }
    };

    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible' || cancelled || inFlight) return;
      if (Date.now() - lastRequestMs < pollIntervalMs) return;
      if (timer !== undefined) clearTimeout(timer);
      void poll();
    };

    document.addEventListener('visibilitychange', onVisibility);
    void poll();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [provider, siteId, pollIntervalMs]);

  return state;
}
