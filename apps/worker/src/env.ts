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
}
