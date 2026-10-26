import type { DataSource } from '@autopw3/shared';
import { calculatePeriodCosts } from './costs';
import { aggregateEnergyTotals, computeCompletenessReport } from './energy';
import { filterAccountableIntervals } from './guard';
import { computeCounterfactuals, computeEfficiencyMetrics } from './metrics';
import type { AccountingInput, AccountingPeriod, AccountingResult } from './types';

/**
 * Main accounting entry point (TASK-11).
 *
 * Orchestrates:
 * 1. Demo/Live verification and SUSPECT filtering (guard.ts)
 * 2. Energy flow aggregation and resolution/completeness diagnostics (energy.ts)
 * 3. Tariff rate resolution, standing charges, VAT, and independent net costs (costs.ts)
 * 4. Self-consumption, self-sufficiency, and battery efficiency (metrics.ts)
 * 5. Counterfactual "no solar, no battery" savings analysis (metrics.ts)
 *
 * Pure, deterministic, decimal-exact, and clock-injected.
 */

export function accountForPeriod<S extends DataSource>(
  input: AccountingInput<S>,
): AccountingResult {
  const context = input.options?.context ?? 'LIVE';
  const siteId = input.options?.siteId ?? null;

  // 1. Guard against demo data in live context & exclude SUSPECT intervals
  const { accountable, excludedSuspectCount } = filterAccountableIntervals(
    input.intervals,
    context,
    'accountForPeriod',
  );

  // 2. Resolve accounting period bounds
  let minStart = input.period?.from;
  let maxEnd = input.period?.to;
  const timezone = input.period?.timezone;

  if (!minStart || !maxEnd || !timezone) {
    for (const interval of accountable) {
      if (!minStart || interval.intervalStart < minStart) {
        minStart = interval.intervalStart;
      }
      if (!maxEnd || interval.intervalEnd > maxEnd) {
        maxEnd = interval.intervalEnd;
      }
    }
  }

  const defaultTz = input.tariffs?.[0]?.timezone ?? 'UTC';
  const period: AccountingPeriod = {
    from: minStart ?? '2026-01-01T00:00:00Z',
    to: maxEnd ?? '2026-01-01T00:00:00Z',
    timezone: timezone ?? defaultTz,
  };

  // 3. Energy flow totals
  const energyTotals = aggregateEnergyTotals(accountable);

  // 4. Telemetry completeness
  const completeness = computeCompletenessReport(accountable, period, excludedSuspectCount);

  // 5. Tariff costing (if tariffs supplied)
  const tariffs = input.tariffs ?? [];
  const costCalc =
    tariffs.length > 0 ? calculatePeriodCosts(accountable, tariffs, period, input.options) : null;

  // 6. Efficiency metrics
  const efficiency = computeEfficiencyMetrics(energyTotals);

  // 7. Counterfactual savings
  const counterfactuals =
    tariffs.length > 0
      ? computeCounterfactuals(
          accountable,
          tariffs,
          period,
          costCalc?.costTotals ?? null,
          input.options,
        )
      : null;

  return {
    context,
    siteId,
    period,
    energyTotals,
    costTotals: costCalc?.costTotals ?? null,
    efficiency,
    counterfactuals,
    completeness,
  };
}
