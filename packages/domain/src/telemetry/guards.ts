import type { PersistedPowerSample } from '@autopw3/shared';
import { PersistedPowerSampleSchema } from '@autopw3/shared';
import type { LivePowerSample } from './types';

/**
 * The demo/live guard (rule 5, D-017). Demo data is synthetic and can never be written to a live table or
 * counted in live accounting. Two layers, as the architecture requires:
 *
 *  1. Types. `LivePowerSample` has `source: 'TESLA'`, so a `DemoPowerSample` (`source: 'DEMO'`) or the broad
 *     `PowerSample` (`'TESLA' | 'DEMO'`) is a compile error wherever a function asks for live samples.
 *  2. Runtime. Types vanish at a JSON boundary or behind a cast, so `requireLiveSamples` checks every `source` and
 *     throws `DemoDataInLivePathError`. The database CHECK `source = 'TESLA'` is the third and final layer.
 *
 * Every function in the live ingestion and live accounting paths (TASK-11, 16) must accept `LivePowerSample`
 * (or `LiveEnergyInterval`) and begin with `requireLiveSamples` or `assertLiveSource`.
 */

/** Thrown when a non-live sample reaches a live path. The message names the path and carries no sample data. */
export class DemoDataInLivePathError extends Error {
  readonly code = 'DEMO_DATA_IN_LIVE_PATH' as const;
  readonly path: string;

  constructor(path: string) {
    super(`Demo or unlabelled data was passed to a live path: ${path}`);
    this.name = 'DemoDataInLivePathError';
    this.path = path;
  }
}

/** Throws unless `value.source` is exactly `'TESLA'`. A missing or unknown source is refused too. */
export function assertLiveSource(
  value: { readonly source?: unknown },
  path: string,
): asserts value is { readonly source: 'TESLA' } {
  if (value.source !== 'TESLA') throw new DemoDataInLivePathError(path);
}

/** Checks every sample is live and returns the same array. The first non-live sample throws. */
export function requireLiveSamples<T extends { readonly source: 'TESLA' }>(
  samples: readonly T[],
  path: string,
): readonly T[] {
  for (const sample of samples) assertLiveSource(sample, path);
  return samples;
}

/**
 * Gate for live ingestion: returns a sample only if it passes the persisted-sample schema, which accepts
 * `source: 'TESLA'` alone. Throws `DemoDataInLivePathError` for a demo sample and a `ZodError` for any other
 * malformed sample. Ingestion (TASK-16) calls this before any write; the database CHECK is the backstop.
 */
export function acceptForLiveIngestion(
  sample: LivePowerSample,
  path = 'live ingestion',
): PersistedPowerSample {
  assertLiveSource(sample, path);
  return PersistedPowerSampleSchema.parse(sample);
}

/**
 * Gate for live accounting: only live samples go in, and `SUSPECT` samples are left out (ENERGY_ACCOUNTING
 * section 2: stored and shown with a warning, excluded from accounting). Returns the accountable samples and how
 * many were excluded, so callers can lower the completeness they report. Demo samples throw.
 */
export function selectAccountableSamples(
  samples: readonly LivePowerSample[],
  path = 'live accounting',
): { readonly accountable: readonly LivePowerSample[]; readonly excludedSuspect: number } {
  requireLiveSamples(samples, path);
  const accountable = samples.filter((s) => s.quality !== 'SUSPECT');
  return { accountable, excludedSuspect: samples.length - accountable.length };
}
