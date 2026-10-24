import { describe, expect, it } from 'vitest';
import {
  Decimal,
  decimalFrom,
  energyWhFrom,
  exact,
  minorUnitDigits,
  roundToMinorUnit,
  whToKwh,
} from './money';

describe('decimalFrom', () => {
  it('parses plain decimal strings exactly, including negatives', () => {
    expect(exact(decimalFrom('0.350000'))).toBe('0.35');
    expect(exact(decimalFrom('-0.0123'))).toBe('-0.0123');
    expect(exact(decimalFrom('1234567.123456'))).toBe('1234567.123456');
  });

  it('refuses anything that is not a plain decimal string', () => {
    for (const bad of ['1e3', '.5', '5.', '007', 'NaN', ' 1', '', '1,5', '+1']) {
      expect(() => decimalFrom(bad)).toThrow(RangeError);
    }
    // A number is not accepted for money or rates (the type forbids it; this proves the runtime too).
    expect(() => decimalFrom(0.1 as unknown as string)).toThrow(RangeError);
  });

  it('is exact where binary floating point is not: 0.1 + 0.2 is 0.3', () => {
    const sum = decimalFrom('0.1').plus(decimalFrom('0.2'));
    expect(exact(sum)).toBe('0.3');
    expect(0.1 + 0.2 === 0.3).toBe(false); // the reason money is never a float
  });
});

describe('energyWhFrom and whToKwh', () => {
  it('accepts strings and finite non-negative numbers, converting numbers through their text', () => {
    expect(exact(energyWhFrom('1234.5'))).toBe('1234.5');
    expect(exact(energyWhFrom(0.1))).toBe('0.1');
    expect(exact(energyWhFrom(0))).toBe('0');
  });

  it('refuses negative, non-finite and malformed energy', () => {
    expect(() => energyWhFrom(-1)).toThrow(RangeError);
    expect(() => energyWhFrom('-1')).toThrow(RangeError);
    expect(() => energyWhFrom(Number.NaN)).toThrow(RangeError);
    expect(() => energyWhFrom(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => energyWhFrom('abc')).toThrow(RangeError);
  });

  it('divides watt-hours by 1000 exactly', () => {
    expect(exact(whToKwh(new Decimal('1234')))).toBe('1.234');
    expect(exact(whToKwh(new Decimal('1')))).toBe('0.001');
  });
});

describe('exact', () => {
  it('never uses exponent notation, however small or large', () => {
    expect(exact(new Decimal('0.0000000001'))).toBe('0.0000000001');
    expect(exact(new Decimal('123456789012345678901234'))).toBe('123456789012345678901234');
  });
});

describe('roundToMinorUnit', () => {
  it('rounds half up to the currency minor unit', () => {
    expect(roundToMinorUnit('1.426000', 'EUR')).toBe('1.43');
    expect(roundToMinorUnit('0.276', 'EUR')).toBe('0.28');
    expect(roundToMinorUnit('0.004999', 'EUR')).toBe('0.00');
    expect(roundToMinorUnit('0.005', 'EUR')).toBe('0.01');
    expect(roundToMinorUnit('1.005', 'EUR')).toBe('1.01'); // 1.005 is not exactly representable as a float
    expect(roundToMinorUnit('2.675', 'GBP')).toBe('2.68');
  });

  it('rounds ties away from zero for negative amounts (credits)', () => {
    expect(roundToMinorUnit('-0.005', 'EUR')).toBe('-0.01');
    expect(roundToMinorUnit('-0.05', 'EUR')).toBe('-0.05');
    expect(roundToMinorUnit('-1.004', 'EUR')).toBe('-1.00');
  });

  it('uses the right number of digits per currency and accepts a Decimal', () => {
    expect(roundToMinorUnit('1234.5', 'JPY')).toBe('1235');
    expect(roundToMinorUnit(new Decimal('0.1'), 'USD')).toBe('0.10');
    expect(minorUnitDigits('EUR')).toBe(2);
    expect(minorUnitDigits('JPY')).toBe(0);
  });

  it('refuses a currency it has no rule for instead of guessing', () => {
    expect(() => roundToMinorUnit('1', 'BHD')).toThrow(RangeError);
    expect(() => minorUnitDigits('XXX')).toThrow(RangeError);
  });
});
