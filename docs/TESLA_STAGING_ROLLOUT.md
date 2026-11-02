# AutoPW3 staging rollout — consolidated approval plan

Historical operator rollout record, not reusable deployment instructions. Private resource values
are withheld; new developers must use [their own independent setup](DEVELOPER_SETUP.md#h-independent-hosted-staging-optional-explicit-authorization).
Do not target the operator's Worker or reuse the old root-config commands for a new deployment.

Publication note: private site/account identifiers and runtime timestamps are withheld. Historical
artifact hashes refer to the operator rollout; portable configuration/public-key placeholders differ
from that deployed artifact. Owner-specific operation helpers and evidence are not published.

Status: VERIFIED on 2026-11-02 — approved staging rollout, ADMIN login, one safe refresh/discovery and user-performed site linking complete. Active version REDACTED_RUNTIME_ID. No further provider or link request is needed. Fresh OAuth consent was not repeated; all live features remain disabled.
Only `autopw3-staging` and Supabase `YOUR_PROJECT_REF` are in scope. Production is excluded.
Stop on any failed check; do not advance to a later stage. Perform the approved rollback if needed.

## 1. Preconditions and pinned artifacts

Run from `C:\AutoPW3`, on `Raj-AutoPW3`; preserve all current work. Read-only preflight confirmed
active Worker `REDACTED_RUNTIME_ID` at 100%, healthy linked project, all existing
secret bindings, no cron schedules and the expected flags. Public login serves HTTP 200 with the
correct Supabase CSP when using a descriptive client User-Agent. Default Python urllib receives
Cloudflare 1010; no security setting should be changed to fix that client diagnostic.

Before any hosted write, refresh `python scripts/staging-hosted-preflight.py` and compare the active
version, 19 existing migrations, binding names/types, public-config matches and credential metadata
with `.wrangler/staging-integration/hosted-preflight.jsonl`. Unexpected drift stops the rollout.
Run `node scripts/verify-staging-build.mjs` and compare its asset hashes against the approved snapshot.
Do not rebuild or replace reviewed assets silently.

The pinned Worker artifact is:
`C:\AutoPW3\apps\worker\.wrangler\staging-integration\worker-dry-run\index.js`
SHA256: `d82384fecfcc97f1aa3c8d02956143919e8942fe4a85708b25d52026e4e29fb8`.
Its `--no-bundle --dry-run --keep-vars` deployment was validated locally. Static assets are the
reviewed `apps/web/dist` tree, pinned in `.wrangler/staging-integration/build-check.json`.
The original frontend was preserved in `.wrangler/staging-integration/frontend-before`.

Approved SQL, in exact applied order (retained rollout record):

| Migration | SHA256 |
| --- | --- |
| `20261102120000_refresh_staging_tesla_discovery_credentials.sql` | `21f407ed8ec9e748da07693002559942c09dd009bc187ce0dc1b14d4fef653b1` |
| `20261102140000_resolve_expired_tesla_refresh_attempts.sql` | `3315dfabd1becd3b0690ec06435aa34b121ce364921576f6f5911c751cc6105a` |
| `20261102160000_fence_staging_tesla_link_commit.sql` | `afe1fce4e0f98d4bb48e195adf99fa70046d3f58888e8afa3383a28386fa48ac` |

Each file is a single DO statement: definitions/grants are atomic in autocommit and inside the
migration runner's transaction. Injected-failure and outer-rollback tests passed for all three.

## 2. Correct staging Auth redirects

Using the existing CLI Management API credential in memory, PATCH only
`https://api.supabase.com/v1/projects/YOUR_PROJECT_REF/config/auth` with:

```json
{
  "site_url": "https://staging.example.invalid",
  "uri_allow_list": "https://staging.example.invalid/auth/callback,https://staging.example.invalid/reset-password,http://localhost:3000,http://localhost:3000/auth/callback,http://localhost:3000/reset-password,http://localhost:5173,http://localhost:5173/auth/callback,http://localhost:5173/reset-password"
}
```

Captured prior values were `http://localhost:3000` and an empty allowlist. The approved execution also preserves explicit localhost:3000 and localhost:5173 development redirects. This corrects email/callback URLs;
it does not change passwords, users, session lifetime, signup policy, signing keys or OAuth grants.
Read these two fields back and require exact equality before continuing. Never log the API token or
the unfiltered Auth configuration, which can contain unrelated secrets.

## 3. Apply the three additive migrations with the old Worker active

Use the already installed Supabase CLI from the current root and its existing credential. Do not
re-link or reset the project. First preview the pending set; require exactly the three files above.

```powershell
$stagingSupabaseCli = 'YOUR_LOCAL_SUPABASE_CLI
& $stagingSupabaseCli db push --linked --dry-run
# Continue only when the exact three approved migrations are pending.
& $stagingSupabaseCli db push --linked --yes
```

The CLI may create its normal temporary database login role to execute the approved migrations.
Do not supply secrets on command lines. Any missing access or unexpected migration stops this step.
Read back the ordered history and require all 22 versions, plus all new definitions/grants and the
private RLS ledger. Verify anon/authenticated cannot read credential or ledger ciphertext; service
cannot begin/finish; authenticated cannot stage. Verify live Auth session schema compatibility.

Existing OAuth, login and site-link RPC signatures remain intact. The audit allowlist preserves all
old actions. The old Worker uses those unchanged signatures and can remain active throughout this
additive migration. Expired discovery is expected to remain unavailable until the new Worker runs.

Issue `NOTIFY pgrst, 'reload schema';` once on this project through the Management API query endpoint
after migration verification if schema visibility has not refreshed; this is an approved cache
notification, not a credential or application-data change. Verify cache availability before proceeding.

## 4. Deploy the pinned staging Worker and frontend

Check asset/config/migration/Worker hashes again. Upload/deploy only this Worker, preserving every
existing secret binding and plain binding through `--keep-vars`:

```powershell
npx wrangler deploy C:\AutoPW3\apps\worker\.wrangler\staging-integration\worker-dry-run\index.js --no-bundle --env staging --keep-vars --config apps/worker/wrangler.jsonc
```

Record the returned version ID. Require a single 100% deployment of that version; verify all existing
binding names/types and the same three secret names. Verify public Supabase configuration matches
the frontend without printing keys. Require exactly:

```text
ENVIRONMENT=staging
LOCAL_MOCKS=false
PROVIDER_MODE=mock
STAGING_TESLA_OAUTH_ENABLED=true
STAGING_TESLA_SITES_ENABLED=true
STAGING_TESLA_LIVE_STATUS_ENABLED=false
```

Require no cron schedules, no new telemetry/polling/control bindings, correct static asset hashes,
HTTP 200 login and project-scoped CSP. Check login, API error shape and unauthenticated rejection.
Do not start discovery on a failed post-deploy check.

## 5. Real ADMIN verification — included in the requested approval

User action: open `https://staging.example.invalid/login`, sign in as the household
ADMIN and leave Settings open. If browser access needs permission, allow the task's Brave window
access. Never paste a password, session token or Tesla token into chat or logs.

Verify the real Supabase session and ADMIN UI; no global DEMO MODE banner; Tesla Energy Site setup
visible; Powerwall controls locked off. The explicit manual OAuth action is available for initial
connection/reauthorization, but do not click it automatically or reconnect as part of this rollout.

Perform one approved Find Tesla energy sites request. This approval includes the real refresh-token
exchange and encrypted persistence required by the currently expired ACTIVE credential, followed
by the real Fleet API products request. Verify one revision-bound attempt, encrypted commit,
last_refresh_at/audit and only authorized energy sites. No token/ciphertext/provider payload is logged.
On REAUTH or uncertain SENT recovery: stop; preserve the barrier and report the precise manual
reauthorization action. Do not retry an uncertain provider exchange or reconnect automatically.

Present the real discovered site name/ID and intended household to the user, then stop for their specific confirmation. Do not automatically select or link a site. Only after that confirmation, link it with the UI-generated idempotency key and verify the
database contains exactly one TESLA site for that natural key in the correct household, one creation
audit and the persisted metadata shown by the UI. A lost link response may be reconciled using the
same key; no automatic polling/retry loop. Repeating an explicit link must return the same persisted
site without duplication. Verify synthetic telemetry remains labelled DEMO and all live hardware
paths remain disabled. Only after all of these real checks pass is the definition of done satisfied.

## 6. Stop and rollback procedure

On any failed verification, stop later stages and retain sanitized request IDs/state metadata.
If the Worker rollout is the cause, restore the confirmed version:

```powershell
npx wrangler rollback REDACTED_RUNTIME_ID --env staging --config apps/worker/wrangler.jsonc --message "Staging Tesla verification failed"
```

Verify 100% old version, original assets, all secret bindings and safety flags. Keep the additive
migrations; do not run a down migration, erase attempts, restore old encrypted tokens or undo a
successful refresh. The old Worker can read the same encrypted envelope and newly committed tokens;
it still cannot refresh them when they next expire. Pending/ambiguous rotations remain fenced.

If the Auth redirect adjustment caused a regression, restore only its captured prior `site_url` and
`uri_allow_list` values and read them back. Never change Auth secrets or users as rollback.
Do not delete a successfully linked site as a diagnostic or rollback step. Preserve audits and
credential state; investigate before any further provider operation. No production action is allowed.


## Executed checkpoint ? 2026-11-02

All three approved migrations are installed in order, each journaled as one DO statement containing
its grants/restrictions. The new read-only RPC is visible and anonymous invocation is denied with
401/42501. Private ledger RLS, revision uniqueness, no policies and revoked direct API-role access
were verified. The old Worker remained active through migration verification.

Staging Auth redirects were corrected with localhost development preserved and every unrelated Auth
field unchanged. The pinned Worker was deployed as `REDACTED_RUNTIME_ID` at 100%. All existing binding names/
types and three secret bindings are preserved; required flags remain exact, and cron schedules empty.
Six publicly served asset hashes match the seven-file reviewed tree (`_headers` is configuration and
was verified through the emitted CSP). Unauthenticated discovery returns 401; unapproved Origin
returns 403. Stored credential metadata remains unchanged and no provider call or link was performed.

One verification harness assertion expected HTTP 200 for the schema-cache notification. Execution
paused before deployment. Read-only diagnosis confirmed the documented HTTP 201 success response
and loaded RPC cache; the notification was not repeated. No migration/security invariant failed.

Remaining: user signs in as ADMIN, one authorized refresh/discovery attempt, presentation of real
site details, then a separate user confirmation before linking. Rollback target remains unchanged.

Real discovery checkpoint: ADMIN login and the authorized refresh/discovery succeeded. Candidate [site name withheld] (REDACTED_TESLA_SITE_ID), [household name withheld]. One committed refresh/audit verified, pending ciphertext cleared, zero linked sites. Awaiting explicit site-specific confirmation; do not rerun discovery or link automatically.

## Final acceptance checkpoint — 2026-11-02

After presentation of the real site and the confirmation request, the user performed the link in
the staging UI. The screenshot and read-only hosted verification agree: [site name withheld],
Tesla ID `REDACTED_TESLA_SITE_ID`, [household name withheld], persisted UUID
`REDACTED_RUNTIME_ID`, [site timezone withheld], state CONNECTING.
Exactly one natural-key site row, one creation audit and one persisted link result exist. The agent
did not repeat linking, discovery or refresh. One committed refresh/audit remains, staged payload
cleared, current credential ACTIVE with read-only scopes.

Final hosted preflight and safety checks passed. Required flags/bindings/RPC permissions remain
correct; PROVIDER_MODE=mock, live status false, no schedules, controls false, no ACTIVE automation
rules and no live metric/accounting rows or capabilities snapshot for this site. CONNECTING is
link metadata, not proof of live telemetry. The served pinned build retains DEMO synthetic telemetry.
Existing OAuth → refresh → real discovery → user-selected link → persistence/UI confirmation is
verified. Fresh OAuth consent was intentionally not exercised. Conservative recovery and missing
automatic abandoned-READY cleanup remain documented limits; generated-artifact root lint remains
unchanged. See the [final handoff](handoffs/TESLA-STAGING-INTEGRATION.md) for tests and evidence.

No further rollout action is pending. Preserve version `REDACTED_RUNTIME_ID` as
rollback target, migrations, latest encrypted credentials, barriers and audits. No production change
or commit was made. Additional provider operations or live-feature activation need a new explicit scope.
