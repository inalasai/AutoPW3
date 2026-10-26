import { describe, expect, it } from 'vitest';
import { buildCostCsv, buildEnergyCsv, sanitizeCsvField } from './csvExport';
import type { CostChartPoint, EnergyChartPoint } from './types';

describe('csvExport utilities', () => {
  describe('sanitizeCsvField', () => {
    it('handles null and undefined', () => {
      expect(sanitizeCsvField(null)).toBe('');
      expect(sanitizeCsvField(undefined)).toBe('');
    });

    it('leaves standard numbers and text unmodified', () => {
      expect(sanitizeCsvField('2026-06-21')).toBe('2026-06-21');
      expect(sanitizeCsvField(42.5)).toBe('42.5');
    });

    it('neutralizes spreadsheet formula injection starters (=, +, -, @, \\t, \\r)', () => {
      expect(sanitizeCsvField('=cmd|/C calc')).toBe("'=cmd|/C calc");
      expect(sanitizeCsvField('+SUM(A1:A10)')).toBe("'+SUM(A1:A10)");
      expect(sanitizeCsvField('-10% discount')).toBe("'-10% discount");
      expect(sanitizeCsvField('@alert')).toBe("'@alert");
      expect(sanitizeCsvField('  =cmd')).toBe("'  =cmd");
    });

    it('escapes quotes and handles embedded commas', () => {
      expect(sanitizeCsvField('Hello, World')).toBe('"Hello, World"');
      expect(sanitizeCsvField('Hello "World"')).toBe('"Hello ""World"""');
    });
  });

  describe('buildEnergyCsv', () => {
    it('produces formatted CSV with units in headers and stringified decimals', () => {
      const points: EnergyChartPoint[] = [
        {
          timestamp: '2026-06-21T12:00:00Z',
          label: '12:00',
          solarKwh: 3.456,
          homeKwh: 1.2,
          gridImportKwh: 0,
          gridExportKwh: 2.256,
          batteryChargedKwh: 0,
          batteryDischargedKwh: 0,
          isGap: false,
        },
      ];

      const csv = buildEnergyCsv(points);
      expect(csv).toContain('Solar Generated (kWh)');
      expect(csv).toContain('Home Consumption (kWh)');
      expect(csv).toContain('2026-06-21T12:00:00Z');
      expect(csv).toContain('3.456');
      expect(csv).toContain('1.200');
      expect(csv).toContain('OK');
    });

    it('marks gaps clearly', () => {
      const points: EnergyChartPoint[] = [
        {
          timestamp: '2026-06-21T10:00:00Z',
          label: '10:00',
          solarKwh: 0,
          homeKwh: 0,
          gridImportKwh: 0,
          gridExportKwh: 0,
          batteryChargedKwh: 0,
          batteryDischargedKwh: 0,
          isGap: true,
        },
      ];

      const csv = buildEnergyCsv(points);
      expect(csv).toContain('GAP');
    });
  });

  describe('buildCostCsv', () => {
    it('produces formatted cost CSV with currency in headers', () => {
      const points: CostChartPoint[] = [
        {
          timestamp: '2026-06-21T12:00:00Z',
          label: '12:00',
          importCost: 0.74,
          exportCredit: 0.25,
          netCost: 0.49,
          isGap: false,
        },
      ];

      const csv = buildCostCsv(points, 'EUR');
      expect(csv).toContain('Import Cost (EUR)');
      expect(csv).toContain('Export Credit (EUR)');
      expect(csv).toContain('Net Cost (EUR)');
      expect(csv).toContain('0.74');
      expect(csv).toContain('0.25');
      expect(csv).toContain('0.49');
    });
  });
});
