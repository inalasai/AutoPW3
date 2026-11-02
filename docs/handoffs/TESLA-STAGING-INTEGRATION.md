# AutoPW3 — Staging integration completion

Publication note: private site/account identifiers and runtime timestamps are withheld. Historical
artifact hashes refer to the operator rollout; portable configuration/public-key placeholders differ
from that deployed artifact. Owner-specific operation helpers and evidence are not published.

Status: VERIFIED — approved staging rollout, ADMIN login, existing OAuth credential refresh, real site discovery, user-performed linking and hosted persistence verified on 2026-11-02. Fresh OAuth consent was not repeated; live telemetry and hardware features remain disabled. Historical Git attribution is explicitly accepted; see [secure publication](SECURE-GITHUB-PUBLICATION.md) and [developer setup](../DEVELOPER_SETUP.md).
Branch: Raj-AutoPW3; preserve existing tracked/untracked work; no commit or production changes.

## Plan before implementation

Trace and verify the existing browser Supabase session, ADMIN membership, OAuth bridge, encrypted
refresh ledger, products adapter, revision-bound linking and frontend confirmation. Preserve D-126's
conservative expired READY policy and durable no-blind-retry barriers.

Expected changes: frontend Tesla failure categories/allowlisted recovery parsing and setup messages;
component/API tests; a production-built staging Playwright fixture/config; local staging telemetry
configuration; a forward atomic migration for post-lock link authorization/freshness checks if the
audit confirms the gap; real DB contention tests; touched READMEs, decisions, limitations and this
handoff. Add narrowly scoped, read-only hosted preflight evidence and a consolidated rollout plan.
No unrelated architecture/refactoring or generated-artifact lint edits.

Risks: recovery messages encouraging unsafe retries; JWT/proof/credential expiry while waiting on a
link lock; accidental demo authentication/default Vite mode; public build variables exposing secrets;
stale OAuth overwrite; losing a rotated token; duplicate natural site keys; hosted migration/catalog
drift; deploying disabled discovery flags; real provider calls before approval. Browser fixtures must
intercept every request and cannot contact hosted Supabase/Tesla.

Hosted changes, Worker deployment, real Tesla refresh, OAuth reconnect and live credential mutation
require one explicit consolidated approval after local tests and hosted preflight. If access is
unavailable, finish independent local work and identify the exact access action needed. A real ADMIN
browser session and authorized site selection are required for final verification after approval.


## Completed local work

- Fixed bounded, contract-validated browser recovery handling and stopped repeated rediscovery after
  REAUTH/uncertain SENT outcomes while preserving the Supabase session.
- Corrected the shared error schema: only the two fixed Tesla recovery CONFLICT details are accepted.
- Added an explicit manual read-only Tesla authorization action through the existing session/ADMIN
  endpoint and OAuth completion bridge. It validates Tesla origin/path, PKCE, redirect URI and exact
  read-only scopes. It never starts automatically; unsafe redirect/scope responses fail closed.
- Disabled the staging Powerwall controls switch and omitted control changes from settings saves.
- Made local staging telemetry explicitly DEMO while keeping real Supabase login and staging site UI.
- Aligned only the staging discovery flag with its already-enabled hosted value.
- Added atomic migration 20261102160000 to recheck live authorization and freshness after site-link
  request-row/unique-index waits. No old OAuth/login/link signatures or scopes were removed.
- Added real PostgreSQL expiry races, atomic installation rollback tests and a built-staging browser
  fixture that intercepts all traffic. Preserved the old frontend and untouched generated lint artifact.

## Exact checks and evidence

| Command | Result |
| --- | --- |
| `npm run test --workspace @autopw3/worker -- --configLoader native --pool threads --maxWorkers 1` | PASS: 703 tests, 39 files. |
| `npm run test --workspace @autopw3/worker -- src/lib/staging-tesla-sites.test.ts --configLoader native --pool threads --maxWorkers 1` | PASS: 102 tests, including actual HTTP error contract validation. |
| `npm run test --workspace @autopw3/shared -- --configLoader native --pool threads --maxWorkers 1` | PASS: 238 tests, 16 files. |
| `npm run test --workspace @autopw3/domain -- --configLoader native --pool threads --maxWorkers 1` | PASS: 535 tests, 29 files. |
| `npm run test --workspace @autopw3/web -- --configLoader native --pool threads --maxWorkers 1` | PASS: 613 tests, 42 files. Initial URL-object/string fixture mismatch corrected; final full rerun passed. |
| `npm run db:test` | PASS: PG 17.10, 22 migrations, 24 SQL files, 726 checks: 693 SQL, 27 concurrency, six atomic-install/outer-rollback checks. Six link and 16 refresh concurrency cases. |
| `npm run db:verify` | PASS: empty install, repeat/reset/reapply, constraints, grants/RLS, 30 public design tables and flows. |
| `npm run db:types -- --check` | PASS: generated types unchanged and current for 22 migrations. |
| `npm run typecheck` | PASS: all workspaces/e2e, including staging fixture/config. |
| `npm run build --workspace @autopw3/web -- --mode staging` | PASS: actual staging-mode frontend; native process needed the existing sandbox escalation. |
| `node scripts/verify-staging-build.mjs` | PASS: mode, Supabase auth, expected public key/URL, site gate, callback chunk, DEMO telemetry, CSP; seven asset hashes pinned. |
| `npx playwright test --config playwright.staging.config.ts` | PASS: six built-staging browser cases, every request intercepted; no real provider/hosted calls. |
| `npx playwright test --config playwright.config.ts` | PASS: 38 desktop/mobile browser regressions. Expected absent-local-Worker proxy warnings only. |
| Targeted ESLint/Prettier | PASS for changed source/helper/browser/config files; exact paths listed below. |
| `npm run lint:rules` / `npm run secrets:scan` | PASS. |
| Worker dry-run and pinned no-bundle dry-run | PASS; no upload/deployment. |
| `python scripts/staging-hosted-preflight.py` | PASS read-only metadata; latest timestamp in the sanitized hosted-preflight evidence. |

Targeted JS/TS paths: `apps/web/src/features/auth/{AuthProvider.tsx,supabase-client.ts,tesla-sites.ts,tesla-sites.test.ts}`;
`apps/web/src/features/admin/{TeslaSiteSetup.tsx,TeslaSiteSetup.test.tsx,SettingsManager.tsx}`;
`packages/shared/src/schemas/{api.ts,api.test.ts}`; `apps/worker/src/lib/staging-tesla-sites.test.ts`;
`scripts/db-test.mjs`, `scripts/db/tesla-site-link-concurrency.mjs`,
`scripts/db/tesla-refresh-migration-atomicity.mjs`, `scripts/verify-staging-build.mjs`,
`e2e/staging-tesla.pw.ts`, `playwright.staging.config.ts`. Prettier also checks
`e2e/tsconfig.json` and `apps/worker/wrangler.jsonc`. Python helper compiles without writing bytecode.

Worker dry-run commands (stdout retained only in ignored local evidence, with no secret values):

```powershell
npx wrangler deploy --dry-run --env staging --config apps/worker/wrangler.jsonc --outdir .wrangler/staging-integration/worker-dry-run
npx wrangler deploy C:\AutoPW3\apps\worker\.wrangler\staging-integration\worker-dry-run\index.js --no-bundle --dry-run --env staging --keep-vars --config apps/worker/wrangler.jsonc --outdir C:\AutoPW3\.wrangler\staging-integration\verified-worker
```

The first relative outdir resolves beneath the Worker config directory. The pinned artifact is
`apps/worker/.wrangler/staging-integration/worker-dry-run/index.js`, SHA256
`d82384fecfcc97f1aa3c8d02956143919e8942fe4a85708b25d52026e4e29fb8`.
Root lint's pre-existing generated `.wrangler-tesla-check/index.js` remains untouched, SHA256
`14740877e5fdd53e08f509992a916bb0eda1cb9280325e607f349b65be388f0a`; prior 349 errors are separate
from the passing source checks. Fresh root ESLint checked 384 files: all 349 errors remain confined to that artifact; no source warnings/errors. Root lint is not claimed to pass. Vite chunk-size/native-loader
future warnings remain; no unrelated refactoring was performed to suppress them.

## Initial hosted read-only findings (before approved rollout)

- Linked project `YOUR_PROJECT_REF` is ACTIVE_HEALTHY in eu-west-1. Cached Supabase CLI is 2.122.0.
- Active staging Worker is still `REDACTED_RUNTIME_ID`, 100% of traffic.
- All requested staging flags match; LOCAL_MOCKS=false. Secret bindings present:
  SUPABASE_SECRET_KEY, TESLA_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY. No values retrieved or logged.
- Worker/public frontend project URL, publishable key and app origin match. No cron schedules.
- Nineteen migrations are installed through 20261101170000. Both refresh files and the new link-commit
  file are not installed. The private refresh ledger and new refresh RPCs are absent as expected.
- Existing 14 relevant routines have correct server/user separation, no PUBLIC or anon execution;
  credential-table RLS is enabled and neither anon nor authenticated can SELECT it. auth.sessions
  has the required not_after column. Existing deployed code calls the unchanged OAuth/link interfaces.
- Credential metadata: ACTIVE, expires [credential timestamp withheld], last_refresh_at NULL, not fresh for
  discovery; exact read-only scopes and approved region; one ADMIN and zero linked sites.
- Auth site_url is http://localhost:3000 and redirect allowlist empty. Proposed staging-only correction
  is approval-gated; existing passwords/users/session policy are preserved.
- Public login is HTTP 200 with asset script and project-scoped CSP. Default urllib was rejected with
  Cloudflare 1010; a descriptive application User-Agent resolves this without changing security.
  Source: https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/.
- Read-only Cloudflare login renewal used Wrangler's existing authorization. No Tesla OAuth reconnect
  occurred. Native browser app access timed out; public HTTP evidence and isolated browser tests do
  not substitute for the real authenticated ADMIN verification after rollout.

Sanitized evidence is timestamped in `.wrangler/staging-integration/hosted-preflight.jsonl`, with the
latest snapshot in hosted-preflight.json. Initial working-tree status and the prior frontend are
preserved there. No hosted application/database write, real Tesla request, deployment or commit.

## Changed files and database compatibility

New: atomic link-commit migration; staging Playwright config/fixture; read-only hosted preflight and
build-check helpers; rollout plan and this handoff; auth/admin folder READMEs where absent.
Modified: the frontend adapter/actions/setup/controls, shared error schema/tests, post-lock link and
atomicity tests/runner, staging discovery flag, e2e type include and touched READMEs/contracts.
Local ignored .env.staging.local gained VITE_TELEMETRY_PROVIDER=demo; public auth values unchanged.
No production setting, control endpoint, polling/automation job or schema credential envelope changed.
Append-only D-127/L-142 document the policy and remaining scope.

Applying the three forward files is additive while the old Worker runs. No existing RPC signature,
public-table column/grant, OAuth flow or login setting is removed. Audit replacement retains all old
allowlists. Link authorization is stricter after lock waits; valid old-Worker calls are compatible.
Credential activation remains atomic and revision-fenced. Do not roll back encrypted credentials.

## Pre-approval acceptance checkpoint (superseded by final verification below)

TASK NOT COMPLETE: real Supabase ADMIN login, real Tesla refresh/products, authorized site selection,
exactly-once linking, hosted persistence and frontend confirmation remain unverified. Current local
and read-only hosted work is ready for one consolidated approval in
[the rollout plan](../TESLA_STAGING_ROLLOUT.md). That approval includes the staging Auth URL correction,
three migrations, pinned Worker/assets, one real credential refresh/discovery and selected-site link.
No automatic reconnect is included. Stop on a failed check and use the approved Worker rollback.

Known limits: durable SENT ambiguity requires explicit recovery; original-session binding remains;
abandoned pending ciphertext has no automatic cleanup. Existing generic admin demo fallbacks are
outside this Tesla slice; staging setup does not claim demo connection status, and controls stay off.
No credentials should be pasted into chat. After approval/deployment the user must sign in as the
household ADMIN at the staging login page and leave Settings open so final verification can proceed.

Final local result: 703 Worker, 238 shared, 535 domain and 613 web tests passed; 726 DB checks and 44 browser cases (38 regression + six built-staging) passed. All requested local checks are complete. Hosted preflight metadata gate: True. Real deployment/provider/link validation remains explicitly approval-gated.


## Approved hosted rollout checkpoint ? 2026-11-02

User approval was received with ten conditions. The site-link condition supersedes the earlier plan:
never automatically link; first present real discovered details and request a specific confirmation.

- The CLI dry-run and hosted/local history comparison confirmed exactly the three approved filenames
  in order. Their hashes, Worker hash, manifest hash and all seven reviewed asset hashes matched.
- Auth site_url now points to staging. Existing localhost:3000 and repo localhost:5173 roots,
  auth/callback and reset-password redirects were preserved explicitly; unrelated Auth fields unchanged.
- All three migrations applied successfully. Hosted history now has 22 versions; each new entry has
  one DO statement containing function privilege restrictions. User/server RPC separation, private
  ledger RLS, no direct table access, unique household/revision fence and Auth schema were verified.
- Old Worker PRIVATE_ROLLBACK_VERSION remained active while migrations were applied/verified; login continued HTTP 200.
- A checker incorrectly expected 200 for the successful schema reload notification (documented 201).
  Rollout paused; SELECT-only diagnosis and anonymous protected-RPC probe confirmed healthy state.
  No notification or token exchange was blindly retried.
- Active new version: `REDACTED_RUNTIME_ID`, 100% traffic. Pinned no-bundle artifact deployed;
  bindings/secrets preserved, all required safety flags exact, no scheduled work.
- Served JS/CSS/HTML/public-key hashes match reviewed files; `_headers` policy verified via CSP.
  Unauthenticated discovery: 401 UNAUTHENTICATED. Unapproved Origin: 403 FORBIDDEN.
- Credentials have not refreshed or changed, zero sites remain linked, no real Tesla request occurred.
  No production changes or commits; no records, refresh barriers or rotated credentials removed.

Evidence: ignored `auth-redirect-checkpoint.json`, `migration-apply-checkpoint.json`,
`migration-security-checkpoint.json`, `predeploy-checkpoint.json`, `deployment-checkpoint.json`,
`postdeploy-checkpoint.json` and timestamped hosted-preflight history under
`.wrangler/staging-integration/`. Values are sanitized; no tokens are printed or persisted.

Next user action: sign in as the real household ADMIN at staging /settings, leave it open and reply
ready without clicking Find or Connect. One refresh/discovery is authorized only after that action.
On success show real site details and wait for linking confirmation; on any actual failure stop.


## Real discovery checkpoint ? 2026-11-02

The user signed in as ADMIN and performed the one authorized Find request after browser automation
could not confidently establish the Windows browser URL. The supplied staging Settings screenshot
shows the ADMIN account, no global DEMO MODE banner, the Tesla setup card and disabled Powerwall
controls. It displays [site name withheld], provider site ID REDACTED_TESLA_SITE_ID, for [household name withheld].

Read-only hosted metadata independently verifies one COMMITTED/TOKEN refresh attempt, one
tesla.token_refreshed audit, no reauth audit, erased staged ciphertext, a valid encrypted credential
envelope, exact read-only scopes and an approved region. last_refresh_at is
[credential timestamp withheld]; access expiry is [credential timestamp withheld].
No refresh/provider request was repeated by the agent. No tokens/ciphertext were selected or printed.

Zero household sites and zero tesla.site_linked audits remain. The real candidate is presented for
explicit confirmation before any link action. Selection shown in the screenshot is not treated as
permission to link. Evidence: ignored discovery-checkpoint.json. No production, telemetry, polling,
automation or control behavior was enabled.

## Final user-linked acceptance checkpoint — 2026-11-02

The user explicitly linked the presented [site name withheld] site through the staging UI and supplied the
successful result screenshot. The agent did not submit a link request or repeat discovery/refresh.
Read-only hosted reconciliation matched the UI's persisted UUID
`REDACTED_RUNTIME_ID`, provider ID `REDACTED_TESLA_SITE_ID`, [household name withheld],
[site timezone withheld] and connection state CONNECTING. There is exactly one row for the natural
site key, one tesla.site_linked creation audit and one persisted idempotent link result.

The credential is ACTIVE with exact read-only scopes. One COMMITTED/TOKEN refresh attempt and one
refresh audit remain; the staged encrypted payload is cleared. No second refresh exchange, OAuth
reconnection, diagnostic link or credential rollback was performed.

Final read-only security/configuration checks passed: all 22 migrations installed, restricted RPC
permissions and credential/ledger RLS intact, active Worker `REDACTED_RUNTIME_ID`
at 100%, existing bindings preserved, PROVIDER_MODE=mock and live-status flag false, no cron schedules.
Household controls_enabled=false, zero ACTIVE automation rules, zero live metric/accounting rows
for the linked site and no live capabilities snapshot. CONNECTING records the persisted linkage;
it does not claim that live telemetry or a hardware connection was activated.

Acceptance evidence: actual user screenshots establish ADMIN login, no incorrect global DEMO MODE,
visible Tesla setup, real discovery selection and linked-site confirmation; hosted database metadata
establishes refresh and exactly-once persistence. Served assets match the staging build whose browser
tests verify DEMO labels for synthetic telemetry. Final evidence is sanitized in ignored
`link-checkpoint.json`, `final-safety-checkpoint.json` and `hosted-preflight.json/jsonl` under
`.wrangler/staging-integration/`. No token values or ciphertext were selected or printed.

The requested staging workflow is VERIFIED using the existing Tesla OAuth grant. All local test
results above remain applicable; only documentation changed after final hosted checks. Fresh Tesla
OAuth consent/reconnection was deliberately NOT_EXECUTED. Pending SENT ambiguity/original-session
loss still requires explicit recovery, and abandoned encrypted READY attempts have no automatic
cleanup; conservative expired READY REAUTH remains enforced. Root lint still has only the 349
previously identified errors in the untouched generated artifact. These limits were not bypassed.

No further user action is needed for site setup. Do not repeat provider calls, enable live features,
delete records/barriers or restore older rotated credentials. Rollback target remains
`REDACTED_RUNTIME_ID`; database migrations and current credentials must be retained.
No production changes or commits were made.
