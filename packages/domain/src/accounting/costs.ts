import type { DataSource, Tariff } from '@autopw3/shared';
import {
  chargesForLocalDates,
  type AmountBreakdown,
  type CoverageGap,
  type IntervalPrice,
} from '../tariff';
import { addLocalDays, localDateOf, parseInstantMs } from '../telemetry/timestamps';
import { Decimal, decimalFrom, exact, roundToMinorUnit } from '../tariff/money';
import { priceInterval } from '../tariff/price';
import type { EnergyIntervalOf } from '../telemetry/types';
import type {
  AccountingOptions,
  AccountingPeriod,
  CostTotals,
  IntervalCostDetail,
  PricingIssues,
} from './types';

/**
 * Financial calculations and cost accounting (ENERGY_ACCOUNTING sections 5-7, TASK-11).
 *
 * Implements strict, independent computation of:
 * - Import energy costs
 * - Export energy revenue / credits
 * - Standing charges and daily levies
 * - VAT and total net costs
 *
 * Every intermediate value uses arbitrary-precision Decimal arithmetic (D-014).
 * Displayed lines are rounded half-up to the currency's minor unit, and displayed net
 * cost is the sum of rounded component lines to guarantee invoice consistency.
 */

interface DecimalBreakdownAcc {
  baseAmount: Decimal;
  levyAmount: Decimal;
  vatAmount: Decimal;
  totalAmount: Decimal;
}

function zeroBreakdownAcc(): DecimalBreakdownAcc {
  return {
    baseAmount: new Decimal(0),
    levyAmount: new Decimal(0),
    vatAmount: new Decimal(0),
    totalAmount: new Decimal(0),
  };
}

function addBreakdown(acc: DecimalBreakdownAcc, b: AmountBreakdown): void {
  acc.baseAmount = acc.baseAmount.plus(decimalFrom(b.baseAmount));
  acc.levyAmount = acc.levyAmount.plus(decimalFrom(b.levyAmount));
  acc.vatAmount = acc.vatAmount.plus(decimalFrom(b.vatAmount));
  acc.totalAmount = acc.totalAmount.plus(decimalFrom(b.totalAmount));
}

function serialiseAcc(acc: DecimalBreakdownAcc): AmountBreakdown {
  return {
    baseAmount: exact(acc.baseAmount),
    levyAmount: exact(acc.levyAmount),
    vatAmount: exact(acc.vatAmount),
    totalAmount: exact(acc.totalAmount),
    amountExcludingVat: exact(acc.totalAmount.minus(acc.vatAmount)),
  };
}

function roundBreakdown(b: AmountBreakdown, currency: string): AmountBreakdown {
  const base = roundToMinorUnit(b.baseAmount, currency);
  const levy = roundToMinorUnit(b.levyAmount, currency);
  const vat = roundToMinorUnit(b.vatAmount, currency);
  const total = roundToMinorUnit(b.totalAmount, currency);
  const exVat = roundToMinorUnit(b.amountExcludingVat, currency);
  return {
    baseAmount: base,
    levyAmount: levy,
    vatAmount: vat,
    totalAmount: total,
    amountExcludingVat: exVat,
  };
}

export interface CalculateCostsResult {
  readonly costTotals: CostTotals;
  readonly intervalDetails: readonly IntervalCostDetail[];
}

/**
 * Calculates independent import, export, standing and net charges for a set of energy intervals.
 */
export function calculatePeriodCosts<S extends DataSource>(
  intervals: readonly EnergyIntervalOf<S>[],
  tariffs: readonly Tariff[],
  period: AccountingPeriod,
  options: AccountingOptions = {},
): CalculateCostsResult {
  const importTariffs = tariffs.filter((t) => t.direction === 'IMPORT');
  const exportTariffs = tariffs.filter((t) => t.direction === 'EXPORT');

  // Determine currency
  const currencies = new Set<string>(tariffs.map((t) => t.currency));
  if (currencies.size > 1) {
    throw new RangeError(
      `Multiple currencies in tariff set (${[...currencies].join(', ')}). Cross-currency accounting is forbidden.`,
    );
  }
  const currency = tariffs[0]?.currency ?? 'EUR';

  const intervalDetails: IntervalCostDetail[] = [];
  const importAcc = zeroBreakdownAcc();
  const exportAcc = zeroBreakdownAcc();

  let unpricedCount = 0;
  let unpriceableResCount = 0;
  const gaps: CoverageGap[] = [];

  const priceMode = options.pricingMode ?? 'STRICT';
  const siteId = options.siteId ?? null;
  const priceObservations = options.priceObservations;

  // Track local dates with interval coverage
  const coveredLocalDates = new Set<string>();

  for (const interval of intervals) {
    const startMs = parseInstantMs(interval.intervalStart);
    const endMs = parseInstantMs(interval.intervalEnd);
    if (startMs === null || endMs === null || endMs <= startMs) continue;

    // Collect local dates
    const dateStart = localDateOf(startMs, period.timezone);
    const dateEnd = localDateOf(endMs - 1, period.timezone);
    for (let d = dateStart; d <= dateEnd; d = addLocalDays(d, 1)) {
      coveredLocalDates.add(d);
    }

    let importPrice: IntervalPrice | null = null;
    let exportPrice: IntervalPrice | null = null;

    const priceOptions = {
      mode: priceMode,
      ...(siteId !== null ? { siteId } : {}),
      ...(priceObservations !== undefined ? { priceObservations } : {}),
    };

    // Price import
    if (interval.gridImportWh !== null && interval.gridImportWh > 0 && importTariffs.length > 0) {
      importPrice = priceInterval(
        { startMs, endMs, energyWh: interval.gridImportWh },
        tariffs,
        'IMPORT',
        priceOptions,
      );

      if (importPrice.status === 'PRICED' || importPrice.status === 'ESTIMATE') {
        addBreakdown(importAcc, importPrice.amounts);
      } else if (importPrice.status === 'UNPRICEABLE_AT_RESOLUTION') {
        unpriceableResCount += 1;
      } else if (importPrice.status === 'UNPRICED') {
        unpricedCount += 1;
        gaps.push(...importPrice.gaps);
      }
    }

    // Price export
    if (interval.gridExportWh !== null && interval.gridExportWh > 0 && exportTariffs.length > 0) {
      exportPrice = priceInterval(
        { startMs, endMs, energyWh: interval.gridExportWh },
        tariffs,
        'EXPORT',
        priceOptions,
      );

      if (exportPrice.status === 'PRICED' || exportPrice.status === 'ESTIMATE') {
        addBreakdown(exportAcc, exportPrice.amounts);
      } else if (exportPrice.status === 'UNPRICEABLE_AT_RESOLUTION') {
        unpriceableResCount += 1;
      } else if (exportPrice.status === 'UNPRICED') {
        unpricedCount += 1;
        gaps.push(...exportPrice.gaps);
      }
    }

    intervalDetails.push({
      intervalStart: interval.intervalStart,
      intervalEnd: interval.intervalEnd,
      importPrice,
      exportPrice,
    });
  }

  // Calculate standing charges and per-day levies
  const standingAcc = zeroBreakdownAcc();
  if (importTariffs.length > 0) {
    const fromMs = parseInstantMs(period.from);
    const toMs = parseInstantMs(period.to);
    if (fromMs !== null && toMs !== null && toMs > fromMs) {
      const firstLocalDate = localDateOf(fromMs, period.timezone);
      const lastLocalDate = localDateOf(toMs - 1, period.timezone);
      const nextAfterLast = addLocalDays(lastLocalDate, 1);

      const standingRule = options.standingChargeRule ?? 'COVERED_DAYS';

      const chargesResult = chargesForLocalDates(firstLocalDate, nextAfterLast, tariffs, {
        siteId,
      });

      if (chargesResult.ok) {
        for (const day of chargesResult.days) {
          if (standingRule === 'ALL_RANGE_DAYS' || coveredLocalDates.has(day.localDate)) {
            addBreakdown(standingAcc, day.amounts);
          }
        }
      } else {
        // Gaps in standing charge version coverage
        unpricedCount += chargesResult.problems.length;
      }
    }
  }

  // Serialise raw unrounded totals
  const importEnergyCost = serialiseAcc(importAcc);
  const exportRevenueCredit = serialiseAcc(exportAcc);
  const standingCharges = serialiseAcc(standingAcc);

  // Net cost calculation:
  // Net = import energy cost + standing charges + import levies + import vat - export revenue
  const netTotal = importAcc.totalAmount.plus(standingAcc.totalAmount).minus(exportAcc.totalAmount);
  const netVat = importAcc.vatAmount.plus(standingAcc.vatAmount).minus(exportAcc.vatAmount);
  const netBase = importAcc.baseAmount.plus(standingAcc.baseAmount).minus(exportAcc.baseAmount);
  const netLevy = importAcc.levyAmount.plus(standingAcc.levyAmount).minus(exportAcc.levyAmount);

  const netCost: AmountBreakdown = {
    baseAmount: exact(netBase),
    levyAmount: exact(netLevy),
    vatAmount: exact(netVat),
    totalAmount: exact(netTotal),
    amountExcludingVat: exact(netTotal.minus(netVat)),
  };

  // Rounded components for invoice display
  const roundedImport = roundBreakdown(importEnergyCost, currency);
  const roundedExport = roundBreakdown(exportRevenueCredit, currency);
  const roundedStanding = roundBreakdown(standingCharges, currency);

  // Displayed net is the sum/difference of rounded component lines (ENERGY_ACCOUNTING line 101)
  const displayedNetTotal = decimalFrom(roundedImport.totalAmount)
    .plus(decimalFrom(roundedStanding.totalAmount))
    .minus(decimalFrom(roundedExport.totalAmount));
  const displayedNetVat = decimalFrom(roundedImport.vatAmount)
    .plus(decimalFrom(roundedStanding.vatAmount))
    .minus(decimalFrom(roundedExport.vatAmount));
  const displayedNetBase = decimalFrom(roundedImport.baseAmount)
    .plus(decimalFrom(roundedStanding.baseAmount))
    .minus(decimalFrom(roundedExport.baseAmount));
  const displayedNetLevy = decimalFrom(roundedImport.levyAmount)
    .plus(decimalFrom(roundedStanding.levyAmount))
    .minus(decimalFrom(roundedExport.levyAmount));

  const roundedNet: AmountBreakdown = {
    baseAmount: roundToMinorUnit(displayedNetBase, currency),
    levyAmount: roundToMinorUnit(displayedNetLevy, currency),
    vatAmount: roundToMinorUnit(displayedNetVat, currency),
    totalAmount: roundToMinorUnit(displayedNetTotal, currency),
    amountExcludingVat: roundToMinorUnit(displayedNetTotal.minus(displayedNetVat), currency),
  };

  const pricingIssues: PricingIssues = {
    unpricedIntervalCount: unpricedCount,
    unpriceableResolutionCount: unpriceableResCount,
    gaps,
  };

  return {
    costTotals: {
      currency,
      importEnergyCost,
      exportRevenueCredit,
      standingCharges,
      netCost,
      rounded: {
        importEnergyCost: roundedImport,
        exportRevenueCredit: roundedExport,
        standingCharges: roundedStanding,
        netCost: roundedNet,
      },
      pricingIssues,
    },
    intervalDetails,
  };
}
