-- TASK-03 migration 1/7: extensions, schemas, role type and shared helper functions.
-- Design: docs/DATABASE_DESIGN.md. Safe to re-run (idempotent).
--
-- Rollback notes (manual, development only; never run on a database holding real data):
--   drop function if exists private.lock_down_public_tables(), private.validate_timezone(),
--     private.reject_modification(), private.reject_audit_modification(), private.touch_updated_at();
--   drop type if exists public.role_enum;
--   drop schema if exists private;   -- extensions are left installed

set search_path = public, extensions;

create schema if not exists extensions;
create extension if not exists citext with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Server-only schema for helper and (later) SECURITY DEFINER functions. Not exposed through the API.
create schema if not exists private;
revoke all on schema private from public;
alter default privileges in schema private revoke execute on functions from public;

-- Household roles (D-004, docs/SECURITY_MODEL.md section 2). There is intentionally no default role here:
-- the column using this type never defaults to ADMIN, and new memberships are READ_ONLY by policy (TASK-04).
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'role_enum'
  ) then
    create type public.role_enum as enum ('READ_ONLY', 'READ_WRITE', 'ADMIN');
  end if;
end
$$;

comment on type public.role_enum is
  'Household role. READ_ONLY < READ_WRITE < ADMIN. Authoritative definition: docs/SECURITY_MODEL.md section 2.';

-- IANA timezone validation. A CHECK constraint cannot read pg_timezone_names, so a trigger does it.
-- Accepts names present in pg_timezone_names except the posix/ and right/ aliases.
create or replace function private.validate_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.timezone is not null and (
    new.timezone ~ '^(posix|right)/'
    or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone)
  ) then
    raise exception 'invalid IANA timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end
$$;

-- Append-only guard for event tables. UPDATE is always rejected. DELETE is rejected unless it is part of a
-- foreign-key cascade (trigger depth > 1), so deleting a household, site or command still works while a user
-- or the Worker cannot delete rows directly. Retention deletes are added by TASK-16 through a reviewed function.
create or replace function private.reject_modification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '% is append-only (% rejected)', tg_table_name, tg_op using errcode = '55000';
end
$$;

-- audit_log variant: additionally allows the foreign-key action ON DELETE SET NULL on actor_user_id
-- (so deleting a user keeps the log but removes the link to the person; docs/PRIVACY.md).
create or replace function private.reject_audit_modification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if tg_op = 'UPDATE'
     and pg_trigger_depth() > 1
     and new.actor_user_id is null
     and (to_jsonb(new) - 'actor_user_id') = (to_jsonb(old) - 'actor_user_id') then
    return new;
  end if;
  raise exception 'audit_log is append-only (% rejected)', tg_op using errcode = '55000';
end
$$;

-- Keeps updated_at truthful without relying on every writer to set it.
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

-- Safe default for every table in schema public: row level security enabled and no access for PUBLIC,
-- anon or authenticated. Policies and explicit grants are TASK-04. Called at the end of each migration;
-- service_role is intentionally untouched (it bypasses RLS and is used only by the Worker, D-006).
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
    select c.oid::pg_catalog.regclass as obj, c.relkind
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
          execute pg_catalog.format('revoke all on table %s from %I', r.obj, role_name);
        else
          execute pg_catalog.format('revoke all on sequence %s from %I', r.obj, role_name);
        end if;
      end if;
    end loop;
  end loop;
end
$$;

revoke all on function private.lock_down_public_tables() from public;

-- Supabase grants new public tables to anon/authenticated by default. Remove that default for the role running
-- migrations so a forgotten table is not exposed. (Skipped on plain PostgreSQL where these roles do not exist.)
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
     and exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    alter default privileges in schema public revoke all on tables from anon, authenticated;
    alter default privileges in schema public revoke all on sequences from anon, authenticated;
  end if;
end
$$;
