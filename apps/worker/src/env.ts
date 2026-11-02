/**
 * Worker bindings and variables. Names only; values come from `vars` in wrangler.jsonc (non-secret),
 * Cloudflare secrets in production, or `apps/worker/.dev.vars` locally. See .env.example.
 */
export interface Env {
  /** Static web assets (the built apps/web). */
  ASSETS: Fetcher;
  /** Deployment label: local | test | preview | staging | production. */
  ENVIRONMENT: string;
  /** Staging only: opt in to the durable GET /api/v1/me slice. Disabled unless exactly "true". */
  STAGING_IDENTITY_READ_ENABLED?: string | undefined;
  /** Staging only, read-only Tesla OAuth connect/callback. Disabled unless exactly "true". */
  STAGING_TESLA_OAUTH_ENABLED?: string | undefined;
  /** Staging only: manual read-only Tesla live-status snapshot; exact "true" opt-in. */
  STAGING_TESLA_LIVE_STATUS_ENABLED?: string | undefined;
  /** Staging only: ADMIN product discovery and durable site linking; exact "true" opt-in. */
  STAGING_TESLA_SITES_ENABLED?: string | undefined;
  /** Explicit opt-in for process-local mocks. Set only in local/test environments. */
  LOCAL_MOCKS?: string | undefined;
  /** Supabase project URL (e.g. https://xxx.supabase.co). */
  SUPABASE_URL?: string | undefined;
  /** Supabase client anon public key. */
  SUPABASE_ANON_KEY?: string | undefined;
  /** Supabase service-role secret key (server-only, bypasses RLS; used only for S1-S9). */
  SUPABASE_SECRET_KEY?: string | undefined;
  /** Comma-separated CORS allowed origins (e.g. http://localhost:5173,https://autopw3.com). */
  ALLOWED_ORIGINS?: string | undefined;
  /** Public application origin used to construct invitation links. */
  APP_BASE_URL?: string | undefined;
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
  /** Explicit NA/EU Fleet audience. No implicit region fallback. */
  TESLA_FLEET_API_BASE_URL?: string | undefined;
  /** Secret key for encrypting stored Tesla credentials at rest (32 bytes hex/base64). */
  TOKEN_ENCRYPTION_KEY?: string | undefined;
}
