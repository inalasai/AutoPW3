# Known Limitations

Append-only register. Use the status vocabulary: VERIFIED, MOCK_ONLY, AWAITING_CREDENTIALS, AWAITING_PROVIDER_APPROVAL, UNSUPPORTED_BY_DEVICE, UNVERIFIED, NOT_EXECUTED.

| ID | Area | Limitation | Status | Added in |
|---|---|---|---|---|
| L-001 | Tesla integration | Live Fleet API behaviour not yet verified against an authorised site | UNVERIFIED | TASK-00 |
| L-002 | Scope | Native mobile app, multi-household UX, non-Tesla inverters, billing are out of v1 | — | kit |
| L-003 | Tesla integration | Native sign convention, field names and update cadence of live_status are not documented in the pages reached; Tesla adapter normalisation cannot be written yet | UNVERIFIED | TASK-00 |
| L-004 | Tesla integration | EU Fleet API base URL not found in official pages reached; discover via GET /api/1/users/region | UNVERIFIED | TASK-00 |
| L-005 | Tesla integration | Payload schemas for backup, operation, grid_import_export, storm_mode and off_grid_vehicle_charging_reserve are not documented in the pages reached; controls are mock-only | UNVERIFIED | TASK-00 |
| L-006 | Tesla integration | Whether energy commands need signing, and whether Powerwall supports Fleet Telemetry streaming, is not documented in the pages reached | UNVERIFIED | TASK-00 |
| L-007 | Tesla integration | Historical data allowed period values, time-zone format, resolution and retention not documented in the pages reached | UNVERIFIED | TASK-00 |
| L-008 | Cost | Fleet API is pay-per-use with a USD 10 monthly discount and a mandatory payment method; continuous polling is not free. Billing category of energy endpoints unverified | AWAITING_PROVIDER_APPROVAL | TASK-00 |
| L-009 | Tesla integration | Forced charging, forced export, solar bypass and islanding are not documented | UNSUPPORTED_BY_DEVICE | TASK-00 |
| L-010 | Access | Approval of an individual (non-business) developer application and the Fleet API agreement terms are unconfirmed | AWAITING_PROVIDER_APPROVAL | TASK-00 |
| L-011 | Security | Supabase session token is held in browser storage (XSS risk); mitigated by CSP and no third-party scripts | UNVERIFIED | TASK-01 |
| L-012 | Security | MFA for ADMIN is recommended, not enforced in v1; Supabase MFA availability unverified | UNVERIFIED | TASK-01 |
| L-013 | Platform | Workers Free limits (10 ms CPU, 50 subrequests) may be too tight; paid plan price unverified | UNVERIFIED | TASK-01 |
| L-014 | Platform | Cron Triggers give no exact-time guarantee; all jobs are idempotent and catch up; automation misses beyond the recovery window are skipped | UNVERIFIED | TASK-01 |
| L-015 | Data | Provider energy resolution and field availability unknown; costs may be reported unpriceable at coarse resolution | UNVERIFIED | TASK-01 |
| L-016 | Data | No table partitioning in v1; revisit above about 10 million rows per table | NOT_EXECUTED | TASK-01 |
| L-017 | Privacy | Lawful basis, DPA and transfer review not done; app treated as owner-only | UNVERIFIED | TASK-01 |
| L-018 | Privacy | Deleted data may persist in Supabase backups for their retention window | UNVERIFIED | TASK-01 |
| L-019 | UX | Invitations are shared by copying a link; no email delivery in v1 | NOT_EXECUTED | TASK-01 |
| L-020 | Hosting | `.well-known` public key file serving as a Worker static asset and Cloudflare-managed nameserver requirement not yet tested | UNVERIFIED | TASK-01 |
| L-021 | Quality | The float-money lint rule only forbids `parseFloat` and `.toFixed()`; other float arithmetic on money is not detected by tooling | NOT_EXECUTED | TASK-02 |
| L-022 | Testing | Worker tests run in Node with a fake `ASSETS` binding, not in workerd; real-runtime behaviour is checked only by manual `wrangler dev` | NOT_EXECUTED | TASK-02 |
| L-023 | CI | `.github/workflows/ci.yml` has not run on GitHub; Linux and Node 22 behaviour is unverified | NOT_EXECUTED | TASK-02 |
| L-024 | Security | The Content-Security-Policy in `apps/web/public/_headers` forbids inline styles and scripts; UI libraries that inject inline styles will need a reviewed policy change | NOT_EXECUTED | TASK-02 |
| L-025 | Tooling | `typescript` is held at 6.0.3 because `typescript-eslint` does not yet support TypeScript 7 (D-025) | UNVERIFIED | TASK-02 |
| L-026 | Testing | Migrations verified on PostgreSQL 17 with a shim for `auth.users` and the Supabase roles, not on a real Supabase stack (`supabase db reset` not run) | NOT_EXECUTED | TASK-03 |
| L-027 | Tooling | `supabase/config.toml` written by hand and never loaded by the Supabase CLI | UNVERIFIED | TASK-03 |
| L-028 | Tariffs | Not enforceable as constraints, left to the tariff engine: full-day slot coverage, overlap between `ALL` and `WEEKDAY`/`WEEKEND` slots, season range validity, same household/direction across versions of one `tariff_key`, price points only on `DYNAMIC` tariffs | NOT_EXECUTED | TASK-03 |
| L-029 | Data | `device_command_log` command kinds are limited to the six TASK-00 `DOCUMENTED` endpoints; their payloads are `UNVERIFIED` and the adapter is mock-only | UNVERIFIED | TASK-03 |
| L-030 | Testing | `npm run db:verify` takes a few minutes (server start-up) and is not part of `npm run check` | NOT_EXECUTED | TASK-03 |
| L-031 | Tariffs | Only the tariff header (`utility_tariffs`) is immutable apart from `name` and `effective_to`; slots, seasons, overrides, levies and price points of an existing version can still be edited by READ_WRITE and ADMIN. The API must create a new version instead (TASK-10/11) | NOT_EXECUTED | TASK-04 |
| L-032 | Privacy | No API role can delete a household (no grant); deleting household data needs an audited function (data deletion task). Until then only the platform operator can do it | NOT_EXECUTED | TASK-04 |
| L-033 | Testing | The security tests ran on PostgreSQL 17.10 with a test shim and `pgtap-lite.sql`, not on a real Supabase stack with real pgTAP (`supabase test db` not run). Unverified there: the trigger on `auth.users`, minimal `auth.users` inserts used by the fixtures, grants on the real `auth` schema, PostgREST behaviour for column privileges | NOT_EXECUTED | TASK-04 |
| L-034 | Security | A superuser or the platform operator can disable triggers or set `session_replication_role = replica`; all trigger-based guards (last admin, append-only, immutability) assume that does not happen. This is the accepted platform-operator risk in `SECURITY_MODEL.md` section 10 | UNVERIFIED | TASK-04 |
| L-035 | Accounts | The auth account of the last ADMIN cannot be deleted (`last_admin_protected`). The account-deletion flow (S9) must promote another ADMIN or delete the household first | NOT_EXECUTED | TASK-04 |
| L-036 | Security | `accept_invitation` has no database rate limit; a 256-bit token makes guessing infeasible. Per-user and per-IP rate limiting is the Worker's job (TASK-14) | NOT_EXECUTED | TASK-04 |
| L-037 | API | `select *` on `household_invitations` fails by design (the `token_hash` column has no grant); callers must list columns. `audit_log.request_id` is not filled by the database functions. Direct audit inserts by `service_role` (S7) bypass the metadata allowlist | NOT_EXECUTED | TASK-04 |
| L-038 | Types | `packages/shared/src/db/database.types.ts` is produced by `scripts/db-types.mjs` on PostgreSQL 17.10, not by `supabase gen types`; the shape is Supabase-compatible but `createClient<Database>()` was not exercised against a real project | NOT_EXECUTED | TASK-05 |
| L-039 | Commands | Command parameter shapes (reserve percent, operation mode, grid flags, storm, off-grid reserve, time-of-use tariff id) are our normalised model. The Tesla request payload mapping and the allowed `operationMode` values are not documented in the pages reached (see L-005) | UNVERIFIED | TASK-05 |
| L-040 | Automation | Rule definition v1 is a minimal proposal (three condition types, AND only, no schedule or day-of-week condition). Changing it needs a new `definitionVersion` | UNVERIFIED | TASK-05 |
| L-041 | API | The `me` export, household export and delete-account or household bodies are proposals; household deletion also lacks a database path (L-032) | NOT_EXECUTED | TASK-05 |
| L-042 | API | `DB_ERROR_TO_API_ERROR` maps database function messages to API codes; several choices (for example `already_member` to `CONFLICT`) are not in `API_CONTRACT.md` and must be confirmed in TASK-14 | UNVERIFIED | TASK-05 |
| L-043 | Types | Generated types show `numeric` and `bigint` columns as `number`, but PostgREST returns JSON numbers, which are not exact. Money and rate columns must be selected as `col::text` and parsed with the decimal helpers (`NUMERIC_COLUMNS` lists them) | NOT_EXECUTED | TASK-05 |
| L-044 | Tariffs | The shared tariff schema checks one tariff in isolation. Slot overlap, full-day coverage and season gaps are checked in `packages/domain` (TASK-10); a multi-table atomic tariff create needs a database function (TASK-14) | NOT_EXECUTED | TASK-05 |
| L-045 | Testing | Two contract tests read repository files through `/// <reference types="node" />`, relying on a transitive `@types/node`; the web and Worker builds do not include them | NOT_EXECUTED | TASK-05 |
| L-046 | Dependencies | `react-router` 8.5.0 declares `engines.node >=22.22.0`; the repository root and CI declare Node 22. Install and CI passed here, but a lower 22.x patch may warn | NOT_EXECUTED | TASK-06 |
| L-047 | Dependencies | `axe-core` is MPL-2.0. It is a dev and test dependency only and is not in the production bundle; the owner approved it | VERIFIED | TASK-06 |
| L-048 | Accessibility | jsdom cannot evaluate colour contrast. It is covered by `styles/contrast.test.ts` (token pairs) and by a manual real-browser axe run, which is not repeatable in CI until Playwright arrives in TASK-07 | MOCK_ONLY | TASK-06 |
| L-049 | Accessibility | Real Tab-key traversal was not demonstrated in the embedded browser (tool-issued Tab presses did not move focus). Keyboard behaviour is evidenced by `user-event` tests in jsdom. A manual pass with a physical keyboard and a screen reader is still needed | NOT_EXECUTED | TASK-06 |
| L-050 | Routes | `/invite/:token` is a placeholder added beyond the task's route list (PRD invitations). TASK-07 or 19 may rename it | UNVERIFIED | TASK-06 |
| L-051 | Controls page | The capability table on `/controls` is a Tesla-agnostic placeholder where every capability shows "Not checked". No capability is claimed (L-005) | UNVERIFIED | TASK-06 |
| L-052 | UI | The effects preference is stored in `localStorage` (`autopw3.effects`); it is per browser and not synced to the account | VERIFIED | TASK-06 |
| L-053 | UI | The demo banner scrolls away with the page; only the header `DEMO` pill is sticky | VERIFIED | TASK-06 |
| L-054 | UI | `/dev/components` exists only in development builds (checked absent from `dist`); it cannot be viewed against a production build or `dev:worker` | VERIFIED | TASK-06 |
| L-055 | Dev | `npm run dev:worker` was not exercised in TASK-06; the Worker's SPA fallback for deep links was not re-tested with the new routes | NOT_EXECUTED | TASK-06 |
| L-056 | Tooling | One `wrangler deploy --dry-run` run crashed on Windows with exit code -1073740791 during an earlier `npm run check`. Rerunning `npm run build` and then `npm run check` passed. Cause not investigated; likely an intermittent local wrangler or workerd fault | NOT_EXECUTED | TASK-06 |
