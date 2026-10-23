-- TASK-04 migration 4/4: row level security policies and explicit grants.
-- This file implements docs/RLS_POLICY_MATRIX.md exactly; the manifest at the end of that document is compared with
-- pg_policies by `npm run db:test`. Safe to re-run (idempotent: policies are dropped and recreated, grants repeat).
--
-- Model:
--   * anon: nothing on any table (anon has no policy and no grant anywhere).
--   * authenticated: SELECT where the user is a member (RLS filters rows); writes only where the role allows and
--     only on the columns granted here. Everything privileged (role changes, invitations, rule activation, pause,
--     bootstrap) goes through the SECURITY DEFINER functions from migration 3/4, never through table writes.
--   * service_role (Worker secret key): bypasses RLS and keeps its default table privileges, except UPDATE, DELETE and
--     TRUNCATE on the append-only tables (migration 2/4). Used only for the cases S1-S9 in docs/SECURITY_MODEL.md.
--   * Server-only tables have RLS on, NO policy and NO grant for authenticated or anon:
--     tesla_credentials, oauth_states, system_bootstrap, job_locks, scheduled_jobs.
--
-- Rollback notes (development only): drop every policy named in docs/RLS_POLICY_MATRIX.md and
--   `revoke all on <table> from authenticated`; migration 1/7 .. 7/7 plus private.lock_down_public_tables()
--   return the schema to deny-all.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------------------------------------------
-- Identity and tenancy
-- ---------------------------------------------------------------------------------------------------------------
-- user_profiles: own row; an ADMIN also sees profiles of the people in their household (visible through the
-- household_members policy below). No insert or delete: the auth trigger creates the row, cascade deletes it.
grant select on public.user_profiles to authenticated;
grant update (display_name, locale) on public.user_profiles to authenticated;

drop policy if exists user_profiles_select_self_or_household_admin on public.user_profiles;
create policy user_profiles_select_self_or_household_admin on public.user_profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.household_members m where m.user_id = user_profiles.user_id)
  );

drop policy if exists user_profiles_update_self on public.user_profiles;
create policy user_profiles_update_self on public.user_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- households: members read; ADMIN edits name and timezone. Households are created only by the bootstrap
-- function in v1, and deleted only by a future audited function (L-032).
grant select on public.households to authenticated;
grant update (name, timezone) on public.households to authenticated;

drop policy if exists households_select_member on public.households;
create policy households_select_member on public.households
  for select to authenticated
  using (private.is_member(id));

drop policy if exists households_update_admin on public.households;
create policy households_update_admin on public.households
  for update to authenticated
  using (private.has_role_at_least(id, 'ADMIN'))
  with check (private.has_role_at_least(id, 'ADMIN'));

-- household_members: read-only for the API. A member sees their own row (their role); an ADMIN sees the household.
-- There is no write grant: changes go through change_member_role, remove_member, leave_household,
-- accept_invitation and the bootstrap, all of which pass the guard trigger.
grant select on public.household_members to authenticated;

drop policy if exists household_members_select_self_or_admin on public.household_members;
create policy household_members_select_self_or_admin on public.household_members
  for select to authenticated
  using (user_id = (select auth.uid()) or private.has_role_at_least(household_id, 'ADMIN'));

-- household_invitations: ADMIN reads the list, never the token hash (column grant). Writes only via functions.
grant select (id, household_id, email, role, expires_at, accepted_at, accepted_by, revoked_at, created_by, created_at)
  on public.household_invitations to authenticated;

drop policy if exists household_invitations_select_admin on public.household_invitations;
create policy household_invitations_select_admin on public.household_invitations
  for select to authenticated
  using (private.has_role_at_least(household_id, 'ADMIN'));

-- household_settings: members read; ADMIN edits budget, retention, polling and the controls switch.
-- automation_paused, paused_by and paused_at change only through set_automation_paused.
grant select on public.household_settings to authenticated;
grant update (
  monthly_spend_cap_usd, live_background_interval_minutes, live_on_demand_min_interval_seconds,
  on_demand_monthly_allowance, raw_retention_days, stale_after_seconds, controls_enabled
) on public.household_settings to authenticated;

drop policy if exists household_settings_select_member on public.household_settings;
create policy household_settings_select_member on public.household_settings
  for select to authenticated
  using (private.is_member(household_id));

drop policy if exists household_settings_update_admin on public.household_settings;
create policy household_settings_update_admin on public.household_settings
  for update to authenticated
  using (private.has_role_at_least(household_id, 'ADMIN'))
  with check (private.has_role_at_least(household_id, 'ADMIN'));

-- ---------------------------------------------------------------------------------------------------------------
-- Sites and usage
-- ---------------------------------------------------------------------------------------------------------------
-- energy_sites: members read; ADMIN connects, renames and disconnects. connection_state and capabilities_snapshot
-- are written by the Worker only (not in the column grants).
grant select on public.energy_sites to authenticated;
grant insert (household_id, provider, provider_site_id, name, timezone) on public.energy_sites to authenticated;
grant update (name, timezone) on public.energy_sites to authenticated;
grant delete on public.energy_sites to authenticated;

drop policy if exists energy_sites_select_member on public.energy_sites;
create policy energy_sites_select_member on public.energy_sites
  for select to authenticated
  using (private.is_member(household_id));

drop policy if exists energy_sites_insert_admin on public.energy_sites;
create policy energy_sites_insert_admin on public.energy_sites
  for insert to authenticated
  with check (private.has_role_at_least(household_id, 'ADMIN'));

drop policy if exists energy_sites_update_admin on public.energy_sites;
create policy energy_sites_update_admin on public.energy_sites
  for update to authenticated
  using (private.has_role_at_least(household_id, 'ADMIN'))
  with check (private.has_role_at_least(household_id, 'ADMIN'));

drop policy if exists energy_sites_delete_admin on public.energy_sites;
create policy energy_sites_delete_admin on public.energy_sites
  for delete to authenticated
  using (private.has_role_at_least(household_id, 'ADMIN'));

-- provider_usage_daily: members read (the stale/budget banner needs it); only the Worker writes.
grant select on public.provider_usage_daily to authenticated;

drop policy if exists provider_usage_daily_select_member on public.provider_usage_daily;
create policy provider_usage_daily_select_member on public.provider_usage_daily
  for select to authenticated
  using (private.is_member(household_id));

-- ---------------------------------------------------------------------------------------------------------------
-- Telemetry and cost cache: members read through the site's household; ingestion is service-role only.
-- No INSERT, UPDATE or DELETE grant exists for authenticated, so demo or user-written telemetry cannot enter.
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'powerwall_metrics_log', 'energy_intervals', 'telemetry_rollups_hourly', 'telemetry_rollups_daily',
    'telemetry_sync_state', 'cost_rollups_daily', 'automation_executions'
  ] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         exists (select 1 from public.energy_sites s where s.id = %I.site_id and private.is_member(s.household_id)))',
      t || '_select_member', t, t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Tariffs: members read; READ_WRITE and ADMIN create, edit and delete. A tariff version is immutable except
-- name and effective_to (trigger in migration 2/4).
-- ---------------------------------------------------------------------------------------------------------------
grant select, insert, update, delete on public.utility_tariffs to authenticated;

drop policy if exists utility_tariffs_select_member on public.utility_tariffs;
create policy utility_tariffs_select_member on public.utility_tariffs
  for select to authenticated
  using (private.is_member(household_id));

drop policy if exists utility_tariffs_insert_writer on public.utility_tariffs;
create policy utility_tariffs_insert_writer on public.utility_tariffs
  for insert to authenticated
  with check (private.has_role_at_least(household_id, 'READ_WRITE'));

drop policy if exists utility_tariffs_update_writer on public.utility_tariffs;
create policy utility_tariffs_update_writer on public.utility_tariffs
  for update to authenticated
  using (private.has_role_at_least(household_id, 'READ_WRITE'))
  with check (private.has_role_at_least(household_id, 'READ_WRITE'));

drop policy if exists utility_tariffs_delete_writer on public.utility_tariffs;
create policy utility_tariffs_delete_writer on public.utility_tariffs
  for delete to authenticated
  using (private.has_role_at_least(household_id, 'READ_WRITE'));

do $$
declare
  t text;
begin
  foreach t in array array[
    'tariff_seasons', 'tariff_overrides', 'tariff_slots', 'tariff_levies', 'tariff_price_points'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         exists (select 1 from public.utility_tariffs u where u.id = %I.tariff_id and private.is_member(u.household_id)))',
      t || '_select_member', t, t
    );

    execute format('drop policy if exists %I on public.%I', t || '_insert_writer', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (
         exists (select 1 from public.utility_tariffs u where u.id = %I.tariff_id and private.has_role_at_least(u.household_id, ''READ_WRITE'')))',
      t || '_insert_writer', t, t
    );

    execute format('drop policy if exists %I on public.%I', t || '_update_writer', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (
         exists (select 1 from public.utility_tariffs u where u.id = %I.tariff_id and private.has_role_at_least(u.household_id, ''READ_WRITE'')))
       with check (
         exists (select 1 from public.utility_tariffs u where u.id = %I.tariff_id and private.has_role_at_least(u.household_id, ''READ_WRITE'')))',
      t || '_update_writer', t, t, t
    );

    execute format('drop policy if exists %I on public.%I', t || '_delete_writer', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (
         exists (select 1 from public.utility_tariffs u where u.id = %I.tariff_id and private.has_role_at_least(u.household_id, ''READ_WRITE'')))',
      t || '_delete_writer', t, t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Automation rules: members read; READ_WRITE and ADMIN create and edit rules that are DISABLED or DRY_RUN.
-- The mode column is not writable directly: set_rule_mode is the only path, and only an ADMIN can reach ACTIVE.
-- An ACTIVE rule cannot be edited or deleted directly; move it out of ACTIVE first (audited).
-- ---------------------------------------------------------------------------------------------------------------
grant select on public.automation_rules to authenticated;
grant insert (household_id, site_id, name, mode, priority, definition, definition_version)
  on public.automation_rules to authenticated;
grant update (name, priority, definition, definition_version, version) on public.automation_rules to authenticated;
grant delete on public.automation_rules to authenticated;

drop policy if exists automation_rules_select_member on public.automation_rules;
create policy automation_rules_select_member on public.automation_rules
  for select to authenticated
  using (private.is_member(household_id));

drop policy if exists automation_rules_insert_writer on public.automation_rules;
create policy automation_rules_insert_writer on public.automation_rules
  for insert to authenticated
  with check (private.has_role_at_least(household_id, 'READ_WRITE') and mode in ('DISABLED', 'DRY_RUN'));

drop policy if exists automation_rules_update_writer on public.automation_rules;
create policy automation_rules_update_writer on public.automation_rules
  for update to authenticated
  using (private.has_role_at_least(household_id, 'READ_WRITE') and mode <> 'ACTIVE')
  with check (private.has_role_at_least(household_id, 'READ_WRITE') and mode <> 'ACTIVE');

drop policy if exists automation_rules_delete_writer on public.automation_rules;
create policy automation_rules_delete_writer on public.automation_rules
  for delete to authenticated
  using (private.has_role_at_least(household_id, 'READ_WRITE') and mode <> 'ACTIVE');

-- ---------------------------------------------------------------------------------------------------------------
-- Device commands: READ_WRITE and ADMIN insert the intent row (user-scoped, D-015) in its initial state only.
-- The lifecycle (state, phase, result) is written by the Worker with the secret key (S5). A command in TESLA mode
-- needs controls_enabled; MOCK mode does not.
-- ---------------------------------------------------------------------------------------------------------------
grant select on public.device_command_log to authenticated;
grant insert (household_id, site_id, origin, kind, params, params_hash, idempotency_key, provider_mode)
  on public.device_command_log to authenticated;

drop policy if exists device_command_log_select_member on public.device_command_log;
create policy device_command_log_select_member on public.device_command_log
  for select to authenticated
  using (private.is_member(household_id));

drop policy if exists device_command_log_insert_writer on public.device_command_log;
create policy device_command_log_insert_writer on public.device_command_log
  for insert to authenticated
  with check (
    private.has_role_at_least(household_id, 'READ_WRITE')
    and origin = 'USER'
    and state = 'PENDING'
    and phase = 'RECORDED'
    and automation_execution_id is null
    and dispatched_at is null
    and finished_at is null
    and error_code is null
    and provider_http_status is null
    and result is null
    and (
      provider_mode = 'MOCK'
      or exists (
        select 1 from public.household_settings s
        where s.household_id = device_command_log.household_id and s.controls_enabled
      )
    )
  );

grant select on public.device_command_events to authenticated;

drop policy if exists device_command_events_select_member on public.device_command_events;
create policy device_command_events_select_member on public.device_command_events
  for select to authenticated
  using (
    exists (
      select 1 from public.device_command_log c
      where c.id = device_command_events.command_id and private.is_member(c.household_id)
    )
  );

-- ---------------------------------------------------------------------------------------------------------------
-- Audit log: ADMIN reads their household's trail. Nobody writes through the API.
-- ---------------------------------------------------------------------------------------------------------------
grant select on public.audit_log to authenticated;

drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using (household_id is not null and private.has_role_at_least(household_id, 'ADMIN'));

-- ---------------------------------------------------------------------------------------------------------------
-- Server-only tables: nothing for authenticated or anon, and no policy. Stated explicitly so a later change that
-- adds a grant or policy here is a visible diff (and fails the tests).
-- ---------------------------------------------------------------------------------------------------------------
revoke all on public.tesla_credentials, public.oauth_states, public.system_bootstrap,
  public.job_locks, public.scheduled_jobs from public, anon, authenticated;
