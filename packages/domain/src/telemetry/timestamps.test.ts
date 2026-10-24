import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  dayOfWeek,
  formatInstant,
  isKnownTimeZone,
  localDateOf,
  localDayBounds,
  localMinuteOfDay,
  normaliseTimestamp,
  parseInstantMs,
  utcOffsetMinutes,
} from './timestamps';

const HOUR = 3_600_000;

describe('parseInstantMs / normaliseTimestamp', () => {
  it('reads an ISO instant ending in Z', () => {
    expect(parseInstantMs('2026-06-21T12:00:00Z')).toBe(Date.UTC(2026, 5, 21, 12));
    expect(normaliseTimestamp('2026-06-21T12:00:00Z')).toBe('2026-06-21T12:00:00Z');
  });

  it('converts an offset to UTC, so equal instants normalise to the same string', () => {
    expect(normaliseTimestamp('2026-06-21T13:00:00+01:00')).toBe('2026-06-21T12:00:00Z');
    expect(normaliseTimestamp('2026-06-21T07:00:00-05:00')).toBe('2026-06-21T12:00:00Z');
  });

  it('keeps milliseconds only when they are not zero', () => {
    expect(normaliseTimestamp('2026-06-21T12:00:00.000Z')).toBe('2026-06-21T12:00:00Z');
    expect(normaliseTimestamp('2026-06-21T12:00:00.250Z')).toBe('2026-06-21T12:00:00.250Z');
  });

  it('accepts a Date and epoch milliseconds', () => {
    const ms = Date.UTC(2026, 5, 21, 12);
    expect(normaliseTimestamp(new Date(ms))).toBe('2026-06-21T12:00:00Z');
    expect(normaliseTimestamp(ms)).toBe('2026-06-21T12:00:00Z');
  });

  it('refuses a string with no zone: it could be UTC, the site or the server', () => {
    expect(normaliseTimestamp('2026-06-21T12:00:00')).toBeNull();
    expect(normaliseTimestamp('2026-06-21')).toBeNull();
    expect(normaliseTimestamp('2026-06-21 12:00:00')).toBeNull();
  });

  it('refuses impossible dates and times instead of rolling them over', () => {
    expect(normaliseTimestamp('2026-02-30T00:00:00Z')).toBeNull();
    expect(normaliseTimestamp('2026-13-01T00:00:00Z')).toBeNull();
    expect(normaliseTimestamp('2026-06-21T24:00:00Z')).toBeNull();
    expect(normaliseTimestamp('2026-06-21T12:60:00Z')).toBeNull();
    expect(normaliseTimestamp('2026-06-21T12:00:60Z')).toBeNull();
    expect(normaliseTimestamp('2026-06-21T12:00:00+24:00')).toBeNull();
  });

  it('accepts 29 February only in a leap year', () => {
    expect(normaliseTimestamp('2028-02-29T00:00:00Z')).toBe('2028-02-29T00:00:00Z');
    expect(normaliseTimestamp('2026-02-29T00:00:00Z')).toBeNull();
  });

  it('refuses epoch seconds passed where milliseconds are expected (they land in 1970)', () => {
    expect(normaliseTimestamp(1_782_043_200)).toBeNull();
  });

  it('refuses non-integers, NaN, Infinity and other types', () => {
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1.5,
      null,
      undefined,
      {},
      true,
      [],
      'x',
    ]) {
      expect(normaliseTimestamp(bad)).toBeNull();
    }
    expect(parseInstantMs(new Date('nonsense'))).toBeNull();
  });

  it('formats a leap-second-free instant round trip', () => {
    const ms = Date.UTC(2026, 9, 25, 1, 0, 0);
    expect(parseInstantMs(formatInstant(ms))).toBe(ms);
  });
});

describe('zone offsets and local dates (no fixed offsets)', () => {
  it('Europe/Dublin is UTC+0 in winter and UTC+1 in summer', () => {
    expect(utcOffsetMinutes(Date.UTC(2026, 0, 15, 12), 'Europe/Dublin')).toBe(0);
    expect(utcOffsetMinutes(Date.UTC(2026, 5, 21, 12), 'Europe/Dublin')).toBe(60);
  });

  it('a zone east of Greenwich has a positive offset', () => {
    expect(utcOffsetMinutes(Date.UTC(2026, 0, 15, 12), 'Asia/Kolkata')).toBe(330);
  });

  it('local date changes at local midnight, not UTC midnight', () => {
    expect(localDateOf(Date.parse('2026-06-20T22:59:59Z'), 'Europe/Dublin')).toBe('2026-06-20');
    expect(localDateOf(Date.parse('2026-06-20T23:00:00Z'), 'Europe/Dublin')).toBe('2026-06-21');
    expect(localMinuteOfDay(Date.parse('2026-06-21T12:30:00Z'), 'Europe/Dublin')).toBe(
      13 * 60 + 30,
    );
  });

  it('knows which names are zones', () => {
    expect(isKnownTimeZone('Europe/Dublin')).toBe(true);
    expect(isKnownTimeZone('Mars/Olympus')).toBe(false);
    expect(() => utcOffsetMinutes(0, 'Mars/Olympus')).toThrow(RangeError);
  });
});

describe('local calendar days', () => {
  const zone = 'Europe/Dublin';

  it('an ordinary summer day is 24 hours and starts at 23:00 UTC the day before', () => {
    const { startMs, endMs } = localDayBounds('2026-06-21', zone);
    expect(new Date(startMs).toISOString()).toBe('2026-06-20T23:00:00.000Z');
    expect(new Date(endMs).toISOString()).toBe('2026-06-21T23:00:00.000Z');
    expect(endMs - startMs).toBe(24 * HOUR);
  });

  it('an ordinary winter day starts at midnight UTC', () => {
    const { startMs, endMs } = localDayBounds('2026-01-15', zone);
    expect(new Date(startMs).toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(endMs - startMs).toBe(24 * HOUR);
  });

  it('the day the clocks go forward (2026-03-29) is 23 hours', () => {
    const { startMs, endMs } = localDayBounds('2026-03-29', zone);
    expect(endMs - startMs).toBe(23 * HOUR);
    expect(new Date(startMs).toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(new Date(endMs).toISOString()).toBe('2026-03-29T23:00:00.000Z');
  });

  it('the day the clocks go back (2026-10-25) is 25 hours', () => {
    const { startMs, endMs } = localDayBounds('2026-10-25', zone);
    expect(endMs - startMs).toBe(25 * HOUR);
    expect(new Date(startMs).toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(new Date(endMs).toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });

  it('consecutive days tile with no gap or overlap across both DST changes', () => {
    for (const first of ['2026-03-28', '2026-10-24']) {
      let date = first;
      let previousEnd = localDayBounds(date, zone).startMs;
      for (let i = 0; i < 4; i += 1) {
        const { startMs, endMs } = localDayBounds(date, zone);
        expect(startMs).toBe(previousEnd);
        previousEnd = endMs;
        date = addLocalDays(date, 1);
      }
    }
  });

  it('half-open: the last instant of a day belongs to that day, the end instant to the next', () => {
    const { startMs, endMs } = localDayBounds('2026-10-25', zone);
    expect(localDateOf(startMs, zone)).toBe('2026-10-25');
    expect(localDateOf(endMs - 1, zone)).toBe('2026-10-25');
    expect(localDateOf(endMs, zone)).toBe('2026-10-26');
  });

  it('works for a zone with a half-hour offset and no DST', () => {
    const { startMs, endMs } = localDayBounds('2026-06-21', 'Asia/Kolkata');
    expect(new Date(startMs).toISOString()).toBe('2026-06-20T18:30:00.000Z');
    expect(endMs - startMs).toBe(24 * HOUR);
  });

  it('rejects a malformed date', () => {
    expect(() => localDayBounds('21/06/2026', zone)).toThrow(RangeError);
    expect(() => addLocalDays('2026-6-21', 1)).toThrow(RangeError);
    expect(() => dayOfWeek('nope')).toThrow(RangeError);
  });

  it('adds days across month and year ends and leap days', () => {
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addLocalDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('knows the day of the week (2026-06-21 is a Sunday)', () => {
    expect(dayOfWeek('2026-06-21')).toBe(0);
    expect(dayOfWeek('2026-06-22')).toBe(1);
  });
});
