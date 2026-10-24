import { memo, useId } from 'react';
import { cx } from '../../lib/cx';
import type { BatteryDisplay, BatteryLevelState } from './flow-model';
import { SPOKE_KIND_LABELS } from './flow-model';
import { formatPercent } from './format';

/** The word for each state. The gauge never relies on colour alone: this word and the fill pattern say it too. */
const STATE_WORDS: Readonly<Record<BatteryLevelState, string>> = {
  NORMAL: 'Normal',
  LOW: 'Low',
  CRITICAL: 'Critically low',
  STALE: 'Stale reading',
  UNKNOWN: 'No reliable level',
};

const STATE_TEXT: Readonly<Record<BatteryLevelState, string>> = {
  NORMAL: 'text-battery',
  LOW: 'text-warning',
  CRITICAL: 'text-danger',
  STALE: 'text-ink-muted',
  UNKNOWN: 'text-ink-muted',
};

const STATE_FILL: Readonly<Record<BatteryLevelState, string>> = {
  NORMAL: 'fill-battery',
  LOW: 'fill-warning',
  CRITICAL: 'fill-danger',
  STALE: 'fill-ink-muted',
  UNKNOWN: 'fill-ink-muted',
};

const CAVEATS: Readonly<Record<NonNullable<BatteryDisplay['caveat']>, string>> = {
  NO_READING: 'There is no battery reading.',
  NO_VALUE: 'The battery level is missing from this reading.',
  STALE_READING: 'This is the last known level. The data is stale.',
  SUSPECT_READING: 'This level was flagged as unreliable.',
};

/** Geometry of the drawing, in SVG units. */
const BODY_X = 8;
const BODY_Y = 12;
const BODY_WIDTH = 40;
const BODY_HEIGHT = 104;
const FILL_INSET = 3;

export interface BatteryGaugeProps {
  battery: BatteryDisplay;
  className?: string;
}

/**
 * Battery level: a vertical gauge with the percentage and a state word beside it. A level that is stale or
 * unverified is drawn hatched and the word says so; a missing level is an empty dashed outline with a dash.
 * Low and critical are different words and different colours. The drawing is a `meter` whenever there is a
 * level, and hidden from assistive technology when there is not.
 */
export const BatteryGauge = memo(function BatteryGauge({ battery, className }: BatteryGaugeProps) {
  const patternId = useId();
  const percent = formatPercent(battery.percent);
  const hatched = battery.state === 'STALE' || battery.state === 'UNKNOWN';
  const innerHeight = BODY_HEIGHT - FILL_INSET * 2;
  const fillHeight = Math.round(innerHeight * battery.fillFraction * 100) / 100;
  const direction =
    battery.direction === null ? null : SPOKE_KIND_LABELS[battery.direction].toLowerCase();

  // The value is carried by a meter on the drawing only, so the words beside it stay readable text.
  const svgAccess =
    battery.percent === null
      ? ({ 'aria-hidden': true } as const)
      : ({
          role: 'meter',
          'aria-label': 'Battery level',
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          'aria-valuenow': Math.round(battery.percent),
          'aria-valuetext': `${percent ?? ''} percent, ${STATE_WORDS[battery.state].toLowerCase()}`,
        } as const);

  const body = (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 56 120" className="h-28 w-14 shrink-0 text-ink-muted" {...svgAccess}>
        <defs>
          <pattern
            id={patternId}
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="4" height="8" className="fill-ink-muted" />
          </pattern>
        </defs>
        <rect x="20" y="4" width="16" height="8" rx="2" fill="currentColor" />
        <rect
          x={BODY_X}
          y={BODY_Y}
          width={BODY_WIDTH}
          height={BODY_HEIGHT}
          rx="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray={battery.percent === null ? '6 4' : undefined}
        />
        {battery.percent !== null ? (
          <rect
            x={BODY_X + FILL_INSET}
            y={BODY_Y + FILL_INSET + (innerHeight - fillHeight)}
            width={BODY_WIDTH - FILL_INSET * 2}
            height={fillHeight}
            rx="3"
            className={hatched ? undefined : STATE_FILL[battery.state]}
            fill={hatched ? `url(#${patternId})` : undefined}
          />
        ) : null}
      </svg>
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wider text-ink-muted">
          Battery level
        </div>
        <div className="mt-1 flex items-baseline gap-1.5 font-mono tabular-nums">
          {percent === null ? (
            <>
              <span aria-hidden="true" className="text-2xl font-semibold">
                {'\u2014'}
              </span>
              <span className="sr-only">No data</span>
            </>
          ) : (
            <>
              <span className="text-2xl font-semibold">{percent}</span>
              <span className="text-sm text-ink-muted">%</span>
            </>
          )}
        </div>
        <p className={cx('mt-1 text-sm font-semibold', STATE_TEXT[battery.state])}>
          {STATE_WORDS[battery.state]}
        </p>
        {direction !== null ? <p className="text-sm text-ink-muted">{direction}</p> : null}
        {battery.caveat !== null ? (
          <p className="mt-1 max-w-prose text-sm text-ink-muted">{CAVEATS[battery.caveat]}</p>
        ) : null}
      </div>
    </div>
  );

  return <div className={className}>{body}</div>;
});
