import { useMemo, useState } from 'react';
import { DEMO_SCENARIOS, DEMO_SCENARIO_IDS, freshnessOf } from '@autopw3/domain';
import type { Clock, DemoScenarioId } from '@autopw3/domain';
import { GlassCard } from '../../components/ui/display';
import { EmptyState, ErrorBanner } from '../../components/ui/feedback';
import { SelectField } from '../../components/ui/fields';
import { PulseIcon } from '../../components/ui/icons';
import type { TelemetryConfig } from '../../lib/config';
import { BatteryGauge } from './BatteryGauge';
import { FlowCanvas } from './FlowCanvas';
import { FlowReadouts } from './FlowReadouts';
import { StatusBar } from './StatusBar';
import { chooseProvider } from './create-provider';
import { buildFlowModel } from './flow-model';
import { summariseFlows } from './format';
import { usePrefersReducedMotion } from './use-reduced-motion';
import { useLiveReading } from './use-live-reading';
import { useClockTick, useThrottledText } from './use-time';

/** Time between requests for a new reading. A proposal; the live provider will set its own (Tesla cost, D-023). */
export const DEFAULT_POLL_INTERVAL_MS = 10_000;
/** Shortest time between screen-reader announcements of the summary. A proposal. */
export const DEFAULT_ANNOUNCE_INTERVAL_MS = 15_000;
/** How often the age of the reading and the stale check are refreshed. */
const TICK_MS = 1000;

const MODEL_VALUE = 'model';

export interface LiveViewProps {
  telemetry: TelemetryConfig;
  clock: Clock;
  /** The site to read. The demo provider ignores it; the live provider will need it. */
  siteId?: string;
  pollIntervalMs?: number;
  /** IANA zone of the site, for the time of day. The browser's zone when omitted. */
  timeZone?: string;
  /** False when visual effects are switched off. Particles stop; the arrows and numbers stay. */
  effectsOn: boolean;
  /** Minimum time between announcements by the screen-reader summary. 0 announces every change. */
  announceIntervalMs?: number;
}

/**
 * The Live View: energy flow between solar, battery, grid and home, the numbers as text, the battery level, and
 * the source and age of the data. It shows only what the provider reports and never invents a value. Where
 * configuration asks for live data that cannot be read yet, it says so and does not fall back to demo data.
 */
export function LiveView({
  telemetry,
  clock,
  siteId = 'demo-site',
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeZone,
  effectsOn,
  announceIntervalMs = DEFAULT_ANNOUNCE_INTERVAL_MS,
}: LiveViewProps) {
  const [scenario, setScenario] = useState<DemoScenarioId | typeof MODEL_VALUE>(MODEL_VALUE);
  const choice = useMemo(
    () => chooseProvider(telemetry, clock, scenario === MODEL_VALUE ? undefined : scenario),
    [telemetry, clock, scenario],
  );
  const provider = choice.kind === 'provider' ? choice.provider : null;
  const reading = useLiveReading(provider, { siteId, pollIntervalMs });
  const now = useClockTick(clock, TICK_MS);
  const reducedMotion = usePrefersReducedMotion();

  const sample = reading.result?.sample ?? null;
  const freshness = freshnessOf(sample?.sampledAt ?? null, now);
  const model = useMemo(
    () => buildFlowModel({ sample, freshness: freshness.freshness }),
    [sample, freshness.freshness],
  );
  const summary = useThrottledText(summariseFlows(model), announceIntervalMs);

  if (choice.kind === 'no-live-provider') {
    return (
      <GlassCard>
        <EmptyState
          title="No live data source is connected yet"
          description="This site is set to show live data, but nothing can read it yet. No numbers are shown, and demo data is not used in its place."
          icon={PulseIcon}
          headingLevel={2}
        />
      </GlassCard>
    );
  }
  if (choice.kind === 'invalid') {
    return <ErrorBanner title="The data source setting is not valid" message={choice.reason} />;
  }

  const loading = reading.status === 'loading';
  const animate = effectsOn && !reducedMotion;

  return (
    <div className="grid gap-4">
      {telemetry.kind === 'demo' ? (
        <GlassCard title="Demo scenario" headingLevel={2}>
          <div className="max-w-sm">
            <SelectField
              label="Scenario"
              hint="Demo data changes every five minutes. Pick a scenario to see one situation straight away."
              value={scenario}
              onChange={(event) => {
                setScenario(event.target.value as DemoScenarioId | typeof MODEL_VALUE);
              }}
            >
              <option value={MODEL_VALUE}>Time of day (default)</option>
              {DEMO_SCENARIO_IDS.map((id) => (
                <option key={id} value={id}>
                  {DEMO_SCENARIOS[id].title}
                </option>
              ))}
            </SelectField>
          </div>
        </GlassCard>
      ) : null}

      <GlassCard title="Status" headingLevel={2}>
        <StatusBar
          data={model.data}
          loading={loading}
          source={reading.result?.source ?? null}
          sampledAt={sample?.sampledAt ?? null}
          freshness={freshness.freshness}
          ageSeconds={freshness.ageSeconds}
          quality={sample?.quality ?? null}
          timeZone={timeZone}
          refreshError={reading.error}
        />
      </GlassCard>

      <GlassCard
        title="Energy flow"
        headingLevel={2}
        {...(model.data === 'LIVE' ? { glow: 'select' as const } : {})}
      >
        <FlowCanvas model={model} animate={animate} />
        <p role="status" aria-live="polite" className="sr-only">
          {loading ? '' : summary}
        </p>
        {model.data === 'NONE' ? (
          <p className="mt-3 text-sm text-ink-muted">
            {loading
              ? 'Loading the latest reading.'
              : 'There is no current reading, so nothing is drawn as flowing.'}
          </p>
        ) : null}
      </GlassCard>

      <GlassCard title="Power now" headingLevel={2}>
        <FlowReadouts model={model} />
      </GlassCard>

      <GlassCard title="Battery" headingLevel={2}>
        <BatteryGauge battery={model.battery} />
      </GlassCard>
    </div>
  );
}
