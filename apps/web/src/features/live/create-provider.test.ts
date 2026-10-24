import { FixedClock } from '@autopw3/domain';
import { describe, expect, it } from 'vitest';
import { chooseProvider } from './create-provider';

const CLOCK = new FixedClock(new Date('2026-06-21T12:00:00Z'));

describe('chooseProvider', () => {
  it('gives the demo provider for demo configuration, and its readings say DEMO', async () => {
    const choice = chooseProvider({ kind: 'demo' }, CLOCK);
    expect(choice.kind).toBe('provider');
    if (choice.kind !== 'provider') return;
    expect(choice.provider.source).toBe('DEMO');
    const reading = await choice.provider.getLiveSnapshot({ siteId: 'demo-site' });
    expect(reading.source).toBe('DEMO');
    expect(reading.sample.source).toBe('DEMO');
  });

  it('serves the chosen demo scenario', async () => {
    const choice = chooseProvider({ kind: 'demo' }, CLOCK, 'LOW_BATTERY');
    expect(choice.kind).toBe('provider');
    if (choice.kind !== 'provider') return;
    const reading = await choice.provider.getLiveSnapshot({ siteId: 'demo-site' });
    expect(reading.sample.batterySocPercent).toBeLessThan(15);
  });

  it('has no provider yet for live configuration, and never substitutes demo data', () => {
    expect(chooseProvider({ kind: 'live' }, CLOCK)).toEqual({ kind: 'no-live-provider' });
    // A scenario is a demo feature; it does not turn live configuration into demo data.
    expect(chooseProvider({ kind: 'live' }, CLOCK, 'SOLAR_SURPLUS')).toEqual({
      kind: 'no-live-provider',
    });
  });

  it('passes an invalid setting through with its reason', () => {
    expect(chooseProvider({ kind: 'invalid', reason: 'nope' }, CLOCK)).toEqual({
      kind: 'invalid',
      reason: 'nope',
    });
  });
});
