import type { DataSource, EnergyResolution, Tariff } from '@autopw3/shared';
import { Decimal } from '@autopw3/shared';
import {
  addLocalDays,
  chargesForLocalDates,
  decimalFrom,
  localDateOf,
  localDayBounds,
  parseInstantMs,
} from '@autopw3/domain';
import type { EnergyIntervalOf, IntervalCostDetail, IntervalPrice } from '@autopw3/domain';
import { toChartNumber } from './format';
import type { CostChartPoint, EnergyChartPoint } from './types';

export const MAX_CHART_POINTS = 500;

function extractPriceAmount(price: IntervalPrice | null | undefined): string | null {
  if (price && (price.status === 'PRICED' || price.status === 'ESTIMATE')) {
    return price.amounts.totalAmount;
  }
  return null;
}

interface IntermediateEnergyBucket {
  timestamp: string;
  label: string;
  solarWh: Decimal;
  homeWh: Decimal;
  gridImportWh: Decimal;
  gridExportWh: Decimal;
  batteryChargedWh: Decimal;
  batteryDischargedWh: Decimal;
  isGap: boolean;
}

interface IntermediateCostBucket {
  timestamp: string;
  label: string;
  importCost: Decimal;
  exportCredit: Decimal;
  standingCharge: Decimal;
  isGap: boolean;
}

function formatHourLabel(isoString: string, timezone: string): string {
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return isoString.substring(11, 16);
  }
}

function formatDateLabel(localDate: string): string {
  try {
    const d = new Date(`${localDate}T00:00:00Z`);
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
    }).format(d);
  } catch {
    return localDate;
  }
}

/**
 * Aggregates intervals and cost details into Chart-ready series.
 */
export function aggregateSeries<S extends DataSource>(
  intervals: readonly EnergyIntervalOf<S>[],
  costDetails: readonly IntervalCostDetail[],
  resolution: EnergyResolution,
  timezone: string,
  tariffs: readonly Tariff[] = [],
): {
  energyPoints: EnergyChartPoint[];
  costPoints: CostChartPoint[];
} {
  const costMap = new Map<string, IntervalCostDetail>();
  for (const detail of costDetails) {
    costMap.set(detail.intervalStart, detail);
  }

  // Pre-calculate daily standing charges if tariffs provided
  const standingChargeMap = new Map<string, Decimal>();
  if (tariffs.length > 0 && intervals.length > 0) {
    const firstStart = intervals[0]?.intervalStart;
    const lastEnd = intervals[intervals.length - 1]?.intervalEnd;
    if (firstStart && lastEnd) {
      const firstMs = parseInstantMs(firstStart);
      const lastMs = parseInstantMs(lastEnd);
      if (firstMs !== null && lastMs !== null) {
        const firstDate = localDateOf(firstMs, timezone);
        const lastDate = localDateOf(lastMs - 1, timezone);
        const nextAfterLast = addLocalDays(lastDate, 1);
        const standingResult = chargesForLocalDates(firstDate, nextAfterLast, tariffs);
        if (standingResult.ok) {
          for (const day of standingResult.days) {
            standingChargeMap.set(day.localDate, decimalFrom(day.amounts.totalAmount));
          }
        }
      }
    }
  }

  if (resolution === 'interval') {
    return aggregateIntervalsDirectly(intervals, costMap, timezone);
  }

  if (resolution === 'hourly') {
    return aggregateHourly(intervals, costMap, timezone);
  }

  // Daily
  return aggregateDaily(intervals, costMap, timezone, standingChargeMap);
}

function aggregateIntervalsDirectly<S extends DataSource>(
  intervals: readonly EnergyIntervalOf<S>[],
  costMap: Map<string, IntervalCostDetail>,
  timezone: string,
): {
  energyPoints: EnergyChartPoint[];
  costPoints: CostChartPoint[];
} {
  const energyRaw: EnergyChartPoint[] = [];
  const costRaw: CostChartPoint[] = [];

  for (const interval of intervals) {
    const isGap = interval.quality === 'SUSPECT';
    const label = formatHourLabel(interval.intervalStart, timezone);
    const solarKwh = toChartNumber(new Decimal(interval.solarGeneratedWh ?? 0).div(1000), 3);
    const homeKwh = toChartNumber(new Decimal(interval.homeConsumedWh ?? 0).div(1000), 3);
    const gridImportKwh = toChartNumber(new Decimal(interval.gridImportWh ?? 0).div(1000), 3);
    const gridExportKwh = toChartNumber(new Decimal(interval.gridExportWh ?? 0).div(1000), 3);
    const batteryChargedKwh = toChartNumber(
      new Decimal(interval.batteryChargedWh ?? 0).div(1000),
      3,
    );
    const batteryDischargedKwh = toChartNumber(
      new Decimal(interval.batteryDischargedWh ?? 0).div(1000),
      3,
    );

    energyRaw.push({
      timestamp: interval.intervalStart,
      label,
      solarKwh,
      homeKwh,
      gridImportKwh,
      gridExportKwh,
      batteryChargedKwh,
      batteryDischargedKwh,
      isGap,
    });

    const costDetail = costMap.get(interval.intervalStart);
    const importAmount = extractPriceAmount(costDetail?.importPrice);
    const exportAmount = extractPriceAmount(costDetail?.exportPrice);
    const importCost = importAmount ? Number(importAmount) : 0;
    const exportCredit = exportAmount ? Number(exportAmount) : 0;
    const netCost = toChartNumber(importCost - exportCredit, 4);

    costRaw.push({
      timestamp: interval.intervalStart,
      label,
      importCost,
      exportCredit,
      netCost,
      isGap,
    });
  }

  return {
    energyPoints: downsampleIfNeeded(energyRaw),
    costPoints: downsampleCostIfNeeded(costRaw),
  };
}

function aggregateHourly<S extends DataSource>(
  intervals: readonly EnergyIntervalOf<S>[],
  costMap: Map<string, IntervalCostDetail>,
  timezone: string,
): {
  energyPoints: EnergyChartPoint[];
  costPoints: CostChartPoint[];
} {
  const energyBuckets = new Map<string, IntermediateEnergyBucket>();
  const costBuckets = new Map<string, IntermediateCostBucket>();

  for (const interval of intervals) {
    const ms = parseInstantMs(interval.intervalStart);
    if (ms === null) continue;
    // Align to start of hour (ms - (ms % 3600000))
    const hourStartMs = Math.floor(ms / (3600 * 1000)) * 3600 * 1000;
    const hourIso = new Date(hourStartMs).toISOString();

    if (!energyBuckets.has(hourIso)) {
      energyBuckets.set(hourIso, {
        timestamp: hourIso,
        label: formatHourLabel(hourIso, timezone),
        solarWh: new Decimal(0),
        homeWh: new Decimal(0),
        gridImportWh: new Decimal(0),
        gridExportWh: new Decimal(0),
        batteryChargedWh: new Decimal(0),
        batteryDischargedWh: new Decimal(0),
        isGap: false,
      });
      costBuckets.set(hourIso, {
        timestamp: hourIso,
        label: formatHourLabel(hourIso, timezone),
        importCost: new Decimal(0),
        exportCredit: new Decimal(0),
        standingCharge: new Decimal(0),
        isGap: false,
      });
    }

    const eb = energyBuckets.get(hourIso)!;
    if (interval.quality === 'SUSPECT') {
      eb.isGap = true;
    } else {
      if (interval.solarGeneratedWh) eb.solarWh = eb.solarWh.plus(interval.solarGeneratedWh);
      if (interval.homeConsumedWh) eb.homeWh = eb.homeWh.plus(interval.homeConsumedWh);
      if (interval.gridImportWh) eb.gridImportWh = eb.gridImportWh.plus(interval.gridImportWh);
      if (interval.gridExportWh) eb.gridExportWh = eb.gridExportWh.plus(interval.gridExportWh);
      if (interval.batteryChargedWh)
        eb.batteryChargedWh = eb.batteryChargedWh.plus(interval.batteryChargedWh);
      if (interval.batteryDischargedWh)
        eb.batteryDischargedWh = eb.batteryDischargedWh.plus(interval.batteryDischargedWh);
    }

    const cb = costBuckets.get(hourIso)!;
    const costDetail = costMap.get(interval.intervalStart);
    const importAmount = extractPriceAmount(costDetail?.importPrice);
    const exportAmount = extractPriceAmount(costDetail?.exportPrice);
    if (importAmount) {
      cb.importCost = cb.importCost.plus(decimalFrom(importAmount));
    }
    if (exportAmount) {
      cb.exportCredit = cb.exportCredit.plus(decimalFrom(exportAmount));
    }
    if (interval.quality === 'SUSPECT') {
      cb.isGap = true;
    }
  }

  const energyPoints: EnergyChartPoint[] = [];
  for (const b of energyBuckets.values()) {
    energyPoints.push({
      timestamp: b.timestamp,
      label: b.label,
      solarKwh: toChartNumber(b.solarWh.div(1000), 3),
      homeKwh: toChartNumber(b.homeWh.div(1000), 3),
      gridImportKwh: toChartNumber(b.gridImportWh.div(1000), 3),
      gridExportKwh: toChartNumber(b.gridExportWh.div(1000), 3),
      batteryChargedKwh: toChartNumber(b.batteryChargedWh.div(1000), 3),
      batteryDischargedKwh: toChartNumber(b.batteryDischargedWh.div(1000), 3),
      isGap: b.isGap,
    });
  }

  const costPoints: CostChartPoint[] = [];
  for (const b of costBuckets.values()) {
    const importNum = toChartNumber(b.importCost, 2);
    const exportNum = toChartNumber(b.exportCredit, 2);
    const netNum = toChartNumber(b.importCost.minus(b.exportCredit), 2);
    costPoints.push({
      timestamp: b.timestamp,
      label: b.label,
      importCost: importNum,
      exportCredit: exportNum,
      netCost: netNum,
      isGap: b.isGap,
    });
  }

  return {
    energyPoints: downsampleIfNeeded(energyPoints),
    costPoints: downsampleCostIfNeeded(costPoints),
  };
}

function aggregateDaily<S extends DataSource>(
  intervals: readonly EnergyIntervalOf<S>[],
  costMap: Map<string, IntervalCostDetail>,
  timezone: string,
  standingChargeMap: Map<string, Decimal>,
): {
  energyPoints: EnergyChartPoint[];
  costPoints: CostChartPoint[];
} {
  const energyBuckets = new Map<string, IntermediateEnergyBucket>();
  const costBuckets = new Map<string, IntermediateCostBucket>();

  for (const interval of intervals) {
    const ms = parseInstantMs(interval.intervalStart);
    if (ms === null) continue;
    const localDate = localDateOf(ms, timezone);

    if (!energyBuckets.has(localDate)) {
      const bounds = localDayBounds(localDate, timezone);
      const isoStart = new Date(bounds.startMs).toISOString();
      const standing = standingChargeMap.get(localDate) ?? new Decimal(0);

      energyBuckets.set(localDate, {
        timestamp: isoStart,
        label: formatDateLabel(localDate),
        solarWh: new Decimal(0),
        homeWh: new Decimal(0),
        gridImportWh: new Decimal(0),
        gridExportWh: new Decimal(0),
        batteryChargedWh: new Decimal(0),
        batteryDischargedWh: new Decimal(0),
        isGap: false,
      });
      costBuckets.set(localDate, {
        timestamp: isoStart,
        label: formatDateLabel(localDate),
        importCost: new Decimal(0),
        exportCredit: new Decimal(0),
        standingCharge: standing,
        isGap: false,
      });
    }

    const eb = energyBuckets.get(localDate)!;
    if (interval.quality === 'SUSPECT') {
      eb.isGap = true;
    } else {
      if (interval.solarGeneratedWh) eb.solarWh = eb.solarWh.plus(interval.solarGeneratedWh);
      if (interval.homeConsumedWh) eb.homeWh = eb.homeWh.plus(interval.homeConsumedWh);
      if (interval.gridImportWh) eb.gridImportWh = eb.gridImportWh.plus(interval.gridImportWh);
      if (interval.gridExportWh) eb.gridExportWh = eb.gridExportWh.plus(interval.gridExportWh);
      if (interval.batteryChargedWh)
        eb.batteryChargedWh = eb.batteryChargedWh.plus(interval.batteryChargedWh);
      if (interval.batteryDischargedWh)
        eb.batteryDischargedWh = eb.batteryDischargedWh.plus(interval.batteryDischargedWh);
    }

    const cb = costBuckets.get(localDate)!;
    const costDetail = costMap.get(interval.intervalStart);
    const importAmount = extractPriceAmount(costDetail?.importPrice);
    const exportAmount = extractPriceAmount(costDetail?.exportPrice);
    if (importAmount) {
      cb.importCost = cb.importCost.plus(decimalFrom(importAmount));
    }
    if (exportAmount) {
      cb.exportCredit = cb.exportCredit.plus(decimalFrom(exportAmount));
    }
    if (interval.quality === 'SUSPECT') {
      cb.isGap = true;
    }
  }

  const energyPoints: EnergyChartPoint[] = [];
  for (const b of energyBuckets.values()) {
    energyPoints.push({
      timestamp: b.timestamp,
      label: b.label,
      solarKwh: toChartNumber(b.solarWh.div(1000), 2),
      homeKwh: toChartNumber(b.homeWh.div(1000), 2),
      gridImportKwh: toChartNumber(b.gridImportWh.div(1000), 2),
      gridExportKwh: toChartNumber(b.gridExportWh.div(1000), 2),
      batteryChargedKwh: toChartNumber(b.batteryChargedWh.div(1000), 2),
      batteryDischargedKwh: toChartNumber(b.batteryDischargedWh.div(1000), 2),
      isGap: b.isGap,
    });
  }

  const costPoints: CostChartPoint[] = [];
  for (const b of costBuckets.values()) {
    const importWithStanding = b.importCost.plus(b.standingCharge);
    const importNum = toChartNumber(importWithStanding, 2);
    const exportNum = toChartNumber(b.exportCredit, 2);
    const netNum = toChartNumber(importWithStanding.minus(b.exportCredit), 2);
    costPoints.push({
      timestamp: b.timestamp,
      label: b.label,
      importCost: importNum,
      exportCredit: exportNum,
      netCost: netNum,
      isGap: b.isGap,
    });
  }

  return {
    energyPoints: downsampleIfNeeded(energyPoints),
    costPoints: downsampleCostIfNeeded(costPoints),
  };
}

/**
 * Downsampling method: Uniform composite grouping.
 * When points exceed MAX_CHART_POINTS (500), adjacent points are combined into equal buckets.
 */
function downsampleIfNeeded(points: EnergyChartPoint[]): EnergyChartPoint[] {
  if (points.length <= MAX_CHART_POINTS) return points;
  const stride = Math.ceil(points.length / MAX_CHART_POINTS);
  const result: EnergyChartPoint[] = [];

  for (let i = 0; i < points.length; i += stride) {
    const slice = points.slice(i, i + stride);
    const first = slice[0]!;
    let solar = 0;
    let home = 0;
    let gridImp = 0;
    let gridExp = 0;
    let batChg = 0;
    let batDis = 0;
    let isGap = false;

    for (const p of slice) {
      solar += p.solarKwh;
      home += p.homeKwh;
      gridImp += p.gridImportKwh;
      gridExp += p.gridExportKwh;
      batChg += p.batteryChargedKwh;
      batDis += p.batteryDischargedKwh;
      if (p.isGap) isGap = true;
    }

    result.push({
      timestamp: first.timestamp,
      label: first.label,
      solarKwh: toChartNumber(solar, 2),
      homeKwh: toChartNumber(home, 2),
      gridImportKwh: toChartNumber(gridImp, 2),
      gridExportKwh: toChartNumber(gridExp, 2),
      batteryChargedKwh: toChartNumber(batChg, 2),
      batteryDischargedKwh: toChartNumber(batDis, 2),
      isGap,
    });
  }

  return result;
}

function downsampleCostIfNeeded(points: CostChartPoint[]): CostChartPoint[] {
  if (points.length <= MAX_CHART_POINTS) return points;
  const stride = Math.ceil(points.length / MAX_CHART_POINTS);
  const result: CostChartPoint[] = [];

  for (let i = 0; i < points.length; i += stride) {
    const slice = points.slice(i, i + stride);
    const first = slice[0]!;
    let imp = 0;
    let exp = 0;
    let net = 0;
    let isGap = false;

    for (const p of slice) {
      imp += p.importCost;
      exp += p.exportCredit;
      net += p.netCost;
      if (p.isGap) isGap = true;
    }

    result.push({
      timestamp: first.timestamp,
      label: first.label,
      importCost: toChartNumber(imp, 2),
      exportCredit: toChartNumber(exp, 2),
      netCost: toChartNumber(net, 2),
      isGap,
    });
  }

  return result;
}
