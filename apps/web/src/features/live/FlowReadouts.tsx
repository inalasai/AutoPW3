import { memo } from 'react';
import { TelemetryValue } from '../../components/ui/display';
import type { TelemetryTone } from '../../components/ui/display';
import { cx } from '../../lib/cx';
import { NODE_TITLES, SPOKE_IDS, SPOKE_KIND_LABELS } from './flow-model';
import type { FlowModel, SpokeFlow, SpokeId } from './flow-model';
import { formatKilowatts } from './format';

const TONES: Readonly<Record<SpokeId, TelemetryTone>> = {
  SOLAR: 'solar',
  BATTERY: 'battery',
  GRID: 'grid',
  HOME: 'neutral',
};

function Route({ spoke }: { spoke: SpokeFlow }) {
  if (spoke.from === null || spoke.to === null) return null;
  return (
    <span className="text-ink-muted">
      {NODE_TITLES[spoke.from]}
      <span aria-hidden="true"> {'\u2192'} </span>
      <span className="sr-only"> to </span>
      {NODE_TITLES[spoke.to]}
    </span>
  );
}

export interface FlowReadoutsProps {
  model: FlowModel;
  className?: string;
}

/**
 * The numbers beside the diagram, as real text: one card per part of the site with the power in kilowatts, what
 * it is doing in words and where the power goes. No data is a dash with "No data" for screen readers, never 0.
 */
export const FlowReadouts = memo(function FlowReadouts({ model, className }: FlowReadoutsProps) {
  return (
    <ul aria-label="Power now" className={cx('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>
      {SPOKE_IDS.map((id) => {
        const spoke = model.spokes[id];
        return (
          <li key={id} className="min-w-0 rounded-control border border-line bg-space-900 p-3">
            <TelemetryValue
              label={NODE_TITLES[id]}
              value={formatKilowatts(spoke.magnitudeW)}
              unit="kW"
              tone={TONES[id]}
            />
            <p className="mt-2 text-sm font-semibold">{SPOKE_KIND_LABELS[spoke.kind]}</p>
            <p className="text-sm">
              <Route spoke={spoke} />
            </p>
          </li>
        );
      })}
    </ul>
  );
});
