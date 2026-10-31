-- RLS and actor attribution exercised by the authenticated repository's first domain slice.
begin;

select plan(19);
select tests.world();

select tests.as_user('alice');
select is((select count(*)::int from public.user_profiles where user_id = tests.id('alice')), 1,
  'actor can read their own profile');
select is((select count(*)::int from public.user_profiles where user_id = tests.id('bob')), 0,
  'actor cannot read an unrelated profile by changing the requested user id');
with changed as (
  update public.user_profiles set display_name = 'stolen'
  where user_id = tests.id('bob') returning 1
) select is((select count(*)::int from changed), 0,
  'actor cannot mutate an unrelated profile');
select is((select count(*)::int from public.households where id = tests.id('h2')), 0,
  'household listing and detail reads hide an unrelated household');
select is((select count(*)::int from public.household_members where household_id = tests.id('h2')), 0,
  'membership reads hide another household');
with changed as (
  update public.household_settings set raw_retention_days = 17
  where household_id = tests.id('h2') returning 1
) select is((select count(*)::int from changed), 0,
  'ADMIN cannot mutate another household settings row');

select tests.as_user('rw1');
select throws_ok($q$select public.create_invitation(tests.id('h1'), 'denied@example.invalid')$q$,
  '42501', 'not_authorised', 'READ_WRITE cannot perform ADMIN invitation operation');
select throws_ok($q$select public.change_member_role(tests.id('h1'), tests.id('ro1'), 'READ_WRITE')$q$,
  '42501', 'not_authorised', 'READ_WRITE cannot change membership roles');
with changed as (
  update public.household_settings set raw_retention_days = 17
  where household_id = tests.id('h1') returning 1
) select is((select count(*)::int from changed), 0,
  'READ_WRITE cannot mutate settings even in their own household');
with changed as (
  update public.user_profiles set display_name = 'Updated name'
  where user_id = tests.id('rw1') returning 1
) select is((select count(*)::int from changed), 1,
  'actor can update only their own profile fields');
select throws_ok($q$select * from public.update_household(tests.id('h1'), 'Denied', null)$q$,
  '42501', 'not_authorised', 'READ_WRITE cannot update household metadata');

select tests.as_user('bob');
select throws_ok($q$select * from public.update_household(tests.id('h1'), 'Cross tenant', null)$q$,
  '42501', 'not_authorised', 'ADMIN cannot update another household metadata');

select tests.as_user('alice');
select is((select name from public.update_household(tests.id('h1'), 'Home renamed', null)), 'Home renamed',
  'household ADMIN can update metadata through the authenticated RPC');
with changed as (
  update public.household_settings set raw_retention_days = 91
  where household_id = tests.id('h1') returning 1
) select is((select count(*)::int from changed), 1,
  'household ADMIN can update a granted setting field');
select tests.clear();
select is((select count(*)::int from public.audit_log
  where household_id = tests.id('h1') and action = 'settings.changed'
    and target_type = 'household'
    and actor_user_id = tests.id('alice') and actor_type = 'USER'), 1,
  'household update audit is attributed to auth.uid() in the same RPC');
select is((select count(*)::int from public.audit_log
  where household_id = tests.id('h1') and action = 'settings.changed'
    and target_type = 'household_settings'
    and actor_user_id = tests.id('alice') and actor_type = 'USER'), 1,
  'settings audit is attributed to the authenticated ADMIN');
select is((select count(*)::int from public.household_settings
  where household_id = tests.id('h1') and updated_by = tests.id('alice')), 1,
  'settings updated_by is stamped from auth.uid()');
select is((select raw_retention_days from public.household_settings where household_id = tests.id('h2')), 90,
  'denied cross-household write left the other household unchanged');
select is((select count(*)::int from public.audit_log
  where household_id = tests.id('h2') and action = 'settings.changed'), 0,
  'denied cross-household write emitted no audit event');

select * from finish();
rollback;
