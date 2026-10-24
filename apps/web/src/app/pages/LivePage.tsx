import { LiveView } from '../../features/live';
import type { TelemetryConfig } from '../../lib/config';
import { systemClock } from '../../lib/clock';
import { useEffects } from '../effects';
import { Page } from './Page';

/** The Live route: the page frame around the Live View (TASK-09). */
export function LivePage({ telemetry }: { telemetry: TelemetryConfig }) {
  const { effects } = useEffects();
  return (
    <Page
      title="Live"
      description="Energy flowing between solar, battery, grid and home right now, with the age of the data shown."
    >
      <LiveView telemetry={telemetry} clock={systemClock} effectsOn={effects === 'on'} />
    </Page>
  );
}
