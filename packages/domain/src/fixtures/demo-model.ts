import { utcOffsetMinutes } from '../telemetry/timestamps';
import { unit } from './prng';

/**
 * SYNTHETIC demo site. Everything this file produces is made up: it exists so the dashboard can be built and
 * shown before any real Powerwall is connected (rule 5). It is labelled `DEMO` wherever it is exposed, never
 * persisted and never mixed with live data.
 *
 * The model is a pure function of its configuration and the instant. There is no `Math.random()`, no ambient
 * clock and no state that depends on call order: the same config always yields the same numbers (D-054).
 *
 * What it models, roughly:
 *  - Solar: an array at Irish latitude. Output follows the sun's elevation (so winter days are short and weak,
 *    summer days long) scaled by a seeded cloud factor that is mostly dull, as Irish weather is.
 *  - Load: a household with a small base load, morning and evening peaks, a later weekend morning, and short
 *    seeded appliance spikes.
 *  - Battery: a home battery on a "self-consumption" policy: it soaks up surplus solar and covers shortfalls
 *    down to a reserve, within its power limit. Round-trip losses are ignored (a simplification).
 *  - Grid: whatever is left, so the balance `load = solar + battery + grid` holds exactly (all values are whole
 *    watts).
 * These are plausible shapes, not measurements of any real home or of the Tesla API (which is UNVERIFIED).
 */

/** The demo world starts here. Earlier instants are outside it. */
export const DEMO_EPOCH_MS = Date.UTC(2026, 0, 1);
/** The demo world ends here (exclusive). Five years is far more than the product needs. */
export const DEMO_HORIZON_MS = Date.UTC(2031, 0, 1);
/** Spacing of the synthetic power snapshots, in seconds. */
export const DEMO_STEP_SECONDS = 300;
/** Length of the synthetic energy intervals, in seconds (three power steps). */
export const DEMO_ENERGY_INTERVAL_SECONDS = 900;

export const DEMO_STEP_MS = DEMO_STEP_SECONDS * 1000;
const DEMO_STEPS_TOTAL = Math.floor((DEMO_HORIZON_MS - DEMO_EPOCH_MS) / DEMO_STEP_MS);
const MS_PER_DAY = 86_400_000;
const STEP_HOURS = DEMO_STEP_SECONDS / 3600;

export interface DemoSiteConfig {
  /** Seeds every "random" choice. Change it for a different, equally repeatable world. */
  readonly seed: number;
  /** IANA zone of the demo site; sets local days and household habits. */
  readonly timezone: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  /** Peak size of the solar array in kW. */
  readonly solarKwp: number;
  readonly batteryCapacityWh: number;
  readonly batteryMaxPowerW: number;
  /** The battery never discharges below this level. */
  readonly batteryReservePercent: number;
}

/** A Dublin-like site: 5.8 kW array, 13.5 kWh battery. All figures illustrative. */
export const DEFAULT_DEMO_SITE: DemoSiteConfig = {
  seed: 20260101,
  timezone: 'Europe/Dublin',
  latitudeDeg: 53.35,
  longitudeDeg: -6.26,
  solarKwp: 5.8,
  batteryCapacityWh: 13_500,
  batteryMaxPowerW: 5_000,
  batteryReservePercent: 10,
};

/** The five values of one synthetic snapshot, in the project's signs. Whole watts; the level to 0.1 percent. */
export interface DemoStepValues {
  readonly solarPowerW: number;
  /** > 0 discharging, < 0 charging. */
  readonly batteryPowerW: number;
  /** > 0 importing, < 0 exporting. */
  readonly gridPowerW: number;
  readonly loadPowerW: number;
  readonly batterySocPercent: number;
}

const DEG = Math.PI / 180;

/** Sine of the sun's elevation at an instant and place (standard declination and equation-of-time formulae). */
function sinSolarElevation(ms: number, latitudeDeg: number, longitudeDeg: number): number {
  const date = new Date(ms);
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((ms - startOfYear) / MS_PER_DAY);
  const declination = 23.44 * DEG * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
  const b = (2 * Math.PI * (dayOfYear - 81)) / 364;
  const equationOfTimeMin = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const utcHours = (ms % MS_PER_DAY) / 3_600_000;
  const solarTimeHours = utcHours + longitudeDeg / 15 + equationOfTimeMin / 60;
  const hourAngle = 15 * DEG * (solarTimeHours - 12);
  const lat = latitudeDeg * DEG;
  return (
    Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle)
  );
}

function bump(x: number, centre: number, width: number): number {
  const z = (x - centre) / width;
  return Math.exp(-0.5 * z * z);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The synthetic site over time. Values are computed lazily from the epoch forward (the battery level carries
 * from one step to the next) and remembered, so asking for any step gives the same answer whatever was asked
 * before. Costs about a millisecond per simulated day on first use.
 */
export class DemoSiteModel {
  readonly config: DemoSiteConfig;
  private readonly solar: number[] = [];
  private readonly battery: number[] = [];
  private readonly grid: number[] = [];
  private readonly load: number[] = [];
  private readonly soc: number[] = [];
  private energyWh: number;
  private readonly offsetCache = new Map<number, number>();

  constructor(config: DemoSiteConfig = DEFAULT_DEMO_SITE) {
    this.config = config;
    this.energyWh = config.batteryCapacityWh * 0.5;
    // Fails fast on an unknown zone instead of producing nonsense later.
    utcOffsetMinutes(DEMO_EPOCH_MS, config.timezone);
  }

  /** Index of the step containing an instant. Throws `RangeError` outside the demo world. */
  stepIndexAt(ms: number): number {
    if (!Number.isFinite(ms) || ms < DEMO_EPOCH_MS || ms >= DEMO_HORIZON_MS) {
      throw new RangeError('Instant is outside the demo world');
    }
    return Math.floor((ms - DEMO_EPOCH_MS) / DEMO_STEP_MS);
  }

  /** Start instant of a step in epoch milliseconds. */
  stepStartMs(index: number): number {
    return DEMO_EPOCH_MS + index * DEMO_STEP_MS;
  }

  /** The values of a step. Throws `RangeError` for an index outside the demo world. */
  valuesAt(index: number): DemoStepValues {
    if (!Number.isInteger(index) || index < 0 || index >= DEMO_STEPS_TOTAL) {
      throw new RangeError('Step is outside the demo world');
    }
    while (this.load.length <= index) this.computeNext();
    return {
      solarPowerW: this.solar[index] ?? 0,
      batteryPowerW: this.battery[index] ?? 0,
      gridPowerW: this.grid[index] ?? 0,
      loadPowerW: this.load[index] ?? 0,
      batterySocPercent: this.soc[index] ?? 0,
    };
  }

  private localOffsetMinutes(ms: number): number {
    // Zones change their clocks on quarter-hour boundaries at the latest, so one lookup per 15 minutes is exact.
    const block = Math.floor(ms / 900_000);
    const cached = this.offsetCache.get(block);
    if (cached !== undefined) return cached;
    const offset = utcOffsetMinutes(block * 900_000, this.config.timezone);
    this.offsetCache.set(block, offset);
    return offset;
  }

  private computeNext(): void {
    const { config } = this;
    const index = this.load.length;
    const ms = this.stepStartMs(index);

    // Solar.
    const sinElevation = sinSolarElevation(ms, config.latitudeDeg, config.longitudeDeg);
    let solarW = 0;
    if (sinElevation > 0.02) {
      const clear = config.solarKwp * 1000 * 0.8 * sinElevation ** 1.15;
      const dayIndex = Math.floor(ms / MS_PER_DAY);
      const dayClear = 0.18 + 0.82 * unit(config.seed, dayIndex, 1) ** 1.5;
      const knot = Math.floor(ms / 1_800_000);
      const frac = (ms - knot * 1_800_000) / 1_800_000;
      const a = unit(config.seed, knot, 2);
      const b = unit(config.seed, knot + 1, 2);
      const n = a + (b - a) * smoothstep(frac);
      const cloud = clamp(dayClear * (0.7 + 0.6 * n), 0.04, 1);
      solarW = Math.round(clear * cloud);
    }

    // Load, on the household's local clock.
    const localMs = ms + this.localOffsetMinutes(ms) * 60_000;
    const localDay = Math.floor(localMs / MS_PER_DAY);
    const hour = (localMs % MS_PER_DAY) / 3_600_000;
    const weekday = (localDay + 4) % 7; // 1970-01-01 was a Thursday (4)
    const weekend = weekday === 0 || weekday === 6;
    const morning = (weekend ? 520 : 760) * bump(hour, weekend ? 9.0 : 7.4, weekend ? 1.4 : 0.9);
    const midday = (weekend ? 380 : 120) * bump(hour, 13.0, 2.0);
    const evening = 1500 * bump(hour, 18.9, 1.5);
    const late = 260 * bump(hour, 22.2, 0.9);
    const base = 210 + 90 * unit(config.seed, localDay, 7);
    const dayScale = 0.85 + 0.3 * unit(config.seed, localDay, 8);
    const wobble = 0.94 + 0.12 * unit(config.seed, index, 9);
    const block = Math.floor(index / 3);
    let spike = 0;
    if (
      hour >= 6 &&
      hour < 22 &&
      unit(config.seed, block, 10) < 0.07 &&
      unit(config.seed, index, 12) < 0.7
    ) {
      spike = 1800 + 900 * unit(config.seed, block, 11);
    }
    const loadW = Math.round(
      Math.max(90, (base + (morning + midday + evening + late) * dayScale) * wobble + spike),
    );

    // Battery on a self-consumption policy.
    const capacity = config.batteryCapacityWh;
    const reserve = (capacity * config.batteryReservePercent) / 100;
    const net = solarW - loadW;
    let batteryW = 0;
    if (net > 0) {
      const room = (capacity - this.energyWh) / STEP_HOURS;
      batteryW = -Math.round(Math.max(0, Math.min(net, config.batteryMaxPowerW, room)));
    } else if (net < 0) {
      const available = (this.energyWh - reserve) / STEP_HOURS;
      batteryW = Math.round(Math.max(0, Math.min(-net, config.batteryMaxPowerW, available)));
    }
    const gridW = loadW - solarW - batteryW;

    // Record the snapshot (level before this step's flow), then move the battery.
    this.solar.push(solarW);
    this.battery.push(batteryW);
    this.grid.push(gridW);
    this.load.push(loadW);
    this.soc.push(Math.round((this.energyWh / capacity) * 1000) / 10);
    this.energyWh = clamp(this.energyWh - batteryW * STEP_HOURS, reserve, capacity);
  }
}

let defaultModel: DemoSiteModel | undefined;

/** The shared model for `DEFAULT_DEMO_SITE`. Its cache is deterministic, so sharing it changes no result. */
export function defaultDemoSiteModel(): DemoSiteModel {
  defaultModel ??= new DemoSiteModel(DEFAULT_DEMO_SITE);
  return defaultModel;
}
