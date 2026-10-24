import { memo } from 'react';
import type { DataSource, Freshness, PowerQuality, SiteConnectionState } from '@autopw3/shared';
import { ConnectionIndicator, FreshnessBadge } from '../../components/ui/display';
import { ErrorBanner } from '../../components/ui/feedback';
import type { DataState } from './flow-model';
import { formatAge, formatClockTime } from './format';

export interface StatusBarProps {
  data: DataState;
  /** No answer has arrived yet. */
  loading: boolean;
  source: DataSource | null;
  /** When the reading was taken, as an ISO instant. */
  sampledAt: string | null;
  freshness: Freshness;
  ageSeconds: number | null;
  quality: PowerQuality | null;
  /** IANA zone for the time of day. The browser's zone when omitted. */
  timeZone?: string | undefined;
  /** A safe sentence about the last failed refresh, or `null`. */
  refreshError: string | null;
}

function connectionOf(props: StatusBarProps): SiteConnectionState {
  if (props.loading && props.source === null) return 'CONNECTING';
  if (props.data === 'NONE') return props.refreshError !== null ? 'ERROR' : 'DISCONNECTED';
  if (props.data === 'STALE') return 'STALE';
  return 'LIVE';
}

function zoneName(timeZone: string | undefined): string {
  if (timeZone !== undefined) return timeZone;
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'local time';
  }
}

/**
 * Where the reading comes from and how old it is: a clear DEMO label, the connection, a freshness badge, the
 * time of the reading, and a warning when the reading is suspect, partial or the last refresh failed. Everything
 * is text; colour only reinforces it.
 */
export const StatusBar = memo(function StatusBar(props: StatusBarProps) {
  const { data, source, sampledAt, freshness, ageSeconds, quality, timeZone, refreshError } = props;
  const clock = sampledAt === null ? null : formatClockTime(sampledAt, timeZone);
  const ageLabel = data === 'NONE' ? undefined : `Updated ${formatAge(ageSeconds)}`;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {source === 'DEMO' ? (
          <span
            data-testid="live-demo-badge"
            className="inline-flex items-center gap-2 text-sm font-medium text-warning"
          >
            <span className="rounded-pill border border-warning px-2 font-mono text-xs tracking-wider">
              DEMO
            </span>
            <span>Simulated data</span>
          </span>
        ) : null}
        <ConnectionIndicator state={connectionOf(props)} />
        <FreshnessBadge state={freshness} {...(ageLabel !== undefined ? { ageLabel } : {})} />
        {clock !== null && sampledAt !== null ? (
          <span className="text-sm text-ink-muted">
            Reading from <time dateTime={sampledAt}>{clock}</time> ({zoneName(timeZone)})
          </span>
        ) : null}
      </div>
      {data === 'STALE' ? (
        <ErrorBanner
          tone="warning"
          title="This data is out of date"
          message="The numbers are the last reading received, so nothing is shown moving."
        />
      ) : null}
      {data === 'SUSPECT' || (data === 'LIVE' && quality === 'SUSPECT') ? (
        <ErrorBanner
          tone="warning"
          title="This reading may be unreliable"
          message="Some values looked implausible. They are shown, but not animated, and are left out of any totals."
        />
      ) : null}
      {data !== 'NONE' && quality === 'PARTIAL' ? (
        <ErrorBanner
          tone="info"
          title="Part of this reading is missing"
          message="Values that were not reported are shown as a dash, never as zero."
        />
      ) : null}
      {refreshError !== null ? (
        <ErrorBanner tone="warning" title="Could not refresh" message={refreshError} />
      ) : null}
    </div>
  );
});
