-- Staging OAuth completion requires the initiating, still-live Supabase Auth session.
-- auth.sessions is owned by Supabase Auth; this migration never creates or alters it.
-- No caller-controlled lease key, lease duration or actor is accepted from public clients.
create or replace function private.tesla_oauth_actor_key(p_user_id uuid)
returns text language sql immutable set search_path = '' as $$
  select 'staging:tesla:oauth:' || encode(extensions.digest(
    convert_to('AutoPW3/staging-tesla-oauth-browser/v1:' || p_user_id::text, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function private.require_tesla_oauth_session(
  p_household_id uuid, p_user_id uuid, p_session_id uuid, p_session_expires_at timestamptz
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_session_expires_at is null or p_session_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'not_authorised';
  end if;
  -- Locks serialize completion against Auth logout/session deletion, not merely JWT expiry.
  perform 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user_id
    and (s.not_after is null or s.not_after > clock_timestamp()) for share;
  if not found then
    raise exception using errcode = '42501', message = 'not_authorised';
  end if;
  perform 1 from public.household_members m where m.household_id = p_household_id
    and m.user_id = p_user_id and m.role = 'ADMIN' for share;
  if not found then
    raise exception using errcode = '42501', message = 'not_authorised';
  end if;
end;
$$;

create or replace function public.worker_begin_tesla_oauth(
  p_household_id uuid, p_user_id uuid, p_session_id uuid,
  p_session_expires_at timestamptz, p_owner uuid, p_restart boolean default false
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_household_key text := 'staging:tesla:oauth:household:' || p_household_id::text;
  v_actor_key text := private.tesla_oauth_actor_key(p_user_id);
begin
  perform private.require_tesla_oauth_session(p_household_id, p_user_id, p_session_id, p_session_expires_at);
  if p_owner is null or p_restart is null then
    raise exception using errcode = '22023', message = 'invalid OAuth attempt';
  end if;
  -- Same order everywhere: session, membership, household lease, actor lease.
  -- A restart is an explicit authenticated ADMIN cancellation, never an anonymous lock steal.
  if p_restart then
    delete from public.job_locks where key = v_household_key;
    delete from public.job_locks where key = v_actor_key;
  end if;
  if not private.acquire_lock(v_household_key, p_owner::text, 720)
    or not private.acquire_lock(v_actor_key, p_owner::text, 720) then
    -- Roll back partial acquisition (and partial restart) using this subtransaction.
    raise lock_not_available;
  end if;
  return true;
exception when lock_not_available then
  return false;
end;
$$;

create or replace function public.worker_validate_tesla_oauth_session(
  p_household_id uuid, p_user_id uuid, p_session_id uuid,
  p_session_expires_at timestamptz, p_owner uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_tesla_oauth_session(p_household_id, p_user_id, p_session_id, p_session_expires_at);
  -- Holding these rows through the caller's transaction fences ambiguous HTTP failures.
  -- No expired or superseded owner can save, even if its HTTP client timed out earlier.
  perform 1 from public.job_locks l
    where l.key = 'staging:tesla:oauth:household:' || p_household_id::text
      and l.owner = p_owner::text and l.lease_expires_at > clock_timestamp() for share;
  if not found then return false; end if;
  perform 1 from public.job_locks l
    where l.key = private.tesla_oauth_actor_key(p_user_id)
      and l.owner = p_owner::text and l.lease_expires_at > clock_timestamp() for share;
  if not found then return false; end if;
  return p_session_expires_at > clock_timestamp();
exception when insufficient_privilege then
  return false;
end;
$$;

create or replace function public.worker_save_tesla_credentials_fenced_for_oauth(
  p_household_id uuid, p_user_id uuid, p_session_id uuid,
  p_session_expires_at timestamptz, p_owner uuid,
  p_key_id text, p_nonce bytea, p_ciphertext bytea, p_version integer,
  p_scopes text[], p_fleet_api_base_url text, p_access_expires_at timestamptz
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.worker_validate_tesla_oauth_session(
    p_household_id, p_user_id, p_session_id, p_session_expires_at, p_owner) then
    raise exception using errcode = '42501', message = 'not_authorised';
  end if;
  -- Reuse existing exact scope validation, encrypted persistence and actor-attributed audit.
  -- All session/membership/lease locks above remain held until this transaction commits.
  return public.worker_save_tesla_credentials_for_oauth(p_household_id, p_user_id,
    p_key_id, p_nonce, p_ciphertext, p_version, p_scopes, p_fleet_api_base_url, p_access_expires_at);
end;
$$;

revoke all on function private.tesla_oauth_actor_key(uuid) from public, anon, authenticated;
revoke all on function private.require_tesla_oauth_session(uuid,uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.worker_begin_tesla_oauth(uuid,uuid,uuid,timestamptz,uuid,boolean) from public, anon, authenticated;
revoke all on function public.worker_validate_tesla_oauth_session(uuid,uuid,uuid,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.worker_save_tesla_credentials_fenced_for_oauth(uuid,uuid,uuid,timestamptz,uuid,text,bytea,bytea,integer,text[],text,timestamptz) from public, anon, authenticated;
grant execute on function public.worker_begin_tesla_oauth(uuid,uuid,uuid,timestamptz,uuid,boolean) to service_role;
grant execute on function public.worker_validate_tesla_oauth_session(uuid,uuid,uuid,timestamptz,uuid) to service_role;
grant execute on function public.worker_save_tesla_credentials_fenced_for_oauth(uuid,uuid,uuid,timestamptz,uuid,text,bytea,bytea,integer,text[],text,timestamptz) to service_role;
