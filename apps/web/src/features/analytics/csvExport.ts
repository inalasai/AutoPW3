import { formatDec } from './format';
import type { CostChartPoint, EnergyChartPoint } from './types';

/**
 * Characters that spreadsheet applications (Excel, Google Sheets) may interpret as formula starters.
 * Leading whitespace is also considered.
 */
const FORMULA_START_CHARS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Guards against CSV formula injection (OWASP CSV Injection).
 * If a cell string starts with an injection character, prepend a single quote `'`.
 */
export function sanitizeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  let str = String(value);

  // Check if string starts with formula trigger
  const trimmed = str.trimStart();
  if (trimmed.length > 0 && FORMULA_START_CHARS.includes(trimmed[0]!)) {
    str = `'${str}`;
  }

  // If contains commas, double quotes, or newlines, wrap in quotes and escape existing quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Builds CSV string for energy chart data.
 */
export function buildEnergyCsv(points: readonly EnergyChartPoint[]): string {
  const headers = [
    'Timestamp (UTC)',
    'Period Label',
    'Solar Generated (kWh)',
    'Home Consumption (kWh)',
    'Grid Import (kWh)',
    'Grid Export (kWh)',
    'Battery Charged (kWh)',
    'Battery Discharged (kWh)',
    'Data Status',
  ];

  const rows = points.map((p) => [
    sanitizeCsvField(p.timestamp),
    sanitizeCsvField(p.label),
    sanitizeCsvField(formatDec(p.solarKwh, 3)),
    sanitizeCsvField(formatDec(p.homeKwh, 3)),
    sanitizeCsvField(formatDec(p.gridImportKwh, 3)),
    sanitizeCsvField(formatDec(p.gridExportKwh, 3)),
    sanitizeCsvField(formatDec(p.batteryChargedKwh, 3)),
    sanitizeCsvField(formatDec(p.batteryDischargedKwh, 3)),
    sanitizeCsvField(p.isGap ? 'GAP' : 'OK'),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

/**
 * Builds CSV string for cost chart data.
 */
export function buildCostCsv(points: readonly CostChartPoint[], currency: string = 'EUR'): string {
  const headers = [
    'Timestamp (UTC)',
    'Period Label',
    `Import Cost (${currency})`,
    `Export Credit (${currency})`,
    `Net Cost (${currency})`,
    'Data Status',
  ];

  const rows = points.map((p) => [
    sanitizeCsvField(p.timestamp),
    sanitizeCsvField(p.label),
    sanitizeCsvField(formatDec(p.importCost, 2)),
    sanitizeCsvField(formatDec(p.exportCredit, 2)),
    sanitizeCsvField(formatDec(p.netCost, 2)),
    sanitizeCsvField(p.isGap ? 'GAP' : 'OK'),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

/**
 * Triggers a browser file download of CSV content.
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
