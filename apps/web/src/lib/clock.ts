import type { Clock } from '@autopw3/domain';

/**
 * The browser's clock. Domain code never reads time itself; it is handed a `Clock`. The app passes this one and
 * tests pass a `FixedClock`.
 */
export const systemClock: Clock = {
  now: () => new Date(),
};
