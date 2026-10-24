import { formatInstant, localDayBounds, addLocalDays } from '../telemetry/timestamps';
import type { DemoEnergyInterval, DemoPowerSample } from '../telemetry/types';
import {
  DEMO_ENERGY_INTERVAL_SECONDS,
  DEMO_EPOCH_MS,
  DEMO_HORIZON_MS,
  DEMO_STEP_MS,
  DEMO_STEP_SECONDS,
  defaultDemoSiteModel,
} from './demo-model';
import type { DemoSiteModel } from './demo-model';

/**
 * SYNTHETIC datasets for a day, a week and a month. All of it is made up and every record says `source: 'DEMO'`.
 * Generated on demand from the seeded model, not stored, so the same call always returns the same records
 * (D-054). Reusable by later tasks: the Live View, analytics and tariff tests all start from these.
 *
 * Anchors, all in the demo site's own zone (Europe/Dublin by default):
 *  - day:   Sunday 2026-06-21, the longest day (24 h).
 *  - week:  Saturday 2026-10-24 to Friday 2026-10-30, which contains the clocks going back on 2026-10-25
 *           (a 25-hour local day), so the week has 169 hours, not 168.
 *  - month: June 2026 (30 local days).
 */

export const DEMO_DATASET_IDS = ['DEMO_DAY', 'DEMO_WEEK', 'DEMO_MONTH'] as const;
export type DemoDatasetId = (typeof DEMO_DATASET_IDS)[number];

export interface DemoDataset {
  readonly id: DemoDatasetId;
  readonly description: string;
  readonly source: 'DEMO';
  readonly seed: number;
  readonly timezone: string;
  /** Inclusive start of the covered range, UTC. */
  readonly from: string;
  /** Exclusive end of the covered range, UTC. */
  readonly to: string;
  /** Power snapshots every 300 s in `[from, to)`. */
  readonly power: readonly DemoPowerSample[];
  /** Energy intervals of 900 s covering `[from, to)`. */
  readonly energy: readonly DemoEnergyInterval[];
}

/** Synthetic snapshots every 300 s whose instant falls in `[fromMs, toMs)`. `receivedAt` equals `sampledAt`. */
export function demoPowerSamples(
  model: DemoSiteModel,
  fromMs: number,
  toMs: number,
): DemoPowerSample[] {
  if (!(toMs > fromMs)) throw new RangeError('toMs must be after fromMs');
  const first = Math.max(Math.ceil((fromMs - DEMO_EPOCH_MS) / DEMO_STEP_MS), 0);
  const samples: DemoPowerSample[] = [];
  for (let index = first; ; index += 1) {
    const ms = model.stepStartMs(index);
    if (ms >= toMs) break;
    if (ms >= DEMO_HORIZON_MS) throw new RangeError('Range runs past the end of the demo world');
    const v = model.valuesAt(index);
    const instant = formatInstant(ms);
    samples.push({
      sampledAt: instant,
      receivedAt: instant,
      timestampOrigin: 'PROVIDER',
      solarPowerW: v.solarPowerW,
      batteryPowerW: v.batteryPowerW,
      gridPowerW: v.gridPowerW,
      loadPowerW: v.loadPowerW,
      batterySocPercent: v.batterySocPercent,
      gridStatus: 'SystemGridConnected',
      quality: 'OK',
      source: 'DEMO',
    });
  }
  return samples;
}

const STEPS_PER_INTERVAL = DEMO_ENERGY_INTERVAL_SECONDS / DEMO_STEP_SECONDS;

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Synthetic energy intervals of 900 s, aligned to the demo epoch, that overlap `[fromMs, toMs)`. Each interval's
 * energy is the sum of its three power steps (Wh = W x 300 s / 3600), split by direction, rounded to 0.1 Wh.
 * By construction the energy balance holds within rounding.
 */
export function demoEnergyIntervals(
  model: DemoSiteModel,
  fromMs: number,
  toMs: number,
): DemoEnergyInterval[] {
  if (!(toMs > fromMs)) throw new RangeError('toMs must be after fromMs');
  const lengthMs = DEMO_ENERGY_INTERVAL_SECONDS * 1000;
  const firstInterval = Math.max(Math.floor((fromMs - DEMO_EPOCH_MS) / lengthMs), 0);
  const intervals: DemoEnergyInterval[] = [];
  for (let k = firstInterval; ; k += 1) {
    const startMs = DEMO_EPOCH_MS + k * lengthMs;
    if (startMs >= toMs) break;
    if (startMs + lengthMs > DEMO_HORIZON_MS) {
      throw new RangeError('Range runs past the end of the demo world');
    }
    let solar = 0;
    let home = 0;
    let imported = 0;
    let exported = 0;
    let charged = 0;
    let discharged = 0;
    for (let s = 0; s < STEPS_PER_INTERVAL; s += 1) {
      const v = model.valuesAt(k * STEPS_PER_INTERVAL + s);
      solar += v.solarPowerW;
      home += v.loadPowerW;
      if (v.gridPowerW > 0) imported += v.gridPowerW;
      else exported -= v.gridPowerW;
      if (v.batteryPowerW > 0) discharged += v.batteryPowerW;
      else charged -= v.batteryPowerW;
    }
    const toWh = DEMO_STEP_SECONDS / 3600;
    intervals.push({
      intervalStart: formatInstant(startMs),
      intervalEnd: formatInstant(startMs + lengthMs),
      resolutionSeconds: DEMO_ENERGY_INTERVAL_SECONDS,
      solarGeneratedWh: oneDecimal(solar * toWh),
      homeConsumedWh: oneDecimal(home * toWh),
      gridImportWh: oneDecimal(imported * toWh),
      gridExportWh: oneDecimal(exported * toWh),
      batteryChargedWh: oneDecimal(charged * toWh),
      batteryDischargedWh: oneDecimal(discharged * toWh),
      source: 'DEMO',
      quality: 'OK',
    });
  }
  return intervals;
}

function buildDataset(
  id: DemoDatasetId,
  description: string,
  model: DemoSiteModel,
  fromMs: number,
  toMs: number,
): DemoDataset {
  return {
    id,
    description,
    source: 'DEMO',
    seed: model.config.seed,
    timezone: model.config.timezone,
    from: formatInstant(fromMs),
    to: formatInstant(toMs),
    power: demoPowerSamples(model, fromMs, toMs),
    energy: demoEnergyIntervals(model, fromMs, toMs),
  };
}

function localRange(
  model: DemoSiteModel,
  firstDate: string,
  lastDate: string,
): { fromMs: number; toMs: number } {
  const zone = model.config.timezone;
  return {
    fromMs: localDayBounds(firstDate, zone).startMs,
    toMs: localDayBounds(lastDate, zone).endMs,
  };
}

/** One summer day: the local day 2026-06-21. */
export function demoDay(model: DemoSiteModel = defaultDemoSiteModel()): DemoDataset {
  const { fromMs, toMs } = localRange(model, '2026-06-21', '2026-06-21');
  return buildDataset(
    'DEMO_DAY',
    'Local day 2026-06-21 (summer solstice, 24 h)',
    model,
    fromMs,
    toMs,
  );
}

/** Seven local days from 2026-10-24, including the 25-hour day of 2026-10-25 when the clocks go back. */
export function demoWeek(model: DemoSiteModel = defaultDemoSiteModel()): DemoDataset {
  const { fromMs, toMs } = localRange(model, '2026-10-24', addLocalDays('2026-10-24', 6));
  return buildDataset(
    'DEMO_WEEK',
    'Local days 2026-10-24 to 2026-10-30, including the 25-hour day when the clocks go back',
    model,
    fromMs,
    toMs,
  );
}

/** June 2026: 30 local days. */
export function demoMonth(model: DemoSiteModel = defaultDemoSiteModel()): DemoDataset {
  const { fromMs, toMs } = localRange(model, '2026-06-01', '2026-06-30');
  return buildDataset('DEMO_MONTH', 'Local days 2026-06-01 to 2026-06-30', model, fromMs, toMs);
}

/** The dataset with the given id. */
export function demoDataset(id: DemoDatasetId, model?: DemoSiteModel): DemoDataset {
  switch (id) {
    case 'DEMO_DAY':
      return demoDay(model);
    case 'DEMO_WEEK':
      return demoWeek(model);
    case 'DEMO_MONTH':
      return demoMonth(model);
  }
}

/** Samples outside `[fromMs, toMs)`: a way to make a series with a hole in it. Never fills or interpolates. */
export function withoutSamplesBetween<T extends { readonly sampledAt: string }>(
  samples: readonly T[],
  from: string,
  to: string,
): T[] {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  return samples.filter((s) => {
    const ms = Date.parse(s.sampledAt);
    return ms < fromMs || ms >= toMs;
  });
}

/**
 * The summer day with 10:00 to 11:30 UTC missing: 18 absent snapshots. Gap detection sees one gap of 5700 seconds,
 * from the last snapshot present (09:55) to the next one present (11:30).
 */
export function demoDayWithGap(model?: DemoSiteModel): DemoDataset {
  const day = demoDay(model);
  return {
    ...day,
    description: `${day.description}, with 10:00 to 11:30 UTC missing`,
    power: withoutSamplesBetween(day.power, '2026-06-21T10:00:00Z', '2026-06-21T11:30:00Z'),
  };
}
