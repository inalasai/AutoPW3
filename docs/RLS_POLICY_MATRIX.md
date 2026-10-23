# RLS Policy Matrix (TASK-04)

Status: **IMPLEMENTED, tested on PostgreSQL 17.10 with a test shim; NOT yet run on a real Supabase stack** (L-026, L-033). Written 2026-10-23. Implements `docs/SECURITY_MODEL.md` section 2.1 and `docs/DATABASE_DESIGN.md` section 3. Decisions D-031 to D-034.

The table at the end ("Policy manifest") is compared with `pg_policies` by `npm run db:test`; a policy that exists but is not listed here, or listed but missing, fails the run.

## 1. How access is enforced

| Layer | Rule |
|---|---|
| `anon` | No privilege on any table, sequence or function. No policy applies to it. |
| `authenticated` | Table privileges are explicit and minimal (column-level where a table holds system-owned columns). Row access is decided by policies that call `private.is_member` and `private.has_role_at_least`. |
| `service_role` (Worker secret key) | Bypasses RLS; keeps its table privileges except `UPDATE`, `DELETE`, `TRUNCATE` on the append-only tables. Allowed only for cases S1 to S9 in `SECURITY_MODEL.md` section 6. |
| Privileged changes | Only through `SECURITY DEFINER` functions that check the caller from the JWT: `create_invitation`, `accept_invitation`, `revoke_invitation`, `change_member_role`, `remove_member`, `leave_household`, `set_automation_paused`, `set_rule_mode`. |
| Invariants for every writer | Triggers (not policies): last-admin protection, no self role change, immutable membership keys, tariff version immutability, append-only logs, actor stamping, audit rows. |
| Server-only tables | `tesla_credentials`, `oauth_states`, `system_bootstrap`, `job_locks`, `scheduled_jobs`: RLS on, no policy, no grant for `anon` or `authenticated`. |

Roles are per household membership and ordered `READ_ONLY < READ_WRITE < ADMIN`. A user with no membership row has no access. "Member" below means any role.

## 2. Table x role x operation

Legend: **R** rows of the user's own household(s) (RLS filtered), **-** denied (no grant or no policy), **fn** only through the named audited function, **svc** service role only, **own** own row only.

| Table | anon | no membership | READ_ONLY | READ_WRITE | ADMIN |
|---|---|---|---|---|---|
| `user_profiles` | - | own: select, update `display_name`, `locale` | same | same | same, plus select profiles of people in the household |
| `households` | - | - | select | select | select, update `name`, `timezone`. Insert: bootstrap only. Delete: not granted (L-032) |
| `household_members` | - | - | select own row (own role) | select own row | select all members of the household. Write: fn only |
| `household_invitations` | - | - | - | - | select (never `token_hash`). Write: fn only |
| `household_settings` | - | - | select | select | select; update budget, retention, intervals, `controls_enabled`. Pause: fn (READ_WRITE+), resume: fn (ADMIN) |
| `energy_sites` | - | - | select | select | select, insert, update `name`/`timezone`, delete. `connection_state` and `capabilities_snapshot`: svc |
| `powerwall_metrics_log`, `energy_intervals`, `telemetry_rollups_hourly`, `telemetry_rollups_daily`, `telemetry_sync_state`, `cost_rollups_daily` | - | - | select | select | select. Write: svc only |
| `provider_usage_daily` | - | - | select | select | select. Write: svc only |
| `utility_tariffs` | - | - | select | select, insert, update (name, `effective_to` only), delete | same as READ_WRITE |
| `tariff_seasons`, `tariff_overrides`, `tariff_slots`, `tariff_levies`, `tariff_price_points` | - | - | select | select, insert, update, delete | same as READ_WRITE |
| `automation_rules` | - | - | select | select; insert `DISABLED`/`DRY_RUN`; update non-mode columns and delete while not `ACTIVE`. Mode: fn `set_rule_mode` (`DISABLED`/`DRY_RUN`) | same as READ_WRITE, plus `ACTIVE` through `set_rule_mode` |
| `automation_executions` | - | - | select | select | select. Write: svc only |
| `device_command_log` | - | - | select | select; insert intent only (`USER`, `PENDING`/`RECORDED`; `TESLA` mode needs `controls_enabled`). Lifecycle: svc | same as READ_WRITE |
| `device_command_events` | - | - | select | select | select. Write: svc only |
| `audit_log` | - | - | - | - | select own household. Write: triggers, functions, svc append only |
| `tesla_credentials`, `oauth_states`, `system_bootstrap`, `job_locks`, `scheduled_jobs` | - | - | - | - | - (svc only) |

### Product permissions (SECURITY_MODEL 2.1) and where each is enforced

| Capability | READ_ONLY | READ_WRITE | ADMIN | Enforced by |
|---|---|---|---|---|
| View live, analytics, tariffs, rules, commands, capabilities | yes | yes | yes | `*_select_member` policies |
| Export own data | yes | yes | yes | same read policies (export is a read) |
| Create/edit tariffs | no | yes | yes | `utility_tariffs_*_writer` and child policies; version trigger |
| Create/edit rules (`DISABLED`/`DRY_RUN`) | no | yes | yes | `automation_rules_*_writer` policies |
| Set rule `ACTIVE` | no | no | yes | `set_rule_mode` (no direct mode write) |
| Submit device command | no | yes | yes | `device_command_log_insert_writer` |
| Pause automation | no | yes | yes | `set_automation_paused(h, true)` |
| Resume automation | no | no | yes | `set_automation_paused(h, false)` |
| Invite/revoke invitations, list members | no | no | yes | `create_invitation`, `revoke_invitation`, select policies |
| Change another member's role / remove member | no | no | yes | `change_member_role`, `remove_member`; self-change refused in function and trigger |
| Connect/disconnect Tesla, choose site | no | no | yes | `energy_sites_*_admin` policies; credentials by svc after the ADMIN check in the Worker (S1) |
| Enable `energy_cmds` (controls) scope | no | no | yes | `household_settings_update_admin` (`controls_enabled`) |
| View audit log | no | no | yes | `audit_log_select_admin` |
| Set budget, retention | no | no | yes | `household_settings_update_admin` column grant |
| Delete household data | no | no | **deferred** | Not granted. A later task adds an audited function (L-032). Nothing can delete a household through the API now |

## 3. Differences from the product table

- "Delete household data" is deferred (L-032): there is no delete grant on `households`.
- An ACTIVE rule cannot be edited directly even by an ADMIN; move it out of `ACTIVE` with `set_rule_mode` first (audited). This is stricter than the product table.
- `READ_ONLY` and `READ_WRITE` see their own membership row but not the member list (the product table says "list members: ADMIN only").

## 4. Functions and triggers (all with `search_path = ''`, `EXECUTE` revoked from `PUBLIC` and `anon`)

| Function | Callable by | Purpose |
|---|---|---|
| `private.is_member(uuid)`, `private.has_role_at_least(uuid, role_enum)` | authenticated (policy helpers) | membership and role checks; `SECURITY DEFINER` so they read `household_members` without recursion |
| `private.touch_audit(...)` | owner and definer functions only | allowlisted audit insert |
| `private.bootstrap_first_admin(email, name, timezone)` | owner, `service_role` | one-time first household and ADMIN (`docs/ADMIN_BOOTSTRAP.md`) |
| `public.create_invitation`, `accept_invitation`, `revoke_invitation` | authenticated (checked inside) | invitation lifecycle |
| `public.change_member_role`, `remove_member`, `leave_household` | authenticated (checked inside) | membership management |
| `public.set_automation_paused`, `public.set_rule_mode` | authenticated (checked inside) | pause/resume, rule mode |
| `private.handle_new_user` (trigger on `auth.users`) | system | profile only, never a role |
| `private.guard_membership`, `audit_membership` | triggers | last admin, no self change, immutable keys, audit |
| `private.guard_tariff_version`, `audit_tariff_version` | triggers | tariff version immutability, audit |
| `private.audit_settings_changed`, `audit_command_requested`, `stamp_actor`, `reject_truncate` | triggers | audit, spoof-proof actor columns, append-only |

## 5. Policy manifest

Format: `table policy command`. Compared with `pg_policies` by `npm run db:test`.

<!-- policy-manifest:start -->
```
audit_log audit_log_select_admin SELECT
automation_executions automation_executions_select_member SELECT
automation_rules automation_rules_delete_writer DELETE
automation_rules automation_rules_insert_writer INSERT
automation_rules automation_rules_select_member SELECT
automation_rules automation_rules_update_writer UPDATE
cost_rollups_daily cost_rollups_daily_select_member SELECT
device_command_events device_command_events_select_member SELECT
device_command_log device_command_log_insert_writer INSERT
device_command_log device_command_log_select_member SELECT
energy_intervals energy_intervals_select_member SELECT
energy_sites energy_sites_delete_admin DELETE
energy_sites energy_sites_insert_admin INSERT
energy_sites energy_sites_select_member SELECT
energy_sites energy_sites_update_admin UPDATE
household_invitations household_invitations_select_admin SELECT
household_members household_members_select_self_or_admin SELECT
household_settings household_settings_select_member SELECT
household_settings household_settings_update_admin UPDATE
households households_select_member SELECT
households households_update_admin UPDATE
powerwall_metrics_log powerwall_metrics_log_select_member SELECT
provider_usage_daily provider_usage_daily_select_member SELECT
tariff_levies tariff_levies_delete_writer DELETE
tariff_levies tariff_levies_insert_writer INSERT
tariff_levies tariff_levies_select_member SELECT
tariff_levies tariff_levies_update_writer UPDATE
tariff_overrides tariff_overrides_delete_writer DELETE
tariff_overrides tariff_overrides_insert_writer INSERT
tariff_overrides tariff_overrides_select_member SELECT
tariff_overrides tariff_overrides_update_writer UPDATE
tariff_price_points tariff_price_points_delete_writer DELETE
tariff_price_points tariff_price_points_insert_writer INSERT
tariff_price_points tariff_price_points_select_member SELECT
tariff_price_points tariff_price_points_update_writer UPDATE
tariff_seasons tariff_seasons_delete_writer DELETE
tariff_seasons tariff_seasons_insert_writer INSERT
tariff_seasons tariff_seasons_select_member SELECT
tariff_seasons tariff_seasons_update_writer UPDATE
tariff_slots tariff_slots_delete_writer DELETE
tariff_slots tariff_slots_insert_writer INSERT
tariff_slots tariff_slots_select_member SELECT
tariff_slots tariff_slots_update_writer UPDATE
telemetry_rollups_daily telemetry_rollups_daily_select_member SELECT
telemetry_rollups_hourly telemetry_rollups_hourly_select_member SELECT
telemetry_sync_state telemetry_sync_state_select_member SELECT
user_profiles user_profiles_select_self_or_household_admin SELECT
user_profiles user_profiles_update_self UPDATE
utility_tariffs utility_tariffs_delete_writer DELETE
utility_tariffs utility_tariffs_insert_writer INSERT
utility_tariffs utility_tariffs_select_member SELECT
utility_tariffs utility_tariffs_update_writer UPDATE
```
<!-- policy-manifest:end -->
