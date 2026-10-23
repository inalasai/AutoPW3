-- TASK-04 migration 1/4: security helpers.
-- Membership helpers used by RLS policies, the allowlisted audit writer, trigger helpers and the revised
-- lock-down function. Safe to re-run (idempotent). Policies and grants are in migration 4/4.
--
-- Every SECURITY DEFINER function here has: SET search_path = '', schema-qualified references,
-- EXECUTE revoked from PUBLIC and anon, and an explicit grant only to the roles that need it.
-- Definer functions run as the migration owner, which bypasses RLS because FORCE ROW LEVEL SECURITY is NOT used
-- (decision D-031). The owner role is not reachable through the API.
--
-- Rollback notes (development only; never run on a database holding real data):
--   drop function if exists private.is_member(uuid), private.has_role_at_least(uuid, public.role_enum),
--     private.touch_audit(uuid, text, text, text, jsonb), private.stamp_actor(), private.reject_truncate();
--   -- private.lock_down_public_tables() is redefined here; migration 1/7 restores the original on re-apply.

set search_path = public, extensions;

create extension if not exists pgcrypto with schema extensions;

-- Schema usage: authenticated needs it to evaluate policy expressions that call the two helpers below;
-- service_role needs it to call server-only functions such as private.bootstrap_first_admin.
-- anon gets nothing. Functions in private stay unusable unless granted individually.
grant usage on schema private to authenticated, service_role;

-- Functions created before this migration (the TASK-03 trigger helpers) still carry PostgreSQL's default
-- EXECUTE-for-PUBLIC. Now that authenticated may use schema private, close that: no role gets EXECUTE on a private
-- function unless granted below or in a later migration.
revoke all on all functions in schema private from public, anon, authenticated;

-- Future functions are not executable by PUBLIC unless granted. (Existing functions are fixed explicitly below.)
alter default privileges revoke execute on functions from public;
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
     and exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    alter default privileges in schema public revoke execute on functions from anon, authenticated;
  end if;
end
$$;

-- Is the signed-in user a member of the household? False when there is no signed-in user (anon).
create or replace function private.is_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = p_household_id
      and m.user_id = (select auth.uid())
  );
$$;

-- Does the signed-in user hold at least the given role in the household? Enum order is
-- READ_ONLY < READ_WRITE < ADMIN, so a plain comparison is correct.
create or replace function private.has_role_at_least(p_household_id uuid, p_min_role public.role_enum)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = p_household_id
      and m.user_id = (select auth.uid())
      and m.role >= p_min_role
  );
$$;

revoke all on function private.is_member(uuid) from public, anon;
revoke all on function private.has_role_at_least(uuid, public.role_enum) from public, anon;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_role_at_least(uuid, public.role_enum) to authenticated;

-- Allowlisted audit writer. Callers pass a metadata object; only the keys listed for the action survive, so a
-- careless caller cannot put a token, JWT or telemetry value into the log. Unknown actions are rejected.
-- The actor is whoever holds the JWT in this transaction; no JWT means SYSTEM.
create or replace function private.touch_audit(
  p_household_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_allowed text[];
  v_clean jsonb;
begin
  v_allowed := case p_action
    when 'member.added' then array['user_id', 'role']
    when 'member.role_changed' then array['user_id', 'old_role', 'new_role']
    when 'member.removed' then array['user_id', 'role']
    when 'invitation.created' then array['invitation_id', 'role', 'email_bound', 'expires_at']
    when 'invitation.accepted' then array['invitation_id', 'role']
    when 'invitation.revoked' then array['invitation_id']
    when 'bootstrap.completed' then array['household_id']
    when 'rule.mode_changed' then array['rule_id', 'old_mode', 'new_mode']
    when 'automation.paused' then array[]::text[]
    when 'automation.resumed' then array[]::text[]
    when 'settings.changed' then array['changed']
    when 'command.requested' then array['command_id', 'kind', 'origin', 'provider_mode']
    when 'tariff.version_created' then array['tariff_id', 'tariff_key', 'version']
    when 'tariff.deleted' then array['tariff_id', 'tariff_key', 'version']
    else null
  end;
  if v_allowed is null then
    raise exception 'unknown audit action: %', p_action using errcode = '22023';
  end if;

  select coalesce(pg_catalog.jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into v_clean
  from pg_catalog.jsonb_each(coalesce(p_metadata, '{}'::jsonb)) as e
  where e.key = any (v_allowed);

  insert into public.audit_log (household_id, actor_type, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_household_id,
    case when v_uid is null then 'SYSTEM' else 'USER' end,
    v_uid,
    p_action,
    p_target_type,
    p_target_id,
    v_clean
  );
end
$$;

revoke all on function private.touch_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Stamps the acting user into the named columns (trigger arguments) when a JWT is present, so created_by,
-- updated_by and requested_by cannot be spoofed by the caller. Without a JWT (Worker secret key, migrations)
-- the values supplied by the caller are kept.
create or replace function private.stamp_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row jsonb;
  v_col text;
begin
  if v_uid is null then
    return new;
  end if;
  v_row := pg_catalog.to_jsonb(new);
  foreach v_col in array tg_argv loop
    v_row := pg_catalog.jsonb_set(v_row, array[v_col], pg_catalog.to_jsonb(v_uid));
  end loop;
  new := pg_catalog.jsonb_populate_record(new, v_row);
  return new;
end
$$;

-- TRUNCATE does not fire row triggers, so append-only tables get a statement trigger as well.
create or replace function private.reject_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only (TRUNCATE rejected)', tg_table_name using errcode = '55000';
end
$$;

-- Revised lock-down (replaces the TASK-03 version). Called at the end of every migration that creates tables.
-- Always: row level security on, nothing for PUBLIC or anon. For authenticated: revoke everything on tables that
-- have NO policy yet, so a new table is closed until its migration adds policies and explicit grants, while the
-- deliberate exposures made by migration 4/4 are kept when a later migration calls this function again.
create or replace function private.lock_down_public_tables()
returns void
language plpgsql
set search_path = ''
as $$
declare
  r record;
  role_name text;
begin
  for r in
    select c.oid as oid, c.oid::pg_catalog.regclass as obj, c.relkind
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'S')
  loop
    if r.relkind in ('r', 'p') then
      execute pg_catalog.format('alter table %s enable row level security', r.obj);
      execute pg_catalog.format('revoke all on table %s from public', r.obj);
    else
      execute pg_catalog.format('revoke all on sequence %s from public', r.obj);
    end if;
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_catalog.pg_roles where rolname = role_name) then
        if r.relkind in ('r', 'p') then
          if role_name = 'anon'
             or not exists (select 1 from pg_catalog.pg_policy p where p.polrelid = r.oid) then
            execute pg_catalog.format('revoke all on table %s from %I', r.obj, role_name);
          end if;
        else
          execute pg_catalog.format('revoke all on sequence %s from %I', r.obj, role_name);
        end if;
      end if;
    end loop;
  end loop;
end
$$;

revoke all on function private.lock_down_public_tables() from public, anon, authenticated;
