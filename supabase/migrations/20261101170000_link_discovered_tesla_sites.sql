-- Provider verification is a backend capability; ordinary linking preserves the user JWT.
-- Operation scope is implicit in this dedicated table. Payload identity is the canonical site ID;
-- clients cannot supply names, timezones, capabilities, actors or provider hosts.
create table if not exists private.tesla_site_link_requests (
  household_id uuid not null references public.households(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  provider_site_id text not null check (provider_site_id ~ '^[1-9][0-9]{0,19}$'),
  session_id uuid not null,
  credential_revision text not null check (credential_revision ~ '^[0-9a-f]{64}$'),
  proof_id uuid not null unique default gen_random_uuid(),
  verified_name text check (verified_name is null or
    (char_length(verified_name) between 1 and 100 and verified_name !~ '[[:cntrl:]<>]')),
  proof_expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  result jsonb,
  primary key (household_id, actor_user_id, idempotency_key)
);
alter table private.tesla_site_link_requests enable row level security;
revoke all on private.tesla_site_link_requests from public, anon, authenticated, service_role;
create index if not exists tesla_site_link_requests_expiry_idx
  on private.tesla_site_link_requests(household_id, actor_user_id, created_at);
comment on table private.tesla_site_link_requests is
  'Backend-verified site linking and atomic operation-scoped idempotency; metadata only, no tokens. Lazy bounded 24-hour cleanup.';

create or replace function private.tesla_site_credential_context(
  p_household_id uuid, p_user_id uuid, p_session_id uuid, p_session_expires_at timestamptz
)
returns text language plpgsql security definer set search_path = '' as $$
declare v_revision text;
begin
  perform private.require_tesla_oauth_session(p_household_id,p_user_id,p_session_id,p_session_expires_at);
  select encode(extensions.digest(convert_to(jsonb_build_array(encode(c.nonce,'hex'),
      encode(c.ciphertext,'hex'),c.key_id,c.version,c.scopes,c.fleet_api_base_url,extract(epoch from c.access_expires_at),c.status)::text,'UTF8'),'sha256'),'hex')
    into v_revision from public.tesla_credentials c
    where c.household_id=p_household_id and c.status='ACTIVE'
      and c.access_expires_at > clock_timestamp()+interval '30 seconds'
      and c.scopes @> array['openid','offline_access','energy_device_data']
      and c.scopes <@ array['openid','offline_access','energy_device_data']
      and array_position(c.scopes,null) is null
      and c.fleet_api_base_url in ('https://fleet-api.prd.eu.vn.cloud.tesla.com','https://fleet-api.prd.na.vn.cloud.tesla.com')
    for share;
  if not found then raise exception using errcode='55000', message='tesla_credentials_unavailable'; end if;
  return v_revision;
end;
$$;

create or replace function public.tesla_site_link_context(p_household_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_stamp text;
begin
  if (auth.jwt()->>'role') is distinct from 'authenticated' then
    raise exception using errcode='42501', message='not_authorised';
  end if;
  v_stamp := private.tesla_site_credential_context(p_household_id,auth.uid(),
    (auth.jwt()->>'session_id')::uuid,to_timestamp((auth.jwt()->>'exp')::double precision));
  return jsonb_build_object('credentialRevision',v_stamp);
end;
$$;

-- Only the Worker may attest that the selected ID was returned by this household's Tesla account.
create or replace function public.worker_prepare_tesla_site_link(
  p_household_id uuid, p_user_id uuid, p_session_id uuid, p_session_expires_at timestamptz,
  p_credential_revision text, p_provider_site_id text, p_name text, p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_stamp text; v_request private.tesla_site_link_requests%rowtype;
begin
  v_stamp := private.tesla_site_credential_context(p_household_id,p_user_id,p_session_id,p_session_expires_at);
  if p_credential_revision is null or v_stamp <> p_credential_revision then
    raise exception using errcode='23505', message='site_link_conflict';
  end if;
  if p_provider_site_id is null or p_provider_site_id !~ '^[1-9][0-9]{0,19}$'
    or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$'
    or (p_name is not null and (char_length(p_name) not between 1 and 100 or p_name ~ '[[:cntrl:]<>]')) then
    raise exception using errcode='22023', message='invalid_argument';
  end if;
  delete from private.tesla_site_link_requests r where r.ctid in (
    select old.ctid from private.tesla_site_link_requests old
    where old.household_id=p_household_id and old.actor_user_id=p_user_id
      and old.created_at < clock_timestamp()-interval '24 hours' and old.idempotency_key<>p_idempotency_key
    order by old.created_at limit 10 for update skip locked
  );
  -- This single conflict operation locks the key; no get/execute/set race.
  insert into private.tesla_site_link_requests as r
    (household_id,actor_user_id,idempotency_key,provider_site_id,session_id,
     credential_revision,verified_name,proof_expires_at)
    values(p_household_id,p_user_id,p_idempotency_key,p_provider_site_id,p_session_id,
      v_stamp,p_name,clock_timestamp()+interval '2 minutes')
    on conflict(household_id,actor_user_id,idempotency_key)
      do update set idempotency_key=excluded.idempotency_key
    returning r.* into v_request;
  if v_request.created_at < clock_timestamp()-interval '24 hours' then
    update private.tesla_site_link_requests r set provider_site_id=p_provider_site_id,
      session_id=p_session_id,credential_revision=v_stamp,verified_name=p_name,
      proof_id=gen_random_uuid(),proof_expires_at=clock_timestamp()+interval '2 minutes',
      created_at=clock_timestamp(),result=null
      where r.household_id=p_household_id and r.actor_user_id=p_user_id and r.idempotency_key=p_idempotency_key
      returning r.* into v_request;
  elsif v_request.provider_site_id <> p_provider_site_id then
    raise exception using errcode='23505', message='site_link_conflict';
  elsif v_request.result is null and (v_request.proof_expires_at <= clock_timestamp()
    or v_request.session_id<>p_session_id or v_request.credential_revision<>v_stamp) then
    update private.tesla_site_link_requests r set session_id=p_session_id,
      credential_revision=v_stamp,verified_name=p_name,proof_id=gen_random_uuid(),
      proof_expires_at=clock_timestamp()+interval '2 minutes'
      where r.household_id=p_household_id and r.actor_user_id=p_user_id and r.idempotency_key=p_idempotency_key
      returning r.* into v_request;
  end if;
  return v_request.proof_id;
end;
$$;

create or replace function public.link_discovered_tesla_site(
  p_household_id uuid, p_proof_id uuid, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_session uuid := (auth.jwt()->>'session_id')::uuid;
  v_stamp text;
  v_request private.tesla_site_link_requests%rowtype;
  v_site public.energy_sites%rowtype;
  v_created boolean;
  v_result jsonb;
begin
  if (auth.jwt()->>'role') is distinct from 'authenticated' then
    raise exception using errcode='42501', message='not_authorised';
  end if;
  -- Same lock order as preparation: Auth session, ADMIN membership, credentials, request row.
  v_stamp := private.tesla_site_credential_context(p_household_id,v_actor,v_session,
    to_timestamp((auth.jwt()->>'exp')::double precision));
  select r.* into v_request from private.tesla_site_link_requests r
    where r.household_id=p_household_id and r.actor_user_id=v_actor
      and r.idempotency_key=p_idempotency_key for update;
  if not found or p_proof_id is null or v_request.proof_id<>p_proof_id
    or v_request.created_at <= clock_timestamp()-interval '24 hours' then
    raise exception using errcode='42501', message='not_authorised';
  end if;
  if v_request.result is not null then return v_request.result; end if;
  if v_request.session_id<>v_session or v_request.credential_revision<>v_stamp
    or v_request.proof_expires_at<=clock_timestamp() then
    raise exception using errcode='42501', message='not_authorised';
  end if;
  insert into public.energy_sites(household_id,provider,provider_site_id,name,timezone)
    select p_household_id,'TESLA',v_request.provider_site_id,v_request.verified_name,h.timezone
    from public.households h where h.id=p_household_id
    on conflict(provider,provider_site_id) do nothing returning * into v_site;
  v_created := found;
  if not v_created then
    select s.* into v_site from public.energy_sites s
      where s.provider='TESLA' and s.provider_site_id=v_request.provider_site_id for share;
    if not found or v_site.household_id<>p_household_id or v_site.connection_state='DISCONNECTED' then
      raise exception using errcode='23505', message='site_link_conflict';
    end if;
  else
    insert into public.audit_log(household_id,actor_type,actor_user_id,action,target_type,target_id)
      values(p_household_id,'USER',v_actor,'tesla.site_linked','energy_site',v_site.id::text);
  end if;
  v_result := jsonb_build_object('created',v_created,'site',jsonb_build_object(
    'id',v_site.id,'householdId',v_site.household_id,'provider',v_site.provider,
    'providerSiteId',v_site.provider_site_id,'name',v_site.name,'timezone',v_site.timezone,
    'connectionState',v_site.connection_state));
  update private.tesla_site_link_requests r set result=v_result
    where r.household_id=p_household_id and r.actor_user_id=v_actor and r.idempotency_key=p_idempotency_key;
  return v_result;
end;
$$;

revoke all on function private.tesla_site_credential_context(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.tesla_site_link_context(uuid) from public,anon,service_role;
grant execute on function public.tesla_site_link_context(uuid) to authenticated;
revoke all on function public.worker_prepare_tesla_site_link(uuid,uuid,uuid,timestamptz,text,text,text,text) from public,anon,authenticated;
grant execute on function public.worker_prepare_tesla_site_link(uuid,uuid,uuid,timestamptz,text,text,text,text) to service_role;
revoke all on function public.link_discovered_tesla_site(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.link_discovered_tesla_site(uuid,uuid,text) to authenticated;
