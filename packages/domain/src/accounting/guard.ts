import type { DataSource } from '@autopw3/shared';
import { DemoDataInLivePathError } from '../telemetry/guards';
import type { EnergyIntervalOf, LiveEnergyInterval } from '../telemetry/types';
import type { AccountingContext } from './types';

/**
 * Demo / Live guard for accounting (rule 5, D-017, TASK-11).
 *
 * Demo data is synthetic and must NEVER reach live accounting without explicit labelling.
 * When the accounting context is 'LIVE':
 *  - Every interval must have `source: 'TESLA'`. Any other source throws `DemoDataInLivePathError`.
 *  - Intervals with `quality: 'SUSPECT'` are excluded from accounting totals, but tracked
 *    against data completeness.
 */

/** Checks that every interval in the list is a live interval. */
export function requireLiveIntervals(
  intervals: readonly EnergyIntervalOf<DataSource>[],
  path = 'live accounting',
): readonly LiveEnergyInterval[] {
  for (const interval of intervals) {
    if (interval.source !== 'TESLA') {
      throw new DemoDataInLivePathError(`${path} (observed source: ${String(interval.source)})`);
    }
  }
  return intervals as readonly LiveEnergyInterval[];
}

export interface FilterAccountableResult<T extends EnergyIntervalOf<DataSource>> {
  readonly accountable: readonly T[];
  readonly excludedSuspectCount: number;
}

/**
 * Filter intervals for accounting:
 * 1. Validates source compatibility with the context.
 *    - In 'LIVE' context, throws `DemoDataInLivePathError` if any interval is not 'TESLA'.
 *    - In 'DEMO' context, throws `Error` if non-demo data is passed without intention.
 * 2. Excludes intervals with quality `SUSPECT` from accounting.
 */
export function filterAccountableIntervals<S extends DataSource>(
  intervals: readonly EnergyIntervalOf<S>[],
  context: AccountingContext = 'LIVE',
  path = 'accounting',
): FilterAccountableResult<EnergyIntervalOf<S>> {
  if (context === 'LIVE') {
    requireLiveIntervals(intervals, path);
  } else if (context === 'DEMO') {
    for (const interval of intervals) {
      if (interval.source !== 'DEMO') {
        throw new Error(
          `Demo accounting received non-demo interval with source: ${String(interval.source)}`,
        );
      }
    }
  }

  const accountable: EnergyIntervalOf<S>[] = [];
  let excludedSuspectCount = 0;

  for (const interval of intervals) {
    if (interval.quality === 'SUSPECT') {
      excludedSuspectCount += 1;
    } else {
      accountable.push(interval);
    }
  }

  return {
    accountable,
    excludedSuspectCount,
  };
}
