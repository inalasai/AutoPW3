import { describe, expect, it } from 'vitest';
import {
  Decimal,
  MoneyAmountStringSchema,
  MoneySchema,
  PercentStringSchema,
  RateStringSchema,
  SpendAmountStringSchema,
  decimalString,
  parseDecimal,
  serialiseDecimal,
} from './decimal';

describe('RateStringSchema (numeric(12,6), never negative)', () => {
  it.each(['0', '0.5', '0.317500', '12.340000', '999999.999999'])('accepts %s', (v) => {
    expect(RateStringSchema.safeParse(v).success).toBe(true);
  });

  it.each([
    '1e3',
    '.5',
    '5.',
    '007',
    'NaN',
    'Infinity',
    ' 1',
    '1 ',
    '+1',
    '-0.1',
    '0.1234567',
    '1000000',
    '',
    '1,5',
  ])('rejects the text %j', (v) => {
    expect(RateStringSchema.safeParse(v).success).toBe(false);
  });

  it('rejects a JSON number: money is never a number', () => {
    expect(RateStringSchema.safeParse(0.3175).success).toBe(false);
    expect(RateStringSchema.safeParse(0).success).toBe(false);
    expect(RateStringSchema.safeParse(null).success).toBe(false);
    expect(RateStringSchema.safeParse(undefined).success).toBe(false);
  });
});

describe('MoneyAmountStringSchema (signed, up to 8 decimals)', () => {
  it('accepts credits and debits', () => {
    for (const v of ['1.426', '-0.05', '0', '-0.00000001', '1234567890.12345678']) {
      expect(MoneyAmountStringSchema.safeParse(v).success).toBe(true);
    }
  });

  it('rejects too many digits and floats', () => {
    for (const v of ['0.123456789', '12345678901', 1.5, '--1']) {
      expect(MoneyAmountStringSchema.safeParse(v).success).toBe(false);
    }
  });
});

describe('PercentStringSchema (VAT in percent)', () => {
  it('accepts 0 to 100 inclusive', () => {
    for (const v of ['0', '23', '23.0000', '100', '100.0000', '13.5']) {
      expect(PercentStringSchema.safeParse(v).success).toBe(true);
    }
  });

  it('rejects above 100, negatives and a fraction written as 5 decimals', () => {
    for (const v of ['100.0001', '101', '-1', '23.00001', 23]) {
      expect(PercentStringSchema.safeParse(v).success).toBe(false);
    }
  });
});

describe('SpendAmountStringSchema (numeric(8,2))', () => {
  it('accepts two decimals', () => {
    expect(SpendAmountStringSchema.safeParse('9.00').success).toBe(true);
    expect(SpendAmountStringSchema.safeParse('9.001').success).toBe(false);
    expect(SpendAmountStringSchema.safeParse(9).success).toBe(false);
  });
});

describe('MoneySchema', () => {
  it('needs a string amount and a currency', () => {
    expect(MoneySchema.safeParse({ amount: '1.43', currency: 'EUR' }).success).toBe(true);
    expect(MoneySchema.safeParse({ amount: 1.43, currency: 'EUR' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: '1.43' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: '1.43', currency: 'eur' }).success).toBe(false);
  });
});

describe('decimalString factory', () => {
  it('builds a bounded schema', () => {
    const two = decimalString({ maxIntegerDigits: 2, maxFractionDigits: 1, allowNegative: false });
    expect(two.safeParse('99.9').success).toBe(true);
    expect(two.safeParse('100').success).toBe(false);
    expect(two.safeParse('9.99').success).toBe(false);
  });
});

describe('parseDecimal and serialiseDecimal', () => {
  it('parses exactly with no float error', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floats; decimals are exact.
    expect(parseDecimal('0.1').plus(parseDecimal('0.2')).equals(parseDecimal('0.3'))).toBe(true);
  });

  it('reproduces the ENERGY_ACCOUNTING worked example without rounding drift', () => {
    const importCost = parseDecimal('2').times(parseDecimal('0.300000'));
    const standing = parseDecimal('0.600000');
    const vat = importCost.plus(standing).times(parseDecimal('23').div(100));
    expect(serialiseDecimal(vat, 6)).toBe('0.276000');
  });

  it('serialises to a fixed scale, half up, never with an exponent', () => {
    expect(serialiseDecimal(new Decimal('1.5'), 6)).toBe('1.500000');
    expect(serialiseDecimal(new Decimal('0.0000005'), 6)).toBe('0.000001');
    expect(serialiseDecimal(new Decimal('2.5'), 0)).toBe('3');
    expect(serialiseDecimal(new Decimal('1e-9'), 8)).toBe('0.00000000');
    expect(serialiseDecimal(new Decimal('123456789012345678'), 2)).toBe('123456789012345678.00');
  });

  it('refuses text and non-finite values that are not plain decimals', () => {
    for (const v of ['1e3', 'abc', '', '1.', '.5', '0x10']) {
      expect(() => parseDecimal(v)).toThrow(RangeError);
    }
    expect(() => serialiseDecimal(new Decimal(Number.POSITIVE_INFINITY), 2)).toThrow(RangeError);
  });

  it('round-trips a valid rate through the schema', () => {
    const text = RateStringSchema.parse('0.317500');
    expect(serialiseDecimal(parseDecimal(text), 6)).toBe(text);
  });
});
