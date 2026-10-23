# AutoPW3 - Task Handoff Report

## Task completed
Number and name: TASK-04 RLS, grants, admin bootstrap and SQL security tests
Branch / commit: `Raj-AutoPW3` (owner chose to work on this branch instead of `task-04-rls-security-tests`); commits prefixed `task-04:`. Not pushed. No PR opened.
Date: 2026-10-23

**Status: complete for what could be run locally, with one deliverable moved:** generated database types are not produced here because `npm run db:types` is defined in TASK-05. Security is verified **only on PostgreSQL 17.10 with a test shim and a pgTAP look-alike**, not on a real Supabase stack (L-033). Do not describe it as verified on Supabase.

## Summary
The database now enforces authorisation on its own. All 29 tables have row-level security with 52 explicit policies for `authenticated`; `anon` has no access anywhere. Role changes, invitations, pausing and rule activation go through 8 audited `SECURITY DEFINER` functions, and triggers enforce last-admin protection, append-only audit and command-event tables, tariff immutability and spoof-proof actor columns. A one-time, audited first-admin bootstrap exists and cannot be rerun. 336 SQL assertions in 11 files pass through `npm run db:test`, and the policy matrix document is compared automatically with `pg_policies`.

## Files created
| Path | Purpose |
|---|---|
| `supabase/migrations/20261023130000_security_helpers.sql` | pgcrypto, `private` schema grants, `is_member`, `has_role_at_least`, `touch_audit` (allowlist), `stamp_actor`, `reject_truncate`, redefined `lock_down_public_tables` (v2), default-privilege revokes |
| `supabase/migrations/20261023130100_membership_integrity_and_audit_triggers.sql` | Last-admin and self-change guards, tariff immutability, audit triggers, actor stamping, TRUNCATE rejection, server-role revokes on append-only tables |
| `supabase/migrations/20261023130200_identity_and_membership_functions.sql` | `handle_new_user` trigger on `auth.users` (+ backfill), the 8 public functions, `private.bootstrap_first_admin` |
| `supabase/migrations/20261023130300_rls_policies_and_grants.sql` | All table/column grants and the 52 policies |
| `supabase/tests/database/000..100_*.test.sql` (11 files) | Security tests (see Checks) |
| `supabase/tests/README.md` | How the tests are organised and run |
| `scripts/db-test.mjs` | `npm run db:test` runner: embedded PostgreSQL 17, applies shim + migrations, runs the files, parses TAP, compares the policy manifest |
| `scripts/db/pgtap-lite.sql` | Test-only look-alike of the pgTAP functions used (`plan`, `ok`, `is`, `isnt`, `throws_ok`, `lives_ok`, `finish`). Not pgTAP |
| `docs/RLS_POLICY_MATRIX.md` | Table x role x operation matrix, product-permission mapping, differences from the design, functions, machine-checked manifest |
| `docs/ADMIN_BOOTSTRAP.md` | How to run the one-time bootstrap, error table, break-glass recovery |
| `docs/handoffs/TASK-04.md` | This report |

## Files modified
| Path | What changed and why |
|---|---|
| `scripts/db/local-shim.sql` | Added `auth.uid()`, `auth.jwt()`, `email_confirmed_at`, `extensions` schema and usage grants so tests can simulate JWTs. Test-only |
| `scripts/db-verify.mjs` | Snapshot covers triggers, policies, privileges and functions. Three TASK-03 checks superseded by this task's model (no longer "no policies" / "no privileges at all": now server-only tables only). Fixture no longer inserts a profile because the auth trigger creates it |
| `package.json` | `db:test` script |
| `AGENTS.md`, `docs/DEVELOPMENT_SETUP.md`, `docs/DATABASE_SETUP.md`, `docs/TESTING.md`, `docs/README.md`, `supabase/README.md` | Commands, status lines, security posture, new documents |
| `.github/workflows/ci.yml` | Added `npm run db:test` after `db:verify` (not run on GitHub: no push) |
| `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md` | Appended D-031..D-035 and L-031..L-037 |
| `docs/ai-build-kit/00-README.md` | TASK-04 ticked |

## Decisions
- **D-031** RLS and privilege model. `FORCE ROW LEVEL SECURITY` deliberately not used (departs from SECURITY_MODEL section 4). `lock_down_public_tables` v2 keeps policy-backed grants.
- **D-032** Privileged operations only through audited functions. Deviations from DATABASE_DESIGN: `leave_household` added, `set_automation_paused` takes a household id, ACTIVE rules not directly editable, members see only their own membership row unless ADMIN, no household deletion through the API.
- **D-033** Bootstrap, invitations (hashed 256-bit token, 168 h default, max 30 days) and the new-user trigger.
- **D-034** Integrity triggers apply to every writer.
- **D-035** Security tests run on embedded PostgreSQL with a pgTAP look-alike; `supabase test db` not run.

## Database changes
- Migrations 8 to 11 above (idempotent, with rollback notes).
- Functions in `public` (EXECUTE for `authenticated` only): `create_invitation`, `accept_invitation`, `revoke_invitation`, `change_member_role`, `remove_member`, `leave_household`, `set_automation_paused`, `set_rule_mode`.
- Functions in `private`: `is_member`, `has_role_at_least` (executable by `authenticated`), `bootstrap_first_admin` (owner and `service_role` only), triggers and helpers (no API access).
- Every `SECURITY DEFINER` function has `search_path` fixed (`''` for the helpers, `public, extensions` for others with schema-qualified references) and EXECUTE revoked from PUBLIC and `anon`; `db:test` file 100 asserts this.
- `tesla_credentials`, `oauth_states`, `system_bootstrap`, `job_locks`, `scheduled_jobs`: RLS on, no policy, no grant for `anon` or `authenticated`.

## API changes
None (no Worker code). The functions above are the future PostgREST RPC surface; TASK-06 onward must call them as the signed-in user's JWT, never with the secret key, for member actions.

## Checks executed
| Exact command | Executed? (yes/no) | Result | Relevant output/failure |
|---|---|---|---|
| `npm run db:test` | yes | exit 0 | 336 ok, 0 not ok across 11 files; manifest matches 52 policies |
| `npm run db:dictionary` (runs `db:verify` then regenerates the dictionary) | yes | exit 0 | "All database checks passed"; dictionary unchanged (no column changes) |
| `npm run check` (typecheck, lint, test, build, secrets:scan; does not include the database scripts) | yes | exit 0 | build and wrangler dry-run succeeded, secretlint clean |
| `npx prettier --write scripts/db-test.mjs scripts/db-verify.mjs package.json` | yes | exit 0 | `db-verify.mjs` reformatted |
| `supabase db reset` | no | NOT_EXECUTED | No Docker or Supabase CLI. Command: `npx supabase db reset` |
| `supabase test db` | no | NOT_EXECUTED | Needs Docker. Command: `npx supabase test db` (the same SQL files; real pgTAP) |
| `npm run db:types` | no | NOT_EXECUTED | Defined in TASK-05 |
| CI on GitHub | no | NOT_EXECUTED | Branch not pushed |

Tests defined (counts): 000 helpers 2, 010 new-user defaults 10, 020 cross-household isolation 29, 030 role permissions 65, 040 membership/last admin 38, 050 invitations 41, 060 bootstrap 24, 070 credentials and server-only tables 58, 080 live-data integrity and append-only 29, 090 audit trail 22, 100 hardening and grants 18.

## Manual verification
None by hand. The existing `db:verify` constraint checks were rerun after the security changes.

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| A read-only user cannot elevate privileges, read another household's data or retrieve Tesla tokens | VERIFIED on PostgreSQL 17.10 with shim; NOT_EXECUTED on real Supabase | files 020, 030, 040, 070 |
| The policy matrix matches the implemented policies | VERIFIED | `db:test` manifest comparison (52 = 52) |
| Every `SECURITY DEFINER` function has a fixed search path and restricted execute grants | VERIFIED (same caveat) | file 100 |
| Required tests: new-user default, READ_ONLY write denial, READ_WRITE and ADMIN actions, cross-household denial, self-escalation denial, membership tampering, credential denial, last admin, bootstrap once, invitation reuse/expiry, demo-source insert denial, audit rows | VERIFIED (same caveat) | files 010 to 090 |
| Generated database types in the handoff | NOT_EXECUTED | TASK-05 owns `db:types` |

## Verification status register
- VERIFIED (PostgreSQL 17.10, shim, pgtap-lite): RLS isolation, role permissions, last-admin protection, bootstrap-once, invitation rules, append-only tables, audit rows.
- UNVERIFIED on a real Supabase stack: the `auth.users` trigger, the real `auth` schema grants, PostgREST column-privilege behaviour, real pgTAP (L-033).
- UNVERIFIED by design: protection against a superuser disabling triggers (L-034).

## Outstanding issues
- L-031 tariff child rows editable after creation; L-032 no household deletion API; L-033 test environment; L-034 superuser bypass; L-035 last admin cannot delete their account; L-036 no DB rate limit on `accept_invitation`; L-037 `select *` on invitations fails by design, `request_id` not filled.
- Owner questions: (1) Is `FORCE ROW LEVEL SECURITY` omission acceptable (D-031)? (2) Should members see the member list? Currently ADMIN only (D-032). (3) Run `npx supabase test db` once Docker is available.

## Environment variables
None added.

## Instructions for the next task
- TASK-05 (types and shared contracts): run `npm run db:types` once defined; types must match migrations 1 to 11. Do not edit existing migrations; add new ones.
- Reuse `private.is_member` and `private.has_role_at_least` for any new table policy; any new table migration must end with `private.lock_down_public_tables()` and then explicit grants and policies, and `docs/RLS_POLICY_MATRIX.md` manifest must be updated or `db:test` fails.
- Do not call member actions with the secret key. Do not grant `authenticated` anything on server-only tables.
- Invitation tokens are shown once by `create_invitation`; never log them.

## Next task
TASK-05. Prerequisite: owner review of D-031 to D-035.
