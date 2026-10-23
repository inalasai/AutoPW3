-- New-user default: sign-up creates a profile only, never a household, a role or any data access.

begin;

select plan(10);

select tests.world();
select tests.new_user('newbie');

select tests.clear();
select is(
  (select count(*)::int from public.user_profiles where user_id = tests.id('newbie')),
  1,
  'sign-up creates a user_profiles row (auth trigger)'
);
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'user_profiles' and column_name ilike '%role%'),
  0,
  'user_profiles has no role column: roles live only in household_members'
);
select is(
  (select count(*)::int from public.household_members where user_id = tests.id('newbie')),
  0,
  'a new user has no household membership and therefore no role'
);

select tests.as_user('newbie');
select is((select count(*)::int from public.households), 0, 'a new user sees no household');
select is(
  (select count(*)::int from public.energy_sites)
    + (select count(*)::int from public.utility_tariffs)
    + (select count(*)::int from public.powerwall_metrics_log)
    + (select count(*)::int from public.automation_rules)
    + (select count(*)::int from public.household_settings)
    + (select count(*)::int from public.audit_log),
  0,
  'a new user sees no sites, tariffs, telemetry, rules, settings or audit rows'
);
select is((select count(*)::int from public.user_profiles), 1, 'a new user sees only their own profile');
select lives_ok(
  $q$update public.user_profiles set display_name = 'Newbie' where user_id = tests.id('newbie')$q$,
  'a user can update their own display name'
);
select throws_ok(
  $q$insert into public.household_members (household_id, user_id, role) values (tests.id('h1'), tests.id('newbie'), 'READ_ONLY')$q$,
  '42501', null,
  'a new user cannot add themselves to a household'
);
select throws_ok(
  $q$update public.user_profiles set user_id = tests.id('alice') where user_id = tests.id('newbie')$q$,
  '42501', null,
  'a user cannot change the owner of a profile row'
);

select tests.clear();
select is(
  (select display_name from public.user_profiles where user_id = tests.id('newbie')),
  'Newbie',
  'the display name update was applied'
);

select * from finish();

rollback;
