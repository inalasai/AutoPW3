import { CompactSign, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createTestJwt, getTestAuthKeys } from '../test/jwt-helpers';
import { verifySupabaseJwt } from './jwt';

describe('required JWT expiration', () => {
  it('rejects a correctly signed authenticated JWT without exp', async () => {
    const keys = await getTestAuthKeys();
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('11111111-1111-4111-8111-111111111111')
      .setIssuer('https://project.supabase.co/auth/v1')
      .sign(keys.privateKey);
    await expect(
      verifySupabaseJwt(token, {
        supabaseUrl: 'https://project.supabase.co',
        testKeySet: keys.publicKey,
      }),
    ).rejects.toMatchObject({ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'exp' });
  });

  it('preserves valid existing tokens and rejects expired ones', async () => {
    const keys = await getTestAuthKeys();
    const config = { supabaseUrl: 'https://project.supabase.co', testKeySet: keys.publicKey };
    await expect(verifySupabaseJwt(await createTestJwt({}, keys), config)).resolves.toHaveProperty(
      'userId',
    );
    await expect(
      verifySupabaseJwt(await createTestJwt({ exp: 1 }, keys), config),
    ).rejects.toMatchObject({ code: 'ERR_JWT_EXPIRED' });
  });
});

describe('optional audience constraint', () => {
  async function tokenWithAudience(audience: unknown) {
    const keys = await getTestAuthKeys();
    const payload = {
      role: 'authenticated',
      sub: '11111111-1111-4111-8111-111111111111',
      iss: 'https://project.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
      aud: audience,
    };
    const token = await new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
      .setProtectedHeader({ alg: 'RS256' })
      .sign(keys.privateKey);
    return {
      token,
      config: { supabaseUrl: 'https://project.supabase.co', testKeySet: keys.publicKey },
    };
  }

  it.each(
    [
      undefined,
      null,
      '',
      123,
      [],
      [''],
      'another-service',
      ['another-service'],
      ['authenticated', 123],
      ['authenticated', null],
      ['authenticated', {}],
      ['authenticated', ['authenticated']],
      ['authenticated', ''],
    ].map((audience) => ({ audience })),
  )(
    'rejects missing, wrong or malformed audience $audience when required',
    async ({ audience }) => {
      const { token, config } = await tokenWithAudience(audience);
      await expect(
        verifySupabaseJwt(token, { ...config, audience: 'authenticated' }),
      ).rejects.toThrow();
    },
  );

  it.each(
    ['authenticated', ['authenticated'], ['another-service', 'authenticated']].map((audience) => ({
      audience,
    })),
  )('accepts a matching, correctly typed audience $audience', async ({ audience }) => {
    const { token, config } = await tokenWithAudience(audience);
    await expect(
      verifySupabaseJwt(token, { ...config, audience: 'authenticated' }),
    ).resolves.toHaveProperty('userId');
  });

  it('preserves shared behavior when the caller does not require an audience', async () => {
    const { token, config } = await tokenWithAudience(undefined);
    await expect(verifySupabaseJwt(token, config)).resolves.toHaveProperty('userId');
  });
});
