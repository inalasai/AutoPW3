-- Public callbacks have no user JWT. Their actor comes from atomically consumed,
-- authenticated-encrypted OAuth state. Only the backend may invoke these RPCs.
create or replace function public.worker_validate_oauth_actor(p_household_id uuid, p_user_id uuid)
returns boolean
language sql security definer set search_path = ''
as $$
  select exists (select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = p_user_id and m.role = 'ADMIN')
$$;

create or replace function public.worker_save_tesla_credentials_for_oauth(
  p_household_id uuid, p_user_id uuid, p_key_id text, p_nonce bytea, p_ciphertext bytea,
  p_version integer, p_scopes text[], p_fleet_api_base_url text, p_access_expires_at timestamptz
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  -- Hold the membership row through commit: removal/demotion cannot race the save.
  perform 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = p_user_id and m.role = 'ADMIN'
    for share;
  if not found then
    raise exception using errcode = '42501', message = 'not_authorised';
  end if;
  if p_scopes is null or not (p_scopes @> array['openid','offline_access','energy_device_data'])
    or not (p_scopes <@ array['openid','offline_access','energy_device_data'])
    or array_position(p_scopes, null) is not null
    or p_fleet_api_base_url is null or p_fleet_api_base_url not in (
      'https://fleet-api.prd.na.vn.cloud.tesla.com', 'https://fleet-api.prd.eu.vn.cloud.tesla.com')
    or p_access_expires_at is null or p_access_expires_at <= transaction_timestamp() then
    raise exception using errcode = '22023', message = 'invalid read-only OAuth credentials';
  end if;
  perform public.worker_save_tesla_credentials(p_household_id, p_key_id, p_nonce, p_ciphertext,
    p_version, p_scopes, p_fleet_api_base_url, p_access_expires_at);
  insert into public.audit_log (household_id, actor_type, actor_user_id, action, target_type, target_id)
    values (p_household_id, 'USER', p_user_id, 'tesla.connected', 'household', p_household_id::text);
  return true;
end;
$$;

revoke all on function public.worker_validate_oauth_actor(uuid,uuid) from public, anon, authenticated;
revoke all on function public.worker_save_tesla_credentials_for_oauth(uuid,uuid,text,bytea,bytea,integer,text[],text,timestamptz) from public, anon, authenticated;
grant execute on function public.worker_validate_oauth_actor(uuid,uuid) to service_role;
grant execute on function public.worker_save_tesla_credentials_for_oauth(uuid,uuid,text,bytea,bytea,integer,text[],text,timestamptz) to service_role;
