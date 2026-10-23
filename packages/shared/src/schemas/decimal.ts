import DecimalJs from 'decimal.js';
import { z } from 'zod';

/**
 * Decimal class with explicit settings (ENERGY_ACCOUNTING section 7): 28 significant digits, round half up.
 * It is a clone, so importing this package never changes the global decimal.js configuration.
 */
export const Decimal = DecimalJs.clone({ precision: 28, rounding: DecimalJs.ROUND_HALF_UP });
export type Decimal = InstanceType<typeof Decimal>;

/**
 * Decimal-safe values (rule 8, D-014). Money, rates and any exact decimal travel as STRINGS in JSON
 * (`"0.317500"`) and are parsed to `Decimal` only for arithmetic. A JavaScript number is rejected for these fields.
 *
 * Accepted text: optional leading minus, no leading zeros except a lone 0, optional fraction, no exponent, no
 * spaces, no plus sign. So "0", "0.5", "12.340000", "-3.1" are valid; "1e3", ".5", "5.", "007", "NaN", " 1" are not.
 */

export interface DecimalStringOptions {
  /** Maximum digits before the point. */
  maxIntegerDigits: number;
  /** Maximum digits after the point. */
  maxFractionDigits: number;
  allowNegative: boolean;
}

/** Build a schema for a decimal string with the given bounds (they mirror the database `numeric(p, s)`). */
export function decimalString(options: DecimalStringOptions) {
  const { maxIntegerDigits, maxFractionDigits, allowNegative } = options;
  const sign = allowNegative ? '-?' : '';
  const pattern = new RegExp(
    `^${sign}(0|[1-9]\\d{0,${maxIntegerDigits - 1}})(\\.\\d{1,${maxFractionDigits}})?$`,
  );
  return z.string().regex(pattern, {
    message: `must be a decimal string with at most ${maxIntegerDigits} integer and ${maxFractionDigits} fraction digits${allowNegative ? '' : ', not negative'}`,
  });
}

/** Rate per kWh, standing charge per day, levy amount, price point: `numeric(12,6)`, never negative. */
export const RateStringSchema = decimalString({
  maxIntegerDigits: 6,
  maxFractionDigits: 6,
  allowNegative: false,
});

/** Computed money amount (cost caches are `numeric(18,8)`); negative means a credit. */
export const MoneyAmountStringSchema = decimalString({
  maxIntegerDigits: 10,
  maxFractionDigits: 8,
  allowNegative: true,
});

/** Percentage held as an exact decimal (VAT in percent, `numeric(7,4)`), 0 to 100 enforced by `.refine`. */
export const PercentStringSchema = decimalString({
  maxIntegerDigits: 3,
  maxFractionDigits: 4,
  allowNegative: false,
}).refine((s) => new Decimal(s).lte(100), { message: 'must be between 0 and 100' });

/** Small money value with two decimals, such as the monthly Tesla spend cap in USD (`numeric(8,2)`). */
export const SpendAmountStringSchema = decimalString({
  maxIntegerDigits: 6,
  maxFractionDigits: 2,
  allowNegative: false,
});

/** A money amount with its currency. Arithmetic across different currencies is an error (ENERGY_ACCOUNTING 7). */
export const MoneySchema = z.strictObject({
  amount: MoneyAmountStringSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type Money = z.infer<typeof MoneySchema>;

/** Parse a decimal string. Throws a RangeError for anything the string schemas would reject. */
export function parseDecimal(value: string): Decimal {
  if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
    throw new RangeError('not a plain decimal string');
  }
  return new Decimal(value);
}

/**
 * Serialise a Decimal as a plain decimal string with exactly `scale` fraction digits, rounding half up.
 * Never produces exponent notation. Use for JSON and database values; presentation rounding to a currency's
 * minor unit is a separate step in the money formatter (packages/domain).
 */
export function serialiseDecimal(value: Decimal, scale: number): string {
  if (!value.isFinite()) {
    throw new RangeError('cannot serialise a non-finite decimal');
  }
  // Decimal#toFixed is exact decimal formatting, unlike Number#toFixed, which the money lint rule targets.
  // eslint-disable-next-line no-restricted-syntax
  return value.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale);
}
