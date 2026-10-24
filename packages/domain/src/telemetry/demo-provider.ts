import { MAX_RANGE_DAYS } from '@autopw3/shared';
import type { EnergyResolution, EnergySeriesPoint } from '@autopw3/shared';
import type { Clock } from '../clock';
import {
  DEMO_ENERGY_INTERVAL_SECONDS,
  DEMO_EPOCH_MS,
  DEMO_HORIZON_MS,
  DEMO_STEP_SECONDS,
  defaultDemoSiteModel,
} from '../fixtures/demo-model';
import type { DemoSiteModel } from '../fixtures/demo-model';
import { demoEnergyIntervals, demoPowerSamples } from '../fixtures/datasets';
import { DEMO_SCENARIOS } from '../fixtures/scenarios';
import type { DemoScenarioId } from '../fixtures/scenarios';
import { normalisePowerReading } from './normalise';
import { TelemetryProviderError, checkRange } from './provider';
import type {
  EnergySeriesRequest,
  EnergySeriesResult,
  LiveSnapshotResult,
  PowerSeriesRequest,
  PowerSeriesResult,
  TelemetryCapabilities,
  TelemetryProvider,
} from './provider';
import { coverageFraction, detectGapsInRange } from './series';
import {
  addLocalDays,
  formatInstant,
  isKnownTimeZone,
  localDateOf,
  localDayBounds,
} from './timestamps';
import type { DemoEnergyInterval } from './types';

/**
 * The demo telemetry provider: a `TelemetryProvider<'DEMO'>` over the synthetic site in `fixtures/`. It needs no
 * network, no credentials and no database, and it never persists anything. Every sample says `source: 'DEMO'`.
 *
 * It answers from an injected `Clock`, so a test using `FixedClock` always gets the same snapshot. Choose a named
 * scenario (`scenario`) to get one fixed situation (surplus, low battery, stale, invalid ...) instead of the
 * time-of-day model; the series methods always use the model.
 *
 * `apps/worker/src/providers/demo` (TASK-14) wraps this for the `/demo/*` routes.
 */

export interface DemoProviderOptions {
  readonly clock: Clock;
  /** The synthetic site. Default: the shared Dublin-like site. */
  readonly model?: DemoSiteModel;
  /** Serve this scenario's reading as the live snapshot instead of the model's. */
  readonly scenario?: DemoScenarioId;
}

function outOfCoverage(): TelemetryProviderError {
  return new TelemetryProviderError(
    'OUT_OF_COVERAGE',
    'The demo world covers 2026-01-01 up to (not including) 2031-01-01',
  );
}

/** A RangeError from the model means the request ran outside the demo world; anything else passes through. */
function asProviderError(error: unknown): Error {
  if (error instanceof TelemetryProviderError) return error;
  if (error instanceof RangeError) return outOfCoverage();
  return error instanceof Error ? error : new Error('Demo provider failed');
}

function checkCoverage(fromMs: number, toMs: number): void {
  if (fromMs < DEMO_EPOCH_MS || toMs > DEMO_HORIZON_MS) throw outOfCoverage();
}

function sumPoint(
  start: number,
  end: number,
  intervals: readonly DemoEnergyInterval[],
  localDate: string | undefined,
): EnergySeriesPoint {
  const total = (pick: (i: DemoEnergyInterval) => number | null): number | null => {
    let sum = 0;
    for (const interval of intervals) {
      const value = pick(interval);
      if (value === null) return null;
      sum += value;
    }
    return Math.round(sum * 10) / 10;
  };
  const covered = intervals.reduce((s, i) => s + i.resolutionSeconds, 0);
  const point: EnergySeriesPoint = {
    start: formatInstant(start),
    end: formatInstant(end),
    ...(localDate === undefined ? {} : { localDate }),
    solarGeneratedWh: total((i) => i.solarGeneratedWh),
    homeConsumedWh: total((i) => i.homeConsumedWh),
    gridImportWh: total((i) => i.gridImportWh),
    gridExportWh: total((i) => i.gridExportWh),
    batteryChargedWh: total((i) => i.batteryChargedWh),
    batteryDischargedWh: total((i) => i.batteryDischargedWh),
    completeness: Math.min(1, covered / ((end - start) / 1000)),
    resolutionSecondsMin: DEMO_ENERGY_INTERVAL_SECONDS,
    resolutionSecondsMax: DEMO_ENERGY_INTERVAL_SECONDS,
    quality: 'OK',
  };
  return point;
}

const MAX_DAYS: Readonly<Record<EnergyResolution, number>> = {
  interval: MAX_RANGE_DAYS.interval,
  hourly: MAX_RANGE_DAYS.hourly,
  daily: MAX_RANGE_DAYS.daily,
};

export function createDemoTelemetryProvider(
  options: DemoProviderOptions,
): TelemetryProvider<'DEMO'> {
  const model = options.model ?? defaultDemoSiteModel();
  const { clock, scenario } = options;

  return {
    source: 'DEMO',

    getCapabilities(): TelemetryCapabilities {
      return {
        source: 'DEMO',
        synthetic: true,
        verification: 'SYNTHETIC',
        live: { supported: true, nativeCadenceSeconds: DEMO_STEP_SECONDS, cadenceVerified: true },
        powerSeries: {
          supported: true,
          resolutionSeconds: DEMO_STEP_SECONDS,
          maxRangeDays: MAX_RANGE_DAYS.power,
        },
        energySeries: {
          resolutions: ['interval', 'hourly', 'daily'],
          nativeIntervalSeconds: DEMO_ENERGY_INTERVAL_SECONDS,
          maxRangeDays: MAX_DAYS,
        },
        fields: {
          solarPowerW: 'SUPPORTED',
          batteryPowerW: 'SUPPORTED',
          gridPowerW: 'SUPPORTED',
          loadPowerW: 'SUPPORTED',
          batterySocPercent: 'SUPPORTED',
          gridStatus: 'SUPPORTED',
        },
      };
    },

    getLiveSnapshot(): Promise<LiveSnapshotResult<'DEMO'>> {
      const now = clock.now();
      const nowMs = now.getTime();
      try {
        if (scenario !== undefined) {
          const chosen = DEMO_SCENARIOS[scenario];
          const { sample, issues } = normalisePowerReading(
            { ...chosen.raw, sampledAt: nowMs - chosen.ageSeconds * 1000 },
            { source: 'DEMO', receivedAt: now },
          );
          return Promise.resolve({ source: 'DEMO', sample, issues });
        }
        if (nowMs < DEMO_EPOCH_MS || nowMs >= DEMO_HORIZON_MS) throw outOfCoverage();
        const index = model.stepIndexAt(nowMs);
        const values = model.valuesAt(index);
        const { sample, issues } = normalisePowerReading(
          { ...values, sampledAt: model.stepStartMs(index), gridStatus: 'SystemGridConnected' },
          { source: 'DEMO', receivedAt: now },
        );
        return Promise.resolve({ source: 'DEMO', sample, issues });
      } catch (error) {
        return Promise.reject(asProviderError(error));
      }
    },

    getPowerSeries(request: PowerSeriesRequest): Promise<PowerSeriesResult<'DEMO'>> {
      try {
        const { fromMs, toMs } = checkRange(request.from, request.to, MAX_RANGE_DAYS.power);
        checkCoverage(fromMs, toMs);
        const samples = demoPowerSamples(model, fromMs, toMs);
        const range = { from: formatInstant(fromMs), to: formatInstant(toMs) };
        const gapOptions = { expectedIntervalSeconds: DEMO_STEP_SECONDS };
        return Promise.resolve({
          source: 'DEMO',
          resolutionSeconds: DEMO_STEP_SECONDS,
          samples,
          gaps: detectGapsInRange(samples, range, gapOptions),
          completeness: coverageFraction(samples, range, gapOptions),
        });
      } catch (error) {
        return Promise.reject(asProviderError(error));
      }
    },

    getEnergySeries(request: EnergySeriesRequest): Promise<EnergySeriesResult<'DEMO'>> {
      try {
        const { resolution } = request;
        const { fromMs, toMs } = checkRange(request.from, request.to, MAX_DAYS[resolution]);
        if (!isKnownTimeZone(request.timezone)) {
          throw new TelemetryProviderError('INVALID_REQUEST', 'timezone must be an IANA zone name');
        }
        const items: EnergySeriesPoint[] = [];
        if (resolution === 'interval') {
          const start = Math.floor(
            (fromMs - DEMO_EPOCH_MS) / (DEMO_ENERGY_INTERVAL_SECONDS * 1000),
          );
          const alignedFrom = DEMO_EPOCH_MS + start * DEMO_ENERGY_INTERVAL_SECONDS * 1000;
          checkCoverage(alignedFrom, toMs);
          for (const interval of demoEnergyIntervals(model, alignedFrom, toMs)) {
            items.push(
              sumPoint(
                Date.parse(interval.intervalStart),
                Date.parse(interval.intervalEnd),
                [interval],
                undefined,
              ),
            );
          }
        } else if (resolution === 'hourly') {
          const hour = 3_600_000;
          let bucketStart = Math.floor(fromMs / hour) * hour;
          checkCoverage(bucketStart, Math.ceil(toMs / hour) * hour);
          for (; bucketStart < toMs; bucketStart += hour) {
            items.push(
              sumPoint(
                bucketStart,
                bucketStart + hour,
                demoEnergyIntervals(model, bucketStart, bucketStart + hour),
                undefined,
              ),
            );
          }
        } else {
          let date = localDateOf(fromMs, request.timezone);
          for (;;) {
            const bounds = localDayBounds(date, request.timezone);
            if (bounds.startMs >= toMs) break;
            checkCoverage(bounds.startMs, bounds.endMs);
            items.push(
              sumPoint(
                bounds.startMs,
                bounds.endMs,
                demoEnergyIntervals(model, bounds.startMs, bounds.endMs),
                date,
              ),
            );
            date = addLocalDays(date, 1);
          }
        }
        return Promise.resolve({ source: 'DEMO', resolution, items });
      } catch (error) {
        return Promise.reject(asProviderError(error));
      }
    },
  };
}
