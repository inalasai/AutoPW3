import { describe, expect, it } from 'vitest';
import { chargesForLocalDates } from './charges';
import {
  DAY_NIGHT_PEAK_IMPORT_EXAMPLE,
  EXPORT_PER_KWH_EXAMPLE,
  FLAT_IMPORT_EXAMPLE,
  SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE,
} from './fixtures';
import { priceInterval } from './price';
import { ms } from './test-helpers';

/**
 * Proof that the engine does no floating-point money (TASK-10 acceptance). Two layers, because the ESLint
 * `no-restricted-properties`/`no-restricted-syntax` rules in the domain package already block `parseFloat` and
 * `Number#toFixed` (`npm run lint`):
 *  1. a scan of the engine's source for number-based money operations, with the one allowed form named;
 *  2. a run that checks every money value leaving the engine is a decimal string, and that the classic
 *     floating-point trap (0.1 + 0.2) is exact.
 */

type RawModules = Record<string, string>;
// `import.meta.glob` is replaced by Vite at transform time, so it must be written out in full.
const sources = (
  import.meta as unknown as {
    glob: (p: string, o: { query: string; import: string; eager: true }) => RawModules;
  }
).glob('./*.ts', { query: '?raw', import: 'default', eager: true });

const engineFiles = Object.entries(sources)
  .map(([path, text]) => ({ name: path.replace('./', ''), text }))
  .filter((f) => !f.name.endsWith('.test.ts') && f.name !== 'test-helpers.ts');

const arithmeticFiles = engineFiles.filter((f) =>
  ['money.ts', 'charges.ts', 'price.ts', 'resolve.ts', 'select.ts'].includes(f.name),
);

describe('engine source has no number-based money operations', () => {
  it('finds the engine files (guards against the scan silently matching nothing)', () => {
    const names = engineFiles.map((f) => f.name);
    for (const expected of [
      'money.ts',
      'charges.ts',
      'price.ts',
      'resolve.ts',
      'split.ts',
      'validate.ts',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('never parses text into a floating-point number', () => {
    for (const f of engineFiles) {
      expect(f.text, f.name).not.toMatch(/parseFloat/);
      expect(f.text, f.name).not.toMatch(/Number\.parseFloat/);
      expect(f.text, f.name).not.toMatch(/\bparseInt\(/);
    }
  });

  it('does not coerce money to a number or round with Math in the arithmetic files', () => {
    for (const f of arithmeticFiles) {
      expect(f.text, f.name).not.toMatch(/\bNumber\(/);
      expect(f.text, f.name).not.toMatch(/\bMath\.(round|floor|ceil|trunc|fround)\b/);
      expect(f.text, f.name).not.toMatch(/\.toNumber\(/);
      expect(f.text, f.name).not.toMatch(/\bparseDecimal\(\s*\+/);
    }
  });

  it('uses toFixed only on Decimal values, each use marked with the lint exemption', () => {
    for (const f of engineFiles) {
      const lines = f.text.split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('.toFixed(')) return;
        const above = lines.slice(Math.max(0, i - 3), i).join('\n');
        expect(f.name, `toFixed in ${f.name}:${i + 1}`).toBe('money.ts');
        expect(above, `no exemption comment above ${f.name}:${i + 1}`).toMatch(/Decimal#toFixed/);
      });
    }
  });
});

describe('every money value leaving the engine is a decimal string', () => {
  const DECIMAL = /^-?\d+(\.\d+)?$/;
  const BREAKDOWN_KEYS = [
    'baseAmount',
    'levyAmount',
    'vatAmount',
    'totalAmount',
    'amountExcludingVat',
  ] as const;

  it('priceInterval amounts, parts and rates', () => {
    const tariffs = [DAY_NIGHT_PEAK_IMPORT_EXAMPLE, EXPORT_PER_KWH_EXAMPLE];
    const result = priceInterval(
      { startMs: ms('2026-06-15T12:00:00Z'), endMs: ms('2026-06-15T13:00:00Z'), energyWh: 1234.5 },
      tariffs,
      'IMPORT',
    );
    if (result.status !== 'PRICED') throw new Error(`unexpected status ${result.status}`);
    expect(typeof result.energyKwh).toBe('string');
    for (const key of BREAKDOWN_KEYS) {
      expect(typeof result.amounts[key], key).toBe('string');
      expect(result.amounts[key], key).toMatch(DECIMAL);
    }
    for (const part of result.parts) {
      expect(part.ratePerKwh).toMatch(DECIMAL);
      expect(part.energyKwh).toMatch(DECIMAL);
      for (const key of BREAKDOWN_KEYS) expect(part.amounts[key]).toMatch(DECIMAL);
    }
  });

  it('chargesForLocalDates amounts', () => {
    const r = chargesForLocalDates('2026-03-28', '2026-04-01', [
      SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE,
    ]);
    if (!r.ok) throw new Error('unexpected problems');
    for (const key of BREAKDOWN_KEYS) expect(r.totals[key]).toMatch(DECIMAL);
    for (const day of r.days) {
      expect(day.standingChargeAmount).toMatch(DECIMAL);
      for (const key of BREAKDOWN_KEYS) expect(day.amounts[key]).toMatch(DECIMAL);
    }
  });

  it('is exact where binary floating point is not: 0.1 + 0.2 kWh at 0.1 per kWh', () => {
    // As numbers, 0.1 + 0.2 = 0.30000000000000004. Energy of 100 Wh + 200 Wh priced one after the other must
    // add up to exactly the price of 300 Wh.
    const flat = [FLAT_IMPORT_EXAMPLE];
    const at = (energyWh: number) =>
      priceInterval(
        { startMs: ms('2026-06-15T12:00:00Z'), endMs: ms('2026-06-15T12:30:00Z'), energyWh },
        flat,
        'IMPORT',
      );
    const a = at(100);
    const b = at(200);
    const c = at(300);
    if (a.status !== 'PRICED' || b.status !== 'PRICED' || c.status !== 'PRICED')
      throw new Error('not priced');
    // 0.1 kWh x 0.30 = 0.03 and 0.2 kWh x 0.30 = 0.06; together 0.09 = 0.3 kWh x 0.30, with no residue.
    expect(a.amounts.baseAmount).toBe('0.03');
    expect(b.amounts.baseAmount).toBe('0.06');
    expect(c.amounts.baseAmount).toBe('0.09');
    expect(0.1 + 0.2).not.toBe(0.3); // the trap is real in this runtime
  });

  it('the shared money guard refuses a number where money is expected', async () => {
    const { decimalFrom } = await import('./money');
    expect(() => decimalFrom(0.1 as unknown as string)).toThrow();
  });
});
