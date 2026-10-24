import { Decimal, parseDecimal } from '@autopw3/shared';

/**
 * Decimal helpers for the tariff engine (ENERGY_ACCOUNTING section 7, D-014). Everything is `Decimal` (28 digits,
 * round half up) and leaves the engine as an exact decimal string. The engine rounds nothing; rounding to a
 * currency's minor unit is a separate, explicit step (`roundToMinorUnit`) done once per displayed line.
 */

export { Decimal };

/**
 * Parse a decimal string such as "0.350000" or "-0.0123" exactly. A JavaScript number is not accepted: money
 * and rates travel as strings. Throws `RangeError` for text that is not a plain decimal.
 */
export function decimalFrom(value: string): Decimal {
  // The type says string, but JSON and casts can deliver a number; refuse it rather than let it be coerced.
  if (typeof value !== 'string') throw new RangeError('a decimal must be given as a string');
  return parseDecimal(value);
}

/**
 * Energy in watt-hours as a `Decimal`. Energy is not money, so a finite non-negative JavaScript number is
 * accepted; it is converted through its shortest decimal text (0.1 is exactly 0.1) and never rounded.
 */
export function energyWhFrom(value: string | number): Decimal {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('energyWh must be a finite number');
    if (value < 0) throw new RangeError('energyWh must not be negative');
    return new Decimal(String(value));
  }
  if (typeof value !== 'string') throw new RangeError('energyWh must be a string or a number');
  const parsed = parseDecimal(value);
  if (parsed.isNegative()) throw new RangeError('energyWh must not be negative');
  return parsed;
}

/** Exact plain-text form: no exponent, no rounding, no trailing zeros added. */
export function exact(value: Decimal): string {
  // Decimal#toFixed() with no argument is exact decimal text, unlike Number#toFixed, which the money lint rule targets.
  // eslint-disable-next-line no-restricted-syntax
  return value.toFixed();
}

/** Watt-hours to kilowatt-hours, exactly (division by 1000 is exact in decimal). */
export function whToKwh(wh: Decimal): Decimal {
  return wh.div(1000);
}

/**
 * ISO 4217 minor-unit digits for the currencies this project has meaningfully considered. A currency that is not
 * listed is an error, never a guess: add it here with a decision when it is first needed.
 */
const MINOR_UNIT_DIGITS: Readonly<Record<string, number>> = {
  EUR: 2,
  GBP: 2,
  USD: 2,
  CHF: 2,
  CAD: 2,
  AUD: 2,
  NZD: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  CZK: 2,
  JPY: 0,
};

/** Number of decimal places of a currency's minor unit (2 for EUR). Throws `RangeError` for an unlisted currency. */
export function minorUnitDigits(currency: string): number {
  const digits = MINOR_UNIT_DIGITS[currency];
  if (digits === undefined) {
    throw new RangeError('no minor-unit rule for this currency; add it with a decision');
  }
  return digits;
}

/**
 * Round half up to the currency's minor unit and return the exact text with that many fraction digits
 * ("1.43"). Half up means away from zero for ties on both signs: 0.005 gives 0.01 and -0.005 gives -0.01. Call it once
 * per displayed line (ENERGY_ACCOUNTING section 7); never round a value that will be summed further.
 */
export function roundToMinorUnit(amount: string | Decimal, currency: string): string {
  const digits = minorUnitDigits(currency);
  const value = typeof amount === 'string' ? parseDecimal(amount) : amount;
  // Decimal#toFixed(n) is exact decimal formatting with half-up rounding from this clone's settings.
  // eslint-disable-next-line no-restricted-syntax
  return value.toDecimalPlaces(digits, Decimal.ROUND_HALF_UP).toFixed(digits);
}
