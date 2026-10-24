import { useEffect, useRef, useState } from 'react';
import type { Clock } from '@autopw3/domain';

/**
 * The current time from an injected clock, refreshed every `intervalMs` while the tab is visible. It drives the
 * "updated 12 s ago" text and the stale check. A hidden tab does not tick, and refreshes as soon as it is shown.
 */
export function useClockTick(clock: Clock, intervalMs: number): Date {
  const [now, setNow] = useState<Date>(() => clock.now());

  useEffect(() => {
    // Keep the old object when the time has not changed, so a clock that returns a new Date each call cannot
    // cause a render loop.
    const refresh = (): void => {
      const next = clock.now();
      setNow((previous) => (previous.getTime() === next.getTime() ? previous : next));
    };
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, intervalMs);
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [clock, intervalMs]);

  return now;
}

/**
 * Text that changes at most once per `intervalMs`, so a screen-reader live region does not announce every poll.
 * The first change after mount is immediate (the first reading is announced at once). With `intervalMs` of 0 or
 * less the text passes straight through.
 */
export function useThrottledText(text: string, intervalMs: number): string {
  const [shown, setShown] = useState(text);
  const lastChangeMs = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    if (intervalMs <= 0 || text === shown) return undefined;
    const wait = Math.max(0, lastChangeMs.current + intervalMs - Date.now());
    const timer = setTimeout(() => {
      lastChangeMs.current = Date.now();
      setShown(text);
    }, wait);
    return () => {
      clearTimeout(timer);
    };
  }, [text, shown, intervalMs]);

  return intervalMs <= 0 ? text : shown;
}
