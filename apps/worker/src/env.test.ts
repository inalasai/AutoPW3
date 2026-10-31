import { describe, expect, it } from 'vitest';
import { assertValidEnvironment, ConfigurationError, type Env } from './env';
import { parseCorsConfig } from './lib/cors';

function makeTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    ASSETS: {
      fetch: (): Promise<Response> => Promise.resolve(new Response('OK')),
      connect: () => {
        throw new Error('unused');
      },
    } as unknown as Fetcher,
    ...overrides,
  };
}

describe('Worker Environment & Security Configuration', () => {
  it('allows development environment without strict production secrets', () => {
    const devEnv = makeTestEnv({
      ENVIRONMENT: 'development',
      SUPABASE_URL: 'https://local.supabase.co',
      ALLOWED_ORIGINS: 'http://localhost:5173',
    });
    expect(() => assertValidEnvironment(devEnv)).not.toThrow();
  });

  it('allows test environment without strict production secrets', () => {
    const testEnv = makeTestEnv({
      ENVIRONMENT: 'test',
    });
    expect(() => assertValidEnvironment(testEnv)).not.toThrow();
  });

  it('fails closed in production if TOKEN_ENCRYPTION_KEY is missing', () => {
    const prodEnv = makeTestEnv({
      ENVIRONMENT: 'production',
      SUPABASE_URL: 'https://xyz.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_key',
      ALLOWED_ORIGINS: 'https://app.autopw3.com',
    });
    expect(() => assertValidEnvironment(prodEnv)).toThrow(ConfigurationError);
    expect(() => assertValidEnvironment(prodEnv)).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it('fails closed in staging if SUPABASE_SECRET_KEY is missing', () => {
    const stagingEnv = makeTestEnv({
      ENVIRONMENT: 'staging',
      SUPABASE_URL: 'https://xyz.supabase.co',
      TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ALLOWED_ORIGINS: 'https://staging.autopw3.com',
    });
    expect(() => assertValidEnvironment(stagingEnv)).toThrow(ConfigurationError);
    expect(() => assertValidEnvironment(stagingEnv)).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it('fails closed in production if ALLOWED_ORIGINS is missing', () => {
    const prodEnv = makeTestEnv({
      ENVIRONMENT: 'production',
      SUPABASE_URL: 'https://xyz.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_key',
      TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });
    expect(() => assertValidEnvironment(prodEnv)).toThrow(ConfigurationError);
    expect(() => assertValidEnvironment(prodEnv)).toThrow(/ALLOWED_ORIGINS/);
  });

  it('fails closed in production if PROVIDER_MODE is mock (per D-017)', () => {
    const prodEnv = makeTestEnv({
      ENVIRONMENT: 'production',
      SUPABASE_URL: 'https://xyz.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_key',
      TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ALLOWED_ORIGINS: 'https://app.autopw3.com',
      PROVIDER_MODE: 'mock',
    });
    expect(() => assertValidEnvironment(prodEnv)).toThrow(ConfigurationError);
    expect(() => assertValidEnvironment(prodEnv)).toThrow(
      /PROVIDER_MODE cannot be "mock" in production/,
    );
  });

  it('passes in production when all required secrets and origins are provided', () => {
    const prodEnv = makeTestEnv({
      ENVIRONMENT: 'production',
      SUPABASE_URL: 'https://xyz.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_key',
      TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ALLOWED_ORIGINS: 'https://app.autopw3.com',
      PROVIDER_MODE: 'tesla_fleet',
    });
    expect(() => assertValidEnvironment(prodEnv)).not.toThrow();
  });

  describe('CORS configuration fail-closed behavior', () => {
    it('returns empty allowedOrigins in production if ALLOWED_ORIGINS is missing or blank', () => {
      const prodCors1 = parseCorsConfig(undefined, 'production');
      expect(prodCors1.allowedOrigins).toEqual([]);

      const prodCors2 = parseCorsConfig('   ', 'production');
      expect(prodCors2.allowedOrigins).toEqual([]);
    });

    it('returns empty allowedOrigins in staging if ALLOWED_ORIGINS is missing or blank', () => {
      const stagingCors = parseCorsConfig('', 'staging');
      expect(stagingCors.allowedOrigins).toEqual([]);
    });

    it('defaults to localhost in development and test when not configured', () => {
      const devCors = parseCorsConfig(undefined, 'development');
      expect(devCors.allowedOrigins).toEqual(['http://localhost:5173']);

      const testCors = parseCorsConfig(undefined, 'test');
      expect(testCors.allowedOrigins).toEqual(['http://localhost:5173']);
    });

    it('parses multiple valid origins cleanly', () => {
      const cors = parseCorsConfig(
        'https://app.autopw3.com, https://admin.autopw3.com',
        'production',
      );
      expect(cors.allowedOrigins).toEqual(['https://app.autopw3.com', 'https://admin.autopw3.com']);
    });
  });
});
