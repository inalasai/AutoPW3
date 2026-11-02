-- Preserve ADMIN/session and fresh provider provenance after link row/index contention.
-- Definitions and exact grants are installed atomically under every migration executor.
do $migration$
begin
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
  if not found then raise exception using errcode='42501', message='not_authorised'; end if;
  -- Recheck time-based authority after every potentially blocking mutation/row lock.
  if private.tesla_site_credential_context(p_household_id,v_actor,v_session,
    to_timestamp((auth.jwt()->>'exp')::double precision)) is distinct from v_stamp then
    raise exception using errcode='23505', message='credential_revision_changed';
  end if;
  if p_proof_id is null or v_request.proof_id<>p_proof_id
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
  -- Recheck time-based authority after every potentially blocking mutation/row lock.
  if private.tesla_site_credential_context(p_household_id,v_actor,v_session,
    to_timestamp((auth.jwt()->>'exp')::double precision)) is distinct from v_stamp then
    raise exception using errcode='23505', message='credential_revision_changed';
  end if;
  if v_request.proof_expires_at<=clock_timestamp() then
    raise exception using errcode='42501', message='not_authorised';
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
revoke all on function public.link_discovered_tesla_site(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.link_discovered_tesla_site(uuid,uuid,text) to authenticated;
end;
$migration$;
