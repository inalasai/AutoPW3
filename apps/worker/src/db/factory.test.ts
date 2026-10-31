import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import { createOAuthStateStore, createRepository, createTokenStore } from './factory';
import { InMemoryRepository } from './repository';
import { SupabaseRepository } from './supabase-repository';
import { InMemoryTokenStore } from '../services/tokens/store';
import { PostgresTokenStore } from '../services/tokens/postgres-store';
import { InMemoryOAuthStateStore } from '../providers/tesla/oauth';
import { PostgresOAuthStateStore } from '../providers/tesla/postgres-oauth-store';

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

describe('Store and Repository Factory', () => {
  const validHexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('creates in-memory stores when Supabase credentials are absent in dev/test', () => {
    const devEnv = makeTestEnv({
      ENVIRONMENT: 'test',
    });

    const repo = createRepository(devEnv);
    expect(repo).toBeInstanceOf(InMemoryRepository);

    const tokenStore = createTokenStore(devEnv);
    expect(tokenStore).toBeInstanceOf(InMemoryTokenStore);

    const oauthStore = createOAuthStateStore(devEnv);
    expect(oauthStore).toBeInstanceOf(InMemoryOAuthStateStore);
  });

  it('creates durable Postgres-backed stores when Supabase credentials and encryption key are present', () => {
    const configuredEnv = makeTestEnv({
      ENVIRONMENT: 'staging',
      SUPABASE_URL: 'https://staging.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_staging_secret_key',
      TOKEN_ENCRYPTION_KEY: validHexKey,
      ALLOWED_ORIGINS: 'https://staging.autopw3.com',
    });

    const repo = createRepository(configuredEnv);
    expect(repo).toBeInstanceOf(SupabaseRepository);

    const tokenStore = createTokenStore(configuredEnv);
    expect(tokenStore).toBeInstanceOf(PostgresTokenStore);

    const oauthStore = createOAuthStateStore(configuredEnv);
    expect(oauthStore).toBeInstanceOf(PostgresOAuthStateStore);
  });

  it('throws in production if durable credentials are incomplete', () => {
    const incompleteProdEnv = makeTestEnv({
      ENVIRONMENT: 'production',
      SUPABASE_URL: 'https://prod.supabase.co',
      ALLOWED_ORIGINS: 'https://app.autopw3.com',
    });

    expect(() => createTokenStore(incompleteProdEnv)).toThrow(
      /Cannot initialize TokenStore: missing Supabase credentials/,
    );
    expect(() => createOAuthStateStore(incompleteProdEnv)).toThrow(
      /Cannot initialize OAuthStateStore: missing Supabase credentials/,
    );
  });
});
