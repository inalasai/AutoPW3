# Privacy (TASK-01)

Status: **PROPOSED, awaiting owner approval.** Written 2026-10-22. This is an engineering design note, **not legal advice**. Items marked *owner to confirm* need the owner (and, if appropriate, a lawyer) before real people's data is processed. The owner is in the EU (Ireland), so GDPR is assumed to be relevant.

## 1. Data inventory

| Data | Examples | Personal data? | Where | Why | Retention (default) |
|---|---|---|---|---|---|
| Account identity | Email, password hash, auth metadata | Yes | Supabase Auth | Sign-in | Until account deletion |
| Profile | Display name, locale | Yes | `user_profiles` | UI | Until account deletion |
| Membership | Household, role, timestamps | Yes (links a person to a household) | `household_members` | Authorisation | Until removal or deletion |
| Invitations | Invitee email (optional), role, hashed token | Yes (email) | `household_invitations` | Joining | Expired or used: 7 days after expiry/use, then deleted |
| Household and site info | Household name, timezone, site name, Tesla site id | Indirectly (it identifies a home) | `households`, `energy_sites` | Operation | Until household deletion |
| Energy telemetry | Solar, battery, grid, load power; energy per interval; SOC | **Yes**: consumption patterns reveal occupancy and behaviour | `powerwall_metrics_log`, `energy_intervals`, rollups | Product function | Raw 90 days; intervals and hourly 800 days; daily and cost rollups until household deletion |
| Tariffs and costs | Rates, standing charge, computed cost | Low (but financial) | `utility_tariffs` etc., `cost_rollups_daily` | Cost analysis | Until household deletion |
| Provider credentials | Tesla access/refresh tokens (ciphertext) | Yes (access to the owner's Tesla account data) | `tesla_credentials` | Tesla access | Until disconnect or deletion |
| Commands and automation | Requested settings, outcomes, rule executions | Yes (actions by identified users) | `device_command_log`, `automation_*` | Safety, history | 24 months (commands/events); executions follow rule life or 24 months |
| Audit log | Who did what, when, request id | Yes (actor id) | `audit_log` | Accountability | 24 months |
| Operational counters | Provider request counts per day | No | `provider_usage_daily` | Budget control | 24 months |
| Logs | Request id, route, status, duration, error code | No by design | Cloudflare Workers Logs | Operations | Per Cloudflare plan (`UNVERIFIED` here) |

Retention values are proposals the owner may change (Q-07). The database `retention` job enforces them (`DATABASE_DESIGN.md` §4).

## 2. What is never collected or logged

- No telemetry values, JWTs, Tesla tokens, client secrets, passwords or invitation tokens in application logs. Logs use an allowlist of fields (request id, route template, status, duration, error code, household and site ids).
- No raw Tesla payloads are stored.
- The application does not store IP addresses or user agents in the database. Cloudflare and Supabase keep their own infrastructure logs under their own policies. Rate-limit buckets, if keyed by IP, use a hash with a short TTL (`UNVERIFIED` mechanism, TASK-14).
- No third-party analytics, advertising scripts or tracking cookies. Only functional storage: the Supabase session in browser storage.

## 3. Roles and recipients

- **Controller/processor split (owner to confirm):** for a single household using its own instance, GDPR's household exemption may apply to the owner's own data; as soon as other people (for example family or tenants) are given accounts, or the owner operates the service for others, the owner likely acts as controller for their data. Seek advice before onboarding anyone outside the owner's own household.
- **Processors/recipients:** Supabase (database and auth, region chosen by the owner, EU region recommended), Cloudflare (Workers execution, static hosting, logs; global network), Tesla (data source and API provider; Tesla is its own controller for Tesla account data). A data-processing agreement and transfer mechanism review is *owner to confirm* (`UNVERIFIED`; not researched here).
- Region note from TASK-00: Fleet API is regionalised for GDPR and other regimes, and the developer remains responsible for compliance (Tesla Best Practices page, accessed 2026-10-22).

## 4. Lawful basis (owner to confirm)

Candidate bases: **contract/legitimate interest** for operating the household's own energy dashboard; **consent** for any additional household member whose data is shown, recorded at invitation acceptance; the Tesla owner's OAuth consent is a separate consent given to Tesla and to the app for the stated scopes. The app requests only the scopes it needs (`energy_device_data`; `energy_cmds` only when controls are enabled by an ADMIN). The chosen basis and a short privacy notice are the owner's to write before onboarding others; TASK-21 includes a template notice.

## 5. User rights, as implemented

| Right | Implementation |
|---|---|
| Access / portability | `POST /me/export` (profile, memberships) and `POST /households/{hid}/export` (ADMIN; household data as JSON; bounded, async if large). Audited as `data.exported`. |
| Rectification | Profile edit; household and site name edit (ADMIN) |
| Erasure | `DELETE /me` removes the auth user, profile, memberships; audit rows keep no personal identifier (actor id set to NULL, metadata allowlisted, no PII). `DELETE /households/{hid}` (ADMIN, typed confirmation) cascades site, telemetry, tariff, command, automation and credential data; disconnect also deletes credentials. A user who is the sole ADMIN of a household with other members must transfer or delete first. |
| Restriction / objection | Disconnecting Tesla stops ingestion; household deletion removes data. Account-level controls handled by the owner as operator. |
| Revoking Tesla access | In-app disconnect deletes stored credentials; the user is also told to revoke on Tesla's consent page (programmatic revocation is `UNVERIFIED`, TASK-00 Q3). Revoking on Tesla removes the app's access immediately. |
| Breach handling | Owner as operator follows `SECURITY.md` and the incident steps in `docs/DEPLOYMENT_RUNBOOK.md` (TASK-21); credential rotation procedures are in `SYSTEM_ARCHITECTURE.md` §8. Notification duties are *owner to confirm*. |

Backups: Supabase backups may retain deleted data for their retention window (`UNVERIFIED`; owner to check the project's plan). TASK-21 records the backup/restore drill and states the deletion-versus-backup behaviour.

## 6. Data minimisation and design choices

- Raw power snapshots expire after 90 days; long-term analysis uses rollups.
- Demo data is synthetic and never stored.
- Telemetry is stored only for the connected site and only at the cadence the cost budget allows.
- Member lists are visible only to ADMINs of the same household; no cross-household directory.
- Audit metadata is allowlisted per action.
- Encryption: tokens encrypted at rest (AES-256-GCM); transport over HTTPS; database encryption at rest is provided by Supabase (`UNVERIFIED` specifics).

## 7. Open privacy items for the owner

Lawful basis and privacy notice (Q-10); DPA and international transfer review for Supabase/Cloudflare (Q-10); log retention on Cloudflare (Q-05); backup retention and deletion behaviour (Q-07); whether to allow any user outside the owner's household in v1 (TASK-00 O4).
