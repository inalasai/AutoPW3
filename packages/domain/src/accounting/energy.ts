import type { DataSource } from '@autopw3/shared';
import { Decimal, exact, whToKwh } from '../tariff/money';
import { parseInstantMs } from '../telemetry/timestamps';
import type { EnergyIntervalOf } from '../telemetry/types';
import type { AccountingPeriod, CompletenessReport, EnergyTotals } from './types';

/**
 * Energy aggregations and completeness tracking (ENERGY_ACCOUNTING section 4 & 6).
 *
 * Sums all energy flows using exact decimal arithmetic.
 * Null values represent unavailable data from the provider and are NOT coerced to zero;
 * they are excluded from the sum and lower fieldCompleteness.
 */

export function aggregateEnergyTotals<S extends DataSource>(
  intervals: readonly EnergyIntervalOf<S>[],
): EnergyTotals {
  let solarWh = new Decimal(0);
  let homeWh = new Decimal(0);
  let gridImportWh = new Decimal(0);
  let gridExportWh = new Decimal(0);
  let batteryChargedWh = new Decimal(0);
  let batteryDischargedWh = new Decimal(0);

  for (const interval of intervals) {
    if (interval.solarGeneratedWh !== null) {
      solarWh = solarWh.plus(new Decimal(String(interval.solarGeneratedWh)));
    }
    if (interval.homeConsumedWh !== null) {
      homeWh = homeWh.plus(new Decimal(String(interval.homeConsumedWh)));
    }
    if (interval.gridImportWh !== null) {
      gridImportWh = gridImportWh.plus(new Decimal(String(interval.gridImportWh)));
    }
    if (interval.gridExportWh !== null) {
      gridExportWh = gridExportWh.plus(new Decimal(String(interval.gridExportWh)));
    }
    if (interval.batteryChargedWh !== null) {
      batteryChargedWh = batteryChargedWh.plus(new Decimal(String(interval.batteryChargedWh)));
    }
    if (interval.batteryDischargedWh !== null) {
      batteryDischargedWh = batteryDischargedWh.plus(
        new Decimal(String(interval.batteryDischargedWh)),
      );
    }
  }

  const netGrid = gridImportWh.minus(gridExportWh);
  const netBattery = batteryDischargedWh.minus(batteryChargedWh);

  return {
    solarGeneratedWh: exact(solarWh),
    homeConsumedWh: exact(homeWh),
    gridImportWh: exact(gridImportWh),
    gridExportWh: exact(gridExportWh),
    batteryChargedWh: exact(batteryChargedWh),
    batteryDischargedWh: exact(batteryDischargedWh),
    netGridWh: exact(netGrid),
    netBatteryWh: exact(netBattery),

    solarGeneratedKwh: exact(whToKwh(solarWh)),
    homeConsumedKwh: exact(whToKwh(homeWh)),
    gridImportKwh: exact(whToKwh(gridImportWh)),
    gridExportKwh: exact(whToKwh(gridExportWh)),
    batteryChargedKwh: exact(whToKwh(batteryChargedWh)),
    batteryDischargedKwh: exact(whToKwh(batteryDischargedWh)),
  };
}

interface Span {
  startMs: number;
  endMs: number;
}

/** Merges overlapping spans and sums total covered seconds within [boundStartMs, boundEndMs). */
function sumCoveredSecondsInBound(spans: Span[], boundStartMs: number, boundEndMs: number): number {
  if (spans.length === 0 || boundEndMs <= boundStartMs) return 0;

  // Clip spans to period bound
  const clipped: Span[] = [];
  for (const s of spans) {
    const start = Math.max(s.startMs, boundStartMs);
    const end = Math.min(s.endMs, boundEndMs);
    if (end > start) clipped.push({ startMs: start, endMs: end });
  }

  if (clipped.length === 0) return 0;
  clipped.sort((a, b) => a.startMs - b.startMs);

  let coveredMs = 0;
  let currentStart = clipped[0]?.startMs ?? 0;
  let currentEnd = clipped[0]?.endMs ?? 0;

  for (let i = 1; i < clipped.length; i += 1) {
    const span = clipped[i];
    if (!span) continue;
    if (span.startMs <= currentEnd) {
      currentEnd = Math.max(currentEnd, span.endMs);
    } else {
      coveredMs += currentEnd - currentStart;
      currentStart = span.startMs;
      currentEnd = span.endMs;
    }
  }
  coveredMs += currentEnd - currentStart;

  return Math.round(coveredMs / 1000);
}

/**
 * Computes completeness ratio, resolution bounds, and per-field availability.
 */
export function computeCompletenessReport<S extends DataSource>(
  intervals: readonly EnergyIntervalOf<S>[],
  period: AccountingPeriod,
  excludedSuspectCount: number,
): CompletenessReport {
  const fromMs = parseInstantMs(period.from);
  const toMs = parseInstantMs(period.to);
  const expectedSeconds =
    fromMs !== null && toMs !== null && toMs > fromMs ? Math.round((toMs - fromMs) / 1000) : 0;

  let minRes: number | null = null;
  let maxRes: number | null = null;

  const allSpans: Span[] = [];
  const solarSpans: Span[] = [];
  const homeSpans: Span[] = [];
  const importSpans: Span[] = [];
  const exportSpans: Span[] = [];
  const batteryChSpans: Span[] = [];
  const batteryDisSpans: Span[] = [];

  for (const interval of intervals) {
    const startMs = parseInstantMs(interval.intervalStart);
    const endMs = parseInstantMs(interval.intervalEnd);
    if (startMs === null || endMs === null || endMs <= startMs) continue;

    const span = { startMs, endMs };
    allSpans.push(span);

    const res = interval.resolutionSeconds;
    if (minRes === null || res < minRes) minRes = res;
    if (maxRes === null || res > maxRes) maxRes = res;

    if (interval.solarGeneratedWh !== null) solarSpans.push(span);
    if (interval.homeConsumedWh !== null) homeSpans.push(span);
    if (interval.gridImportWh !== null) importSpans.push(span);
    if (interval.gridExportWh !== null) exportSpans.push(span);
    if (interval.batteryChargedWh !== null) batteryChSpans.push(span);
    if (interval.batteryDischargedWh !== null) batteryDisSpans.push(span);
  }

  const boundStart = fromMs ?? 0;
  const boundEnd = toMs ?? 0;

  const coveredSeconds = sumCoveredSecondsInBound(allSpans, boundStart, boundEnd);
  const completenessRatio = expectedSeconds > 0 ? Math.min(1, coveredSeconds / expectedSeconds) : 0;

  const fieldRatio = (spans: Span[]): number => {
    if (expectedSeconds <= 0) return 0;
    const sec = sumCoveredSecondsInBound(spans, boundStart, boundEnd);
    return Math.min(1, sec / expectedSeconds);
  };

  return {
    expectedSeconds,
    coveredSeconds,
    completenessRatio,
    totalIntervals: intervals.length + excludedSuspectCount,
    accountedIntervals: intervals.length,
    excludedSuspectIntervals: excludedSuspectCount,
    minResolutionSeconds: minRes,
    maxResolutionSeconds: maxRes,
    fieldCompleteness: {
      solarGenerated: fieldRatio(solarSpans),
      homeConsumed: fieldRatio(homeSpans),
      gridImport: fieldRatio(importSpans),
      gridExport: fieldRatio(exportSpans),
      batteryCharged: fieldRatio(batteryChSpans),
      batteryDischarged: fieldRatio(batteryDisSpans),
    },
  };
}
