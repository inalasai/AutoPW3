export type {
  AccountingContext,
  AccountingInput,
  AccountingOptions,
  AccountingPeriod,
  AccountingResult,
  CompletenessReport,
  CostTotals,
  CounterfactualAnalysis,
  EfficiencyMetrics,
  EnergyTotals,
  IntervalCostDetail,
  PricingIssues,
  StandingChargeRule,
} from './types';

export { accountForPeriod } from './account';
export { powerSamplesToEnergyIntervals } from './integrate';
export type { IntegratePowerOptions } from './integrate';
export { aggregateEnergyTotals, computeCompletenessReport } from './energy';
export { calculatePeriodCosts } from './costs';
export type { CalculateCostsResult } from './costs';
export {
  FINANCIAL_MODEL_ASSUMPTIONS,
  computeCounterfactuals,
  computeEfficiencyMetrics,
} from './metrics';
export { filterAccountableIntervals, requireLiveIntervals } from './guard';
export type { FilterAccountableResult } from './guard';

export {
  DATA_GAPS_FIXTURE,
  DST_FALL_BACK_FIXTURE,
  DST_SPRING_FORWARD_FIXTURE,
  EXPORT_ONLY_FIXTURE,
  MID_RANGE_TARIFF_FIXTURE,
  SECTION_8_FIXTURE,
  SUSPECT_EXCLUSION_FIXTURE,
} from './fixtures';
