# Development Setup

Status: **created in TASK-02.** Commands below were run on Windows 11 with Node 24 and npm 11; CI uses Node 22 on Ubuntu (not yet executed, see `docs/handoffs/TASK-02.md`).

## Requirements
- Node.js 22 or newer (`engines` in `package.json`) and npm 10 or newer.
- No Tesla account, no Supabase project and no secrets are needed to run the skeleton.

## First run
```bash
npm install            # or: npm ci (clean install from the lockfile)
npm run typecheck
npm run lint
npm test
npm run build
```
`npm run check` runs all of the above plus the secrets scan.

## Run it locally (no credentials)
Two terminals:
```bash
npm run dev            # Vite on http://localhost:5173, demo mode, proxies /api to the Worker
npm run build && npm run dev:worker   # Worker on http://localhost:8787, serves apps/web/dist and /api/v1/health
```
- `npm run dev` alone shows the demo shell. `/api/*` calls need the Worker running.
- The Worker serves the **built** web app, so run `npm run build` (at least `npm run build -w @autopw3/web`) before `npm run dev:worker`. The `assets.directory` it points at (`apps/web/dist`) only exists after a web build.
- Check the Worker: `curl http://localhost:8787/api/v1/health` returns `{"status":"ok"}`.
- Cron triggers do not fire locally; to run the `scheduled` handler once: `curl "http://localhost:8787/cdn-cgi/local/scheduled"`.
- To stop Wrangler sending anonymous telemetry: set `WRANGLER_SEND_METRICS=false`.

## Scripts (root `package.json`)
| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server for `apps/web` |
| `npm run dev:worker` | `wrangler dev` for `apps/worker` |
| `npm run typecheck` | `tsc` in every workspace (strict) |
| `npm run lint` | ESLint, then `scripts/check-lint-rules.mjs` (proves the architecture rules fire), then Prettier check |
| `npm run format` | Prettier write |
| `npm test` | Vitest in every workspace |
| `npm run build` | Vite build for web (`apps/web/dist`), `wrangler deploy --dry-run` bundle for the Worker (`apps/worker/dist`) |
| `npm run db:verify` | Applies `supabase/migrations` to a throwaway PostgreSQL 17 and runs constraint checks (TASK-03; takes a few minutes; not part of `npm run check`) |
| `npm run db:test` | Runs the SQL security tests in `supabase/tests/database` (RLS, roles, bootstrap, invitations, audit) on a throwaway PostgreSQL 17 after applying the migrations, and checks the policies against `docs/RLS_POLICY_MATRIX.md` (TASK-04; takes a few minutes; not part of `npm run check`) |
| `npm run db:dictionary` | `db:verify` plus regenerates `docs/DATABASE_DICTIONARY.md` |
| `npm run db:reset` | `supabase db reset` on a local Supabase stack. Needs Docker; `NOT_EXECUTED` so far |
| `npm run secrets:scan` | Secretlint over the repository |
| `npm run check` | All of the above in order |

Not yet available: `npm run test:e2e` (TASK-07), `npm run db:types` (TASK-05). Database setup details: `docs/DATABASE_SETUP.md`.

## Workspaces and import rules
Packages: `@autopw3/shared`, `@autopw3/domain`, `@autopw3/web`, `@autopw3/worker`. `shared` and `domain` are consumed as TypeScript source (no build step), so a change is visible to the apps immediately.

ESLint enforces `docs/ai-build-kit/04-REPO-STRUCTURE.md` section 2:
- `shared` imports neither `domain` nor apps; `domain` imports only `shared`; `web` never imports `worker` or any `providers/tesla` code; `worker` never imports `web`.
- `packages/domain` may not call `Date.now()`, `new Date()` with no argument, `Math.random()` or `performance.now()`, and may not use `fetch`, `XMLHttpRequest` or `WebSocket`. Inject a `Clock` (`packages/domain/src/clock.ts`).
- Everywhere: no `parseFloat` or `.toFixed()`. This is a **heuristic** guard for the rule that money is never a float (D-014); it cannot catch every float calculation, so reviews and the money tests in TASK-10/11 remain necessary.
- The browser app may not reference `SUPABASE_SECRET_KEY` or service-role names.

`scripts/check-lint-rules.mjs` lints in-memory snippets that must trigger each rule, so the rules cannot silently stop working.

## Configuration
`.env.example` lists every variable name with placeholders only. Copy it as described in `docs/CREDENTIALS.md`:
- Web: `.env.local` (git-ignored). `VITE_` variables are public.
- Worker: `apps/worker/.dev.vars` (git-ignored); production values are Cloudflare secrets.
- Non-secret Worker variables (for example `ENVIRONMENT`) live under `vars` in `apps/worker/wrangler.jsonc`.

## Cloudflare configuration
`apps/worker/wrangler.jsonc` defines one Worker (D-021): `assets.directory` points at `../web/dist`, `run_worker_first` is `["/api/*"]`, unmatched navigation requests fall back to the single-page app, and a cron trigger runs every minute. `apps/web/public/_headers` sets security headers (including a strict Content-Security-Policy: no inline styles or scripts, so later UI work must not introduce them without updating the policy and recording a decision).

`apps/web/public/.well-known/appspecific/com.tesla.3p.public-key.pem` is a **placeholder**, not a key. TASK-15 replaces it. Locally the file is served with status 200 and the security headers; whether Cloudflare's production asset service serves a dot-directory identically is still `UNVERIFIED` (Q-03).

## Line endings and formatting
`.gitattributes` forces LF; `.editorconfig` and Prettier agree. If your editor writes CRLF, run `npm run format`.
