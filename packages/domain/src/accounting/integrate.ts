import type { DataSource } from '@autopw3/shared';
import { dedupeBySampledAt, sortBySampledAt } from '../telemetry/series';
import { formatInstant, parseInstantMs } from '../telemetry/timestamps';
import type { EnergyIntervalOf, PowerSampleOf } from '../telemetry/types';

/**
 * Power-to-energy integration (ENERGY_ACCOUNTING section 4, TASK-11).
 *
 * Converts instantaneous power samples (W) into directional energy intervals (Wh).
 * Uses step (left-Riemann / hold-last) integration:
 * - Each power reading is assumed constant over the step until the next sample.
 * - For a step of duration dt seconds between samples: Wh = W * (dt / 3600).
 * - Steps exceeding `maxGapSeconds` (default: 3600 s or 2x expectedInterval) are identified as gaps
 *   and left UNCOVERED (never interpolated or zero-filled).
 * - Directional signs:
 *   * solarPowerW >= 0 -> solarGeneratedWh
 *   * loadPowerW >= 0 -> homeConsumedWh
 *   * gridPowerW > 0 -> gridImportWh; gridPowerW < 0 -> gridExportWh (|gridPowerW|)
 *   * batteryPowerW > 0 -> batteryDischargedWh; batteryPowerW < 0 -> batteryChargedWh (|batteryPowerW|)
 * - Produced intervals are tagged with quality `DERIVED`.
 */

export interface IntegratePowerOptions {
  /** Expected interval between samples in seconds (default: 300). */
  readonly expectedIntervalSeconds?: number;
  /** Max spacing before a step is treated as a gap and left uncovered (default: 3600). */
  readonly maxGapSeconds?: number;
  /**
   * Optional bucket resolution in seconds (e.g. 900 for 15-minute intervals).
   * When specified, steps are partitioned into fixed UTC-aligned buckets.
   * When omitted, each consecutive sample pair produces one step interval.
   */
  readonly bucketSeconds?: number;
}

interface StepAccumulator {
  solarWh: number | null;
  homeWh: number | null;
  gridImportWh: number | null;
  gridExportWh: number | null;
  batteryChargedWh: number | null;
  batteryDischargedWh: number | null;
  hasSolar: boolean;
  hasHome: boolean;
  hasGrid: boolean;
  hasBattery: boolean;
}

function emptyAccumulator(): StepAccumulator {
  return {
    solarWh: null,
    homeWh: null,
    gridImportWh: null,
    gridExportWh: null,
    batteryChargedWh: null,
    batteryDischargedWh: null,
    hasSolar: false,
    hasHome: false,
    hasGrid: false,
    hasBattery: false,
  };
}

function addStepEnergy(
  acc: StepAccumulator,
  sample: PowerSampleOf<DataSource>,
  dtSeconds: number,
): void {
  const hours = dtSeconds / 3600;

  if (sample.solarPowerW !== null) {
    acc.hasSolar = true;
    acc.solarWh = (acc.solarWh ?? 0) + sample.solarPowerW * hours;
  }
  if (sample.loadPowerW !== null) {
    acc.hasHome = true;
    acc.homeWh = (acc.homeWh ?? 0) + sample.loadPowerW * hours;
  }
  if (sample.gridPowerW !== null) {
    acc.hasGrid = true;
    if (sample.gridPowerW > 0) {
      acc.gridImportWh = (acc.gridImportWh ?? 0) + sample.gridPowerW * hours;
      acc.gridExportWh = acc.gridExportWh ?? 0;
    } else if (sample.gridPowerW < 0) {
      acc.gridExportWh = (acc.gridExportWh ?? 0) + -sample.gridPowerW * hours;
      acc.gridImportWh = acc.gridImportWh ?? 0;
    } else {
      acc.gridImportWh = acc.gridImportWh ?? 0;
      acc.gridExportWh = acc.gridExportWh ?? 0;
    }
  }
  if (sample.batteryPowerW !== null) {
    acc.hasBattery = true;
    if (sample.batteryPowerW > 0) {
      acc.batteryDischargedWh = (acc.batteryDischargedWh ?? 0) + sample.batteryPowerW * hours;
      acc.batteryChargedWh = acc.batteryChargedWh ?? 0;
    } else if (sample.batteryPowerW < 0) {
      acc.batteryChargedWh = (acc.batteryChargedWh ?? 0) + -sample.batteryPowerW * hours;
      acc.batteryDischargedWh = acc.batteryDischargedWh ?? 0;
    } else {
      acc.batteryChargedWh = acc.batteryChargedWh ?? 0;
      acc.batteryDischargedWh = acc.batteryDischargedWh ?? 0;
    }
  }
}

/** Round energy to 0.1 Wh precision (matching demo provider specification). */
function roundWh(val: number | null): number | null {
  if (val === null) return null;
  return Math.round(val * 10) / 10;
}

/**
 * Converts a series of power samples to energy intervals using left-Riemann integration.
 */
export function powerSamplesToEnergyIntervals<S extends DataSource>(
  samples: readonly PowerSampleOf<S>[],
  options: IntegratePowerOptions = {},
): EnergyIntervalOf<S>[] {
  if (samples.length < 2) return [];

  const maxGap = options.maxGapSeconds ?? 3600;
  const sorted = sortBySampledAt(samples);
  const { items: deduped } = dedupeBySampledAt(sorted);
  const nonSuspect = deduped.filter((s) => s.quality !== 'SUSPECT');

  if (nonSuspect.length < 2) return [];

  const source = nonSuspect[0]?.source as S;
  const bucketSeconds = options.bucketSeconds;

  if (bucketSeconds !== undefined && bucketSeconds > 0) {
    // Aligned bucketing integration
    const bucketMs = bucketSeconds * 1000;
    const intervals: EnergyIntervalOf<S>[] = [];

    // Bucket start timestamp -> accumulator
    const buckets = new Map<number, { acc: StepAccumulator; count: number }>();

    for (let i = 0; i + 1 < nonSuspect.length; i += 1) {
      const curr = nonSuspect[i];
      const next = nonSuspect[i + 1];
      if (!curr || !next) continue;

      const currMs = parseInstantMs(curr.sampledAt);
      const nextMs = parseInstantMs(next.sampledAt);
      if (currMs === null || nextMs === null || nextMs <= currMs) continue;

      const dt = (nextMs - currMs) / 1000;
      if (dt > maxGap) continue; // Gap: do not integrate across gap

      // Split step across any bucket boundaries
      let tCursor = currMs;
      while (tCursor < nextMs) {
        const bucketStart = Math.floor(tCursor / bucketMs) * bucketMs;
        const bucketEnd = bucketStart + bucketMs;
        const subEnd = Math.min(nextMs, bucketEnd);
        const subDt = (subEnd - tCursor) / 1000;

        let entry = buckets.get(bucketStart);
        if (!entry) {
          entry = { acc: emptyAccumulator(), count: 0 };
          buckets.set(bucketStart, entry);
        }
        addStepEnergy(entry.acc, curr, subDt);
        entry.count += 1;

        tCursor = subEnd;
      }
    }

    const sortedBucketStarts = [...buckets.keys()].sort((a, b) => a - b);
    for (const bStart of sortedBucketStarts) {
      const entry = buckets.get(bStart);
      if (!entry) continue;
      const bEnd = bStart + bucketMs;
      intervals.push({
        intervalStart: formatInstant(bStart),
        intervalEnd: formatInstant(bEnd),
        resolutionSeconds: bucketSeconds,
        solarGeneratedWh: roundWh(entry.acc.solarWh),
        homeConsumedWh: roundWh(entry.acc.homeWh),
        gridImportWh: roundWh(entry.acc.gridImportWh),
        gridExportWh: roundWh(entry.acc.gridExportWh),
        batteryChargedWh: roundWh(entry.acc.batteryChargedWh),
        batteryDischargedWh: roundWh(entry.acc.batteryDischargedWh),
        source,
        quality: 'DERIVED',
      });
    }

    return intervals;
  }

  // Step-by-step intervals
  const intervals: EnergyIntervalOf<S>[] = [];
  for (let i = 0; i + 1 < nonSuspect.length; i += 1) {
    const curr = nonSuspect[i];
    const next = nonSuspect[i + 1];
    if (!curr || !next) continue;

    const currMs = parseInstantMs(curr.sampledAt);
    const nextMs = parseInstantMs(next.sampledAt);
    if (currMs === null || nextMs === null || nextMs <= currMs) continue;

    const dt = (nextMs - currMs) / 1000;
    if (dt > maxGap) continue; // Gap: leave uncovered

    const acc = emptyAccumulator();
    addStepEnergy(acc, curr, dt);

    intervals.push({
      intervalStart: formatInstant(currMs),
      intervalEnd: formatInstant(nextMs),
      resolutionSeconds: Math.round(dt),
      solarGeneratedWh: roundWh(acc.solarWh),
      homeConsumedWh: roundWh(acc.homeWh),
      gridImportWh: roundWh(acc.gridImportWh),
      gridExportWh: roundWh(acc.gridExportWh),
      batteryChargedWh: roundWh(acc.batteryChargedWh),
      batteryDischargedWh: roundWh(acc.batteryDischargedWh),
      source,
      quality: 'DERIVED',
    });
  }

  return intervals;
}
