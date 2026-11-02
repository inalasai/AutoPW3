-- Forward fix: expired staged access cannot loop or cause a second pending-generation exchange.
-- Single-statement installation is atomic in autocommit and transaction-wrapped hosted runners.
do $migration$
begin
create or replace function private.tesla_refresh_context(p_household_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.tesla_credentials%rowtype;
begin
  select * into c from public.tesla_credentials where household_id=p_household_id for share;
  if c.status='NEEDS_REAUTH' then
    raise exception using errcode='55000', message='tesla_reauthorization_required';
  end if;
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
  -- The pending rotated pair is a distinct generation, never another exchange input here.
  -- Its access expiry terminates activation, not the durable no-reexchange barrier.
  if v_payload->>'outcome'='TOKEN'
    and (v_payload->>'expiresAt')::timestamptz<=clock_timestamp()+interval '30 seconds' then
    v_payload:=jsonb_build_object('outcome','REAUTH');
  end if;
  if v_payload->>'outcome'='TOKEN' then
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

revoke all on function private.tesla_refresh_context(uuid) from public,anon,authenticated,service_role;
revoke all on function public.finish_tesla_discovery_refresh(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.finish_tesla_discovery_refresh(uuid,uuid,uuid) to authenticated;
end;
$migration$;
