-- TEST-ONLY shim. Used by scripts/db-verify.mjs against plain PostgreSQL when a real Supabase stack
-- (Docker + Supabase CLI) is not available. It is NOT a migration, is never applied by `supabase db reset`,
-- and must never run against a real Supabase project.
--
-- It recreates only what the migrations reference that Supabase normally provides:
--   * auth.users (migrations create foreign keys to it),
--   * the roles anon, authenticated, service_role,
--   * Supabase's default behaviour of granting new public tables to those roles (so the lock-down in the
--     migrations is tested against the real default, not an empty one).
-- The real Supabase auth.users has more columns; only id and email are needed here.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to service_role;

-- Emulate Supabase's default privileges for objects created by the migration role.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
