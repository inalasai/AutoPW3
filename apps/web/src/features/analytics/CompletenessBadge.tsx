import type { CompletenessReport } from '@autopw3/domain';
import { AlertIcon, CheckIcon } from '../../components/ui/icons';

export interface CompletenessBadgeProps {
  readonly completeness: CompletenessReport | null;
}

export function CompletenessBadge({ completeness }: CompletenessBadgeProps) {
  if (!completeness) return null;

  const pct = Math.round(completeness.completenessRatio * 1000) / 10;
  const isPerfect =
    completeness.completenessRatio >= 1.0 && completeness.excludedSuspectIntervals === 0;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span
        className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 font-medium ${
          isPerfect
            ? 'border-success/40 bg-success/10 text-success'
            : 'border-warning/40 bg-warning/10 text-warning'
        }`}
        title={`${completeness.accountedIntervals} accounted intervals, ${completeness.excludedSuspectIntervals} suspect/gap intervals.`}
      >
        {isPerfect ? <CheckIcon className="size-3.5" /> : <AlertIcon className="size-3.5" />}
        <span>{pct}% Telemetry Coverage</span>
      </span>

      {!isPerfect && (
        <span className="text-ink-muted">Gaps visible; data is never silently interpolated.</span>
      )}
    </div>
  );
}
