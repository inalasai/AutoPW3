import { z } from 'zod';
import { IDEMPOTENCY_KEY, MINUTES_PER_DAY, PAGINATION } from '../constants/limits';

/**
 * Building blocks every other schema uses. Units are in field names, not here. Money and exact decimals are
 * in `decimal.ts`, never plain numbers.
 */

export const UuidSchema = z.uuid();

/** An instant: ISO-8601 in UTC with a trailing Z (`2026-10-22T10:00:00Z`). Offsets such as +01:00 are rejected. */
export const InstantUtcSchema = z.iso.datetime();

/** A calendar date `YYYY-MM-DD`, interpreted in the site or tariff timezone by the field that carries it. */
export const LocalDateSchema = z.iso.date();

// Region/City form with canonical capitalisation (Europe/Dublin, America/Argentina/Buenos_Aires, Etc/GMT+5, UTC).
// This also rejects fixed offsets such as "+01:00": recurring schedules must never use UTC offsets (rule 7).
const TIMEZONE_SHAPE = /^[A-Z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

/** True when `value` is an IANA zone name the runtime knows. Pure; no network. */
export function isIanaTimezone(value: string): boolean {
  if (!TIMEZONE_SHAPE.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const IanaTimezoneSchema = z.string().refine(isIanaTimezone, {
  message: 'must be an IANA timezone name such as Europe/Dublin',
});

/** ISO 4217 shape. The database CHECK is the same pattern; the currency table lives in packages/domain. */
export const CurrencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'must be a 3-letter uppercase currency code');
export type Currency = z.infer<typeof CurrencySchema>;

/** 0 to 100 inclusive, as a JSON number. Battery state of charge and other percentages. */
export const PercentSchema = z.number().min(0).max(100);

/** Signed power in W as a JSON number. The sign meaning belongs to the field (constants/signs.ts). */
export const PowerWSchema = z.number();
/** Power that can never be negative (solar generation, site load). */
export const NonNegativePowerWSchema = z.number().min(0);
/** Energy in Wh. Every directional flow is non-negative; the direction is in the field name. */
export const EnergyWhSchema = z.number().min(0);

/** Minutes after local midnight where a window starts: 0 to 1439. */
export const StartMinuteSchema = z
  .int()
  .min(0)
  .max(MINUTES_PER_DAY - 1);
/** Minutes after local midnight where a window ends (exclusive): 1 to 1440. */
export const EndMinuteSchema = z.int().min(1).max(MINUTES_PER_DAY);

export const IdempotencyKeySchema = z
  .string()
  .min(IDEMPOTENCY_KEY.minLength)
  .max(IDEMPOTENCY_KEY.maxLength)
  .regex(IDEMPOTENCY_KEY.pattern);

/** Plain text field of bounded length (names, labels). Trimmed so whitespace-only values are rejected. */
export function boundedText(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

/** Half-open local time window `[startMinute, endMinute)` that must have positive length. */
export const TimeWindowSchema = z
  .strictObject({ startMinute: StartMinuteSchema, endMinute: EndMinuteSchema })
  .refine((w) => w.endMinute > w.startMinute, {
    message: 'endMinute must be greater than startMinute',
    path: ['endMinute'],
  });
export type TimeWindow = z.infer<typeof TimeWindowSchema>;

/** Query-string pagination (`limit` default 50, max 200; opaque `cursor`). */
export const PaginationQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
  cursor: z.string().min(1).max(PAGINATION.maxCursorLength).optional(),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/** `{ items, nextCursor }` page envelope for any item schema. */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.strictObject({
    items: z.array(item),
    nextCursor: z.string().min(1).max(PAGINATION.maxCursorLength).nullable(),
  });
}

/** A half-open instant range `[from, to)` where `to` is after `from`. */
export const InstantRangeSchema = z
  .strictObject({ from: InstantUtcSchema, to: InstantUtcSchema })
  .refine((r) => Date.parse(r.to) > Date.parse(r.from), {
    message: 'to must be after from',
    path: ['to'],
  });
export type InstantRange = z.infer<typeof InstantRangeSchema>;

const MS_PER_DAY = 86_400_000;

/** Whether `[from, to)` spans no more than `maxDays` days. Both values must already be valid instants. */
export function rangeWithinDays(from: string, to: string, maxDays: number): boolean {
  return Date.parse(to) - Date.parse(from) <= maxDays * MS_PER_DAY;
}
