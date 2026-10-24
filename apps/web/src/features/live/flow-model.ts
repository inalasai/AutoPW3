import { batteryDirection, gridDirection } from '@autopw3/shared';
import type { BatteryDirection, Freshness, GridDirection, PowerQuality } from '@autopw3/shared';
import { DEFAULT_LOW_BATTERY_PERCENT } from '@autopw3/domain';

/**
 * The flow model: normalised telemetry in, directed flows and display states out. Pure functions only. It knows
 * nothing about canvas, React or time, so every rule here is unit-tested without a browser.
 *
 * Picture: a Core Hub (the site's power bus) with four spokes, Solar, Battery, Grid and Home. Power moves along a
 * spoke towards the hub or away from it:
 *
 *   Solar    solarPowerW > 0                    Solar -> Hub
 *   Battery  batteryPowerW < 0 (charging)       Hub -> Battery
 *            batteryPowerW > 0 (discharging)    Battery -> Hub
 *   Grid     gridPowerW > 0 (importing)         Grid -> Hub
 *            gridPowerW < 0 (exporting)         Hub -> Grid
 *   Home     loadPowerW > 0                     Hub -> Home
 *
 * Signs are the project convention (`@autopw3/shared` constants/signs.ts); the direction helpers come from there.
 * Provider-native signs are converted by the provider adapter, never here.
 *
 * Honesty rules:
 *  - A missing, non-finite or impossible value (negative solar or load) makes that spoke `UNKNOWN`. It is never
 *    drawn as zero.
 *  - Only data that is `FRESH` and not `SUSPECT` animates. Stale or suspect data keeps its numbers and direction
 *    arrows but shows no moving particles, so old data cannot look live.
 *  - A reading below `IDLE_THRESHOLD_W` is shown as idle (no direction), but the number shown is the real one.
 */

export const SPOKE_IDS = ['SOLAR', 'BATTERY', 'GRID', 'HOME'] as const;
export type SpokeId = (typeof SPOKE_IDS)[number];
export type NodeId = SpokeId | 'HUB';

export const NODE_TITLES: Readonly<Record<NodeId, string>> = {
  HUB: 'Core Hub',
  SOLAR: 'Solar',
  BATTERY: 'Battery',
  GRID: 'Grid',
  HOME: 'Home',
};

/** Below this magnitude a flow is treated as no flow, so meter noise does not make particles flicker. A proposal. */
export const IDLE_THRESHOLD_W = 10;
/** Magnitude at which speed and density reach their maximum. Larger values are clamped. A proposal. */
export const FULL_SCALE_W = 6000;
export const MIN_PARTICLES = 1;
export const MAX_PARTICLES = 12;
export const MIN_SPEED_PX_PER_SECOND = 24;
export const MAX_SPEED_PX_PER_SECOND = 140;
/** Battery level below which the gauge turns amber ("below 15%"). Same default as the domain's low-battery level. */
export const LOW_BATTERY_PERCENT = DEFAULT_LOW_BATTERY_PERCENT;
/** Battery level below which the gauge shows the critical state. A proposal. */
export const CRITICAL_BATTERY_PERCENT = 5;

export type SpokeKind =
  | 'GENERATING'
  | 'CHARGING'
  | 'DISCHARGING'
  | 'IMPORTING'
  | 'EXPORTING'
  | 'CONSUMING'
  | 'IDLE'
  | 'UNKNOWN';

export const SPOKE_KIND_LABELS: Readonly<Record<SpokeKind, string>> = {
  GENERATING: 'Generating',
  CHARGING: 'Charging',
  DISCHARGING: 'Discharging',
  IMPORTING: 'Importing',
  EXPORTING: 'Exporting',
  CONSUMING: 'Using',
  IDLE: 'Idle',
  UNKNOWN: 'No data',
};

/** Whether the data behind the model may be shown as live. */
export type DataState =
  /** Fresh and not suspect: numbers and animation. */
  | 'LIVE'
  /** Older than the stale threshold: numbers and arrows, no animation. */
  | 'STALE'
  /** Fresh but flagged suspect: numbers and arrows, no animation, with a warning. */
  | 'SUSPECT'
  /** No reading, or one with no usable time: nothing is shown as a value. */
  | 'NONE';

export interface FlowSample {
  readonly solarPowerW: number | null;
  readonly batteryPowerW: number | null;
  readonly gridPowerW: number | null;
  readonly loadPowerW: number | null;
  readonly batterySocPercent: number | null;
  readonly quality: PowerQuality;
}

export interface FlowInput {
  /** The latest normalised reading, or `null` when there is none yet. */
  readonly sample: FlowSample | null;
  readonly freshness: Freshness;
}

/** One directed flow of power between two nodes. */
export interface Flow {
  readonly spoke: SpokeId;
  readonly from: NodeId;
  readonly to: NodeId;
  /** Magnitude in watts, at least 0. */
  readonly powerW: number;
}

export interface SpokeFlow {
  readonly id: SpokeId;
  readonly kind: SpokeKind;
  /** Where the power comes from and goes to. Both `null` when idle or unknown. */
  readonly from: NodeId | null;
  readonly to: NodeId | null;
  /** The real magnitude in watts for the number on screen, or `null` when unknown. */
  readonly magnitudeW: number | null;
  /** True when particles may move on this spoke: active, and the data is live. */
  readonly animated: boolean;
  /** 0 to 1: how large the flow is on the clamped scale. 0 when idle or unknown. */
  readonly level: number;
  /** Particle speed in CSS pixels per second. 0 when not animated. */
  readonly speedPxPerSecond: number;
  /** Number of particles on the spoke. 0 when not animated. */
  readonly particleCount: number;
}

export type BatteryLevelState = 'NORMAL' | 'LOW' | 'CRITICAL' | 'STALE' | 'UNKNOWN';

export interface BatteryDisplay {
  readonly state: BatteryLevelState;
  /** The level to print, 0 to 100, or `null` when there is none. Kept for stale and suspect readings. */
  readonly percent: number | null;
  /** The level the gauge fills to, 0 to 1. 0 when there is no level. */
  readonly fillFraction: number;
  readonly direction: BatteryDirection | null;
  /** Why the level is not shown as reliable, for a text note. `null` when it is reliable. */
  readonly caveat: 'NO_READING' | 'NO_VALUE' | 'STALE_READING' | 'SUSPECT_READING' | null;
}

export interface FlowModel {
  readonly data: DataState;
  readonly spokes: Readonly<Record<SpokeId, SpokeFlow>>;
  /** The active flows only, in a fixed order: solar, battery, grid, home. */
  readonly flows: readonly Flow[];
  readonly battery: BatteryDisplay;
  readonly gridDirection: GridDirection | null;
}

export interface FlowModelOptions {
  readonly idleThresholdW?: number;
  readonly lowBatteryPercent?: number;
  readonly criticalBatteryPercent?: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

/**
 * How a flow of a given magnitude looks. Speed and particle count grow with the square root of the magnitude
 * (so small flows are still visible and big ones do not look frantic) and never exceed the fixed upper bounds,
 * however large the input. Below the idle threshold, or for a value that is not a finite positive number, nothing
 * moves.
 */
export function flowVisual(
  magnitudeW: number,
  idleThresholdW: number = IDLE_THRESHOLD_W,
): { readonly level: number; readonly speedPxPerSecond: number; readonly particleCount: number } {
  if (!Number.isFinite(magnitudeW) || magnitudeW < idleThresholdW || magnitudeW <= 0) {
    return { level: 0, speedPxPerSecond: 0, particleCount: 0 };
  }
  const level = clamp(Math.sqrt(magnitudeW / FULL_SCALE_W), 0, 1);
  return {
    level,
    speedPxPerSecond: Math.round(
      MIN_SPEED_PX_PER_SECOND + (MAX_SPEED_PX_PER_SECOND - MIN_SPEED_PX_PER_SECOND) * level,
    ),
    particleCount: clamp(
      MIN_PARTICLES + Math.round((MAX_PARTICLES - MIN_PARTICLES) * level),
      MIN_PARTICLES,
      MAX_PARTICLES,
    ),
  };
}

const UNKNOWN_SPOKE = (id: SpokeId): SpokeFlow => ({
  id,
  kind: 'UNKNOWN',
  from: null,
  to: null,
  magnitudeW: null,
  animated: false,
  level: 0,
  speedPxPerSecond: 0,
  particleCount: 0,
});

function makeSpoke(
  id: SpokeId,
  kind: SpokeKind,
  from: NodeId | null,
  to: NodeId | null,
  magnitudeW: number,
  live: boolean,
  idleThresholdW: number,
): SpokeFlow {
  if (kind === 'IDLE') {
    return { ...UNKNOWN_SPOKE(id), kind, magnitudeW };
  }
  const visual = flowVisual(magnitudeW, idleThresholdW);
  return {
    id,
    kind,
    from,
    to,
    magnitudeW,
    animated: live,
    level: visual.level,
    speedPxPerSecond: live ? visual.speedPxPerSecond : 0,
    particleCount: live ? visual.particleCount : 0,
  };
}

function batteryDirectionOf(kind: SpokeKind): BatteryDirection | null {
  if (kind === 'CHARGING' || kind === 'DISCHARGING' || kind === 'IDLE') return kind;
  return null;
}

function dataStateOf(input: FlowInput): DataState {
  if (input.sample === null || input.freshness === 'UNAVAILABLE') return 'NONE';
  if (input.freshness === 'STALE') return 'STALE';
  if (input.sample.quality === 'SUSPECT') return 'SUSPECT';
  return 'LIVE';
}

function batteryDisplay(
  data: DataState,
  soc: number | null,
  direction: BatteryDirection | null,
  low: number,
  critical: number,
): BatteryDisplay {
  const valid = soc !== null && Number.isFinite(soc) && soc >= 0 && soc <= 100;
  if (data === 'NONE') {
    return {
      state: 'UNKNOWN',
      percent: null,
      fillFraction: 0,
      direction: null,
      caveat: 'NO_READING',
    };
  }
  if (!valid) {
    return { state: 'UNKNOWN', percent: null, fillFraction: 0, direction, caveat: 'NO_VALUE' };
  }
  const percent = soc;
  const fillFraction = percent / 100;
  if (data === 'STALE') {
    return { state: 'STALE', percent, fillFraction, direction, caveat: 'STALE_READING' };
  }
  if (data === 'SUSPECT') {
    return { state: 'UNKNOWN', percent, fillFraction, direction, caveat: 'SUSPECT_READING' };
  }
  const state: BatteryLevelState =
    percent < critical ? 'CRITICAL' : percent < low ? 'LOW' : 'NORMAL';
  return { state, percent, fillFraction, direction, caveat: null };
}

/** Turn a normalised reading into directed flows and display states. */
export function buildFlowModel(input: FlowInput, options: FlowModelOptions = {}): FlowModel {
  const idle = options.idleThresholdW ?? IDLE_THRESHOLD_W;
  const low = options.lowBatteryPercent ?? LOW_BATTERY_PERCENT;
  const critical = options.criticalBatteryPercent ?? CRITICAL_BATTERY_PERCENT;
  const data = dataStateOf(input);
  const live = data === 'LIVE';
  const sample = data === 'NONE' ? null : input.sample;

  const solar = finiteOrNull(sample?.solarPowerW ?? null);
  const battery = finiteOrNull(sample?.batteryPowerW ?? null);
  const grid = finiteOrNull(sample?.gridPowerW ?? null);
  const load = finiteOrNull(sample?.loadPowerW ?? null);

  // Solar and load cannot be negative in the convention; a negative value is impossible, so it is unknown.
  const spokes: Record<SpokeId, SpokeFlow> = {
    SOLAR:
      solar === null || solar < 0
        ? UNKNOWN_SPOKE('SOLAR')
        : solar < idle
          ? makeSpoke('SOLAR', 'IDLE', null, null, solar, live, idle)
          : makeSpoke('SOLAR', 'GENERATING', 'SOLAR', 'HUB', solar, live, idle),
    BATTERY: UNKNOWN_SPOKE('BATTERY'),
    GRID: UNKNOWN_SPOKE('GRID'),
    HOME:
      load === null || load < 0
        ? UNKNOWN_SPOKE('HOME')
        : load < idle
          ? makeSpoke('HOME', 'IDLE', null, null, load, live, idle)
          : makeSpoke('HOME', 'CONSUMING', 'HUB', 'HOME', load, live, idle),
  };

  if (battery !== null) {
    const magnitude = Math.abs(battery);
    const direction = magnitude < idle ? 'IDLE' : batteryDirection(battery);
    spokes.BATTERY =
      direction === 'IDLE'
        ? makeSpoke('BATTERY', 'IDLE', null, null, magnitude, live, idle)
        : direction === 'CHARGING'
          ? makeSpoke('BATTERY', 'CHARGING', 'HUB', 'BATTERY', magnitude, live, idle)
          : makeSpoke('BATTERY', 'DISCHARGING', 'BATTERY', 'HUB', magnitude, live, idle);
  }

  let gridDir: GridDirection | null = null;
  if (grid !== null) {
    const magnitude = Math.abs(grid);
    gridDir = magnitude < idle ? 'IDLE' : gridDirection(grid);
    spokes.GRID =
      gridDir === 'IDLE'
        ? makeSpoke('GRID', 'IDLE', null, null, magnitude, live, idle)
        : gridDir === 'IMPORTING'
          ? makeSpoke('GRID', 'IMPORTING', 'GRID', 'HUB', magnitude, live, idle)
          : makeSpoke('GRID', 'EXPORTING', 'HUB', 'GRID', magnitude, live, idle);
  }

  const flows: Flow[] = [];
  for (const id of SPOKE_IDS) {
    const spoke = spokes[id];
    if (spoke.from !== null && spoke.to !== null && spoke.magnitudeW !== null) {
      flows.push({ spoke: id, from: spoke.from, to: spoke.to, powerW: spoke.magnitudeW });
    }
  }

  return {
    data,
    spokes,
    flows,
    battery: batteryDisplay(
      data,
      sample?.batterySocPercent ?? null,
      batteryDirectionOf(spokes.BATTERY.kind),
      low,
      critical,
    ),
    gridDirection: gridDir,
  };
}
