-- TEST-ONLY shim. Used by scripts/db-verify.mjs and scripts/db-test.mjs against plain PostgreSQL when a real
-- Supabase stack (Docker + Supabase CLI) is not available. It is NOT a migration, is never applied by
-- `supabase db reset`, and must never run against a real Supabase project.
--
-- It recreates only what the migrations reference that Supabase normally provides:
--   * auth.users (migrations create foreign keys and a trigger on it),
--   * auth.uid() and auth.jwt(), reading the same request.jwt.claim(s) settings Supabase reads,
--   * the roles anon, authenticated, service_role,
--   * Supabase's default behaviour of granting new public tables to those roles (so the lock-down in the
--     migrations is tested against the real default, not an empty one).
-- The real auth.users has more columns; only id, email and email_confirmed_at are needed here.
-- Differences from a real stack are listed in docs/KNOWN_LIMITATIONS.md (L-026).

create schema if not exists auth;
create schema if not exists extensions;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  email_confirmed_at timestamptz,
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

-- Same definitions as Supabase: the subject comes from request.jwt.claim.sub or the request.jwt.claims JSON.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

-- Emulate Supabase's default privileges for objects created by the migration role.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
