/**
 * Worker bindings and variables. Names only; values come from `vars` in wrangler.jsonc (non-secret),
 * Cloudflare secrets in production, or `apps/worker/.dev.vars` locally. See .env.example.
 */
export interface Env {
  /** Static web assets (the built apps/web). */
  ASSETS: Fetcher;
  /** Deployment label: local | test | preview | production. */
  ENVIRONMENT: string;
  /** Supabase project URL (e.g. https://xxx.supabase.co). */
  SUPABASE_URL?: string | undefined;
  /** Supabase client anon public key. */
  SUPABASE_ANON_KEY?: string | undefined;
  /** Supabase service-role secret key (server-only, bypasses RLS; used only for S1-S9). */
  SUPABASE_SECRET_KEY?: string | undefined;
  /** Comma-separated CORS allowed origins (e.g. http://localhost:5173,https://autopw3.com). */
  ALLOWED_ORIGINS?: string | undefined;
  /** Telemetry provider mode: demo | mock | live. Refused in production if "mock" (D-017). */
  PROVIDER_MODE?: string | undefined;
  /** Optional custom JWT issuer override. Defaults to ${SUPABASE_URL}/auth/v1 */
  JWT_ISSUER?: string | undefined;
  /** Optional custom JWKS URL override for tests. Defaults to ${SUPABASE_URL}/auth/v1/.well-known/jwks.json */
  JWT_JWKS_URL?: string | undefined;
  /** Tesla Fleet API OAuth Client ID. */
  TESLA_CLIENT_ID?: string | undefined;
  /** Tesla Fleet API OAuth Client Secret. */
  TESLA_CLIENT_SECRET?: string | undefined;
  /** Tesla Fleet API OAuth Redirect URI. */
  TESLA_REDIRECT_URI?: string | undefined;
  /** Secret key for encrypting stored Tesla credentials at rest (32 bytes hex/base64). */
  TOKEN_ENCRYPTION_KEY?: string | undefined;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Validates required environment configuration and prevents unsafe production defaults.
 * Fails closed if production or staging is missing required keys or if mock provider is active in production (D-017).
 */
export function assertValidEnvironment(env: Env): void {
  const isProd = env.ENVIRONMENT === 'production';
  const isStaging = env.ENVIRONMENT === 'staging';

  if (isProd || isStaging) {
    if (!env.TOKEN_ENCRYPTION_KEY || env.TOKEN_ENCRYPTION_KEY.trim().length < 32) {
      throw new ConfigurationError(
        `TOKEN_ENCRYPTION_KEY is required and must be at least 32 characters in ${env.ENVIRONMENT}`,
      );
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_URL.startsWith('https://')) {
      throw new ConfigurationError(`SUPABASE_URL must be a valid HTTPS URL in ${env.ENVIRONMENT}`);
    }

    if (!env.SUPABASE_SECRET_KEY || env.SUPABASE_SECRET_KEY.trim().length === 0) {
      throw new ConfigurationError(`SUPABASE_SECRET_KEY is required in ${env.ENVIRONMENT}`);
    }

    if (!env.ALLOWED_ORIGINS || env.ALLOWED_ORIGINS.trim().length === 0) {
      throw new ConfigurationError(`ALLOWED_ORIGINS must be configured in ${env.ENVIRONMENT}`);
    }
  }

  if (isProd) {
    if (env.PROVIDER_MODE === 'mock') {
      throw new ConfigurationError('PROVIDER_MODE cannot be "mock" in production (D-017)');
    }
  }
}
