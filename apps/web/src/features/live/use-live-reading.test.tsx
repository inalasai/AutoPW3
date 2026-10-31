import { act, renderHook, waitFor } from '@testing-library/react';
import { FixedClock, TelemetryProviderError, createDemoTelemetryProvider } from '@autopw3/domain';
import type { LiveSnapshotResult } from '@autopw3/domain';
import type { DataSource } from '@autopw3/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveProvider } from './create-provider';
import { describeProviderError, useLiveReading } from './use-live-reading';

/*
  These tests use real timers with short intervals instead of fake timers: React's async `act` and fake timers
  do not mix reliably, and the behaviour under test (one request at a time, rescheduling after completion,
  pausing when hidden, cleaning up) does not depend on the length of the interval.
*/

const NOW = new Date('2026-06-21T12:00:00Z');
const INTERVAL_MS = 60;
const OPTIONS = { siteId: 'demo-site', pollIntervalMs: INTERVAL_MS };

function snapshot(scenario: 'SOLAR_SURPLUS' | 'LOW_BATTERY') {
  return createDemoTelemetryProvider({ clock: new FixedClock(NOW), scenario }).getLiveSnapshot({
    siteId: 'demo-site',
  });
}

/** One provider object per function: a new object each render would restart the hook's effect on every render. */
const providers = new WeakMap<object, LiveProvider>();
function providerOf(getLiveSnapshot: LiveProvider['getLiveSnapshot']): LiveProvider {
  const known = providers.get(getLiveSnapshot);
  if (known !== undefined) return known;
  const created = { getLiveSnapshot } as unknown as LiveProvider;
  providers.set(getLiveSnapshot, created);
  return created;
}

const sleep = (ms: number): Promise<void> =>
  act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  });

let visibility: 'visible' | 'hidden';

function setVisibility(value: 'visible' | 'hidden'): void {
  visibility = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

describe('useLiveReading', () => {
  it('starts loading, then holds the first reading', async () => {
    const getLiveSnapshot = vi.fn(() => snapshot('SOLAR_SURPLUS'));
    const { result } = renderHook(() => useLiveReading(providerOf(getLiveSnapshot), OPTIONS));
    expect(result.current.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.result?.source).toBe('DEMO');
    expect(result.current.error).toBeNull();
    expect(getLiveSnapshot).toHaveBeenCalledWith({ siteId: 'demo-site' });
  });

  it('asks again after the interval, and not before', async () => {
    const getLiveSnapshot = vi.fn(() => snapshot('SOLAR_SURPLUS'));
    const slow = { siteId: 'demo-site', pollIntervalMs: 400 };
    renderHook(() => useLiveReading(providerOf(getLiveSnapshot), slow));
    await waitFor(() => {
      expect(getLiveSnapshot).toHaveBeenCalledTimes(1);
    });
    await sleep(150);
    expect(getLiveSnapshot).toHaveBeenCalledTimes(1);
    await waitFor(
      () => {
        expect(getLiveSnapshot).toHaveBeenCalledTimes(2);
      },
      { timeout: 1500 },
    );
  });

  it('never has two requests in flight: the next is scheduled after the last one finishes', async () => {
    const pending: Array<(value: LiveSnapshotResult<DataSource>) => void> = [];
    const getLiveSnapshot = vi.fn(
      () =>
        new Promise<LiveSnapshotResult<DataSource>>((resolve) => {
          pending.push(resolve);
        }),
    );
    renderHook(() => useLiveReading(providerOf(getLiveSnapshot), OPTIONS));
    await sleep(INTERVAL_MS * 5);
    expect(getLiveSnapshot).toHaveBeenCalledTimes(1);
    const reading = await snapshot('SOLAR_SURPLUS');
    await act(async () => {
      pending[0]?.(reading);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(getLiveSnapshot).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps the last good reading and says why when a refresh fails', async () => {
    const getLiveSnapshot = vi
      .fn<LiveProvider['getLiveSnapshot']>()
      .mockImplementationOnce(() => snapshot('SOLAR_SURPLUS'))
      .mockRejectedValueOnce(new TelemetryProviderError('UNAVAILABLE', 'secret detail'))
      .mockImplementation(() => snapshot('LOW_BATTERY'));
    const { result } = renderHook(() => useLiveReading(providerOf(getLiveSnapshot), OPTIONS));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    const first = result.current.result;
    expect(first).not.toBeNull();
    await waitFor(() => {
      expect(result.current.status).toBe('error');
      expect(result.current.result).toBe(first);
      expect(result.current.error).toMatch(/last reading is kept/);
      expect(result.current.error).not.toContain('secret');
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.error).toBeNull();
    expect(result.current.result).not.toBe(first);
  });

  it('makes no request while the tab is hidden, and refreshes when it is shown again', async () => {
    visibility = 'hidden';
    const getLiveSnapshot = vi.fn(() => snapshot('SOLAR_SURPLUS'));
    renderHook(() => useLiveReading(providerOf(getLiveSnapshot), OPTIONS));
    await sleep(INTERVAL_MS * 5);
    expect(getLiveSnapshot).not.toHaveBeenCalled();
    act(() => {
      setVisibility('visible');
    });
    await waitFor(() => {
      expect(getLiveSnapshot).toHaveBeenCalled();
    });
  });

  it('does not refresh again at once when the tab is shown right after a request', async () => {
    const getLiveSnapshot = vi.fn(() => snapshot('SOLAR_SURPLUS'));
    const slow = { siteId: 'demo-site', pollIntervalMs: 5000 };
    renderHook(() => useLiveReading(providerOf(getLiveSnapshot), slow));
    await waitFor(() => {
      expect(getLiveSnapshot).toHaveBeenCalledTimes(1);
    });
    act(() => {
      setVisibility('hidden');
      setVisibility('visible');
    });
    await sleep(50);
    expect(getLiveSnapshot).toHaveBeenCalledTimes(1);
  });

  it('removes its timer and listener on unmount and ignores a late answer', async () => {
    let resolveLate: ((value: LiveSnapshotResult<DataSource>) => void) | undefined;
    const getLiveSnapshot = vi.fn(
      () =>
        new Promise<LiveSnapshotResult<DataSource>>((resolve) => {
          resolveLate = resolve;
        }),
    );
    const { result, unmount } = renderHook(() =>
      useLiveReading(providerOf(getLiveSnapshot), OPTIONS),
    );
    await waitFor(() => {
      expect(getLiveSnapshot).toHaveBeenCalledTimes(1);
    });
    unmount();
    const reading = await snapshot('SOLAR_SURPLUS');
    resolveLate?.(reading);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, INTERVAL_MS * 4);
    });
    // The late answer changed nothing and no further request was made.
    expect(result.current.status).toBe('loading');
    expect(getLiveSnapshot).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    setVisibility('visible');
    expect(getLiveSnapshot).toHaveBeenCalledTimes(1);
  });

  it('makes no request without a provider', async () => {
    const { result } = renderHook(() => useLiveReading(null, OPTIONS));
    await sleep(INTERVAL_MS * 3);
    expect(result.current).toEqual({ status: 'loading', result: null, error: null });
  });

  it('starts over when the provider changes, and stops asking the old one', async () => {
    const first = vi.fn(() => snapshot('SOLAR_SURPLUS'));
    const second = vi.fn(() => snapshot('LOW_BATTERY'));
    const { result, rerender } = renderHook(
      ({ provider }: { provider: LiveProvider }) => useLiveReading(provider, OPTIONS),
      { initialProps: { provider: providerOf(first) } },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    const calls = first.mock.calls.length;
    rerender({ provider: providerOf(second) });
    expect(result.current.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    await sleep(INTERVAL_MS * 3);
    expect(first.mock.calls.length).toBe(calls);
    expect(second.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('describeProviderError', () => {
  it('turns a provider failure into a safe sentence, never the provider message', () => {
    for (const code of ['RATE_LIMITED', 'BUDGET_EXHAUSTED'] as const) {
      expect(describeProviderError(new TelemetryProviderError(code, 'internal text'))).toMatch(
        /limiting requests/,
      );
    }
    expect(describeProviderError(new TelemetryProviderError('NOT_AUTHORISED', 'x'))).toMatch(
      /not allowed/,
    );
    expect(describeProviderError(new TelemetryProviderError('OUT_OF_COVERAGE', 'x'))).toMatch(
      /does not cover/,
    );
    expect(describeProviderError(new Error('boom: token abc'))).not.toContain('abc');
    expect(describeProviderError('anything')).toMatch(/did not answer/);
  });
});
