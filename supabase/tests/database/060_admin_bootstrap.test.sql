-- One-time admin bootstrap: trusted role only, works once, impossible to rerun, audited.
-- This test removes any existing admins INSIDE its transaction (rolled back at the end) to start from an
-- unbootstrapped database. Run it against a local test database only.

begin;

select plan(24);

select tests.world();
select tests.new_user('owner1');
select tests.new_user('unconfirmed', false);

-- ---- nobody but the trusted role can run it ---------------------------------------------------------------------
select tests.as_anon();
select throws_ok(
  $q$select private.bootstrap_first_admin('owner1@example.invalid', 'Home', 'Europe/Dublin')$q$,
  '42501', null, 'anon cannot run the bootstrap'
);
select tests.as_user('owner1');
select throws_ok(
  $q$select private.bootstrap_first_admin('owner1@example.invalid', 'Home', 'Europe/Dublin')$q$,
  '42501', null, 'an authenticated user cannot run the bootstrap'
);

-- ---- refused while an ADMIN already exists ---------------------------------------------------------------------
select tests.as_service();
select throws_ok(
  $q$select private.bootstrap_first_admin('owner1@example.invalid', 'Home', 'Europe/Dublin')$q$,
  'P0001', 'bootstrap_not_allowed', 'the bootstrap is refused when an ADMIN already exists'
);

-- Start from an unbootstrapped database: remove all memberships and any bootstrap marker (inside this transaction).
select tests.clear();
alter table public.household_members disable trigger household_members_guard;
delete from public.household_members;
alter table public.household_members enable trigger household_members_guard;
delete from public.system_bootstrap;

-- ---- argument checks -----------------------------------------------------------------------------------------------
select tests.as_service();
select throws_ok(
  $q$select private.bootstrap_first_admin('', 'Home', 'Europe/Dublin')$q$,
  'P0001', 'invalid_argument', 'an empty email is rejected'
);
select throws_ok(
  $q$select private.bootstrap_first_admin('owner1@example.invalid', '', 'Europe/Dublin')$q$,
  'P0001', 'invalid_argument', 'an empty household name is rejected'
);
select throws_ok(
  $q$select private.bootstrap_first_admin('nobody@example.invalid', 'Home', 'Europe/Dublin')$q$,
  'P0002', 'bootstrap_user_not_found', 'an unknown email is rejected: the user must sign up first'
);
select throws_ok(
  $q$select private.bootstrap_first_admin('unconfirmed@example.invalid', 'Home', 'Europe/Dublin')$q$,
  'P0002', 'bootstrap_user_not_found', 'a user with an unconfirmed email is rejected'
);
select throws_ok(
  $q$select private.bootstrap_first_admin('owner1@example.invalid', 'Home', 'Mars/Olympus_Mons')$q$,
  '22023', null, 'an invalid IANA timezone is rejected'
);

select tests.clear();
select is((select count(*)::int from public.system_bootstrap), 0, 'failed attempts left no bootstrap marker');
select is(
  (select count(*)::int from public.household_members), 0,
  'failed attempts created no membership'
);

-- ---- success: exactly once -----------------------------------------------------------------------------------------
select tests.as_service();
select set_config(
  'tests.boot_household',
  (select private.bootstrap_first_admin('Owner1@Example.Invalid', '  Home  ', 'Europe/Dublin')::text),
  true
);
select ok(current_setting('tests.boot_household')::uuid is not null, 'the bootstrap returns the new household id');

select tests.clear();
select is(
  (select count(*)::int from public.household_members
    where household_id = current_setting('tests.boot_household')::uuid and user_id = tests.id('owner1') and role = 'ADMIN'),
  1,
  'the named, confirmed user is ADMIN of the new household'
);
select is(
  (select name from public.households where id = current_setting('tests.boot_household')::uuid), 'Home',
  'the household name was trimmed and stored'
);
select is(
  (select count(*)::int from public.household_settings where household_id = current_setting('tests.boot_household')::uuid), 1,
  'the household has its settings row'
);
select is((select count(*)::int from public.system_bootstrap), 1, 'the bootstrap marker exists');
select is(
  (select count(*)::int from public.system_bootstrap where bootstrap_by_email_hash = sha256(convert_to('owner1@example.invalid', 'UTF8'))),
  1,
  'the marker stores only a hash of the email'
);
select is(
  (select count(*)::int from public.audit_log
    where action = 'bootstrap.completed' and actor_type = 'SYSTEM' and household_id = current_setting('tests.boot_household')::uuid
      and metadata = jsonb_build_object('household_id', current_setting('tests.boot_household'))),
  1,
  'the bootstrap is audited as a SYSTEM action with only the household id'
);

select tests.as_service();
select throws_ok(
  $q$select private.bootstrap_first_admin('owner1@example.invalid', 'Second', 'Europe/Dublin')$q$,
  'P0001', 'bootstrap_already_completed', 'the bootstrap cannot be run a second time'
);

-- ---- still impossible after the household is deleted or the admin leaves ---------------------------------------------
select tests.clear();
delete from public.households where id = current_setting('tests.boot_household')::uuid;
select is((select count(*)::int from public.system_bootstrap), 1, 'the marker survives deletion of the household');
select tests.as_service();
select throws_ok(
  $q$select private.bootstrap_first_admin('owner1@example.invalid', 'Third', 'Europe/Dublin')$q$,
  'P0001', 'bootstrap_already_completed', 'the bootstrap stays impossible after the household is deleted'
);

-- ---- the marker table is server-only --------------------------------------------------------------------------------
select tests.as_user('owner1');
select throws_ok('select 1 from public.system_bootstrap', '42501', null, 'an authenticated user cannot read system_bootstrap');
select throws_ok('insert into public.system_bootstrap (id) values (true)', '42501', null, 'an authenticated user cannot write system_bootstrap');

-- ---- new users never receive a role by themselves -------------------------------------------------------------------
select tests.clear();
select is(
  (select count(*)::int from public.household_members where user_id = tests.id('unconfirmed')), 0,
  'a user who signed up but was not bootstrapped has no role'
);
select is(
  (select count(*)::int from public.household_members m where m.role = 'ADMIN' and m.user_id <> tests.id('owner1')), 0,
  'no other user became ADMIN'
);

select * from finish();

rollback;
