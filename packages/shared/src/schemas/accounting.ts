import { z } from 'zod';
import { COST_GRANULARITIES, PRICING_FLAGS } from '../constants/enums';
import { MAX_RANGE_DAYS } from '../constants/limits';
import { MoneyAmountStringSchema } from './decimal';
import {
  CurrencySchema,
  InstantUtcSchema,
  LocalDateSchema,
  PercentSchema,
  UuidSchema,
} from './primitives';

/**
 * Financial inputs and outputs (ENERGY_ACCOUNTING sections 6 and 7, API contract section 2.4).
 *
 * Money is a decimal STRING with its currency beside it; a missing amount is `null`, never "0.00000000". Cost
 * amounts here are UNROUNDED (scale up to 8). Rounding to a currency's minor unit happens once per displayed line in
 * the money formatter (packages/domain, D-014). Net cost: positive = cost to the household, negative = net credit.
 */

export const PricingFlagSchema = z.enum(PRICING_FLAGS);

/** Cost components for one period. Each is null when it could not be fully priced. */
const costFields = {
  currency: CurrencySchema,
  importEnergyCost: MoneyAmountStringSchema.nullable(),
  exportCredit: MoneyAmountStringSchema.nullable(),
  standingCharge: MoneyAmountStringSchema.nullable(),
  levies: MoneyAmountStringSchema.nullable(),
  tax: MoneyAmountStringSchema.nullable(),
  netCost: MoneyAmountStringSchema.nullable(),
  /** Covered time divided by expected time, 0 to 1. Never rounded up to hide gaps. */
  completeness: z.number().min(0).max(1),
  flags: z.array(PricingFlagSchema),
  /** True when any figure rests on an estimate (for example an opt-in pro-rata allocation). */
  isEstimate: z.boolean(),
};

/** One day of cost (the daily cache `cost_rollups_daily`, or computed on demand). */
export const DailyCostSchema = z.strictObject({
  localDate: LocalDateSchema,
  importTariffId: UuidSchema.nullable(),
  exportTariffId: UuidSchema.nullable(),
  ...costFields,
});
export type DailyCost = z.infer<typeof DailyCostSchema>;

/** One month of cost: the sum of UNROUNDED daily values (never a sum of rounded days). */
export const MonthlyCostSchema = z.strictObject({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  ...costFields,
});
export type MonthlyCost = z.infer<typeof MonthlyCostSchema>;

export const CostsQuerySchema = z
  .strictObject({
    from: LocalDateSchema,
    to: LocalDateSchema,
    granularity: z.enum(COST_GRANULARITIES),
  })
  .refine((q) => q.to > q.from, { message: 'to must be after from', path: ['to'] })
  .refine(
    (q) =>
      (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000 <=
      MAX_RANGE_DAYS.costsDay,
    { message: `range must not exceed ${MAX_RANGE_DAYS.costsDay} days`, path: ['to'] },
  );
export type CostsQuery = z.infer<typeof CostsQuerySchema>;

/** Share of the requested range that could be priced. Reported so a gap is visible, not hidden. */
export const CostCoverageSchema = z.strictObject({
  pricedDays: z.int().min(0),
  requestedDays: z.int().min(0),
  completeness: z.number().min(0).max(1),
});
export type CostCoverage = z.infer<typeof CostCoverageSchema>;

export const CostsResponseSchema = z.discriminatedUnion('granularity', [
  z.strictObject({
    granularity: z.literal('day'),
    items: z.array(DailyCostSchema),
    coverage: CostCoverageSchema,
    flags: z.array(PricingFlagSchema),
  }),
  z.strictObject({
    granularity: z.literal('month'),
    items: z.array(MonthlyCostSchema),
    coverage: CostCoverageSchema,
    flags: z.array(PricingFlagSchema),
  }),
]);
export type CostsResponse = z.infer<typeof CostsResponseSchema>;

/**
 * Efficiency metrics derived from energy intervals. Each is null when a source field is null; none is ever 0 as a
 * stand-in. `estimatedSavings` is always an ESTIMATE against "no solar and no battery on the same tariff".
 */
export const EnergyMetricsSchema = z.strictObject({
  selfConsumedSolarWh: z.number().min(0).nullable(),
  selfConsumptionPercent: PercentSchema.nullable(),
  selfSufficiencyPercent: PercentSchema.nullable(),
  estimatedSavings: MoneyAmountStringSchema.nullable(),
  currency: CurrencySchema.nullable(),
  completeness: z.number().min(0).max(1),
  generatedAt: InstantUtcSchema,
});
export type EnergyMetrics = z.infer<typeof EnergyMetricsSchema>;
