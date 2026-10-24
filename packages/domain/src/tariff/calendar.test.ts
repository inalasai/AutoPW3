import { describe, expect, it } from 'vitest';
import {
  allMonthDayKeys,
  dayTypeOf,
  inSeason,
  instantsOfLocalMinute,
  localDatesBetween,
  localDay,
  localDateAndMinute,
  minuteText,
  monthDayKey,
} from './calendar';
import { ms } from './test-helpers';

const DUBLIN = 'Europe/Dublin';
const NEW_YORK = 'America/New_York';

describe('dayTypeOf', () => {
  it('uses the local calendar date: Saturday and Sunday are the weekend', () => {
    expect(dayTypeOf('2026-10-23')).toBe('WEEKDAY'); // Friday
    expect(dayTypeOf('2026-10-24')).toBe('WEEKEND'); // Saturday
    expect(dayTypeOf('2026-10-25')).toBe('WEEKEND'); // Sunday
    expect(dayTypeOf('2026-10-26')).toBe('WEEKDAY'); // Monday
  });
});

describe('seasons', () => {
  const winter = { startMonth: 10, startDay: 1, endMonth: 3, endDay: 31 };
  const summer = { startMonth: 4, startDay: 1, endMonth: 9, endDay: 30 };

  it('treats the month/day range as inclusive at both ends', () => {
    expect(inSeason(summer, '2026-03-31')).toBe(false);
    expect(inSeason(summer, '2026-04-01')).toBe(true);
    expect(inSeason(summer, '2026-09-30')).toBe(true);
    expect(inSeason(summer, '2026-10-01')).toBe(false);
  });

  it('wraps the year end', () => {
    expect(inSeason(winter, '2026-09-30')).toBe(false);
    expect(inSeason(winter, '2026-10-01')).toBe(true);
    expect(inSeason(winter, '2026-12-31')).toBe(true);
    expect(inSeason(winter, '2027-01-01')).toBe(true);
    expect(inSeason(winter, '2027-03-31')).toBe(true);
    expect(inSeason(winter, '2027-04-01')).toBe(false);
  });

  it('handles 29 February the same way every year', () => {
    const feb = { startMonth: 2, startDay: 29, endMonth: 3, endDay: 1 };
    expect(inSeason(feb, '2028-02-29')).toBe(true);
    expect(inSeason(feb, '2028-02-28')).toBe(false);
    expect(inSeason(feb, '2027-03-01')).toBe(true);
  });

  it('keys are month * 100 + day, and the leap-year list has 366 distinct days', () => {
    expect(monthDayKey('2026-03-01')).toBe(301);
    const keys = allMonthDayKeys();
    expect(keys).toHaveLength(366);
    expect(new Set(keys).size).toBe(366);
  });
});

describe('localDatesBetween and minuteText', () => {
  it('lists the local dates of a half-open range', () => {
    expect(localDatesBetween('2026-10-24', '2026-10-27')).toEqual([
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ]);
    expect(localDatesBetween('2026-10-24', '2026-10-24')).toEqual([]);
  });

  it('formats minutes of the day', () => {
    expect(minuteText(0)).toBe('00:00');
    expect(minuteText(510)).toBe('08:30');
    expect(minuteText(1440)).toBe('24:00');
  });
});

describe('localDateAndMinute', () => {
  it('reads the wall clock of the zone, including summer time', () => {
    expect(localDateAndMinute(ms('2026-07-15T22:30:00Z'), DUBLIN)).toEqual({
      localDate: '2026-07-15',
      localMinute: 23 * 60 + 30,
    });
    expect(localDateAndMinute(ms('2026-07-15T23:30:00Z'), DUBLIN)).toEqual({
      localDate: '2026-07-16',
      localMinute: 30,
    });
    expect(localDateAndMinute(ms('2026-01-15T23:30:00Z'), DUBLIN)).toEqual({
      localDate: '2026-01-15',
      localMinute: 23 * 60 + 30,
    });
  });
});

describe('localDay: lengths and clock changes (hand-derived UTC instants)', () => {
  it('Europe/Dublin spring forward 2026-03-29 is 23 hours; clocks change at 01:00Z', () => {
    const d = localDay('2026-03-29', DUBLIN);
    expect(d.startMs).toBe(ms('2026-03-29T00:00:00Z'));
    expect(d.endMs).toBe(ms('2026-03-29T23:00:00Z'));
    expect(d.endMs - d.startMs).toBe(23 * 3_600_000);
    expect(d.transitionMs).toBe(ms('2026-03-29T01:00:00Z'));
    expect(d.deltaMinutes).toBe(60);
  });

  it('Europe/Dublin fall back 2026-10-25 is 25 hours; clocks change at 01:00Z', () => {
    const d = localDay('2026-10-25', DUBLIN);
    expect(d.startMs).toBe(ms('2026-10-24T23:00:00Z'));
    expect(d.endMs).toBe(ms('2026-10-26T00:00:00Z'));
    expect(d.endMs - d.startMs).toBe(25 * 3_600_000);
    expect(d.transitionMs).toBe(ms('2026-10-25T01:00:00Z'));
    expect(d.deltaMinutes).toBe(-60);
  });

  it('an ordinary day is 24 hours with no clock change', () => {
    const d = localDay('2026-06-21', DUBLIN);
    expect(d.endMs - d.startMs).toBe(24 * 3_600_000);
    expect(d.transitionMs).toBeNull();
    expect(d.deltaMinutes).toBe(0);
  });

  it('works for a second zone: America/New_York 2026-03-08 and 2026-11-01', () => {
    const spring = localDay('2026-03-08', NEW_YORK);
    expect(spring.startMs).toBe(ms('2026-03-08T05:00:00Z'));
    expect(spring.endMs).toBe(ms('2026-03-09T04:00:00Z'));
    expect(spring.transitionMs).toBe(ms('2026-03-08T07:00:00Z'));
    expect(spring.deltaMinutes).toBe(60);

    const fall = localDay('2026-11-01', NEW_YORK);
    expect(fall.startMs).toBe(ms('2026-11-01T04:00:00Z'));
    expect(fall.endMs).toBe(ms('2026-11-02T05:00:00Z'));
    expect(fall.transitionMs).toBe(ms('2026-11-01T06:00:00Z'));
    expect(fall.deltaMinutes).toBe(-60);
  });

  it('returns the same value when asked twice (the cache changes nothing)', () => {
    expect(localDay('2026-03-29', DUBLIN)).toEqual(localDay('2026-03-29', DUBLIN));
  });
});

describe('instantsOfLocalMinute', () => {
  const spring = localDay('2026-03-29', DUBLIN);
  const fall = localDay('2026-10-25', DUBLIN);
  const normal = localDay('2026-06-21', DUBLIN);

  it('gives one instant on an ordinary day', () => {
    expect(instantsOfLocalMinute(normal, 0)).toEqual([ms('2026-06-20T23:00:00Z')]);
    expect(instantsOfLocalMinute(normal, 480)).toEqual([ms('2026-06-21T07:00:00Z')]);
    expect(instantsOfLocalMinute(normal, 1439)).toEqual([ms('2026-06-21T22:59:00Z')]);
  });

  it('gives none for a local time that is skipped when the clocks go forward', () => {
    expect(instantsOfLocalMinute(spring, 60)).toEqual([]); // 01:00
    expect(instantsOfLocalMinute(spring, 90)).toEqual([]); // 01:30
    expect(instantsOfLocalMinute(spring, 119)).toEqual([]); // 01:59
  });

  it('gives one instant just before and just after the skipped hour', () => {
    expect(instantsOfLocalMinute(spring, 59)).toEqual([ms('2026-03-29T00:59:00Z')]);
    expect(instantsOfLocalMinute(spring, 120)).toEqual([ms('2026-03-29T01:00:00Z')]);
    expect(instantsOfLocalMinute(spring, 480)).toEqual([ms('2026-03-29T07:00:00Z')]);
  });

  it('gives two instants for a local time in the repeated hour when the clocks go back', () => {
    expect(instantsOfLocalMinute(fall, 60)).toEqual([
      ms('2026-10-25T00:00:00Z'),
      ms('2026-10-25T01:00:00Z'),
    ]);
    expect(instantsOfLocalMinute(fall, 90)).toEqual([
      ms('2026-10-25T00:30:00Z'),
      ms('2026-10-25T01:30:00Z'),
    ]);
  });

  it('gives one instant around the repeated hour', () => {
    expect(instantsOfLocalMinute(fall, 0)).toEqual([ms('2026-10-24T23:00:00Z')]);
    expect(instantsOfLocalMinute(fall, 59)).toEqual([ms('2026-10-24T23:59:00Z')]);
    expect(instantsOfLocalMinute(fall, 120)).toEqual([ms('2026-10-25T02:00:00Z')]);
    expect(instantsOfLocalMinute(fall, 1439)).toEqual([ms('2026-10-25T23:59:00Z')]);
  });

  it('rejects minutes outside 0 to 1439 and fractions', () => {
    expect(() => instantsOfLocalMinute(normal, -1)).toThrow(RangeError);
    expect(() => instantsOfLocalMinute(normal, 1440)).toThrow(RangeError);
    expect(() => instantsOfLocalMinute(normal, 1.5)).toThrow(RangeError);
  });

  it('round-trips: every returned instant reads back as the requested local minute', () => {
    for (const day of [spring, fall, normal]) {
      for (let minute = 0; minute < 1440; minute += 1) {
        for (const instant of instantsOfLocalMinute(day, minute)) {
          expect(localDateAndMinute(instant, DUBLIN).localMinute).toBe(minute);
          expect(instant).toBeGreaterThanOrEqual(day.startMs);
          expect(instant).toBeLessThan(day.endMs);
        }
      }
    }
  });
});
