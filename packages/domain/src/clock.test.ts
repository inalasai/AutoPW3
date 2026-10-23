import { describe, expect, it } from 'vitest';
import { FixedClock } from './clock';

describe('FixedClock', () => {
  it('returns the configured instant and does not move by itself', () => {
    const clock = new FixedClock(new Date('2026-03-29T00:59:59.000Z'));
    expect(clock.now().toISOString()).toBe('2026-03-29T00:59:59.000Z');
    expect(clock.now().toISOString()).toBe('2026-03-29T00:59:59.000Z');
  });

  it('advances only when told to', () => {
    const clock = new FixedClock(new Date('2026-03-29T00:59:59.000Z'));
    clock.advanceMs(1000);
    expect(clock.now().toISOString()).toBe('2026-03-29T01:00:00.000Z');
  });

  it('does not let callers mutate the stored instant', () => {
    const clock = new FixedClock(new Date('2026-03-29T00:00:00.000Z'));
    clock.now().setUTCFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });
});
