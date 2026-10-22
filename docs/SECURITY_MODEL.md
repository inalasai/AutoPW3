# Security Model (TASK-01)

Status: **PROPOSED, awaiting owner approval.** Written 2026-10-22. Vendor facts V1 to V10 are defined in `docs/SYSTEM_ARCHITECTURE.md` §1. Decision IDs refer to `docs/DECISIONS.md`.

Principle: **the database and Worker are authoritative; the browser only reflects.** A request that bypasses the frontend must fail on every protected operation.

## 1. Trust boundaries

| Zone | Trust | Holds |
|---|---|---|
| Browser | Untrusted | User session JWT, UI state |
| Cloudflare Worker | Trusted server | Secrets, decrypted tokens in memory, service access |
| Supabase Postgres | Authoritative store | Data, RLS, ciphertext |
| Supabase Auth | Identity provider | Users, password hashes, signing keys |
| Tesla | External provider | Owner's device data and controls |
| Platform operator (owner via dashboards) | Privileged human | Supabase and Cloudflare dashboards, secrets |

## 2. Roles (decision 1, D-004)

Roles are **per household membership**: table `household_members(household_id, user_id, role)`. A user with no row has no access. Roles never live on the user.

| Role | Intent |
|---|---|
| `READ_ONLY` | View live data, analytics, tariffs, rules, command history, own profile; export own data. |
| `READ_WRITE` | Everything `READ_ONLY` plus: edit tariffs, create/edit automation rules (modes `DISABLED` or `DRY_RUN` only), submit device commands, trigger the global automation pause. |
| `ADMIN` | Everything `READ_WRITE` plus: manage members and invitations, change roles of **other** members, connect/disconnect Tesla, enable controls scope, set a rule to `ACTIVE`, resume after global pause, view audit log, set budgets and retention. ADMIN is **household-scoped**. |

Invariants (enforced in the database, TASK-04):
1. New users default to **no membership**. Invitations default to `READ_ONLY`. Only an ADMIN may issue an invitation with a higher role.
2. Nobody can change their own role or remove their own membership (except "leave household", allowed if not the last ADMIN).
3. The last active ADMIN of a household cannot be demoted or removed.
4. Role changes happen only through audited functions; direct `UPDATE` on `household_members.role` is not granted to `authenticated`.
5. The user directory (member list) shows only members of households the caller belongs to. There is no platform-wide user listing in the app; platform operations use the Supabase dashboard (kit review item 6).
6. Asymmetry for safety: any `READ_WRITE` or `ADMIN` can **pause** automation; only `ADMIN` can **resume**.

### 2.1 Permission matrix (product level)

| Capability | READ_ONLY | READ_WRITE | ADMIN |
|---|---|---|---|
| View live, analytics, tariffs, rules, commands, capabilities | yes | yes | yes |
| Export own data | yes | yes | yes |
| Create/edit tariffs | no | yes | yes |
| Create/edit rules (`DISABLED`/`DRY_RUN`) | no | yes | yes |
| Set rule `ACTIVE` | no | no | yes |
| Submit device command | no | yes | yes |
| Pause automation | no | yes | yes |
| Resume automation | no | no | yes |
| Invite/revoke invitations, list members | no | no | yes |
| Change another member's role / remove member | no | no | yes |
| Connect/disconnect Tesla, choose site | no | no | yes |
| Enable `energy_cmds` (controls) scope | no | no | yes |
| View audit log | no | no | yes |
| Set budget, retention | no | no | yes |
| Delete household data | no | no | yes |

The detailed table × role × operation RLS matrix is produced in TASK-04 (`docs/RLS_POLICY_MATRIX.md`) and must implement this table exactly.

## 3. Authentication and sessions

- Supabase Auth issues JWTs. The Worker verifies them locally with asymmetric keys via JWKS (V8, V9); HS256 is rejected (D-009). Details and the request diagram: `SYSTEM_ARCHITECTURE.md` §4.
- Public sign-up yields a zero-privilege user. Email confirmation required. Password policy and rate limits are Supabase Auth settings, to be configured and verified in TASK-07 (`UNVERIFIED` here).
- The Worker never accepts `role`, `householdId` role claims or `x-` role headers from the client. It resolves membership from the database per request for the `(sub, householdId)` pair (path parameter only identifies which household to check; it grants nothing).
- Cross-household access returns **404** (not 403), so existence is not revealed. A valid member with insufficient role gets **403**. Unauthenticated gets **401**.

## 4. Database controls (TASK-03/04 implement)

- RLS enabled on every table in an exposed schema; `FORCE ROW LEVEL SECURITY` where the owner role is used by functions. Explicit `GRANT`/`REVOKE`; `anon` has nothing; with RLS on and no policy nothing is visible (V10).
- Membership helpers: `private.is_member(household_id)` and `private.has_role_at_least(household_id, role)`; `SECURITY DEFINER`, `SET search_path = ''`, schema-qualified references, `REVOKE EXECUTE … FROM PUBLIC`, executable only by the roles that need them. Helpers live in a schema that is **not** exposed through the API (V10 notes definer functions run as `postgres`, which bypasses RLS).
- Views are created `WITH (security_invoker = true)` or not exposed; views bypass RLS by default (V10).
- Constraints enforce: role enum; percentages 0 to 100; `source = 'TESLA'` on live telemetry; unique `(site_id, sampled_at)`; unique idempotency key per site; tariff windows validity and overlap exclusion where practical.
- Append-only: `audit_log` and `device_command_log` events have no `UPDATE`/`DELETE` grants for any API role; triggers reject changes.
- One-time admin bootstrap (decision 2, D-005): function `private.bootstrap_first_admin(email, household_name, timezone)`, executable only by a trusted server role, succeeds only when `system_bootstrap.completed_at is null` and no `ADMIN` exists, records an audit row, sets `completed_at`, and can never run again. Documented in `docs/ADMIN_BOOTSTRAP.md` (TASK-04).
- Invitations: tokens are random 256-bit values, stored only as SHA-256 hash, single-use, expire (default 7 days), revocable; acceptance requires an authenticated user whose verified email equals the invited email (when an email was specified) and creates the membership with the invited role.

## 5. Credentials

Authoritative description is `SYSTEM_ARCHITECTURE.md` §8 (one place). Summary: Tesla tokens are AES-256-GCM ciphertext in `tesla_credentials`, readable only by the Worker with the Cloudflare-held key; no browser or `authenticated` access; never logged. The Supabase secret key and encryption key exist only as Worker secrets (V7); `vars` never hold them; `.dev.vars` is git-ignored; `secrets.required` makes deploys fail if one is missing.

## 6. Service-level access (secret key) – allowed cases only

The Worker uses user-scoped database access for all ordinary user reads and writes. The secret key (bypasses RLS only when no user token is attached, V10) is allowed only for:

| # | Operation | Why user scope is not enough |
|---|---|---|
| S1 | Read/write `tesla_credentials` | No user may access it |
| S2 | `claim_jobs`, `acquire_lock`, `release_lock`, enqueue jobs | Runs from cron with no user |
| S3 | Ingestion writes to `powerwall_metrics_log`, `energy_intervals`, rollups, `telemetry_sync_state` | Written by the system, not users |
| S4 | `provider_usage_daily` increments and budget checks | System counter |
| S5 | Write command lifecycle transitions after dispatch (`device_command_log` events) | The record of provider outcomes is system-owned; initial intent row is inserted user-scoped so RLS proves the role |
| S6 | Bootstrap function call | One time, trusted role |
| S7 | Audit writes for system actors | Cron/system events |
| S8 | OAuth state create/consume | Callback has no user token |
| S9 | Delete the caller's Supabase Auth user on account deletion (auth admin API) | Deleting an auth user is an administrative operation; allowed only after the caller's own JWT is verified and the confirmation is checked |

Every route and job handler lists which of S1–S8 it uses in `docs/API_OPERATIONS.md` (TASK-14). Any other use is a defect.

## 7. Tesla-specific safety

- Tesla access is server-side only; the browser never sees tokens, client secret, or raw Tesla payloads.
- No Tesla endpoint, scope, payload or capability is enabled unless TASK-00 marked it `DOCUMENTED` **and** its payload has been verified (otherwise mock-only). Forced charge, forced export, solar bypass and islanding are `NOT_SUPPORTED` and rejected by the backend regardless of UI state.
- Capability registry lives in `apps/worker/src/providers/tesla`; the command service rejects anything not `SUPPORTED` for the site (backend check, TASK-17).
- Controls scope `energy_cmds` is requested only when an ADMIN enables controls. Until live behaviour is verified by the owner by hand, commands run against the mock only (D-006, D-003).
- Command lifecycle, idempotency, honest statuses: `docs/SYSTEM_ARCHITECTURE.md` (diagram) and `docs/DECISIONS.md` D-015. HTTP 200 is never `CONFIRMED`.
- Automation: new rules `DISABLED` or `DRY_RUN`; dry-run never calls control endpoints; missing/stale data, capability or authorisation means no action; global pause; idempotent commands.
- Budget guard prevents runaway billing (D-023); 4xx responses are billed and are never retried in a loop.

## 8. Application-layer controls (TASK-14)

Middleware order: request id → size limit → CORS (dev/preview only) → authentication → membership/role → input validation (shared Zod schemas) → rate limit → handler. Consistent error envelope; no stack traces; no token, JWT or telemetry payload in logs; log fields are an allowlist. Rate limiting: per user and per IP buckets stored in the database or a Workers binding; the mechanism is chosen in TASK-14 and documented (`UNVERIFIED` here; the V2 compatibility matrix lists a Rate Limiting binding as supported on Workers).

Browser hardening: CSP via `_headers` (default-src 'self'; connect-src limited to the Supabase project origin and same origin; frame-ancestors 'none'), no inline scripts, no third-party scripts, `Referrer-Policy`, `X-Content-Type-Options`. No secret in any `VITE_*` variable (`.env.example` marks which are public).

## 9. Threat model (summary)

| Threat | Control |
|---|---|
| READ_ONLY user calls mutating API directly | Worker role check + RLS; tested with a READ_ONLY token on every mutating route (TASK-14) |
| User changes own role | No grant; function rejects; tested (TASK-04) |
| Cross-household read/write | RLS on every table; 404 on mismatch; tested |
| Leaked service secret key | Only in Worker secrets; rotate in Supabase; `secrets.required`; secret scan in CI |
| Leaked encryption key | Keys in Worker secrets only; rotation procedure; ciphertext AAD binding |
| Stolen DB dump | Tokens are ciphertext; no plaintext secrets in tables |
| Forged/expired JWT | Local signature + `exp` + `iss` checks, algorithm allowlist, no HS256 |
| OAuth CSRF / code injection | Single-use hashed `state` bound to user and household, expiry 10 min, PKCE |
| Refresh-token race locks owner out | Per-credential lease; persist new token before use |
| Runaway Tesla billing | Spend cap, atomic counters, no retry on 4xx |
| Duplicate/unsafe commands from duplicate cron | Idempotency key per command; job dedupe key and leases |
| Demo data in live accounting | Type split, runtime guard, DB `CHECK` |
| XSS stealing session | CSP, no third-party scripts; residual risk documented |
| PII/telemetry in logs | Redacting logger allowlist; tests |
| Malicious invitation reuse | Hashed single-use expiring tokens; email binding |
| Admin lockout | Last-admin DB rule; bootstrap one-time; owner break-glass via Supabase dashboard (documented, audited out-of-band) |

## 10. Residual risks (accepted, tracked in `KNOWN_LIMITATIONS.md`)

Session token in local storage (XSS); no MFA enforcement in v1 unless enabled in Supabase (`UNVERIFIED`); Tesla behaviours still `UNVERIFIED`; a platform operator has full access to both dashboards by design.
