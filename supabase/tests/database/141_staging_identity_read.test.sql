-- SQL equivalent of the authenticated GET /me profile and embedded household membership reads.
-- This proves local RLS behavior; hosted PostgREST embedding and JWT handling need staging tests.
begin;
select plan(12);
select tests.world();

select tests.as_user('alice');
select is((select count(*)::int from public.user_profiles where user_id = auth.uid()), 1,
  'ADMIN reads their own persisted profile');
select is((select count(*)::int from public.user_profiles where user_id = tests.id('bob')), 0,
  'ADMIN cannot read an unrelated household profile');
select is((select h.id from public.household_members m
  join public.households h on h.id = m.household_id where m.user_id = auth.uid()), tests.id('h1'),
  'self membership query joins the permitted household');
select is((select count(*)::int from public.household_members m
  join public.households h on h.id = m.household_id where m.user_id = tests.id('bob')), 0,
  'substituting an unrelated actor cannot expose their household join');
select is((select count(*)::int from public.user_profiles where user_id = tests.id('ro1')), 1,
  'ADMIN retains permitted shared-household profile visibility');

select tests.as_user('rw1');
select is((select count(*)::int from public.user_profiles where user_id = auth.uid()), 1,
  'READ_WRITE reads their own profile');
select is((select count(*)::int from public.household_members m
  join public.households h on h.id = m.household_id where m.user_id = auth.uid()), 1,
  'READ_WRITE reads their own joined membership');
select is((select count(*)::int from public.user_profiles where user_id = tests.id('alice')), 0,
  'READ_WRITE cannot use shared membership to read an ADMIN profile');

select tests.as_user('ro1');
select is((select m.role::text from public.household_members m
  join public.households h on h.id = m.household_id where m.user_id = auth.uid()), 'READ_ONLY',
  'READ_ONLY reads their own persisted role through the join');

select tests.as_user('bob');
select is((select count(*)::int from public.household_members m
  join public.households h on h.id = m.household_id where h.id = tests.id('h1')), 0,
  'other household ADMIN cannot read the first household join');

select tests.as_user('carol');
select is((select count(*)::int from public.user_profiles where user_id = auth.uid()), 1,
  'registered user without memberships retains their profile');
select is((select count(*)::int from public.household_members m
  join public.households h on h.id = m.household_id where m.user_id = auth.uid()), 0,
  'registered user without memberships receives an empty joined result');

select * from finish();
rollback;
