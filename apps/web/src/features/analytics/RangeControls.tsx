import { useState } from 'react';
import type { EnergyResolution } from '@autopw3/shared';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/fields';
import { SegmentedControl } from '../../components/ui/Tabs';
import type { DateRangeState, RangePreset } from './types';

export interface RangeControlsProps {
  readonly range: DateRangeState;
  readonly resolution: EnergyResolution;
  readonly availableResolutions: readonly EnergyResolution[];
  readonly onPresetChange: (preset: RangePreset) => void;
  readonly onCustomRangeChange: (start: string, end: string) => void;
  readonly onResolutionChange: (resolution: EnergyResolution) => void;
}

const PRESET_OPTIONS: ReadonlyArray<{ value: RangePreset; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'custom', label: 'Custom' },
];

const RESOLUTION_LABELS: Record<EnergyResolution, string> = {
  interval: 'Interval (15m)',
  hourly: 'Hourly',
  daily: 'Daily',
};

const RESOLUTION_DESCRIPTIONS: Record<EnergyResolution, string> = {
  interval: 'Raw 15-minute intervals',
  hourly: 'Hourly rollups',
  daily: 'Local calendar daily rollups',
};

export function RangeControls({
  range,
  resolution,
  availableResolutions,
  onPresetChange,
  onCustomRangeChange,
  onResolutionChange,
}: RangeControlsProps) {
  const [customStart, setCustomStart] = useState(range.startDate);
  const [customEnd, setCustomEnd] = useState(range.endDate);

  const resolutionOptions = availableResolutions.map((res) => ({
    value: res,
    label: RESOLUTION_LABELS[res] ?? res,
  }));

  const handleApplyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (customStart && customEnd && customEnd >= customStart) {
      onCustomRangeChange(customStart, customEnd);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="Time range preset"
            value={range.preset}
            options={PRESET_OPTIONS}
            onValueChange={onPresetChange}
          />

          <span className="text-xs text-ink-muted">
            Timezone: <strong className="text-ink">{range.timezone}</strong>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="Aggregation resolution"
            value={resolution}
            options={resolutionOptions}
            onValueChange={onResolutionChange}
          />

          <span
            className="rounded-control border border-line bg-space-900 px-2.5 py-1 text-xs font-medium text-select"
            title="Actual resolution displayed. Finer resolution is never fabricated."
          >
            Resolution: {RESOLUTION_DESCRIPTIONS[resolution]}
          </span>
        </div>
      </div>

      {range.preset === 'custom' && (
        <form
          onSubmit={handleApplyCustom}
          className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-space-900/60 p-3"
        >
          <TextField
            label="Start Date"
            type="date"
            value={customStart}
            onChange={(e) => {
              setCustomStart(e.target.value);
            }}
            required
          />
          <TextField
            label="End Date"
            type="date"
            value={customEnd}
            onChange={(e) => {
              setCustomEnd(e.target.value);
            }}
            required
          />
          <Button type="submit" variant="secondary" size="md">
            Apply Range
          </Button>
        </form>
      )}
    </div>
  );
}
