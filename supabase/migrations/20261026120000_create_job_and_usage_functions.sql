-- TASK-16 migration: job claiming, lease lock management, and provider usage tracking functions.
-- Design: docs/DATABASE_DESIGN.md section 3 & 4.
-- Server-only functions: callable by service_role, revoked from public, anon, and authenticated.
-- Safe to re-run (idempotent).

set search_path = public, extensions;

-- 1. claim_jobs: atomic job claiming with FOR UPDATE SKIP LOCKED
create or replace function private.claim_jobs(
  p_worker_id text,
  p_max integer,
  p_lease_seconds integer default 60
)
returns setof public.scheduled_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with to_claim as (
    select id
    from public.scheduled_jobs
    where (state = 'QUEUED' and run_at <= now())
       or (state = 'RUNNING' and lease_expires_at < now())
    order by run_at asc
    limit p_max
    for update skip locked
  )
  update public.scheduled_jobs j
  set state = 'RUNNING',
      attempts = j.attempts + 1,
      locked_by = p_worker_id,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval
  from to_claim c
  where j.id = c.id
  returning j.*;
end;
$$;

-- 2. acquire_lock: atomic short lease lock
create or replace function private.acquire_lock(
  p_key text,
  p_owner text,
  p_lease_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz := now() + (p_lease_seconds || ' seconds')::interval;
begin
  insert into public.job_locks (key, owner, lease_expires_at)
  values (p_key, p_owner, v_expires)
  on conflict (key) do update
    set owner = p_owner,
        lease_expires_at = v_expires
    where public.job_locks.lease_expires_at < now();

  return found;
end;
$$;

-- 3. release_lock: release named lock if owned
create or replace function private.release_lock(
  p_key text,
  p_owner text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.job_locks
  where key = p_key and owner = p_owner;

  return found;
end;
$$;

-- 4. record_provider_call: atomic counter for provider usage
create or replace function private.record_provider_call(
  p_household_id uuid,
  p_category text,
  p_ok boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.provider_usage_daily (household_id, usage_day, category, request_count, error_count)
  values (p_household_id, (now() at time zone 'UTC')::date, p_category, 1, case when p_ok then 0 else 1 end)
  on conflict (household_id, usage_day, category) do update
    set request_count = public.provider_usage_daily.request_count + 1,
        error_count = public.provider_usage_daily.error_count + case when p_ok then 0 else 1 end;

  return true;
end;
$$;

-- Revoke execute from public/anon/authenticated and grant to service_role
revoke all on function private.claim_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function private.acquire_lock(text, text, integer) from public, anon, authenticated;
revoke all on function private.release_lock(text, text) from public, anon, authenticated;
revoke all on function private.record_provider_call(uuid, text, boolean) from public, anon, authenticated;

grant execute on function private.claim_jobs(text, integer, integer) to service_role;
grant execute on function private.acquire_lock(text, text, integer) to service_role;
grant execute on function private.release_lock(text, text) to service_role;
grant execute on function private.record_provider_call(uuid, text, boolean) to service_role;
