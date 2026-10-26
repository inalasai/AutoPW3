import type { DataSource, Tariff } from '@autopw3/shared';
import { parseInstantMs } from '../telemetry/timestamps';
import { Decimal, decimalFrom, exact } from '../tariff/money';
import { priceInterval } from '../tariff/price';
import type { EnergyIntervalOf } from '../telemetry/types';
import type {
  AccountingOptions,
  AccountingPeriod,
  CostTotals,
  CounterfactualAnalysis,
  EfficiencyMetrics,
  EnergyTotals,
} from './types';

/**
 * Energy efficiency metrics and counterfactual savings analysis (ENERGY_ACCOUNTING §6, TASK-11).
 *
 * All formulas are explicit and deterministic:
 * - selfConsumedSolarWh = max(0, solarGeneratedWh - gridExportWh)
 * - selfConsumptionPercent = (selfConsumedSolarWh / solarGeneratedWh) * 100
 * - selfSufficiencyPercent = ((homeConsumedWh - gridImportWh) / homeConsumedWh) * 100 [clamped 0-100]
 * - batteryLossWh = max(0, batteryChargedWh - batteryDischargedWh)
 * - batteryEfficiencyPercent = (batteryDischargedWh / batteryChargedWh) * 100
 * - counterfactual "no solar, no battery": all home consumption priced at import tariff + standing charges
 * - estimatedSavings = counterfactualNetCost - actualNetCost (labelled ESTIMATE)
 */

export const FINANCIAL_MODEL_ASSUMPTIONS: readonly string[] = [
  'A-01: Partial-day standing charges apply to any local calendar date containing active interval coverage.',
  'A-02: Counterfactual "no solar, no battery" prices 100% of home consumption as imported from grid at active import tariff rates.',
  'A-03: Battery round-trip efficiency is measured as total discharge divided by total charge across the period.',
  'A-04: Tariff optimisation benefit measures savings achieved through time-of-use shifting relative to volume-weighted average rate.',
  'A-05: SUSPECT intervals are excluded from totals and tracked against data completeness.',
  'A-06: Intervals unpriceable at resolution in strict mode are flagged and excluded from cost totals.',
];

/**
 * Computes energy self-consumption, self-sufficiency, and battery round-trip indicators.
 */
export function computeEfficiencyMetrics(energyTotals: EnergyTotals): EfficiencyMetrics {
  const solarWh = new Decimal(energyTotals.solarGeneratedWh);
  const homeWh = new Decimal(energyTotals.homeConsumedWh);
  const gridImportWh = new Decimal(energyTotals.gridImportWh);
  const gridExportWh = new Decimal(energyTotals.gridExportWh);
  const batteryChargedWh = new Decimal(energyTotals.batteryChargedWh);
  const batteryDischargedWh = new Decimal(energyTotals.batteryDischargedWh);

  let selfConsumedWh: Decimal | null = null;
  let selfConsumptionPercent: Decimal | null = null;
  let selfSufficiencyPercent: Decimal | null = null;
  let batteryLossWh: Decimal | null = null;
  let batteryEfficiencyPercent: Decimal | null = null;

  if (solarWh.gt(0)) {
    // selfConsumedSolarWh = max(0, solarGeneratedWh - gridExportWh)
    const consumed = Decimal.max(0, solarWh.minus(gridExportWh));
    selfConsumedWh = Decimal.min(solarWh, consumed);
    selfConsumptionPercent = selfConsumedWh.div(solarWh).times(100);
  }

  if (homeWh.gt(0)) {
    // selfSufficiencyPercent = ((homeConsumedWh - gridImportWh) / homeConsumedWh) * 100
    const netHome = homeWh.minus(gridImportWh);
    const ratio = netHome.div(homeWh).times(100);
    selfSufficiencyPercent = Decimal.min(100, Decimal.max(0, ratio));
  }

  if (batteryChargedWh.gt(0) && batteryDischargedWh.gt(0)) {
    batteryLossWh = Decimal.max(0, batteryChargedWh.minus(batteryDischargedWh));
    batteryEfficiencyPercent = batteryDischargedWh.div(batteryChargedWh).times(100);
  }

  // Format percentages to 2 decimal places
  const fmtPercent = (d: Decimal | null): string | null => {
    if (d === null) return null;
    // eslint-disable-next-line no-restricted-syntax
    return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
  };

  return {
    selfConsumedSolarWh: selfConsumedWh ? exact(selfConsumedWh) : null,
    selfConsumptionPercent: fmtPercent(selfConsumptionPercent),
    selfSufficiencyPercent: fmtPercent(selfSufficiencyPercent),
    batteryLossWh: batteryLossWh ? exact(batteryLossWh) : null,
    batteryEfficiencyPercent: fmtPercent(batteryEfficiencyPercent),
  };
}

/**
 * Computes counterfactual "no solar, no battery" scenario and tariff optimisation benefits.
 */
export function computeCounterfactuals<S extends DataSource>(
  intervals: readonly EnergyIntervalOf<S>[],
  tariffs: readonly Tariff[],
  _period: AccountingPeriod,
  actualCostTotals: CostTotals | null,
  options: AccountingOptions = {},
): CounterfactualAnalysis | null {
  if (!actualCostTotals) return null;

  const importTariffs = tariffs.filter((t) => t.direction === 'IMPORT');
  if (importTariffs.length === 0) return null;

  const priceMode = options.pricingMode ?? 'STRICT';
  const siteId = options.siteId ?? null;
  const priceObservations = options.priceObservations;

  let counterfactualImportTotal = new Decimal(0);
  let counterfactualImportVat = new Decimal(0);
  let hasHomeConsumption = false;

  for (const interval of intervals) {
    if (interval.homeConsumedWh !== null && interval.homeConsumedWh > 0) {
      hasHomeConsumption = true;
      const startMs = parseInstantMs(interval.intervalStart);
      const endMs = parseInstantMs(interval.intervalEnd);
      if (startMs === null || endMs === null || endMs <= startMs) continue;

      const priced = priceInterval(
        { startMs, endMs, energyWh: interval.homeConsumedWh },
        tariffs,
        'IMPORT',
        {
          mode: priceMode,
          ...(siteId !== null ? { siteId } : {}),
          ...(priceObservations !== undefined ? { priceObservations } : {}),
        },
      );

      if (priced.status === 'PRICED' || priced.status === 'ESTIMATE') {
        counterfactualImportTotal = counterfactualImportTotal.plus(
          decimalFrom(priced.amounts.totalAmount),
        );
        counterfactualImportVat = counterfactualImportVat.plus(
          decimalFrom(priced.amounts.vatAmount),
        );
      }
    }
  }

  if (!hasHomeConsumption) {
    return {
      counterfactualNoSolarNoBatteryNetCost: null,
      avoidedGridImportCost: null,
      estimatedNetSavings: null,
      tariffOptimisationBenefit: null,
      assumptions: FINANCIAL_MODEL_ASSUMPTIONS,
    };
  }

  // Counterfactual net cost = counterfactual import charges + actual standing charges
  const actualStandingTotal = decimalFrom(actualCostTotals.standingCharges.totalAmount);
  const counterfactualNet = counterfactualImportTotal.plus(actualStandingTotal);

  const actualImportTotal = decimalFrom(actualCostTotals.importEnergyCost.totalAmount);
  const actualNet = decimalFrom(actualCostTotals.netCost.totalAmount);

  // Avoided grid import cost = counterfactual import charges - actual import charges
  const avoidedGridImport = Decimal.max(0, counterfactualImportTotal.minus(actualImportTotal));

  // Estimated net savings = counterfactual net cost - actual net cost
  const estimatedNetSavings = Decimal.max(0, counterfactualNet.minus(actualNet));

  // Tariff optimisation benefit:
  // Evaluates difference if actual grid import was priced at average flat rate vs actual ToU-shaped rate
  const actualGridImportKwh = intervals.reduce((acc, i) => {
    return acc.plus(i.gridImportWh !== null ? new Decimal(String(i.gridImportWh)).div(1000) : 0);
  }, new Decimal(0));

  let optimisationBenefit: Decimal | null = null;
  if (actualGridImportKwh.gt(0)) {
    const actualEnergyBase = decimalFrom(actualCostTotals.importEnergyCost.baseAmount);
    const avgRatePerKwh = actualEnergyBase.div(actualGridImportKwh);
    // Compare against weighted average rate if shifting occurred
    const flatCost = actualGridImportKwh.times(avgRatePerKwh);
    optimisationBenefit = Decimal.max(0, flatCost.minus(actualEnergyBase));
  }

  return {
    counterfactualNoSolarNoBatteryNetCost: exact(counterfactualNet),
    avoidedGridImportCost: exact(avoidedGridImport),
    estimatedNetSavings: exact(estimatedNetSavings),
    tariffOptimisationBenefit: optimisationBenefit ? exact(optimisationBenefit) : null,
    assumptions: FINANCIAL_MODEL_ASSUMPTIONS,
  };
}
