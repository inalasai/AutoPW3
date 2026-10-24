import { createDemoTelemetryProvider } from '@autopw3/domain';
import type { Clock, DemoScenarioId, TelemetryProvider } from '@autopw3/domain';
import type { DataSource } from '@autopw3/shared';
import type { TelemetryConfig } from '../../lib/config';

/** Any provider the Live View can read from: the demo one now, the live one later. */
export type LiveProvider = TelemetryProvider<DataSource>;

/**
 * What configuration chose:
 *  - `provider`: read from it.
 *  - `no-live-provider`: live data was asked for but the live provider does not exist yet (Tesla adapter TASK-15,
 *    ingestion TASK-16). The Live View says so. It never substitutes demo data.
 *  - `invalid`: the setting is unusable.
 */
export type ProviderChoice =
  | { readonly kind: 'provider'; readonly provider: LiveProvider }
  | { readonly kind: 'no-live-provider' }
  | { readonly kind: 'invalid'; readonly reason: string };

/**
 * Pick the telemetry provider from configuration. This is the one place that maps the setting to a provider; when
 * the live provider exists (a Worker-backed client in TASK-14 to 16) it is added here and nothing else changes.
 * `scenario` only applies to the demo provider, to show one fixed situation instead of the time-of-day model.
 */
export function chooseProvider(
  config: TelemetryConfig,
  clock: Clock,
  scenario?: DemoScenarioId,
): ProviderChoice {
  switch (config.kind) {
    case 'demo':
      return {
        kind: 'provider',
        provider: createDemoTelemetryProvider({
          clock,
          ...(scenario !== undefined ? { scenario } : {}),
        }),
      };
    case 'live':
      return { kind: 'no-live-provider' };
    case 'invalid':
      return { kind: 'invalid', reason: config.reason };
  }
}
