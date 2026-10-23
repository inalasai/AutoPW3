-- TASK-04 migration 3/4: auth trigger, invitation lifecycle, membership management, automation controls and the
-- one-time admin bootstrap. Safe to re-run (idempotent).
--
-- Rules for every function in this file:
--   * SECURITY DEFINER with SET search_path = '' and schema-qualified references;
--   * EXECUTE revoked from PUBLIC and anon and granted explicitly (authenticated for the public.* RPCs,
--     service_role for the bootstrap);
--   * authorisation is checked inside the function from the JWT (auth.uid()), never from a parameter;
--   * a caller who is not allowed gets SQLSTATE 42501 with the message 'not_authorised'; business-rule
--     failures use SQLSTATE P0001 with a short fixed message.
--
-- Rollback notes (development only):
--   drop trigger if exists on_auth_user_created on auth.users;
--   drop function if exists private.handle_new_user(), private.bootstrap_first_admin(text, text, text),
--     public.create_invitation(uuid, text, public.role_enum, interval), public.accept_invitation(text),
--     public.revoke_invitation(uuid), public.change_member_role(uuid, uuid, public.role_enum),
--     public.remove_member(uuid, uuid), public.leave_household(uuid), public.set_automation_paused(uuid, boolean),
--     public.set_rule_mode(uuid, text);

set search_path = public, extensions;

-- ---------------------------------------------------------------------------------------------------------------
-- New users: profile only. Never a household and never a role (docs/SECURITY_MODEL.md invariant 1).
-- This function must never raise, or sign-up would fail.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Users that existed before this migration get a profile too.
insert into public.user_profiles (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------------------------------------------
-- Invitations. The token is 256 random bits, returned once to the ADMIN who creates it, stored only as SHA-256.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.create_invitation(
  p_household_id uuid,
  p_email text default null,
  p_role public.role_enum default 'READ_ONLY',
  -- 168 hours, not '7 days': an interval of days follows the session time zone across a DST change,
  -- so the lifetime would be 167 or 169 hours. Hours are exact.
  p_expires_in interval default interval '168 hours'
)
returns table (invitation_id uuid, invitation_token text, invitation_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, ''))), '');
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if v_uid is null or not private.has_role_at_least(p_household_id, 'ADMIN') then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_role is null then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$') then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;
  if p_expires_in is null or p_expires_in < interval '1 minute' or p_expires_in > interval '30 days' then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;

  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := pg_catalog.now() + p_expires_in;

  insert into public.household_invitations (household_id, email, role, token_hash, expires_at, created_by)
  values (
    p_household_id, v_email, p_role,
    pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8')),
    v_expires, v_uid
  )
  returning id into v_id;

  perform private.touch_audit(
    p_household_id, 'invitation.created', 'invitation', v_id::text,
    pg_catalog.jsonb_build_object(
      'invitation_id', v_id, 'role', p_role, 'email_bound', v_email is not null, 'expires_at', v_expires
    )
  );

  return query select v_id, v_token, v_expires;
end
$$;

revoke all on function public.create_invitation(uuid, text, public.role_enum, interval) from public, anon;
grant execute on function public.create_invitation(uuid, text, public.role_enum, interval) to authenticated;

-- Acceptance: signed-in user, valid single-use unexpired token. When the invitation names an email, the user's
-- CONFIRMED email must match. A role above READ_ONLY is honoured only while the inviter is still an ADMIN of that
-- household. Every failure of the token itself returns the same error so the token cannot be probed.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv public.household_invitations%rowtype;
  v_user_email text;
  v_user_confirmed timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_invitation' using errcode = 'P0001';
  end if;

  select * into v_inv
  from public.household_invitations i
  where i.token_hash = pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'))
  for update;

  if not found
     or v_inv.accepted_at is not null
     or v_inv.revoked_at is not null
     or v_inv.expires_at <= pg_catalog.now() then
    raise exception 'invalid_invitation' using errcode = 'P0001';
  end if;

  if v_inv.email is not null then
    select u.email, u.email_confirmed_at into v_user_email, v_user_confirmed
    from auth.users u where u.id = v_uid;
    if v_user_confirmed is null
       or v_user_email is null
       or pg_catalog.lower(v_user_email) <> pg_catalog.lower(v_inv.email::text) then
      raise exception 'invalid_invitation' using errcode = 'P0001';
    end if;
  end if;

  if v_inv.role <> 'READ_ONLY' and not exists (
    select 1 from public.household_members m
    where m.household_id = v_inv.household_id
      and m.user_id = v_inv.created_by
      and m.role = 'ADMIN'
  ) then
    raise exception 'invalid_invitation' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.household_members m
    where m.household_id = v_inv.household_id and m.user_id = v_uid
  ) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  insert into public.household_members (household_id, user_id, role, created_by)
  values (v_inv.household_id, v_uid, v_inv.role, v_inv.created_by);

  update public.household_invitations
  set accepted_at = pg_catalog.now(), accepted_by = v_uid
  where id = v_inv.id;

  perform private.touch_audit(
    v_inv.household_id, 'invitation.accepted', 'invitation', v_inv.id::text,
    pg_catalog.jsonb_build_object('invitation_id', v_inv.id, 'role', v_inv.role)
  );

  return v_inv.household_id;
end
$$;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_household uuid;
begin
  select i.household_id into v_household
  from public.household_invitations i where i.id = p_invitation_id;
  -- Same error for "does not exist" and "not yours": existence is not revealed.
  if v_uid is null or v_household is null or not private.has_role_at_least(v_household, 'ADMIN') then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  update public.household_invitations
  set revoked_at = pg_catalog.now()
  where id = p_invitation_id and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'invalid_invitation' using errcode = 'P0001';
  end if;

  perform private.touch_audit(
    v_household, 'invitation.revoked', 'invitation', p_invitation_id::text,
    pg_catalog.jsonb_build_object('invitation_id', p_invitation_id)
  );
end
$$;

revoke all on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Membership management. Audit rows are written by the household_members triggers, so these functions and any
-- other writer produce the same trail.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.change_member_role(
  p_household_id uuid,
  p_user_id uuid,
  p_role public.role_enum
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.has_role_at_least(p_household_id, 'ADMIN') then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_user_id is null or p_role is null then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;
  if p_user_id = v_uid then
    raise exception 'self_change_not_allowed' using errcode = 'P0001';
  end if;

  update public.household_members
  set role = p_role
  where household_id = p_household_id and user_id = p_user_id;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
end
$$;

revoke all on function public.change_member_role(uuid, uuid, public.role_enum) from public, anon;
grant execute on function public.change_member_role(uuid, uuid, public.role_enum) to authenticated;

create or replace function public.remove_member(p_household_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.has_role_at_least(p_household_id, 'ADMIN') then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;
  if p_user_id = v_uid then
    raise exception 'self_change_not_allowed' using errcode = 'P0001';
  end if;

  delete from public.household_members
  where household_id = p_household_id and user_id = p_user_id;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
end
$$;

revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- "Leave household" is the one allowed removal of oneself; the last-admin guard still applies.
create or replace function public.leave_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  delete from public.household_members
  where household_id = p_household_id and user_id = v_uid;
  if not found then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
end
$$;

revoke all on function public.leave_household(uuid) from public, anon;
grant execute on function public.leave_household(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Automation controls. Pause: READ_WRITE or ADMIN. Resume: ADMIN only (docs/SECURITY_MODEL.md invariant 6).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.set_automation_paused(p_household_id uuid, p_paused boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_changed boolean;
begin
  if p_paused is null then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;
  if v_uid is null
     or not private.has_role_at_least(p_household_id, case when p_paused then 'READ_WRITE' else 'ADMIN' end::public.role_enum) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  update public.household_settings s
  set automation_paused = p_paused,
      paused_by = case when p_paused then v_uid else null end,
      paused_at = case when p_paused then pg_catalog.now() else null end
  where s.household_id = p_household_id and s.automation_paused is distinct from p_paused;
  v_changed := found;

  if v_changed then
    perform private.touch_audit(
      p_household_id,
      case when p_paused then 'automation.paused' else 'automation.resumed' end,
      'household_settings', p_household_id::text, '{}'::jsonb
    );
  elsif not exists (select 1 from public.household_settings s where s.household_id = p_household_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end
$$;

revoke all on function public.set_automation_paused(uuid, boolean) from public, anon;
grant execute on function public.set_automation_paused(uuid, boolean) to authenticated;

-- Rule mode. DISABLED or DRY_RUN: READ_WRITE or ADMIN. ACTIVE: ADMIN only. The mode column is not writable
-- directly by authenticated, so this is the only path. Unknown and foreign rules give the same error.
create or replace function public.set_rule_mode(p_rule_id uuid, p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_rule public.automation_rules%rowtype;
begin
  if p_mode is null or p_mode not in ('DISABLED', 'DRY_RUN', 'ACTIVE') then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;

  select * into v_rule from public.automation_rules r where r.id = p_rule_id for update;
  if v_uid is null
     or not found
     or not private.has_role_at_least(v_rule.household_id, case when p_mode = 'ACTIVE' then 'ADMIN' else 'READ_WRITE' end::public.role_enum) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  -- Demoting an ACTIVE rule is always allowed to READ_WRITE (safety direction); only ADMIN can move into ACTIVE.
  if v_rule.mode = p_mode then
    return;
  end if;

  update public.automation_rules
  set mode = p_mode, version = version + 1
  where id = p_rule_id;

  perform private.touch_audit(
    v_rule.household_id, 'rule.mode_changed', 'automation_rule', p_rule_id::text,
    pg_catalog.jsonb_build_object('rule_id', p_rule_id, 'old_mode', v_rule.mode, 'new_mode', p_mode)
  );
end
$$;

revoke all on function public.set_rule_mode(uuid, text) from public, anon;
grant execute on function public.set_rule_mode(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- One-time admin bootstrap (D-005). Server-only: executable by the owner role and service_role; not exposed through
-- the API because schema private is not exposed. Runs once: the system_bootstrap row is permanent, so it can
-- never run again even if the household is later deleted. See docs/ADMIN_BOOTSTRAP.md.
-- The user must already have signed up and confirmed their email; no password or token passes through here.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.bootstrap_first_admin(
  p_email text,
  p_household_name text,
  p_timezone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_name text := pg_catalog.btrim(coalesce(p_household_name, ''));
  v_user uuid;
  v_household uuid;
begin
  -- Serialise concurrent callers; the checks below then see each other's committed work.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('autopw3:bootstrap', 0));

  if exists (select 1 from public.system_bootstrap) then
    raise exception 'bootstrap_already_completed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.household_members m where m.role = 'ADMIN') then
    raise exception 'bootstrap_not_allowed' using errcode = 'P0001';
  end if;
  if v_email = '' or char_length(v_name) not between 1 and 100 then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;

  select u.id into v_user
  from auth.users u
  where pg_catalog.lower(u.email) = v_email and u.email_confirmed_at is not null;
  if v_user is null then
    raise exception 'bootstrap_user_not_found' using errcode = 'P0002';
  end if;

  -- The timezone is validated by the households trigger (invalid names raise 22023).
  insert into public.households (name, timezone, created_by)
  values (v_name, p_timezone, v_user)
  returning id into v_household;

  insert into public.household_settings (household_id) values (v_household);

  insert into public.household_members (household_id, user_id, role, created_by)
  values (v_household, v_user, 'ADMIN', v_user);

  insert into public.system_bootstrap (id, household_id, bootstrap_by_email_hash)
  values (true, v_household, pg_catalog.sha256(pg_catalog.convert_to(v_email, 'UTF8')));

  perform private.touch_audit(
    v_household, 'bootstrap.completed', 'household', v_household::text,
    pg_catalog.jsonb_build_object('household_id', v_household)
  );

  return v_household;
end
$$;

revoke all on function private.bootstrap_first_admin(text, text, text) from public, anon, authenticated;
grant execute on function private.bootstrap_first_admin(text, text, text) to service_role;
