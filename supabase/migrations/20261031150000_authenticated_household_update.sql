-- Actor-aware household metadata update. The update and audit row share this RPC transaction.
-- This is a forward-only migration; do not edit previously applied migrations.

create or replace function private.audit_household_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[];
begin
  select coalesce(pg_catalog.array_agg(n.key order by n.key), array[]::text[])
    into v_changed
  from pg_catalog.jsonb_each(pg_catalog.to_jsonb(new)) as n
  where n.key = any (array['name', 'timezone'])
    and (pg_catalog.to_jsonb(old) -> n.key) is distinct from n.value;
  if pg_catalog.cardinality(v_changed) > 0 then
    perform private.touch_audit(
      new.id, 'settings.changed', 'household', new.id::text,
      pg_catalog.jsonb_build_object('changed', pg_catalog.to_jsonb(v_changed))
    );
  end if;
  return null;
end
$$;

revoke all on function private.audit_household_changed() from public, anon, authenticated;
drop trigger if exists households_audit_changed on public.households;
create trigger households_audit_changed
  after update of name, timezone on public.households
  for each row execute function private.audit_household_changed();

create or replace function public.update_household(
  p_household_id uuid,
  p_name text default null,
  p_timezone text default null
)
returns table (id uuid, name text, timezone text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_name text := case when p_name is null then null else pg_catalog.btrim(p_name) end;
  v_row public.households%rowtype;
begin
  if v_actor is null or not private.has_role_at_least(p_household_id, 'ADMIN') then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_name is null and p_timezone is null then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;
  if p_name is not null and char_length(v_name) not between 1 and 100 then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;

  update public.households h
  set name = coalesce(v_name, h.name),
      timezone = coalesce(p_timezone, h.timezone)
  where h.id = p_household_id
  returning h.* into v_row;
  if not found then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  return query select v_row.id, v_row.name, v_row.timezone;
end
$$;

revoke all on function public.update_household(uuid, text, text) from public, anon;
grant execute on function public.update_household(uuid, text, text) to authenticated;
