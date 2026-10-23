import { z } from 'zod';
import {
  BUDGET_STATES,
  DATA_SOURCES,
  ENERGY_RESOLUTIONS,
  FRESHNESS_STATES,
  INTERVAL_QUALITIES,
  PERSISTED_SOURCES,
  POWER_QUALITIES,
  TIMESTAMP_ORIGINS,
} from '../constants/enums';
import { MAX_RANGE_DAYS } from '../constants/limits';
import {
  EnergyWhSchema,
  InstantUtcSchema,
  NonNegativePowerWSchema,
  PaginationQuerySchema,
  PercentSchema,
  PowerWSchema,
  pageOf,
  rangeWithinDays,
} from './primitives';

/**
 * Normalised telemetry. NORMALISATION BOUNDARY: everything in this file is the project's internal model, in the
 * sign convention of constants/signs.ts. Provider-native shapes (Tesla's own field names, signs and cadence,
 * all UNVERIFIED) exist only in apps/worker/src/providers/tesla and are converted by the adapter before they
 * reach any schema here. Nothing outside the adapter may import a provider shape.
 *
 * Every reading carries `source` and `quality` (rule 5, rule 9). A missing value is `null`, never 0.
 */

export const DataSourceSchema = z.enum(DATA_SOURCES);
export const PowerQualitySchema = z.enum(POWER_QUALITIES);
export const IntervalQualitySchema = z.enum(INTERVAL_QUALITIES);
export const FreshnessSchema = z.enum(FRESHNESS_STATES);

/** Fields of one instantaneous power snapshot, without the source (so DEMO and TESLA variants share them). */
const powerFields = {
  sampledAt: InstantUtcSchema,
  receivedAt: InstantUtcSchema,
  timestampOrigin: z.enum(TIMESTAMP_ORIGINS),
  /** >= 0 generation. */
  solarPowerW: NonNegativePowerWSchema.nullable(),
  /** > 0 discharging (supplying the site), < 0 charging. */
  batteryPowerW: PowerWSchema.nullable(),
  /** > 0 importing from the grid, < 0 exporting. */
  gridPowerW: PowerWSchema.nullable(),
  /** >= 0 site consumption. */
  loadPowerW: NonNegativePowerWSchema.nullable(),
  batterySocPercent: PercentSchema.nullable(),
  /** Provider grid status text (for example on-grid or off-grid); free text, bounded. */
  gridStatus: z.string().min(1).max(64).nullable(),
  quality: PowerQualitySchema,
};

/** A power snapshot from any source, as the API returns it. */
export const PowerSampleSchema = z.strictObject({
  ...powerFields,
  source: DataSourceSchema,
});
export type PowerSample = z.infer<typeof PowerSampleSchema>;

/**
 * A power snapshot that may be written to powerwall_metrics_log. `source` can only be TESLA: DEMO is rejected here,
 * as the database CHECK rejects it, so demo data cannot reach live tables or live accounting (rule 5, D-017).
 */
export const PersistedPowerSampleSchema = z.strictObject({
  ...powerFields,
  source: z.enum(PERSISTED_SOURCES),
});
export type PersistedPowerSample = z.infer<typeof PersistedPowerSampleSchema>;

export const BudgetFlagSchema = z.strictObject({ state: z.enum(BUDGET_STATES) });

/** GET /sites/{id}/live and the demo equivalent. */
export const LiveReadingSchema = z.strictObject({
  ...powerFields,
  source: DataSourceSchema,
  ageSeconds: z.int().min(0),
  freshness: FreshnessSchema,
  /** Present when budget exhaustion or provider failure forced a stored snapshot (contract section 3). */
  budget: BudgetFlagSchema.optional(),
});
export type LiveReading = z.infer<typeof LiveReadingSchema>;

/** Demo responses must say DEMO and can never be anything else. */
export const DemoLiveReadingSchema = LiveReadingSchema.extend({ source: z.literal('DEMO') });
export type DemoLiveReading = z.infer<typeof DemoLiveReadingSchema>;

/** Energy per interval, all in Wh and non-negative. `null` means the provider did not supply the field. */
const energyFlowFields = {
  solarGeneratedWh: EnergyWhSchema.nullable(),
  homeConsumedWh: EnergyWhSchema.nullable(),
  gridImportWh: EnergyWhSchema.nullable(),
  gridExportWh: EnergyWhSchema.nullable(),
  batteryChargedWh: EnergyWhSchema.nullable(),
  batteryDischargedWh: EnergyWhSchema.nullable(),
};

/** A provider energy interval `[intervalStart, intervalEnd)` at the real resolution the provider returned. */
export const EnergyIntervalSchema = z
  .strictObject({
    intervalStart: InstantUtcSchema,
    intervalEnd: InstantUtcSchema,
    resolutionSeconds: z.int().positive(),
    ...energyFlowFields,
    source: z.enum(PERSISTED_SOURCES),
    quality: IntervalQualitySchema,
  })
  .refine((i) => Date.parse(i.intervalEnd) > Date.parse(i.intervalStart), {
    message: 'intervalEnd must be after intervalStart',
    path: ['intervalEnd'],
  });
export type EnergyInterval = z.infer<typeof EnergyIntervalSchema>;

/**
 * One row of GET /sites/{id}/energy at the requested resolution. `completeness` is covered time divided by
 * bucket time (never rounded up to hide gaps); the real min and max resolution are always reported, and nothing
 * is resampled to finer data than the provider supplied (rule 9).
 */
export const EnergySeriesPointSchema = z
  .strictObject({
    start: InstantUtcSchema,
    end: InstantUtcSchema,
    /** Site-local calendar date, daily resolution only. */
    localDate: z.iso.date().optional(),
    ...energyFlowFields,
    completeness: z.number().min(0).max(1),
    resolutionSecondsMin: z.int().positive().nullable(),
    resolutionSecondsMax: z.int().positive().nullable(),
    quality: IntervalQualitySchema,
  })
  .refine((p) => Date.parse(p.end) > Date.parse(p.start), {
    message: 'end must be after start',
    path: ['end'],
  })
  .refine(
    (p) =>
      p.resolutionSecondsMin === null ||
      p.resolutionSecondsMax === null ||
      p.resolutionSecondsMin <= p.resolutionSecondsMax,
    {
      message: 'resolutionSecondsMin must not exceed resolutionSecondsMax',
      path: ['resolutionSecondsMin'],
    },
  );
export type EnergySeriesPoint = z.infer<typeof EnergySeriesPointSchema>;

// --- queries ---------------------------------------------------------------------------------------------------

/** GET /sites/{id}/power?from&to&limit&cursor (raw snapshots, max 7 days). */
export const PowerQuerySchema = z
  .strictObject({
    from: InstantUtcSchema,
    to: InstantUtcSchema,
    limit: PaginationQuerySchema.shape.limit,
    cursor: PaginationQuerySchema.shape.cursor,
  })
  .refine((r) => Date.parse(r.to) > Date.parse(r.from), {
    message: 'to must be after from',
    path: ['to'],
  })
  .refine((r) => rangeWithinDays(r.from, r.to, MAX_RANGE_DAYS.power), {
    message: `range must not exceed ${MAX_RANGE_DAYS.power} days`,
    path: ['to'],
  });
export type PowerQuery = z.infer<typeof PowerQuerySchema>;

export const PowerSeriesResponseSchema = pageOf(PersistedPowerSampleSchema);
export type PowerSeriesResponse = z.infer<typeof PowerSeriesResponseSchema>;

/** GET /sites/{id}/energy?from&to&resolution. The range cap depends on the resolution. */
export const EnergyQuerySchema = z
  .strictObject({
    from: InstantUtcSchema,
    to: InstantUtcSchema,
    resolution: z.enum(ENERGY_RESOLUTIONS),
  })
  .refine((q) => Date.parse(q.to) > Date.parse(q.from), {
    message: 'to must be after from',
    path: ['to'],
  })
  .refine((q) => rangeWithinDays(q.from, q.to, MAX_RANGE_DAYS[q.resolution]), {
    message: 'range exceeds the maximum for this resolution',
    path: ['to'],
  });
export type EnergyQuery = z.infer<typeof EnergyQuerySchema>;

export const EnergySeriesResponseSchema = z.strictObject({
  resolution: z.enum(ENERGY_RESOLUTIONS),
  items: z.array(EnergySeriesPointSchema),
});
export type EnergySeriesResponse = z.infer<typeof EnergySeriesResponseSchema>;

/** DEMO series: same shape, but the response says DEMO and is never persisted. */
export const DemoEnergySeriesResponseSchema = EnergySeriesResponseSchema.extend({
  source: z.literal('DEMO'),
});
export type DemoEnergySeriesResponse = z.infer<typeof DemoEnergySeriesResponseSchema>;
