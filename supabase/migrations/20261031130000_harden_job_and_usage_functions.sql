-- Harden server-only job, lock, and provider usage primitives.
-- Existing migration history is immutable; this migration replaces the TASK-16 functions.

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
declare
  v_worker_id text;
  v_now timestamptz := transaction_timestamp();
begin
  if p_worker_id is null or char_length(btrim(p_worker_id)) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'worker_id must contain 1 to 100 characters';
  end if;
  if p_max is null or p_max not between 1 and 100 then
    raise exception using errcode = '22023', message = 'max must be between 1 and 100';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 1 and 3600 then
    raise exception using errcode = '22023', message = 'lease_seconds must be between 1 and 3600';
  end if;

  v_worker_id := btrim(p_worker_id);

  -- Exhausted jobs are terminal once they become eligible for another attempt.
  update public.scheduled_jobs j
  set state = 'DEAD',
      finished_at = coalesce(j.finished_at, v_now),
      locked_by = null,
      lease_expires_at = null
  where j.attempts >= j.max_attempts
    and (
      (j.state = 'QUEUED' and j.run_at <= v_now)
      or (j.state = 'RUNNING' and (j.lease_expires_at is null or j.lease_expires_at <= v_now))
    );

  return query
  with to_claim as (
    select j.id
    from public.scheduled_jobs j
    where j.attempts < j.max_attempts
      and (
        (j.state = 'QUEUED' and j.run_at <= v_now)
        or (j.state = 'RUNNING' and (j.lease_expires_at is null or j.lease_expires_at <= v_now))
      )
    order by j.run_at asc, j.id asc
    limit p_max
    for update of j skip locked
  )
  update public.scheduled_jobs j
  set state = 'RUNNING',
      attempts = j.attempts + 1,
      locked_by = v_worker_id,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      finished_at = null
  from to_claim c
  where j.id = c.id
  returning j.*;
end;
$$;

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
  v_key text;
  v_owner text;
  v_now timestamptz := transaction_timestamp();
begin
  if p_key is null or char_length(btrim(p_key)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'key must contain 1 to 200 characters';
  end if;
  if p_owner is null or char_length(btrim(p_owner)) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'owner must contain 1 to 100 characters';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 1 and 3600 then
    raise exception using errcode = '22023', message = 'lease_seconds must be between 1 and 3600';
  end if;

  v_key := btrim(p_key);
  v_owner := btrim(p_owner);

  insert into public.job_locks (key, owner, lease_expires_at)
  values (v_key, v_owner, v_now + make_interval(secs => p_lease_seconds))
  on conflict (key) do update
    set owner = excluded.owner,
        lease_expires_at = excluded.lease_expires_at
    where public.job_locks.lease_expires_at <= v_now;

  return found;
end;
$$;

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
  if p_key is null or char_length(btrim(p_key)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'key must contain 1 to 200 characters';
  end if;
  if p_owner is null or char_length(btrim(p_owner)) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'owner must contain 1 to 100 characters';
  end if;

  delete from public.job_locks
  where key = btrim(p_key) and owner = btrim(p_owner);

  return found;
end;
$$;

-- Keep the existing boolean signature for migration re-application compatibility.
-- A true result means the counter row was inserted or updated; budget enforcement is separate.
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
declare
  v_now timestamptz := transaction_timestamp();
begin
  if p_category is null or p_category not in ('DATA', 'COMMAND', 'WAKE', 'STREAM', 'AUTH') then
    raise exception using errcode = '22023', message = 'category is not supported';
  end if;

  insert into public.provider_usage_daily (household_id, usage_day, category, request_count, error_count)
  values (p_household_id, (v_now at time zone 'UTC')::date, p_category, 1, case when p_ok then 0 else 1 end)
  on conflict (household_id, usage_day, category) do update
    set request_count = public.provider_usage_daily.request_count + 1,
        error_count = public.provider_usage_daily.error_count + case when p_ok then 0 else 1 end;

  return found;
end;
$$;

revoke all on function private.claim_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function private.acquire_lock(text, text, integer) from public, anon, authenticated;
revoke all on function private.release_lock(text, text) from public, anon, authenticated;
revoke all on function private.record_provider_call(uuid, text, boolean) from public, anon, authenticated;

grant execute on function private.claim_jobs(text, integer, integer) to service_role;
grant execute on function private.acquire_lock(text, text, integer) to service_role;
grant execute on function private.release_lock(text, text) to service_role;
grant execute on function private.record_provider_call(uuid, text, boolean) to service_role;
