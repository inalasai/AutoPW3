import { z } from 'zod';
import {
  DAY_TYPES,
  EXPORT_PAYMENT_MODELS,
  LEVY_KINDS,
  PRICE_MODES,
  TARIFF_DIRECTIONS,
  TARIFF_PROBLEM_CODES,
  TAX_MODES,
} from '../constants/enums';
import { MAX_PRICE_POINTS_PER_CALL, TARIFF_LIMITS, TEXT_LIMITS } from '../constants/limits';
import { PercentStringSchema, RateStringSchema } from './decimal';
import {
  CurrencySchema,
  EndMinuteSchema,
  IanaTimezoneSchema,
  InstantUtcSchema,
  LocalDateSchema,
  PaginationQuerySchema,
  StartMinuteSchema,
  UuidSchema,
  boundedText,
  pageOf,
} from './primitives';

/**
 * Tariff profiles (ENERGY_ACCOUNTING section 5, API contract section 2.5). Rates, levy amounts and the standing
 * charge are decimal STRINGS with six fraction digits at most; VAT is a percent string (`"23.0000"` = 23 percent,
 * decision 3 of TASK-05, D-036). Dates are site-local calendar dates in the tariff's own timezone; instants for
 * dynamic prices are UTC.
 *
 * This file checks structure and single-field rules the database also enforces. Whether slots overlap, whether a
 * day is fully covered, and whether versions overlap in time are tariff-engine questions answered by
 * `validateTariff` in packages/domain (TASK-10) and again by the database exclusion constraint.
 */

export const TariffDirectionSchema = z.enum(TARIFF_DIRECTIONS);
export const PriceModeSchema = z.enum(PRICE_MODES);
export const TaxModeSchema = z.enum(TAX_MODES);
export const DayTypeSchema = z.enum(DAY_TYPES);
export const LevyKindSchema = z.enum(LEVY_KINDS);
export const ExportPaymentModelSchema = z.enum(EXPORT_PAYMENT_MODELS);

/** A rate for a local wall-clock window. Local minutes, never UTC offsets, so DST needs no special case here. */
export const TariffSlotSchema = z
  .strictObject({
    dayType: DayTypeSchema.default('ALL'),
    startMinute: StartMinuteSchema,
    endMinute: EndMinuteSchema,
    ratePerKwh: RateStringSchema,
    label: z.string().trim().min(1).max(TEXT_LIMITS.label).nullable().default(null),
  })
  .refine((s) => s.endMinute > s.startMinute, {
    message: 'endMinute must be greater than startMinute',
    path: ['endMinute'],
  });
export type TariffSlot = z.infer<typeof TariffSlotSchema>;

const slotList = z.array(TariffSlotSchema).max(TARIFF_LIMITS.maxSlotsPerSchedule);

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function validMonthDay(month: number, day: number): boolean {
  const max = DAYS_IN_MONTH[month - 1];
  return max !== undefined && day >= 1 && day <= max;
}

/** Inclusive month/day range within a tariff; may wrap the year end (for example 1 Nov to 28 Feb). */
export const TariffSeasonSchema = z
  .strictObject({
    name: boundedText(TEXT_LIMITS.name),
    startMonth: z.int().min(1).max(12),
    startDay: z.int().min(1).max(31),
    endMonth: z.int().min(1).max(12),
    endDay: z.int().min(1).max(31),
    slots: slotList,
  })
  .refine((s) => validMonthDay(s.startMonth, s.startDay), {
    message: 'startDay is not a valid day of startMonth',
    path: ['startDay'],
  })
  .refine((s) => validMonthDay(s.endMonth, s.endDay), {
    message: 'endDay is not a valid day of endMonth',
    path: ['endDay'],
  });
export type TariffSeason = z.infer<typeof TariffSeasonSchema>;

/** Date-range replacement schedule `[dateFrom, dateTo)`; the higher priority wins. */
export const TariffOverrideSchema = z
  .strictObject({
    name: boundedText(TEXT_LIMITS.name),
    dateFrom: LocalDateSchema,
    dateTo: LocalDateSchema,
    priority: z.int().min(0).max(32767),
    slots: slotList,
  })
  .refine((o) => o.dateTo > o.dateFrom, {
    message: 'dateTo must be after dateFrom',
    path: ['dateTo'],
  });
export type TariffOverride = z.infer<typeof TariffOverrideSchema>;

/** A levy charged per kWh or per local day, in the tariff currency. */
export const TariffLevySchema = z.strictObject({
  name: boundedText(TEXT_LIMITS.name),
  kind: LevyKindSchema,
  amount: RateStringSchema,
  taxable: z.boolean(),
});
export type TariffLevy = z.infer<typeof TariffLevySchema>;

/** A dynamic price for `[intervalStart, intervalEnd)` at any resolution (for example half-hourly). */
export const PricePointSchema = z
  .strictObject({
    intervalStart: InstantUtcSchema,
    intervalEnd: InstantUtcSchema,
    ratePerKwh: RateStringSchema,
  })
  .refine((p) => Date.parse(p.intervalEnd) > Date.parse(p.intervalStart), {
    message: 'intervalEnd must be after intervalStart',
    path: ['intervalEnd'],
  });
export type PricePoint = z.infer<typeof PricePointSchema>;

/** PUT /tariffs/{id}/price-points: at most 5,000 points per call (1 MiB body cap). */
export const PutPricePointsRequestSchema = z.strictObject({
  pricePoints: z.array(PricePointSchema).min(1).max(MAX_PRICE_POINTS_PER_CALL),
});
export type PutPricePointsRequest = z.infer<typeof PutPricePointsRequestSchema>;

export const PutPricePointsResponseSchema = z.strictObject({ upserted: z.int().min(0) });
export type PutPricePointsResponse = z.infer<typeof PutPricePointsResponseSchema>;

/** Fields common to a tariff header in requests and responses. */
const headerFields = {
  /** null = household default tariff; otherwise applies to that site only. */
  siteId: UuidSchema.nullable().default(null),
  name: boundedText(TEXT_LIMITS.name),
  direction: TariffDirectionSchema,
  priceMode: PriceModeSchema,
  currency: CurrencySchema,
  timezone: IanaTimezoneSchema,
  effectiveFrom: LocalDateSchema,
  effectiveTo: LocalDateSchema.nullable().default(null),
  taxMode: TaxModeSchema.default('NONE'),
  /** Percent, for example "23.0000". Required with INCLUSIVE or EXCLUSIVE tax, absent with NONE. */
  vatRatePercent: PercentStringSchema.nullable().default(null),
  /** Required for FLAT, absent otherwise. */
  flatRatePerKwh: RateStringSchema.nullable().default(null),
  /** IMPORT tariffs only. */
  standingChargePerDay: RateStringSchema.nullable().default(null),
  /** EXPORT tariffs only, and required there: payment is never assumed. */
  exportPaymentModel: ExportPaymentModelSchema.nullable().default(null),
};

const childFields = {
  slots: slotList.default([]),
  seasons: z.array(TariffSeasonSchema).max(TARIFF_LIMITS.maxSeasons).default([]),
  overrides: z.array(TariffOverrideSchema).max(TARIFF_LIMITS.maxOverrides).default([]),
  levies: z.array(TariffLevySchema).max(TARIFF_LIMITS.maxLevies).default([]),
};

interface TariffShape {
  direction: 'IMPORT' | 'EXPORT';
  priceMode: 'FLAT' | 'TIME_OF_USE' | 'DYNAMIC';
  taxMode: 'INCLUSIVE' | 'EXCLUSIVE' | 'NONE';
  effectiveFrom: string;
  effectiveTo: string | null;
  vatRatePercent: string | null;
  flatRatePerKwh: string | null;
  standingChargePerDay: string | null;
  exportPaymentModel: 'PER_KWH' | 'NONE' | null;
  slots: readonly unknown[];
  seasons: readonly { slots: readonly unknown[] }[];
}

/** Cross-field rules shared by the request and the stored tariff. Mirrors the database CHECKs plus API strictness. */
function checkTariffShape(t: TariffShape, ctx: z.RefinementCtx): void {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });

  if (t.effectiveTo !== null && t.effectiveTo <= t.effectiveFrom) {
    issue('effectiveTo', 'effectiveTo must be after effectiveFrom');
  }
  if ((t.taxMode === 'NONE') !== (t.vatRatePercent === null)) {
    issue(
      'vatRatePercent',
      'vatRatePercent is required with INCLUSIVE or EXCLUSIVE tax and must be absent with NONE',
    );
  }
  if ((t.priceMode === 'FLAT') !== (t.flatRatePerKwh !== null)) {
    issue('flatRatePerKwh', 'flatRatePerKwh is required for FLAT and must be absent otherwise');
  }
  if (t.direction === 'EXPORT' && t.standingChargePerDay !== null) {
    issue('standingChargePerDay', 'a standing charge applies to IMPORT tariffs only');
  }
  if (t.direction === 'IMPORT' && t.exportPaymentModel !== null) {
    issue('exportPaymentModel', 'exportPaymentModel applies to EXPORT tariffs only');
  }
  if (t.direction === 'EXPORT' && t.exportPaymentModel === null) {
    issue(
      'exportPaymentModel',
      'exportPaymentModel is required for EXPORT tariffs (PER_KWH or NONE)',
    );
  }
  const hasSeasonSlots = t.seasons.some((s) => s.slots.length > 0);
  if (t.priceMode === 'TIME_OF_USE' && t.slots.length === 0 && !hasSeasonSlots) {
    issue('slots', 'a TIME_OF_USE tariff needs at least one slot');
  }
  if (t.priceMode !== 'TIME_OF_USE' && (t.slots.length > 0 || t.seasons.length > 0)) {
    issue('slots', 'slots and seasons apply to TIME_OF_USE tariffs only');
  }
}

/**
 * POST /households/{hid}/tariffs. With `tariffKey` it creates a NEW VERSION of that tariff; without, a new tariff.
 * An existing version is never edited (only `effectiveTo` can end it).
 */
export const CreateTariffRequestSchema = z
  .strictObject({
    tariffKey: UuidSchema.optional(),
    ...headerFields,
    ...childFields,
  })
  .superRefine(checkTariffShape);
export type CreateTariffRequest = z.infer<typeof CreateTariffRequestSchema>;

/** A stored tariff version as returned by GET /tariffs/{id}. Price points come from a separate endpoint. */
export const TariffSchema = z
  .strictObject({
    id: UuidSchema,
    tariffKey: UuidSchema,
    version: z.int().min(1),
    createdAt: InstantUtcSchema,
    ...headerFields,
    ...childFields,
  })
  .superRefine(checkTariffShape);
export type Tariff = z.infer<typeof TariffSchema>;

/** List row: the header only. */
export const TariffSummarySchema = z.strictObject({
  id: UuidSchema,
  tariffKey: UuidSchema,
  version: z.int().min(1),
  siteId: UuidSchema.nullable(),
  name: z.string().min(1).max(TEXT_LIMITS.name),
  direction: TariffDirectionSchema,
  priceMode: PriceModeSchema,
  currency: CurrencySchema,
  timezone: IanaTimezoneSchema,
  effectiveFrom: LocalDateSchema,
  effectiveTo: LocalDateSchema.nullable(),
});
export type TariffSummary = z.infer<typeof TariffSummarySchema>;

export const TariffListQuerySchema = z.strictObject({
  direction: TariffDirectionSchema.optional(),
  /** Local date: only tariffs in force on that date. */
  asOf: LocalDateSchema.optional(),
  limit: PaginationQuerySchema.shape.limit,
  cursor: PaginationQuerySchema.shape.cursor,
});
export type TariffListQuery = z.infer<typeof TariffListQuerySchema>;

export const TariffListResponseSchema = pageOf(TariffSummarySchema);

/** PATCH /tariffs/{id}: only `effectiveTo` (ending a version). Anything else needs a new version. */
export const EndTariffRequestSchema = z.strictObject({ effectiveTo: LocalDateSchema });
export type EndTariffRequest = z.infer<typeof EndTariffRequestSchema>;

export const TariffProblemSchema = z.strictObject({
  code: z.enum(TARIFF_PROBLEM_CODES),
  path: z.string().max(200),
  message: z.string().min(1).max(TEXT_LIMITS.reason),
});
export type TariffProblem = z.infer<typeof TariffProblemSchema>;

/** POST /tariffs/{id}/validate: a dry validation with no write. */
export const ValidateTariffResponseSchema = z
  .strictObject({ valid: z.boolean(), problems: z.array(TariffProblemSchema) })
  .refine((r) => r.valid === (r.problems.length === 0), {
    message: 'valid must be true exactly when there are no problems',
    path: ['valid'],
  });
export type ValidateTariffResponse = z.infer<typeof ValidateTariffResponseSchema>;
