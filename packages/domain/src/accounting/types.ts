import type { DataSource, Tariff } from '@autopw3/shared';
import type {
  AmountBreakdown,
  CoverageGap,
  IntervalPrice,
  PriceObservations,
  PricingMode,
} from '../tariff';
import type { EnergyIntervalOf } from '../telemetry/types';

/**
 * Accounting types for packages/domain.
 *
 * Implements ENERGY_ACCOUNTING.md and FINANCIAL_MODEL.md.
 * All monetary amounts and rates are exact decimal strings (D-014).
 * Time intervals are half-open [start, end) in UTC ISO-8601 strings.
 * Demo and live accounting are strictly distinguished at both type and runtime levels.
 */

/** Execution context for accounting calculations. */
export type AccountingContext = 'LIVE' | 'DEMO';

/** Input period for accounting aggregations. */
export interface AccountingPeriod {
  /** Inclusive start instant (UTC ISO-8601). */
  readonly from: string;
  /** Exclusive end instant (UTC ISO-8601). */
  readonly to: string;
  /** IANA timezone for site local calendar days (e.g. 'Europe/Dublin'). */
  readonly timezone: string;
}

/** Aggregate energy totals for directional energy flows in Wh and kWh. */
export interface EnergyTotals {
  /** Total solar generated in Wh (exact decimal string). */
  readonly solarGeneratedWh: string;
  /** Total home consumed in Wh (exact decimal string). */
  readonly homeConsumedWh: string;
  /** Total grid import in Wh (exact decimal string). */
  readonly gridImportWh: string;
  /** Total grid export in Wh (exact decimal string). */
  readonly gridExportWh: string;
  /** Total battery charged in Wh (exact decimal string). */
  readonly batteryChargedWh: string;
  /** Total battery discharged in Wh (exact decimal string). */
  readonly batteryDischargedWh: string;
  /** Net grid flow in Wh: import - export (>0 importing, <0 exporting). */
  readonly netGridWh: string;
  /** Net battery flow in Wh: discharged - charged (>0 net discharge, <0 net charge). */
  readonly netBatteryWh: string;

  /** Total solar generated in kWh (exact decimal string). */
  readonly solarGeneratedKwh: string;
  /** Total home consumed in kWh (exact decimal string). */
  readonly homeConsumedKwh: string;
  /** Total grid import in kWh (exact decimal string). */
  readonly gridImportKwh: string;
  /** Total grid export in kWh (exact decimal string). */
  readonly gridExportKwh: string;
  /** Total battery charged in kWh (exact decimal string). */
  readonly batteryChargedKwh: string;
  /** Total battery discharged in kWh (exact decimal string). */
  readonly batteryDischargedKwh: string;
}

/** Tracking of telemetry completeness and resolution across the period. */
export interface CompletenessReport {
  /** Expected seconds in requested period. */
  readonly expectedSeconds: number;
  /** Covered seconds from non-suspect intervals. */
  readonly coveredSeconds: number;
  /** Fraction of period covered (0.0 to 1.0). Never rounded up. */
  readonly completenessRatio: number;
  /** Total intervals provided. */
  readonly totalIntervals: number;
  /** Number of intervals included in accounting (quality OK, PARTIAL, DERIVED). */
  readonly accountedIntervals: number;
  /** Number of intervals excluded due to SUSPECT quality. */
  readonly excludedSuspectIntervals: number;
  /** Minimum interval resolution in seconds. */
  readonly minResolutionSeconds: number | null;
  /** Maximum interval resolution in seconds. */
  readonly maxResolutionSeconds: number | null;
  /** Fraction of time each individual flow field was available (not null). */
  readonly fieldCompleteness: {
    readonly solarGenerated: number;
    readonly homeConsumed: number;
    readonly gridImport: number;
    readonly gridExport: number;
    readonly batteryCharged: number;
    readonly batteryDischarged: number;
  };
}

/** Details of unpriced intervals or gaps encountered. */
export interface PricingIssues {
  /** Count of intervals where rate could not be resolved (UNPRICED). */
  readonly unpricedIntervalCount: number;
  /** Count of intervals unpriceable due to multiple rates within interval. */
  readonly unpriceableResolutionCount: number;
  /** List of rate coverage gaps found. */
  readonly gaps: readonly CoverageGap[];
}

/** Detailed cost summary of an individual energy interval. */
export interface IntervalCostDetail {
  readonly intervalStart: string;
  readonly intervalEnd: string;
  readonly importPrice: IntervalPrice | null;
  readonly exportPrice: IntervalPrice | null;
}

/** Aggregate financial totals for the period. */
export interface CostTotals {
  /** ISO 4217 currency code. */
  readonly currency: string;
  /** Import energy charges breakdown (unrounded exact decimals). */
  readonly importEnergyCost: AmountBreakdown;
  /** Export revenue / credit breakdown (unrounded exact decimals). */
  readonly exportRevenueCredit: AmountBreakdown;
  /** Standing charges and per-day levies breakdown (unrounded exact decimals). */
  readonly standingCharges: AmountBreakdown;
  /** Net cost breakdown: import energy + standing charges - export credit. */
  readonly netCost: AmountBreakdown;

  /** Component amounts rounded to minor units for presentation / billing. */
  readonly rounded: {
    readonly importEnergyCost: AmountBreakdown;
    readonly exportRevenueCredit: AmountBreakdown;
    readonly standingCharges: AmountBreakdown;
    /** Sum of rounded component lines, ensuring invoice arithmetic adds up. */
    readonly netCost: AmountBreakdown;
  };

  /** Issues encountered during interval pricing. */
  readonly pricingIssues: PricingIssues;
}

/** Energy efficiency and battery performance indicators. */
export interface EfficiencyMetrics {
  /** Solar energy consumed locally (Wh): min(solarGenerated, homeConsumed + batteryCharged) or solar - export. */
  readonly selfConsumedSolarWh: string | null;
  /** Self-consumption percentage (0 to 100): selfConsumedSolar / solarGenerated * 100. */
  readonly selfConsumptionPercent: string | null;
  /** Self-sufficiency percentage (0 to 100): (homeConsumed - gridImport) / homeConsumed * 100. */
  readonly selfSufficiencyPercent: string | null;
  /** Estimated battery round-trip energy loss in Wh: max(0, charged - discharged). */
  readonly batteryLossWh: string | null;
  /** Battery round-trip efficiency percentage: (discharged / charged) * 100. */
  readonly batteryEfficiencyPercent: string | null;
}

/** Counterfactual scenarios for savings and optimisation benefits. */
export interface CounterfactualAnalysis {
  /** What home consumption would have cost with no solar and no battery under the same tariff. */
  readonly counterfactualNoSolarNoBatteryNetCost: string | null;
  /** Avoided grid import cost: counterfactual import cost minus actual import cost. */
  readonly avoidedGridImportCost: string | null;
  /** Estimated net savings: counterfactual net cost minus actual net cost. Always labelled ESTIMATE. */
  readonly estimatedNetSavings: string | null;
  /** Benefit achieved by shifting energy away from peak rates. */
  readonly tariffOptimisationBenefit: string | null;
  /** Explicit list of assumptions underlying the counterfactual calculations. */
  readonly assumptions: readonly string[];
}

/** Master result of period accounting. */
export interface AccountingResult {
  /** Accounting context: 'LIVE' or 'DEMO'. */
  readonly context: AccountingContext;
  /** Target site ID, if site-scoped. */
  readonly siteId: string | null;
  /** Effective period. */
  readonly period: AccountingPeriod;
  /** Energy flow totals. */
  readonly energyTotals: EnergyTotals;
  /** Financial totals, or null if no tariffs were supplied. */
  readonly costTotals: CostTotals | null;
  /** Efficiency metrics. */
  readonly efficiency: EfficiencyMetrics;
  /** Counterfactual savings analysis, or null if tariffs/consumption not available. */
  readonly counterfactuals: CounterfactualAnalysis | null;
  /** Completeness and quality diagnostics. */
  readonly completeness: CompletenessReport;
}

/** Rule for charging standing daily charges over the period. */
export type StandingChargeRule = 'COVERED_DAYS' | 'ALL_RANGE_DAYS';

/** Configuration options for the accounting engine. */
export interface AccountingOptions {
  /** Accounting context: defaults to 'LIVE'. Live context rejects demo intervals. */
  readonly context?: AccountingContext;
  /** Optional site identifier for site-scoped tariff lookups. */
  readonly siteId?: string | null;
  /** Pricing mode: 'STRICT' (default) or 'PRORATA_ESTIMATE'. */
  readonly pricingMode?: PricingMode;
  /** How daily standing charges are applied: defaults to 'COVERED_DAYS'. */
  readonly standingChargeRule?: StandingChargeRule;
  /** Dynamic price observations (separate from recurring tariff). */
  readonly priceObservations?: PriceObservations;
}

/** Input to the accounting engine. */
export interface AccountingInput<S extends DataSource = DataSource> {
  /** Normalised energy intervals to account for. */
  readonly intervals: readonly EnergyIntervalOf<S>[];
  /** Tariffs applicable to the period (import and/or export). */
  readonly tariffs?: readonly Tariff[];
  /** Expected period range. If omitted, inferred from intervals. */
  readonly period?: Partial<AccountingPeriod>;
  /** Accounting options. */
  readonly options?: AccountingOptions;
}
