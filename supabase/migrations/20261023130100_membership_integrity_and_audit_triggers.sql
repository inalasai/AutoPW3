-- TASK-04 migration 2/4: integrity triggers and audit triggers.
-- Membership guard (last-admin protection, no self role change, immutable keys), tariff version immutability,
-- append-only TRUNCATE guards, actor stamping, and audit triggers for privileged actions.
-- These triggers apply to EVERY writer, including the Worker's secret key and definer functions, because the
-- database is authoritative (docs/SECURITY_MODEL.md). Safe to re-run (idempotent).
--
-- Not enforced here: session_replication_role = replica (superuser only) disables triggers; that is a platform
-- operator capability and is recorded in docs/KNOWN_LIMITATIONS.md.
--
-- Rollback notes (development only):
--   drop trigger if exists household_members_guard on public.household_members;  (and the other triggers named below)
--   drop function if exists private.guard_membership(), private.audit_membership(), private.guard_tariff_version(),
--     private.audit_tariff_version(), private.audit_settings_changed(), private.audit_command_requested();

set search_path = public, extensions;

-- ---------------------------------------------------------------------------------------------------------------
-- household_members: last-admin protection, no self role change, immutable keys.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.guard_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.household_id <> old.household_id or new.user_id <> old.user_id then
      raise exception 'immutable_key' using errcode = 'P0001';
    end if;
    if new.role = old.role then
      return new;
    end if;
    -- Nobody changes their own role, whatever path they use (defence in depth: the functions check this too).
    if v_uid is not null and old.user_id = v_uid then
      raise exception 'self_change_not_allowed' using errcode = 'P0001';
    end if;
  end if;

  -- Demoting or removing an ADMIN: another ADMIN must remain. The advisory lock serialises membership changes
  -- per household, so two admins demoting each other at the same moment cannot both succeed.
  if old.role = 'ADMIN' and (tg_op = 'DELETE' or new.role <> 'ADMIN') then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('household_members:' || old.household_id::text, 0)
    );
    -- Deleting the household itself cascades to its members; that must not be blocked.
    if tg_op = 'DELETE'
       and not exists (select 1 from public.households h where h.id = old.household_id) then
      return old;
    end if;
    if not exists (
      select 1
      from public.household_members m
      where m.household_id = old.household_id
        and m.role = 'ADMIN'
        and m.user_id <> old.user_id
    ) then
      raise exception 'last_admin_protected' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

revoke all on function private.guard_membership() from public, anon, authenticated;

drop trigger if exists household_members_guard on public.household_members;
create trigger household_members_guard
  before insert or update or delete on public.household_members
  for each row execute function private.guard_membership();

-- Audit membership changes (all writers): member.added, member.role_changed, member.removed.
create or replace function private.audit_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.touch_audit(
      new.household_id, 'member.added', 'user', new.user_id::text,
      pg_catalog.jsonb_build_object('user_id', new.user_id, 'role', new.role)
    );
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      perform private.touch_audit(
        new.household_id, 'member.role_changed', 'user', new.user_id::text,
        pg_catalog.jsonb_build_object('user_id', new.user_id, 'old_role', old.role, 'new_role', new.role)
      );
    end if;
  elsif tg_op = 'DELETE' then
    -- No audit row when the whole household is being deleted (its audit rows are removed with it).
    if exists (select 1 from public.households h where h.id = old.household_id) then
      perform private.touch_audit(
        old.household_id, 'member.removed', 'user', old.user_id::text,
        pg_catalog.jsonb_build_object('user_id', old.user_id, 'role', old.role)
      );
    end if;
  end if;
  return null;
end
$$;

revoke all on function private.audit_membership() from public, anon, authenticated;

drop trigger if exists household_members_audit on public.household_members;
create trigger household_members_audit
  after insert or update or delete on public.household_members
  for each row execute function private.audit_membership();

-- ---------------------------------------------------------------------------------------------------------------
-- utility_tariffs: a version is immutable except its name and the date it stops applying (docs/DATABASE_DESIGN.md
-- 2.4: editing a tariff creates a new row). Audited on creation and deletion.
-- Child rows (slots, levies, price points) are not versioned in the schema; see KNOWN_LIMITATIONS L-031.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.guard_tariff_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (pg_catalog.to_jsonb(new) - 'name' - 'effective_to') is distinct from (pg_catalog.to_jsonb(old) - 'name' - 'effective_to') then
    raise exception 'tariff_version_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

drop trigger if exists utility_tariffs_guard_version on public.utility_tariffs;
create trigger utility_tariffs_guard_version
  before update on public.utility_tariffs
  for each row execute function private.guard_tariff_version();

create or replace function private.audit_tariff_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.touch_audit(
      new.household_id, 'tariff.version_created', 'utility_tariff', new.id::text,
      pg_catalog.jsonb_build_object('tariff_id', new.id, 'tariff_key', new.tariff_key, 'version', new.version)
    );
  elsif exists (select 1 from public.households h where h.id = old.household_id) then
    perform private.touch_audit(
      old.household_id, 'tariff.deleted', 'utility_tariff', old.id::text,
      pg_catalog.jsonb_build_object('tariff_id', old.id, 'tariff_key', old.tariff_key, 'version', old.version)
    );
  end if;
  return null;
end
$$;

revoke all on function private.audit_tariff_version() from public, anon, authenticated;

drop trigger if exists utility_tariffs_audit on public.utility_tariffs;
create trigger utility_tariffs_audit
  after insert or delete on public.utility_tariffs
  for each row execute function private.audit_tariff_version();

-- ---------------------------------------------------------------------------------------------------------------
-- Settings changes and command requests are audited; actor columns are stamped from the JWT.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.audit_settings_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cols constant text[] := array[
    'monthly_spend_cap_usd', 'live_background_interval_minutes', 'live_on_demand_min_interval_seconds',
    'on_demand_monthly_allowance', 'raw_retention_days', 'stale_after_seconds', 'controls_enabled'
  ];
  v_changed text[];
begin
  select coalesce(pg_catalog.array_agg(n.key order by n.key), array[]::text[])
    into v_changed
  from pg_catalog.jsonb_each(pg_catalog.to_jsonb(new)) as n
  where n.key = any (v_cols)
    and (pg_catalog.to_jsonb(old) -> n.key) is distinct from n.value;
  if pg_catalog.cardinality(v_changed) > 0 then
    perform private.touch_audit(
      new.household_id, 'settings.changed', 'household_settings', new.household_id::text,
      pg_catalog.jsonb_build_object('changed', pg_catalog.to_jsonb(v_changed))
    );
  end if;
  return null;
end
$$;

revoke all on function private.audit_settings_changed() from public, anon, authenticated;

drop trigger if exists household_settings_audit on public.household_settings;
create trigger household_settings_audit
  after update on public.household_settings
  for each row execute function private.audit_settings_changed();

drop trigger if exists household_settings_stamp_actor on public.household_settings;
create trigger household_settings_stamp_actor
  before update on public.household_settings
  for each row execute function private.stamp_actor('updated_by');

drop trigger if exists utility_tariffs_stamp_actor on public.utility_tariffs;
create trigger utility_tariffs_stamp_actor
  before insert on public.utility_tariffs
  for each row execute function private.stamp_actor('created_by');

drop trigger if exists automation_rules_stamp_actor_insert on public.automation_rules;
create trigger automation_rules_stamp_actor_insert
  before insert on public.automation_rules
  for each row execute function private.stamp_actor('created_by', 'updated_by');

drop trigger if exists automation_rules_stamp_actor_update on public.automation_rules;
create trigger automation_rules_stamp_actor_update
  before update on public.automation_rules
  for each row execute function private.stamp_actor('updated_by');

drop trigger if exists device_command_log_stamp_actor on public.device_command_log;
create trigger device_command_log_stamp_actor
  before insert on public.device_command_log
  for each row execute function private.stamp_actor('requested_by');

create or replace function private.audit_command_requested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.touch_audit(
    new.household_id, 'command.requested', 'device_command', new.id::text,
    pg_catalog.jsonb_build_object(
      'command_id', new.id, 'kind', new.kind, 'origin', new.origin, 'provider_mode', new.provider_mode
    )
  );
  return null;
end
$$;

revoke all on function private.audit_command_requested() from public, anon, authenticated;

drop trigger if exists device_command_log_audit on public.device_command_log;
create trigger device_command_log_audit
  after insert on public.device_command_log
  for each row execute function private.audit_command_requested();

-- ---------------------------------------------------------------------------------------------------------------
-- Append-only tables: TRUNCATE is rejected too, and the server role loses UPDATE, DELETE and TRUNCATE on them.
-- (Foreign-key cascades run as the table owner and are unaffected; see private.reject_modification.)
-- ---------------------------------------------------------------------------------------------------------------
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.reject_truncate();

drop trigger if exists device_command_events_no_truncate on public.device_command_events;
create trigger device_command_events_no_truncate
  before truncate on public.device_command_events
  for each statement execute function private.reject_truncate();

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    revoke update, delete, truncate on public.audit_log from service_role;
    revoke update, delete, truncate on public.device_command_events from service_role;
  end if;
end
$$;
