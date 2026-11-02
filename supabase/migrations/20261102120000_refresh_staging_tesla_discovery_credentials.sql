-- Request-scoped discovery refresh. No existing freshness predicate or public table grant changes.
-- Unshipped migration: one statement makes function creation and privilege restriction atomic.
do $migration$
begin
create table if not exists private.tesla_discovery_refresh_attempts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  credential_revision text not null check (credential_revision ~ '^[0-9a-f]{64}$'),
  -- Deliberately not cascading from Auth: logout/user deletion must not erase the no-reexchange barrier.
  actor_user_id uuid not null,
  session_id uuid not null,
  owner uuid not null,
  deadline timestamptz not null,
  state text not null check (state in ('SENT','READY','COMMITTED')),
  payload jsonb,
  outcome text check (outcome in ('TOKEN','REAUTH')),
  result_revision text,
  unique(household_id,credential_revision)
);
alter table private.tesla_discovery_refresh_attempts enable row level security;
revoke all on private.tesla_discovery_refresh_attempts from public,anon,authenticated,service_role;
comment on table private.tesla_discovery_refresh_attempts is
  'Durable no-reexchange barrier and encrypted pending rotation. SENT is never reset on lease expiry.';

-- Extend the existing audit metadata allowlist by exactly two empty-metadata actions.
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
    when 'tesla.token_refreshed' then array[]::text[]
    when 'tesla.reauth_required' then array[]::text[]
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

create or replace function private.tesla_refresh_revision(c public.tesla_credentials)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(jsonb_build_array(encode(c.nonce,'hex'),
    encode(c.ciphertext,'hex'),c.key_id,c.version,c.scopes,c.fleet_api_base_url,
    extract(epoch from c.access_expires_at),c.status)::text,'UTF8'),'sha256'),'hex')
$$;

create or replace function private.tesla_refresh_context(p_household_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.tesla_credentials%rowtype;
begin
  select * into c from public.tesla_credentials where household_id=p_household_id for share;
  if not found or c.status<>'ACTIVE' or c.access_expires_at is null
    or c.scopes is null or not (c.scopes @> array['openid','offline_access','energy_device_data'])
    or not (c.scopes <@ array['openid','offline_access','energy_device_data'])
    or array_position(c.scopes,null) is not null
    or c.fleet_api_base_url not in ('https://fleet-api.prd.eu.vn.cloud.tesla.com','https://fleet-api.prd.na.vn.cloud.tesla.com') then
    raise exception using errcode='55000', message='tesla_credentials_unavailable';
  end if;
  return jsonb_build_object('credentialRevision',private.tesla_refresh_revision(c),
    'needsRefresh',c.access_expires_at<=clock_timestamp()+interval '30 seconds');
end;
$$;

create or replace function public.tesla_discovery_refresh_context(p_household_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if (auth.jwt()->>'role') is distinct from 'authenticated' then
    raise exception using errcode='42501', message='not_authorised';
  end if;
  perform private.require_tesla_oauth_session(p_household_id,auth.uid(),
    (auth.jwt()->>'session_id')::uuid,to_timestamp((auth.jwt()->>'exp')::double precision));
  return private.tesla_refresh_context(p_household_id);
end;
$$;

create or replace function public.begin_tesla_discovery_refresh(
  p_household_id uuid,p_revision text,p_owner uuid,p_deadline timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid:=auth.uid(); v_session uuid:=(auth.jwt()->>'session_id')::uuid;
  v_exp timestamptz:=to_timestamp((auth.jwt()->>'exp')::double precision);
  v_deadline timestamptz; v_context jsonb; r private.tesla_discovery_refresh_attempts%rowtype;
begin
  if (auth.jwt()->>'role') is distinct from 'authenticated' then
    raise exception using errcode='42501', message='not_authorised';
  end if;
  perform private.require_tesla_oauth_session(p_household_id,v_actor,v_session,v_exp);
  if p_owner is null or p_deadline is null or p_deadline<=clock_timestamp() then
    raise exception using errcode='22023', message='invalid_argument';
  end if;
  v_deadline:=least(p_deadline,clock_timestamp()+interval '25 seconds',v_exp);
  if not private.acquire_lock('token:'||p_household_id::text,p_owner::text,30) then
    raise exception using errcode='55P03', message='refresh_busy';
  end if;
  v_context:=private.tesla_refresh_context(p_household_id);
  if p_revision is distinct from v_context->>'credentialRevision' then
    raise exception using errcode='23505', message='credential_revision_changed';
  end if;
  select * into r from private.tesla_discovery_refresh_attempts
    where household_id=p_household_id and credential_revision=p_revision for update;
  perform private.require_tesla_oauth_session(p_household_id,v_actor,v_session,v_exp);
  if v_deadline<=clock_timestamp() or not exists(select 1 from public.job_locks
    where key='token:'||p_household_id::text and owner=p_owner::text and lease_expires_at>clock_timestamp()) then
    raise exception using errcode='55000', message='refresh_deadline_expired';
  end if;
  if r.id is not null then
    if r.state<>'READY' then
      raise exception using errcode='55000', message='refresh_recovery_required';
    end if;
    if r.actor_user_id<>v_actor or r.session_id<>v_session then
      raise exception using errcode='42501', message='not_authorised';
    end if;
    update private.tesla_discovery_refresh_attempts set owner=p_owner,deadline=v_deadline where id=r.id;
    return jsonb_build_object('attemptId',r.id,'state','READY');
  end if;
  if v_context->>'needsRefresh'<>'true' then
    raise exception using errcode='23505', message='credential_revision_changed';
  end if;
  if v_deadline<=clock_timestamp() then
    raise exception using errcode='55000', message='refresh_deadline_expired';
  end if;
  insert into private.tesla_discovery_refresh_attempts
    (household_id,credential_revision,actor_user_id,session_id,owner,deadline,state)
    values(p_household_id,p_revision,v_actor,v_session,p_owner,v_deadline,'SENT') returning * into r;
  return jsonb_build_object('attemptId',r.id,'state','SENT');
end;
$$;

-- Service role can stage, never activate; authority originates in the authenticated begin transaction.
create or replace function public.worker_stage_tesla_discovery_refresh(p_attempt_id uuid,p_owner uuid,p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r private.tesla_discovery_refresh_attempts%rowtype; v_context jsonb; v_region text;
begin
  select * into r from private.tesla_discovery_refresh_attempts where id=p_attempt_id;
  if not found then raise exception using errcode='42501', message='not_authorised'; end if;
  perform 1 from public.job_locks where key='token:'||r.household_id::text
    and owner=p_owner::text and lease_expires_at>clock_timestamp() for share;
  if not found then raise exception using errcode='23505', message='refresh_fence_lost'; end if;
  v_context:=private.tesla_refresh_context(r.household_id);
  select fleet_api_base_url into v_region from public.tesla_credentials where household_id=r.household_id;
  select * into r from private.tesla_discovery_refresh_attempts where id=p_attempt_id for update;
  if r.owner is distinct from p_owner or r.deadline<=clock_timestamp()
    or not exists(select 1 from public.job_locks where key='token:'||r.household_id::text
      and owner=p_owner::text and lease_expires_at>clock_timestamp())
    or r.credential_revision is distinct from v_context->>'credentialRevision' then
    raise exception using errcode='23505', message='refresh_fence_lost';
  end if;
  if r.state='READY' and r.payload=p_payload then return true; end if;
  if r.state<>'SENT' then raise exception using errcode='23505', message='refresh_fence_lost'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>262144 then
    raise exception using errcode='22023', message='invalid_argument';
  end if;
  if p_payload=jsonb_build_object('outcome','REAUTH') then null;
  elsif p_payload->>'outcome'='TOKEN'
    and (select count(*) from jsonb_object_keys(p_payload))=8
    and p_payload->>'nonce' ~ '^\\x[0-9a-f]{24}$'
    and p_payload->>'ciphertext' ~ '^\\x[0-9a-f]{34,}$'
    and length(p_payload->>'ciphertext')%2=0
    and p_payload->>'version' ~ '^[1-9][0-9]{0,8}$'
    and p_payload->>'keyId'='v'||(p_payload->>'version')
    and jsonb_typeof(p_payload->'scopes')='array'
    and p_payload->'scopes' @> '["openid","offline_access","energy_device_data"]'::jsonb
    and p_payload->'scopes' <@ '["openid","offline_access","energy_device_data"]'::jsonb
    and p_payload->>'region'=v_region
    and (p_payload->>'expiresAt')::timestamptz>clock_timestamp()+interval '30 seconds'
    and (p_payload->>'expiresAt')::timestamptz<=clock_timestamp()+interval '31 days' then null;
  else raise exception using errcode='22023', message='invalid_argument'; end if;
  update private.tesla_discovery_refresh_attempts set state='READY',payload=p_payload where id=r.id;
  return true;
end;
$$;

-- The activating mutation accepts no actor/session identifiers or token/ciphertext input.
create or replace function public.finish_tesla_discovery_refresh(p_household_id uuid,p_attempt_id uuid,p_owner uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid:=auth.uid(); v_session uuid:=(auth.jwt()->>'session_id')::uuid;
  r private.tesla_discovery_refresh_attempts%rowtype; c public.tesla_credentials%rowtype;
  v_revision text; v_payload jsonb;
begin
  if (auth.jwt()->>'role') is distinct from 'authenticated' then
    raise exception using errcode='42501', message='not_authorised';
  end if;
  perform private.require_tesla_oauth_session(p_household_id,v_actor,v_session,
    to_timestamp((auth.jwt()->>'exp')::double precision));
  select * into r from private.tesla_discovery_refresh_attempts where id=p_attempt_id;
  if not found or r.household_id<>p_household_id or r.actor_user_id<>v_actor
    or r.session_id<>v_session or r.owner is distinct from p_owner then
    raise exception using errcode='42501', message='not_authorised';
  end if;
  if r.state='COMMITTED' then
    select * into c from public.tesla_credentials where household_id=p_household_id for share;
    if not found or private.tesla_refresh_revision(c) is distinct from r.result_revision then
      raise exception using errcode='23505', message='credential_revision_changed';
    end if;
    return jsonb_build_object('credentialRevision',r.result_revision,'outcome',r.outcome);
  end if;
  perform 1 from public.job_locks where key='token:'||p_household_id::text
    and owner=p_owner::text and lease_expires_at>clock_timestamp() for share;
  if not found then raise exception using errcode='23505', message='refresh_fence_lost'; end if;
  select * into c from public.tesla_credentials where household_id=p_household_id for update;
  select * into r from private.tesla_discovery_refresh_attempts where id=p_attempt_id for update;
  perform private.require_tesla_oauth_session(p_household_id,v_actor,v_session,
    to_timestamp((auth.jwt()->>'exp')::double precision));
  if r.state='COMMITTED' and r.owner=p_owner and private.tesla_refresh_revision(c)=r.result_revision then
    return jsonb_build_object('credentialRevision',r.result_revision,'outcome',r.outcome);
  end if;
  if c.household_id is null or r.state<>'READY' or r.owner is distinct from p_owner
    or r.deadline<=clock_timestamp() or c.status<>'ACTIVE'
    or not exists(select 1 from public.job_locks where key='token:'||p_household_id::text
      and owner=p_owner::text and lease_expires_at>clock_timestamp())
    or private.tesla_refresh_revision(c) is distinct from r.credential_revision then
    raise exception using errcode='23505', message='refresh_fence_lost';
  end if;
  v_payload:=r.payload;
  if v_payload->>'outcome'='TOKEN' then
    if (v_payload->>'expiresAt')::timestamptz<=clock_timestamp()+interval '30 seconds' then
      raise exception using errcode='55000', message='tesla_credentials_unavailable';
    end if;
    perform public.worker_save_tesla_credentials(p_household_id,v_payload->>'keyId',
      (v_payload->>'nonce')::bytea,(v_payload->>'ciphertext')::bytea,(v_payload->>'version')::integer,
      array(select jsonb_array_elements_text(v_payload->'scopes')),v_payload->>'region',
      (v_payload->>'expiresAt')::timestamptz);
    update public.tesla_credentials set last_refresh_at=clock_timestamp() where household_id=p_household_id;
  elsif v_payload->>'outcome'='REAUTH' then
    update public.tesla_credentials set status='NEEDS_REAUTH' where household_id=p_household_id;
  else raise exception using errcode='22023', message='invalid_argument'; end if;
  select private.tesla_refresh_revision(x) into v_revision from public.tesla_credentials x where household_id=p_household_id;
  perform private.touch_audit(p_household_id,
    case when v_payload->>'outcome'='TOKEN' then 'tesla.token_refreshed' else 'tesla.reauth_required' end,
    'household',p_household_id::text,'{}'::jsonb);
  update private.tesla_discovery_refresh_attempts set state='COMMITTED',payload=null,
    outcome=v_payload->>'outcome',result_revision=v_revision where id=r.id;
  return jsonb_build_object('credentialRevision',v_revision,'outcome',v_payload->>'outcome');
end;
$$;

revoke all on function private.tesla_refresh_revision(public.tesla_credentials) from public,anon,authenticated,service_role;
revoke all on function private.tesla_refresh_context(uuid) from public,anon,authenticated,service_role;
revoke all on function public.tesla_discovery_refresh_context(uuid) from public,anon,service_role;
revoke all on function public.begin_tesla_discovery_refresh(uuid,text,uuid,timestamptz) from public,anon,service_role;
revoke all on function public.finish_tesla_discovery_refresh(uuid,uuid,uuid) from public,anon,service_role;
revoke all on function public.worker_stage_tesla_discovery_refresh(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.tesla_discovery_refresh_context(uuid) to authenticated;
grant execute on function public.begin_tesla_discovery_refresh(uuid,text,uuid,timestamptz) to authenticated;
grant execute on function public.finish_tesla_discovery_refresh(uuid,uuid,uuid) to authenticated;
grant execute on function public.worker_stage_tesla_discovery_refresh(uuid,uuid,jsonb) to service_role;
end;
$migration$;
