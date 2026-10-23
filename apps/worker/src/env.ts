/**
 * Worker bindings and variables. Names only; values come from `vars` in wrangler.jsonc (non-secret),
 * Cloudflare secrets in production, or `apps/worker/.dev.vars` locally. See .env.example.
 * TASK-14 and later add Supabase and Tesla variables here.
 */
export interface Env {
  /** Static web assets (the built apps/web). */
  ASSETS: Fetcher;
  /** Deployment label. Not a secret. */
  ENVIRONMENT: string;
}
