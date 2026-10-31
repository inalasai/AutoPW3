-- Profile rows are private to their owner and admins of a shared household.
begin;

select plan(16);
select tests.world();

select tests.new_user('dave');
select tests.new_user('multi');
select tests.new_household('h3');
select tests.new_member('h3', 'dave', 'ADMIN');
select tests.new_member('h1', 'multi', 'ADMIN');
select tests.new_member('h2', 'multi', 'READ_ONLY');

-- ADMIN sees the profiles of members of the shared household, and no others.
select tests.as_user('alice');
select is((select count(*)::int from public.user_profiles), 4, 'h1 admin sees only the four h1 profiles');
select is((select count(*)::int from public.user_profiles where user_id = tests.id('bob')), 0, 'changing the profile UUID cannot read an unrelated household profile');
select is((select count(*)::int from public.user_profiles where user_id = tests.id('dave')), 0, 'h1 admin cannot see h3 profile');
select is((select count(*)::int from public.user_profiles where user_id = tests.id('multi')), 1, 'h1 admin sees a member who also belongs to h2');

-- READ_WRITE and READ_ONLY memberships do not grant directory access.
select tests.as_user('rw1');
select is((select count(*)::int from public.user_profiles), 1, 'READ_WRITE sees only own profile');
select is((select count(*)::int from public.user_profiles where user_id = tests.id('ro1')), 0, 'READ_WRITE cannot query another h1 profile by UUID');
select tests.as_user('ro1');
select is((select count(*)::int from public.user_profiles), 1, 'READ_ONLY sees only own profile');
select is((select count(*)::int from public.user_profiles where user_id = tests.id('alice')), 0, 'READ_ONLY cannot query admin profile by UUID');

-- A user with multiple memberships is visible to admins of each shared household only.
select tests.as_user('bob');
select is((select count(*)::int from public.user_profiles), 2, 'h2 admin sees only h2 members, including multi-household member');
select is((select count(*)::int from public.user_profiles where user_id = tests.id('alice')), 0, 'h2 admin cannot see h1-only profile');

-- Membership-free users retain only self access.
select tests.as_user('carol');
select is((select count(*)::int from public.user_profiles), 1, 'user with no household sees own profile only');
select is((select count(*)::int from public.user_profiles where user_id = tests.id('dave')), 0, 'membership-free user cannot query another profile by UUID');

-- IDs from unrelated tenants do not turn a read into an authorized operation.
select tests.as_user('dave');
select is((select count(*)::int from public.user_profiles where user_id = tests.id('bob')), 0, 'h3 admin cannot read h2 profile by changing the requested UUID');

-- The SQL role cannot bypass row filters by selecting the whole table or by using a join.
select tests.as_user('alice');
select is((select count(*)::int from public.user_profiles p join public.household_members m on m.user_id = p.user_id where m.household_id = tests.id('h2')), 0, 'join cannot see household memberships hidden by RLS');
select is((select count(*)::int from public.user_profiles p where p.user_id in (select user_id from public.household_members where household_id = tests.id('h2'))), 0, 'subquery cannot expose unrelated household members');

select tests.clear();
select is((select count(*)::int from public.user_profiles), 7, 'owner fixture can inspect all seven test profiles after role reset');

select * from finish();
rollback;
