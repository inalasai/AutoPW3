import { describe, expect, it } from 'vitest';
import {
  IanaTimezoneSchema,
  IdempotencyKeySchema,
  InstantRangeSchema,
  InstantUtcSchema,
  LocalDateSchema,
  PaginationQuerySchema,
  PercentSchema,
  TimeWindowSchema,
  UuidSchema,
  boundedText,
  isIanaTimezone,
  pageOf,
  rangeWithinDays,
} from './primitives';

describe('IanaTimezoneSchema', () => {
  it.each([
    'Europe/Dublin',
    'America/Argentina/Buenos_Aires',
    'Etc/GMT+5',
    'UTC',
    'Australia/Lord_Howe',
  ])('accepts %s', (tz) => {
    expect(IanaTimezoneSchema.safeParse(tz).success).toBe(true);
  });

  it.each([
    'Europe/Dubln', // misspelt
    'europe/dublin', // wrong capitalisation
    '+01:00', // fixed UTC offset: forbidden for recurring schedules
    'UTC+1',
    'GMT+01:00',
    '',
    ' Europe/Dublin',
    'Europe/Dublin/',
    'Not a zone',
  ])('rejects the malformed timezone %j', (tz) => {
    expect(IanaTimezoneSchema.safeParse(tz).success).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(IanaTimezoneSchema.safeParse(60).success).toBe(false);
    expect(isIanaTimezone('Europe/Dublin')).toBe(true);
  });
});

describe('InstantUtcSchema and LocalDateSchema', () => {
  it('accepts UTC instants with a trailing Z', () => {
    expect(InstantUtcSchema.safeParse('2026-10-22T10:00:00Z').success).toBe(true);
    expect(InstantUtcSchema.safeParse('2026-10-25T01:30:00.250Z').success).toBe(true);
  });

  it('rejects offsets, missing zone, impossible dates and non-ISO text', () => {
    for (const v of [
      '2026-10-22T10:00:00+01:00',
      '2026-10-22T10:00:00',
      '2026-02-30T10:00:00Z',
      '22/10/2026',
      '',
      1_700_000_000,
    ]) {
      expect(InstantUtcSchema.safeParse(v).success).toBe(false);
    }
  });

  it('accepts a calendar date and rejects an impossible one', () => {
    expect(LocalDateSchema.safeParse('2026-10-25').success).toBe(true);
    expect(LocalDateSchema.safeParse('2026-13-01').success).toBe(false);
    expect(LocalDateSchema.safeParse('2026-10-25T00:00:00Z').success).toBe(false);
  });
});

describe('PercentSchema', () => {
  it('accepts 0 to 100 inclusive', () => {
    for (const v of [0, 0.5, 55, 100]) expect(PercentSchema.safeParse(v).success).toBe(true);
  });

  it('rejects SOC 120, negatives, NaN and text', () => {
    for (const v of [120, 100.01, -0.1, Number.NaN, Number.POSITIVE_INFINITY, '50']) {
      expect(PercentSchema.safeParse(v).success).toBe(false);
    }
  });
});

describe('TimeWindowSchema', () => {
  it('accepts a positive-length window', () => {
    expect(TimeWindowSchema.safeParse({ startMinute: 0, endMinute: 480 }).success).toBe(true);
    expect(TimeWindowSchema.safeParse({ startMinute: 1380, endMinute: 1440 }).success).toBe(true);
  });

  it('rejects a negative, zero or out-of-range length', () => {
    expect(TimeWindowSchema.safeParse({ startMinute: 600, endMinute: 480 }).success).toBe(false);
    expect(TimeWindowSchema.safeParse({ startMinute: 480, endMinute: 480 }).success).toBe(false);
    expect(TimeWindowSchema.safeParse({ startMinute: 0, endMinute: 1441 }).success).toBe(false);
    expect(TimeWindowSchema.safeParse({ startMinute: -1, endMinute: 10 }).success).toBe(false);
    expect(TimeWindowSchema.safeParse({ startMinute: 1.5, endMinute: 10 }).success).toBe(false);
  });
});

describe('IdempotencyKeySchema', () => {
  it('accepts 8 to 128 characters of [A-Za-z0-9_-]', () => {
    expect(IdempotencyKeySchema.safeParse('abcd1234').success).toBe(true);
    expect(IdempotencyKeySchema.safeParse('a'.repeat(128)).success).toBe(true);
    expect(IdempotencyKeySchema.safeParse('4f1c-2b_ZZ90').success).toBe(true);
  });

  it('rejects short, long and unsafe keys', () => {
    for (const v of ['short', 'a'.repeat(129), 'has space 1234', 'semi;colon1234', '']) {
      expect(IdempotencyKeySchema.safeParse(v).success).toBe(false);
    }
  });
});

describe('PaginationQuerySchema and pageOf', () => {
  it('defaults the limit to 50 and coerces query strings', () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(PaginationQuerySchema.parse({ limit: '200', cursor: 'abc' })).toEqual({
      limit: 200,
      cursor: 'abc',
    });
  });

  it('caps the limit at 200 and rejects zero, fractions and unknown keys', () => {
    for (const q of [{ limit: '201' }, { limit: '0' }, { limit: '1.5' }, { page: '2' }]) {
      expect(PaginationQuerySchema.safeParse(q).success).toBe(false);
    }
  });

  it('wraps items with a nullable nextCursor', () => {
    const page = pageOf(UuidSchema);
    expect(page.safeParse({ items: [], nextCursor: null }).success).toBe(true);
    expect(page.safeParse({ items: ['nope'], nextCursor: null }).success).toBe(false);
    expect(page.safeParse({ items: [] }).success).toBe(false);
  });
});

describe('ranges and text', () => {
  it('requires the end of a range to be after its start', () => {
    expect(
      InstantRangeSchema.safeParse({ from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' })
        .success,
    ).toBe(true);
    expect(
      InstantRangeSchema.safeParse({ from: '2026-10-02T00:00:00Z', to: '2026-10-02T00:00:00Z' })
        .success,
    ).toBe(false);
    expect(
      InstantRangeSchema.safeParse({ from: '2026-10-03T00:00:00Z', to: '2026-10-02T00:00:00Z' })
        .success,
    ).toBe(false);
  });

  it('measures a range in days', () => {
    expect(rangeWithinDays('2026-10-01T00:00:00Z', '2026-10-08T00:00:00Z', 7)).toBe(true);
    expect(rangeWithinDays('2026-10-01T00:00:00Z', '2026-10-08T00:00:01Z', 7)).toBe(false);
  });

  it('trims text and rejects blank or too-long values', () => {
    const name = boundedText(10);
    expect(name.parse('  Home  ')).toBe('Home');
    expect(name.safeParse('   ').success).toBe(false);
    expect(name.safeParse('x'.repeat(11)).success).toBe(false);
  });
});
