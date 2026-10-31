import type { Env } from '../env';
import { InMemoryRepository, type Repository } from './repository';
import { SupabaseRepository } from './supabase-repository';
import { InMemoryTokenStore, type TokenStore } from '../services/tokens/store';
import { PostgresTokenStore } from '../services/tokens/postgres-store';
import { InMemoryOAuthStateStore, type OAuthStateStore } from '../providers/tesla/oauth';
import { PostgresOAuthStateStore } from '../providers/tesla/postgres-oauth-store';

const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/**
 * Returns durable Supabase repository if credentials are provided in env,
 * otherwise falls back to InMemoryRepository for isolated local/test environments.
 */
export function createRepository(env: Env): Repository {
  const isStrict = env.ENVIRONMENT === 'production' || env.ENVIRONMENT === 'staging';

  if (env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
    return new SupabaseRepository(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  }

  if (isStrict) {
    throw new Error(
      `Cannot initialize Repository: missing Supabase credentials in ${env.ENVIRONMENT}`,
    );
  }

  return new InMemoryRepository();
}

/**
 * Returns durable PostgresTokenStore if Supabase and encryption key are configured,
 * otherwise falls back to InMemoryTokenStore for isolated local/test environments.
 */
export function createTokenStore(env: Env): TokenStore {
  const isStrict = env.ENVIRONMENT === 'production' || env.ENVIRONMENT === 'staging';

  if (env.SUPABASE_URL && env.SUPABASE_SECRET_KEY && env.TOKEN_ENCRYPTION_KEY) {
    return new PostgresTokenStore(
      env.SUPABASE_URL,
      env.SUPABASE_SECRET_KEY,
      env.TOKEN_ENCRYPTION_KEY,
    );
  }

  if (isStrict) {
    throw new Error(
      `Cannot initialize TokenStore: missing Supabase credentials or TOKEN_ENCRYPTION_KEY in ${env.ENVIRONMENT}`,
    );
  }

  const key = env.TOKEN_ENCRYPTION_KEY ?? TEST_ENCRYPTION_KEY;
  return new InMemoryTokenStore(key);
}

/**
 * Returns durable PostgresOAuthStateStore if Supabase and encryption key are configured,
 * otherwise falls back to InMemoryOAuthStateStore for isolated local/test environments.
 */
export function createOAuthStateStore(env: Env): OAuthStateStore {
  const isStrict = env.ENVIRONMENT === 'production' || env.ENVIRONMENT === 'staging';

  if (env.SUPABASE_URL && env.SUPABASE_SECRET_KEY && env.TOKEN_ENCRYPTION_KEY) {
    return new PostgresOAuthStateStore(
      env.SUPABASE_URL,
      env.SUPABASE_SECRET_KEY,
      env.TOKEN_ENCRYPTION_KEY,
    );
  }

  if (isStrict) {
    throw new Error(
      `Cannot initialize OAuthStateStore: missing Supabase credentials or TOKEN_ENCRYPTION_KEY in ${env.ENVIRONMENT}`,
    );
  }

  return new InMemoryOAuthStateStore();
}
