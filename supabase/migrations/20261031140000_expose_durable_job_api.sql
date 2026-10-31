-- Narrow PostgREST entry points for the Worker durable queue.
-- The private schema remains unexposed; every public wrapper is service_role-only.

create table if not exists public.worker_rate_limit_buckets (
  key_hash bytea primary key check (octet_length(key_hash) = 32),
  window_started_at timestamptz not null,
  hit_count integer not null check (hit_count >= 1),
  expires_at timestamptz not null
);

create or replace function public.worker_enqueue_job(
  p_kind text,
  p_household_id uuid,
  p_site_id uuid,
  p_dedupe_key text,
  p_run_at timestamptz,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts integer default 5
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_kind is null or p_kind not in (
    'token_maintenance', 'sync_live', 'sync_history', 'rollup', 'retention',
    'evaluate_rules', 'reconcile_command', 'reencrypt_credentials'
  ) then
    raise exception using errcode = '22023', message = 'unsupported job kind';
  end if;
  if p_dedupe_key is null or char_length(btrim(p_dedupe_key)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'invalid dedupe key';
  end if;
  if p_run_at is null or p_payload is null or p_payload <> '{}'::jsonb
     or p_max_attempts is null or p_max_attempts not between 1 and 20 then
    raise exception using errcode = '22023', message = 'invalid job parameters or payload';
  end if;

  if p_kind in ('sync_live', 'sync_history', 'rollup', 'evaluate_rules', 'reconcile_command') then
    if p_household_id is null or p_site_id is null or not exists (
      select 1 from public.energy_sites s
      where s.id = p_site_id and s.household_id = p_household_id and s.provider = 'TESLA'
    ) then
      raise exception using errcode = '22023', message = 'site does not belong to household';
    end if;
  elsif p_site_id is not null or p_household_id is null then
    raise exception using errcode = '22023', message = 'job requires household scope only';
  elsif not exists (select 1 from public.households h where h.id = p_household_id) then
    raise exception using errcode = '22023', message = 'household does not exist';
  end if;

  insert into public.scheduled_jobs (kind, household_id, site_id, dedupe_key, run_at, payload, max_attempts)
  values (p_kind, p_household_id, p_site_id, btrim(p_dedupe_key), p_run_at, p_payload, p_max_attempts)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.worker_schedule_due_jobs(
  p_now timestamptz default transaction_timestamp(),
  p_max_sites integer default 100,
  p_max_households integer default 100
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
  v_count integer := 0;
  v_total integer := 0;
  v_offset integer := 0;
begin
  if p_now is null or p_max_sites is null or p_max_sites not between 1 and 100
     or p_max_households is null or p_max_households not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid scheduling bounds';
  end if;

  with expired_buckets as (
    select b.key_hash from public.worker_rate_limit_buckets b
     where b.expires_at <= p_now
     order by b.expires_at
     limit 500
  )
  delete from public.worker_rate_limit_buckets b
   using expired_buckets e where b.key_hash = e.key_hash;

  -- Token jobs are enqueued only for active credentials near expiry. The ciphertext is never selected.
  select count(*) into v_total from public.tesla_credentials c
   where c.status = 'ACTIVE' and c.access_expires_at <= p_now + interval '1 hour';
  v_offset := (floor(extract(epoch from p_now) / 300)::bigint %
    greatest(1, ceil(v_total::numeric / p_max_households)::integer))::integer * p_max_households;

  with due as (
    select c.household_id
      from public.tesla_credentials c
     where c.status = 'ACTIVE' and c.access_expires_at <= p_now + interval '1 hour'
     order by c.access_expires_at, c.household_id
     offset v_offset
     limit p_max_households
  ), added as (
    insert into public.scheduled_jobs (kind, household_id, dedupe_key, run_at)
    select 'token_maintenance', d.household_id,
           'token_maintenance:household:' || d.household_id::text || ':' ||
             floor(extract(epoch from p_now) / 3600)::bigint::text,
           p_now
      from due d
    on conflict (dedupe_key) do nothing
    returning 1
  ) select count(*) into v_count from added;
  v_inserted := v_inserted + v_count;

  -- Per-site recurring work is bounded and uses household + site keys; tenant association is read from the DB.
  select count(*) into v_total from public.energy_sites s
   where s.provider = 'TESLA' and s.connection_state in ('LIVE', 'STALE');
  v_offset := (floor(extract(epoch from p_now) / 300)::bigint %
    greatest(1, ceil(v_total::numeric / p_max_sites)::integer))::integer * p_max_sites;

  with targets as (
    select s.id as site_id, s.household_id,
           coalesce(hs.live_background_interval_minutes, 30) as live_minutes
      from public.energy_sites s
      left join public.household_settings hs on hs.household_id = s.household_id
     where s.provider = 'TESLA' and s.connection_state in ('LIVE', 'STALE')
     order by s.id
     offset v_offset
     limit p_max_sites
  ), scheduled as (
    select 'sync_live'::text as kind, t.household_id, t.site_id,
           'sync_live:site:' || t.site_id::text || ':' ||
             floor(extract(epoch from p_now) / (t.live_minutes * 60))::bigint::text as dedupe_key
      from targets t
    union all
    select 'sync_history', t.household_id, t.site_id,
           'sync_history:site:' || t.site_id::text || ':' ||
             floor(extract(epoch from p_now) / 21600)::bigint::text
      from targets t
    union all
    select 'rollup', t.household_id, t.site_id,
           'rollup:site:' || t.site_id::text || ':' ||
             floor(extract(epoch from p_now) / 86400)::bigint::text
      from targets t
    union all
    select 'evaluate_rules', t.household_id, t.site_id,
           'evaluate_rules:site:' || t.site_id::text || ':' ||
             floor(extract(epoch from p_now) / 300)::bigint::text
      from targets t
  ), added as (
    insert into public.scheduled_jobs (kind, household_id, site_id, dedupe_key, run_at)
    select kind, household_id, site_id, dedupe_key, p_now from scheduled
    on conflict (dedupe_key) do nothing
    returning 1
  ) select count(*) into v_count from added;
  v_inserted := v_inserted + v_count;

  -- Retention remains household-scoped so handlers can apply each household's own retention policy.
  select count(*) into v_total from public.households;
  v_offset := (floor(extract(epoch from p_now) / 300)::bigint %
    greatest(1, ceil(v_total::numeric / p_max_households)::integer))::integer * p_max_households;

  with due as (
    select h.id as household_id from public.households h
     order by h.id offset v_offset limit p_max_households
  ), added as (
    insert into public.scheduled_jobs (kind, household_id, dedupe_key, run_at)
    select 'retention', d.household_id,
           'retention:household:' || d.household_id::text || ':' ||
             floor(extract(epoch from p_now) / 86400)::bigint::text,
           p_now
      from due d
    on conflict (dedupe_key) do nothing
    returning 1
  ) select count(*) into v_count from added;
  v_inserted := v_inserted + v_count;

  -- Reconciliation is scheduled only where a command is actually unresolved.
  select count(*) into v_total from (
    select distinct c.site_id
      from public.device_command_log c
     where c.state in ('PENDING', 'UNKNOWN') and c.requested_at <= p_now - interval '2 minutes'
  ) unresolved;
  v_offset := (floor(extract(epoch from p_now) / 60)::bigint %
    greatest(1, ceil(v_total::numeric / p_max_sites)::integer))::integer * p_max_sites;

  with due as (
    select distinct c.household_id, c.site_id
      from public.device_command_log c
     where c.state in ('PENDING', 'UNKNOWN') and c.requested_at <= p_now - interval '2 minutes'
     order by c.site_id
     offset v_offset
     limit p_max_sites
  ), added as (
    insert into public.scheduled_jobs (kind, household_id, site_id, dedupe_key, run_at)
    select 'reconcile_command', d.household_id, d.site_id,
           'reconcile_command:site:' || d.site_id::text || ':' ||
             floor(extract(epoch from p_now) / 60)::bigint::text,
           p_now
      from due d
    on conflict (dedupe_key) do nothing
    returning 1
  ) select count(*) into v_count from added;
  v_inserted := v_inserted + v_count;

  return v_inserted;
end;
$$;

create or replace function public.worker_claim_jobs(
  p_worker_id text,
  p_max integer,
  p_lease_seconds integer default 60
)
returns setof public.scheduled_jobs
language sql
security definer
set search_path = ''
as $$
  select * from private.claim_jobs(p_worker_id, p_max, p_lease_seconds)
$$;

create or replace function public.worker_finish_job(p_job_id uuid, p_worker_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.scheduled_jobs
     set state = 'DONE', finished_at = transaction_timestamp(),
         locked_by = null, lease_expires_at = null, last_error = null
   where id = p_job_id and state = 'RUNNING' and locked_by = p_worker_id;
  return found;
end;
$$;

create or replace function public.worker_fail_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_retry_delay_seconds integer default 60,
  p_permanent boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.scheduled_jobs%rowtype;
  v_state text;
begin
  if p_error_code is null or p_error_code !~ '^[A-Z0-9_]{1,64}$'
     or p_retry_delay_seconds is null or p_retry_delay_seconds not between 1 and 86400
     or p_permanent is null then
    raise exception using errcode = '22023', message = 'invalid failure metadata';
  end if;

  select * into v_job from public.scheduled_jobs
   where id = p_job_id and state = 'RUNNING' and locked_by = p_worker_id
   for update;
  if not found then
    return null;
  end if;

  v_state := case when p_permanent or v_job.attempts >= v_job.max_attempts then 'DEAD' else 'QUEUED' end;
  update public.scheduled_jobs
     set state = v_state,
         run_at = case when v_state = 'QUEUED'
                       then transaction_timestamp() + make_interval(secs => p_retry_delay_seconds)
                       else run_at end,
         finished_at = case when v_state = 'DEAD' then transaction_timestamp() else null end,
         locked_by = null, lease_expires_at = null, last_error = p_error_code
   where id = p_job_id;
  return v_state;
end;
$$;

create or replace function public.worker_acquire_lock(p_key text, p_owner text, p_lease_seconds integer default 60)
returns boolean
language sql
security definer
set search_path = ''
as $$ select private.acquire_lock(p_key, p_owner, p_lease_seconds) $$;

create or replace function public.worker_release_lock(p_key text, p_owner text)
returns boolean
language sql
security definer
set search_path = ''
as $$ select private.release_lock(p_key, p_owner) $$;

create or replace function public.worker_record_provider_call(p_household_id uuid, p_category text, p_ok boolean default true)
returns boolean
language sql
security definer
set search_path = ''
as $$ select private.record_provider_call(p_household_id, p_category, p_ok) $$;

create or replace function public.worker_save_tesla_credentials(
  p_household_id uuid,
  p_key_id text,
  p_nonce bytea,
  p_ciphertext bytea,
  p_version integer,
  p_scopes text[],
  p_fleet_api_base_url text,
  p_access_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_household_id is null or p_key_id is null or char_length(p_key_id) not between 1 and 64
     or p_nonce is null or octet_length(p_nonce) <> 12 or p_ciphertext is null or octet_length(p_ciphertext) <= 16
     or p_version is null or p_version < 1 or p_scopes is null
     or p_fleet_api_base_url is null or p_fleet_api_base_url !~ '^https://'
     or p_access_expires_at is null then
    raise exception using errcode = '22023', message = 'invalid encrypted credential record';
  end if;

  insert into public.tesla_credentials
    (household_id, key_id, nonce, ciphertext, version, scopes, fleet_api_base_url, status, access_expires_at)
  values
    (p_household_id, p_key_id, p_nonce, p_ciphertext, p_version, p_scopes, p_fleet_api_base_url, 'ACTIVE', p_access_expires_at)
  on conflict (household_id) do update
    set key_id = excluded.key_id, nonce = excluded.nonce, ciphertext = excluded.ciphertext,
        version = excluded.version, scopes = excluded.scopes,
        fleet_api_base_url = excluded.fleet_api_base_url, status = 'ACTIVE',
        access_expires_at = excluded.access_expires_at, refresh_issued_at = transaction_timestamp();
  return true;
end;
$$;

create or replace function public.worker_get_tesla_credentials(p_household_id uuid)
returns table (nonce bytea, ciphertext bytea, version integer, scopes text[], fleet_api_base_url text,
               access_expires_at timestamptz, status text)
language sql
security definer
set search_path = ''
as $$
  select c.nonce, c.ciphertext, c.version, c.scopes, c.fleet_api_base_url, c.access_expires_at, c.status
    from public.tesla_credentials c where c.household_id = p_household_id
$$;

create or replace function public.worker_delete_tesla_credentials(p_household_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.tesla_credentials where household_id = p_household_id;
  return found;
end;
$$;

create or replace function public.worker_save_oauth_state(
  p_state text,
  p_household_id uuid,
  p_user_id uuid,
  p_pkce_verifier_ciphertext bytea,
  p_pkce_nonce bytea,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_state is null or char_length(p_state) not between 32 and 256
     or p_household_id is null or p_user_id is null
     or p_pkce_verifier_ciphertext is null or octet_length(p_pkce_verifier_ciphertext) <= 16
     or p_pkce_nonce is null or octet_length(p_pkce_nonce) <> 12
     or p_expires_at is null or p_expires_at <= transaction_timestamp()
     or p_expires_at > transaction_timestamp() + interval '10 minutes'
     or not exists (select 1 from public.household_members m
                    where m.household_id = p_household_id and m.user_id = p_user_id) then
    raise exception using errcode = '22023', message = 'invalid OAuth state record';
  end if;

  delete from public.oauth_states where expires_at <= transaction_timestamp();
  insert into public.oauth_states
    (state_hash, household_id, user_id, pkce_verifier_ciphertext, pkce_nonce, expires_at)
  values
    (extensions.digest(convert_to(p_state, 'UTF8'), 'sha256'), p_household_id, p_user_id,
     p_pkce_verifier_ciphertext, p_pkce_nonce, p_expires_at);
  return true;
end;
$$;

create or replace function public.worker_consume_oauth_state(p_state text)
returns table (household_id uuid, user_id uuid, pkce_verifier_ciphertext bytea, pkce_nonce bytea, expires_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  delete from public.oauth_states s
   where p_state is not null
     and s.state_hash = extensions.digest(convert_to(p_state, 'UTF8'), 'sha256')
     and s.expires_at > transaction_timestamp()
  returning s.household_id, s.user_id, s.pkce_verifier_ciphertext, s.pkce_nonce, s.expires_at
$$;

create or replace function public.worker_check_rate_limit(
  p_key_hash bytea,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := transaction_timestamp();
  v_bucket public.worker_rate_limit_buckets%rowtype;
begin
  if p_key_hash is null or octet_length(p_key_hash) <> 32
     or p_limit is null or p_limit not between 1 and 10000
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception using errcode = '22023', message = 'invalid rate limit parameters';
  end if;

  insert into public.worker_rate_limit_buckets (key_hash, window_started_at, hit_count, expires_at)
  values (p_key_hash, v_now, 1, v_now + make_interval(secs => p_window_seconds))
  on conflict (key_hash) do update
    set window_started_at = case
          when public.worker_rate_limit_buckets.window_started_at + make_interval(secs => p_window_seconds) <= v_now
          then v_now else public.worker_rate_limit_buckets.window_started_at end,
        hit_count = case
          when public.worker_rate_limit_buckets.window_started_at + make_interval(secs => p_window_seconds) <= v_now
          then 1 else least(public.worker_rate_limit_buckets.hit_count + 1, p_limit + 1) end,
        expires_at = case
          when public.worker_rate_limit_buckets.window_started_at + make_interval(secs => p_window_seconds) <= v_now
          then v_now + make_interval(secs => p_window_seconds)
          else public.worker_rate_limit_buckets.expires_at end
  returning * into v_bucket;

  return query select v_bucket.hit_count <= p_limit,
    greatest(1, ceil(extract(epoch from (v_bucket.window_started_at + make_interval(secs => p_window_seconds) - v_now)))::integer);
end;
$$;

revoke all on function public.worker_enqueue_job(text, uuid, uuid, text, timestamptz, jsonb, integer)
  from public, anon, authenticated;
revoke all on function public.worker_schedule_due_jobs(timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.worker_claim_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.worker_finish_job(uuid, text) from public, anon, authenticated;
revoke all on function public.worker_fail_job(uuid, text, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.worker_acquire_lock(text, text, integer) from public, anon, authenticated;
revoke all on function public.worker_release_lock(text, text) from public, anon, authenticated;
revoke all on function public.worker_record_provider_call(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.worker_save_tesla_credentials(uuid, text, bytea, bytea, integer, text[], text, timestamptz) from public, anon, authenticated;
revoke all on function public.worker_get_tesla_credentials(uuid) from public, anon, authenticated;
revoke all on function public.worker_delete_tesla_credentials(uuid) from public, anon, authenticated;
revoke all on function public.worker_save_oauth_state(text, uuid, uuid, bytea, bytea, timestamptz) from public, anon, authenticated;
revoke all on function public.worker_consume_oauth_state(text) from public, anon, authenticated;
revoke all on function public.worker_check_rate_limit(bytea, integer, integer) from public, anon, authenticated;
grant execute on function public.worker_enqueue_job(text, uuid, uuid, text, timestamptz, jsonb, integer) to service_role;
grant execute on function public.worker_schedule_due_jobs(timestamptz, integer, integer) to service_role;
grant execute on function public.worker_claim_jobs(text, integer, integer) to service_role;
grant execute on function public.worker_finish_job(uuid, text) to service_role;
grant execute on function public.worker_fail_job(uuid, text, text, integer, boolean) to service_role;
grant execute on function public.worker_acquire_lock(text, text, integer) to service_role;
grant execute on function public.worker_release_lock(text, text) to service_role;
grant execute on function public.worker_record_provider_call(uuid, text, boolean) to service_role;
grant execute on function public.worker_save_tesla_credentials(uuid, text, bytea, bytea, integer, text[], text, timestamptz) to service_role;
grant execute on function public.worker_get_tesla_credentials(uuid) to service_role;
grant execute on function public.worker_delete_tesla_credentials(uuid) to service_role;
grant execute on function public.worker_save_oauth_state(text, uuid, uuid, bytea, bytea, timestamptz) to service_role;
grant execute on function public.worker_consume_oauth_state(text) to service_role;
grant execute on function public.worker_check_rate_limit(bytea, integer, integer) to service_role;

select private.lock_down_public_tables();
