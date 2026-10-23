-- Role self-escalation, membership tampering and last-admin protection, enforced in the database.

begin;

select plan(38);

select tests.world();

-- ---- no table write grants: membership is only changed through audited functions -------------------------------
select tests.as_user('ro1');
select throws_ok(
  $q$update public.household_members set role = 'ADMIN' where user_id = tests.id('ro1')$q$,
  '42501', null, 'a READ_ONLY user cannot raise their own role with a table update'
);
select throws_ok(
  $q$insert into public.household_members (household_id, user_id, role) values (tests.id('h1'), tests.id('carol'), 'READ_ONLY')$q$,
  '42501', null, 'a READ_ONLY user cannot add members'
);
select throws_ok(
  $q$delete from public.household_members where user_id = tests.id('rw1')$q$,
  '42501', null, 'a READ_ONLY user cannot remove members'
);
select throws_ok(
  $q$select public.change_member_role(tests.id('h1'), tests.id('ro1'), 'ADMIN')$q$,
  '42501', 'not_authorised', 'a READ_ONLY user cannot raise their own role through the function'
);
select throws_ok(
  $q$select public.remove_member(tests.id('h1'), tests.id('rw1'))$q$,
  '42501', 'not_authorised', 'a READ_ONLY user cannot remove another member'
);

select tests.as_user('rw1');
select throws_ok(
  $q$select public.change_member_role(tests.id('h1'), tests.id('rw1'), 'ADMIN')$q$,
  '42501', 'not_authorised', 'a READ_WRITE user cannot raise their own role'
);

-- ---- an ADMIN cannot change their own role or remove themselves ------------------------------------------------
select tests.as_user('alice');
select throws_ok(
  $q$select public.change_member_role(tests.id('h1'), tests.id('alice'), 'READ_ONLY')$q$,
  'P0001', 'self_change_not_allowed', 'an ADMIN cannot change their own role'
);
select throws_ok(
  $q$select public.remove_member(tests.id('h1'), tests.id('alice'))$q$,
  'P0001', 'self_change_not_allowed', 'an ADMIN cannot remove themselves with remove_member'
);

-- ---- cross-household administration ---------------------------------------------------------------------------
select throws_ok(
  $q$select public.change_member_role(tests.id('h2'), tests.id('bob'), 'READ_ONLY')$q$,
  '42501', 'not_authorised', 'an ADMIN of h1 cannot change roles in h2'
);
select throws_ok(
  $q$select public.remove_member(tests.id('h2'), tests.id('bob'))$q$,
  '42501', 'not_authorised', 'an ADMIN of h1 cannot remove a member of h2'
);
select throws_ok(
  $q$select public.change_member_role(tests.id('h1'), tests.id('carol'), 'READ_ONLY')$q$,
  'P0002', 'member_not_found', 'changing the role of a non-member fails and does not create a membership'
);
select throws_ok(
  $q$select public.create_invitation(tests.id('h2'), 'x@example.invalid')$q$,
  '42501', 'not_authorised', 'an ADMIN of h1 cannot invite into h2'
);

-- ---- defence in depth: the trigger refuses self role changes and key changes for every writer ------------------
select tests.clear();
select set_config('request.jwt.claim.sub', tests.id('ro1')::text, true);
select throws_ok(
  $q$update public.household_members set role = 'ADMIN' where user_id = tests.id('ro1')$q$,
  'P0001', 'self_change_not_allowed', 'the trigger rejects a self role change even without the table grant check'
);
select tests.clear();
select throws_ok(
  $q$update public.household_members set user_id = tests.id('carol') where user_id = tests.id('ro1')$q$,
  'P0001', 'immutable_key', 'a membership cannot be handed to another user'
);
select throws_ok(
  $q$update public.household_members set household_id = tests.id('h2') where user_id = tests.id('ro1')$q$,
  'P0001', 'immutable_key', 'a membership cannot be moved to another household'
);
select is((select role::text from public.household_members where user_id = tests.id('ro1')), 'READ_ONLY', 'ro1 is still READ_ONLY');

-- ---- ADMIN changes roles and removes members; audit rows are written ------------------------------------------
select tests.as_user('alice');
select lives_ok(
  $q$select public.change_member_role(tests.id('h1'), tests.id('ro1'), 'READ_WRITE')$q$,
  'an ADMIN can change another member''s role'
);
select lives_ok($q$select public.remove_member(tests.id('h1'), tests.id('rw1'))$q$, 'an ADMIN can remove another member');
select throws_ok(
  $q$select public.remove_member(tests.id('h1'), tests.id('rw1'))$q$,
  'P0002', 'member_not_found', 'removing a non-member fails'
);

select tests.clear();
select is((select role::text from public.household_members where user_id = tests.id('ro1')), 'READ_WRITE', 'the role change was applied');
select is((select count(*)::int from public.household_members where user_id = tests.id('rw1')), 0, 'the removal was applied');
select is(
  (select count(*)::int from public.audit_log
    where action = 'member.role_changed' and actor_user_id = tests.id('alice') and actor_type = 'USER'
      and metadata ->> 'old_role' = 'READ_ONLY' and metadata ->> 'new_role' = 'READ_WRITE'
      and (metadata ->> 'user_id')::uuid = tests.id('ro1')),
  1,
  'the role change is audited with actor, old role and new role'
);
select is(
  (select count(*)::int from public.audit_log
    where action = 'member.removed' and actor_user_id = tests.id('alice') and (metadata ->> 'user_id')::uuid = tests.id('rw1')),
  1,
  'the removal is audited'
);

-- ---- last-admin protection ---------------------------------------------------------------------------------------
select tests.as_user('alice');
select throws_ok(
  $q$select public.leave_household(tests.id('h1'))$q$,
  'P0001', 'last_admin_protected', 'the last ADMIN cannot leave the household'
);

select tests.clear();
select throws_ok(
  $q$delete from public.household_members where user_id = tests.id('alice')$q$,
  'P0001', 'last_admin_protected', 'the last ADMIN row cannot be deleted by any writer'
);
select throws_ok(
  $q$update public.household_members set role = 'READ_ONLY' where user_id = tests.id('alice')$q$,
  'P0001', 'last_admin_protected', 'the last ADMIN cannot be demoted by any writer'
);
select throws_ok(
  $q$delete from auth.users where id = tests.id('alice')$q$,
  'P0001', 'last_admin_protected', 'deleting the account of the last ADMIN is refused until another ADMIN exists'
);
select is(
  (select count(*)::int from public.household_members where household_id = tests.id('h1') and role = 'ADMIN'), 1,
  'h1 still has its ADMIN'
);

select tests.as_user('alice');
select lives_ok(
  $q$select public.change_member_role(tests.id('h1'), tests.id('ro1'), 'ADMIN')$q$,
  'an ADMIN can promote another member to ADMIN'
);
select lives_ok($q$select public.leave_household(tests.id('h1'))$q$, 'an ADMIN can leave once another ADMIN exists');
select tests.clear();
select is(
  (select count(*)::int from public.household_members where household_id = tests.id('h1') and role = 'ADMIN'), 1,
  'exactly one ADMIN remains'
);

select tests.as_user('ro1');
select throws_ok(
  $q$select public.leave_household(tests.id('h1'))$q$,
  'P0001', 'last_admin_protected', 'the new sole ADMIN cannot leave either'
);
select throws_ok(
  $q$select public.leave_household(tests.id('h2'))$q$,
  '42501', 'not_authorised', 'leaving a household you are not in fails'
);

-- A non-admin can leave.
select tests.clear();
select tests.new_user('leaver');
select tests.new_member('h1', 'leaver', 'READ_ONLY');
select tests.as_user('leaver');
select lives_ok($q$select public.leave_household(tests.id('h1'))$q$, 'a non-admin member can leave');

-- Deleting a household removes its members even when the sole ADMIN is among them (the guard allows the cascade).
select tests.clear();
select lives_ok($q$delete from public.households where id = tests.id('h2')$q$, 'a household can be deleted with its sole ADMIN');
select is(
  (select count(*)::int from public.household_members where user_id = tests.id('bob')), 0,
  'the household deletion removed the membership'
);

-- Anonymous callers cannot reach the functions at all.
select tests.as_anon();
select throws_ok(
  $q$select public.change_member_role(tests.id('h1'), tests.id('ro1'), 'READ_ONLY')$q$,
  '42501', null, 'anon cannot execute change_member_role'
);
select throws_ok($q$select public.leave_household(tests.id('h1'))$q$, '42501', null, 'anon cannot execute leave_household');

select * from finish();

rollback;
