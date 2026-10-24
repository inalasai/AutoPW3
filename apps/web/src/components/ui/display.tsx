import { useId } from 'react';
import type { ElementType, ReactNode } from 'react';
import type { Freshness, SiteConnectionState } from '@autopw3/shared';
import { cx } from '../../lib/cx';

export type GlowTone = 'solar' | 'battery' | 'grid' | 'select';

const GLOW_CLASS: Record<GlowTone, string> = {
  solar: 'glow-solar',
  battery: 'glow-battery',
  grid: 'glow-grid',
  select: 'glow-select',
};

export interface GlassCardProps {
  /** Heading text. When set the card is a labelled region so screen readers can jump to it. */
  title?: string;
  /** Heading element level; pick the one that keeps the page outline in order. Default h2. */
  headingLevel?: 2 | 3 | 4;
  actions?: ReactNode;
  /** Optional accent glow. Decorative only: it disappears with effects off and never carries meaning. */
  glow?: GlowTone;
  as?: ElementType;
  className?: string;
  children: ReactNode;
}

/** Translucent slate "glass" panel, opaque with effects off. */
export function GlassCard({
  title,
  headingLevel = 2,
  actions,
  glow,
  as: Component = 'section',
  className,
  children,
}: GlassCardProps) {
  const headingId = useId();
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  return (
    <Component
      aria-labelledby={title !== undefined ? headingId : undefined}
      className={cx('glass min-w-0 p-4 sm:p-5', glow !== undefined && GLOW_CLASS[glow], className)}
    >
      {title !== undefined || actions !== undefined ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title !== undefined ? (
            <Heading id={headingId} className="text-base font-semibold">
              {title}
            </Heading>
          ) : (
            <span />
          )}
          {actions !== undefined ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </Component>
  );
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Status area to the right of (or below) the title: freshness, connection, mode. */
  status?: ReactNode;
  actions?: ReactNode;
}

/** Page title block. The `h1` is focusable by script so the shell can move focus here after navigation. */
export function PageHeader({ title, description, status, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 id="page-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {description !== undefined ? (
          <p className="mt-1 max-w-prose text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {status !== undefined || actions !== undefined ? (
        <div className="flex flex-wrap items-center gap-3">
          {status}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export type TelemetryTone = 'neutral' | GlowTone;

const TELEMETRY_TONE: Record<TelemetryTone, string> = {
  neutral: 'text-ink',
  solar: 'text-solar',
  battery: 'text-battery',
  grid: 'text-grid-ink',
  select: 'text-info',
};

export interface TelemetryValueProps {
  label: string;
  /** Already formatted for display, for example "3.42". `null` means no data and is shown as a dash, never as zero. */
  value: string | null;
  /** Unit text, for example "kW" or "%". Shown beside the value, not part of the number. */
  unit?: string;
  tone?: TelemetryTone;
}

/**
 * One telemetry reading: label, monospace value with tabular digits, unit. It formats nothing and calculates
 * nothing; callers pass strings. A missing value is a dash with the words "No data" for screen readers.
 */
export function TelemetryValue({ label, value, unit, tone = 'neutral' }: TelemetryValueProps) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium uppercase tracking-wider text-ink-muted">{label}</div>
      <div
        className={cx(
          'mt-1 flex items-baseline gap-1.5 font-mono tabular-nums',
          TELEMETRY_TONE[tone],
        )}
      >
        {value === null ? (
          <>
            <span aria-hidden="true" className="text-2xl font-semibold">
              {'\u2014'}
            </span>
            <span className="sr-only">No data</span>
          </>
        ) : (
          <span className="text-2xl font-semibold">{value}</span>
        )}
        {unit !== undefined ? <span className="text-sm text-ink-muted">{unit}</span> : null}
      </div>
    </div>
  );
}

const CONNECTION: Record<SiteConnectionState, { label: string; dot: string; text: string }> = {
  CONNECTING: { label: 'Connecting', dot: 'bg-info animate-pulse', text: 'text-info' },
  LIVE: { label: 'Live', dot: 'bg-success', text: 'text-success' },
  STALE: { label: 'Stale', dot: 'bg-warning', text: 'text-warning' },
  ERROR: { label: 'Error', dot: 'bg-danger', text: 'text-danger' },
  DISCONNECTED: { label: 'Disconnected', dot: 'bg-ink-muted', text: 'text-ink-muted' },
};

/** Connection state of a site. Always shows the word; the dot colour is a reinforcement. */
export function ConnectionIndicator({
  state,
  detail,
}: {
  state: SiteConnectionState;
  /** Extra text such as "Tesla link needs sign-in". */
  detail?: string;
}) {
  const view = CONNECTION[state];
  return (
    <span
      role="status"
      className={cx('inline-flex items-center gap-2 text-sm font-medium', view.text)}
    >
      <span aria-hidden="true" className={cx('size-2.5 rounded-pill', view.dot)} />
      <span>{view.label}</span>
      {detail !== undefined ? <span className="font-normal text-ink-muted">{detail}</span> : null}
    </span>
  );
}

const FRESHNESS: Record<Freshness, { label: string; classes: string }> = {
  FRESH: { label: 'Fresh', classes: 'border-success text-success' },
  STALE: { label: 'Stale', classes: 'border-warning text-warning' },
  UNAVAILABLE: { label: 'Unavailable', classes: 'border-danger text-danger' },
};

/** Data freshness badge. `ageLabel` is a ready-made phrase such as "updated 3 min ago"; this component does no time maths. */
export function FreshnessBadge({ state, ageLabel }: { state: Freshness; ageLabel?: string }) {
  const view = FRESHNESS[state];
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        className={cx(
          'rounded-pill border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider',
          view.classes,
        )}
      >
        {view.label}
      </span>
      {ageLabel !== undefined ? <span className="text-ink-muted">{ageLabel}</span> : null}
    </span>
  );
}

export interface DataTableColumn<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  /** Right-aligned, monospace, tabular digits. Use for telemetry and money. */
  numeric?: boolean;
}

export interface DataTableProps<Row> {
  caption: string;
  /** Hide the caption visually; it stays the table's accessible name. */
  captionHidden?: boolean;
  columns: ReadonlyArray<DataTableColumn<Row>>;
  rows: ReadonlyArray<Row>;
  getRowKey: (row: Row) => string;
  emptyMessage?: string;
}

/**
 * Accessible table: real `<table>`, `<caption>`, column headers with `scope`. The wrapper scrolls sideways on
 * narrow screens (so the page never does) and is focusable so keyboard users can scroll it.
 */
export function DataTable<Row>({
  caption,
  captionHidden,
  columns,
  rows,
  getRowKey,
  emptyMessage = 'No rows to show.',
}: DataTableProps<Row>) {
  return (
    <div
      role="region"
      aria-label={`${caption} (scrollable)`}
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-control border border-line"
    >
      <table className="w-full border-collapse text-sm">
        <caption
          className={cx('p-3 text-left text-sm font-semibold', captionHidden === true && 'sr-only')}
        >
          {caption}
        </caption>
        <thead className="bg-space-900">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx(
                  'whitespace-nowrap px-3 py-2 font-medium text-ink-muted',
                  column.numeric === true ? 'text-right' : 'text-left',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-ink-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={getRowKey(row)} className="border-t border-line">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cx(
                      'px-3 py-2 align-top',
                      column.numeric === true && 'text-right font-mono tabular-nums',
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
