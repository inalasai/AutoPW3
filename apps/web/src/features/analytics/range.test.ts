import { describe, expect, it } from 'vitest';
import {
  countLocalDays,
  getAvailableResolutions,
  getDefaultResolution,
  resolveDateRange,
  resolvePresetDates,
} from './range';

describe('range utilities', () => {
  it('resolves standard day preset', () => {
    const range = resolveDateRange('day', 'Europe/Dublin', '2026-06-21');
    expect(range.startDate).toBe('2026-06-21');
    expect(range.endDate).toBe('2026-06-21');
    // Europe/Dublin is UTC+1 in June (Irish Standard Time)
    expect(range.from).toBe('2026-06-20T23:00:00Z');
    expect(range.to).toBe('2026-06-21T23:00:00Z');
  });

  it('handles DST spring-forward 23h day (2026-03-29)', () => {
    const range = resolveDateRange('day', 'Europe/Dublin', '2026-03-29');
    expect(range.startDate).toBe('2026-03-29');
    expect(range.from).toBe('2026-03-29T00:00:00Z');
    // Clock jumped from 01:00 to 02:00, so end of local day is 23:00 UTC
    expect(range.to).toBe('2026-03-29T23:00:00Z');
    const fromMs = Date.parse(range.from);
    const toMs = Date.parse(range.to);
    expect((toMs - fromMs) / (3600 * 1000)).toBe(23);
  });

  it('handles DST fall-back 25h day (2026-10-25)', () => {
    const range = resolveDateRange('day', 'Europe/Dublin', '2026-10-25');
    expect(range.startDate).toBe('2026-10-25');
    // Starts at 23:00 UTC of previous day (in IST UTC+1)
    expect(range.from).toBe('2026-10-24T23:00:00Z');
    // Clock repeated 01:00 to 02:00, back to GMT UTC+0 at 02:00. End of day is 2026-10-26T00:00:00Z
    expect(range.to).toBe('2026-10-26T00:00:00Z');
    const fromMs = Date.parse(range.from);
    const toMs = Date.parse(range.to);
    expect((toMs - fromMs) / (3600 * 1000)).toBe(25);
  });

  it('resolves week preset for 7 local days', () => {
    const range = resolveDateRange('week', 'Europe/Dublin', '2026-10-24');
    expect(range.startDate).toBe('2026-10-24');
    expect(range.endDate).toBe('2026-10-30');
    expect(countLocalDays(range.startDate, range.endDate)).toBe(7);
  });

  it('resolves month preset covering entire calendar month', () => {
    const dates = resolvePresetDates('month', '2026-06-21');
    expect(dates.startDate).toBe('2026-06-01');
    expect(dates.endDate).toBe('2026-06-30');
  });

  it('resolves year preset covering full calendar year', () => {
    const dates = resolvePresetDates('year', '2026-06-21');
    expect(dates.startDate).toBe('2026-01-01');
    expect(dates.endDate).toBe('2026-12-31');
  });

  it('resolves custom date range', () => {
    const range = resolveDateRange(
      'custom',
      'Europe/Dublin',
      '2026-06-21',
      '2026-07-01',
      '2026-07-05',
    );
    expect(range.startDate).toBe('2026-07-01');
    expect(range.endDate).toBe('2026-07-05');
  });

  it('provides appropriate resolution choices without violating limits', () => {
    expect(getAvailableResolutions('day', '2026-06-21', '2026-06-21')).toEqual([
      'interval',
      'hourly',
    ]);
    expect(getAvailableResolutions('week', '2026-06-01', '2026-06-07')).toEqual([
      'hourly',
      'interval',
      'daily',
    ]);
    expect(getAvailableResolutions('year', '2026-01-01', '2026-12-31')).toEqual(['daily']);

    expect(getDefaultResolution('day')).toBe('interval');
    expect(getDefaultResolution('week')).toBe('hourly');
    expect(getDefaultResolution('month')).toBe('daily');
    expect(getDefaultResolution('year')).toBe('daily');
  });
});
