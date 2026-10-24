import { act, renderHook } from '@testing-library/react';
import { FixedClock } from '@autopw3/domain';
import type { Clock } from '@autopw3/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useClockTick, useThrottledText } from './use-time';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-06-21T12:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useClockTick', () => {
  it('follows the clock once per interval', () => {
    let current = new Date('2026-06-21T12:00:00Z');
    const clock: Clock = { now: () => current };
    const { result } = renderHook(() => useClockTick(clock, 1000));
    expect(result.current.toISOString()).toBe('2026-06-21T12:00:00.000Z');
    current = new Date('2026-06-21T12:00:05Z');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.toISOString()).toBe('2026-06-21T12:00:05.000Z');
  });

  it('does not tick while the tab is hidden and clears its timer on unmount', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    let current = new Date('2026-06-21T12:00:00Z');
    const clock: Clock = { now: () => current };
    const { result, unmount } = renderHook(() => useClockTick(clock, 1000));
    current = new Date('2026-06-21T12:10:00Z');
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.toISOString()).toBe('2026-06-21T12:00:00.000Z');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not render in a loop when the clock returns a new Date object every call', () => {
    let renders = 0;
    const clock = new FixedClock(new Date(0));
    renderHook(() => {
      renders += 1;
      return useClockTick(clock, 1000);
    });
    expect(renders).toBeLessThan(5);
  });
});

describe('useThrottledText', () => {
  it('shows the first change at once and later changes at most once per interval', () => {
    const { result, rerender } = renderHook(({ text }) => useThrottledText(text, 10_000), {
      initialProps: { text: 'No data' },
    });
    expect(result.current).toBe('No data');
    rerender({ text: 'First reading' });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe('First reading');
    rerender({ text: 'Second' });
    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    expect(result.current).toBe('First reading');
    rerender({ text: 'Third' });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    // The newest text wins when the interval has passed; the one in between is never announced.
    expect(result.current).toBe('Third');
  });

  it('passes text straight through with a zero interval', () => {
    const { result, rerender } = renderHook(({ text }) => useThrottledText(text, 0), {
      initialProps: { text: 'a' },
    });
    rerender({ text: 'b' });
    expect(result.current).toBe('b');
  });

  it('clears its timer on unmount', () => {
    const { rerender, unmount } = renderHook(({ text }) => useThrottledText(text, 10_000), {
      initialProps: { text: 'a' },
    });
    rerender({ text: 'b' });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    rerender({ text: 'c' });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
