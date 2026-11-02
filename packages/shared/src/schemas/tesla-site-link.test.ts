import { describe, expect, it } from 'vitest';
import { TeslaSiteLinkRequestSchema, TeslaSiteLinkResponseSchema } from './sites';

describe('staging Tesla site onboarding contract', () => {
  it('preserves decimal string IDs and accepts only provider selection', () => {
    const body = { provider: 'TESLA', providerSiteId: '9007199254740993' };
    expect(TeslaSiteLinkRequestSchema.parse(body)).toEqual(body);
    expect(TeslaSiteLinkRequestSchema.parse({ providerSiteId: '123' })).toEqual({
      providerSiteId: '123',
    });
  });
  it.each([
    { providerSiteId: 123 },
    { providerSiteId: '01' },
    { providerSiteId: '0' },
    { providerSiteId: '../123' },
    { providerSiteId: '123', householdId: crypto.randomUUID() },
    { providerSiteId: '123', name: 'caller-selected' },
    { providerSiteId: '123', enableControls: true },
    { providerSiteId: '123', timezone: 'UTC' },
  ])('rejects ambiguous identifiers and extra mutation authority %j', (body) => {
    expect(TeslaSiteLinkRequestSchema.safeParse(body).success).toBe(false);
  });
  it('returns persisted metadata without invented capabilities', () => {
    const value = {
      created: true,
      site: {
        id: crypto.randomUUID(),
        householdId: crypto.randomUUID(),
        provider: 'TESLA',
        providerSiteId: '123',
        name: null,
        timezone: 'Europe/Dublin',
        connectionState: 'CONNECTING',
      },
    };
    expect(TeslaSiteLinkResponseSchema.parse(value)).toEqual(value);
    expect(
      TeslaSiteLinkResponseSchema.safeParse({
        ...value,
        site: { ...value.site, capabilitiesSummary: {} },
      }).success,
    ).toBe(false);
    expect(
      TeslaSiteLinkResponseSchema.safeParse({
        ...value,
        site: { ...value.site, name: '<script>fixture</script>' },
      }).success,
    ).toBe(false);
  });
});
