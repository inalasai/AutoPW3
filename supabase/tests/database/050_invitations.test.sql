-- Invitations: hashed single-use expiring tokens, READ_ONLY by default, email binding, revocation.

begin;

select plan(41);

select tests.world();
select tests.new_user('dave');
select tests.new_user('erin', false);   -- email not confirmed
select tests.new_user('frank');

-- ---- creating invitations --------------------------------------------------------------------------------------
select tests.as_user('alice');
select set_config(
  'tests.tok_carol',
  (select invitation_token from public.create_invitation(tests.id('h1'), 'carol@example.invalid')),
  true
);
select set_config(
  'tests.inv_carol',
  (select invitation_id::text from public.create_invitation(tests.id('h1'), 'unused@example.invalid')),
  true
);
select ok(current_setting('tests.tok_carol') ~ '^[0-9a-f]{64}$', 'the token is 256 random bits, hex encoded');

select tests.clear();
select is(
  (select count(*)::int from public.household_invitations
    where token_hash = sha256(convert_to(current_setting('tests.tok_carol'), 'UTF8'))),
  1,
  'only the SHA-256 of the token is stored'
);
select is(
  (select count(*)::int from public.household_invitations i where to_jsonb(i)::text like '%' || current_setting('tests.tok_carol') || '%'),
  0,
  'the token itself appears in no column'
);
select is(
  (select role::text from public.household_invitations where token_hash = sha256(convert_to(current_setting('tests.tok_carol'), 'UTF8'))),
  'READ_ONLY',
  'an invitation defaults to READ_ONLY'
);
select is(
  (select extract(epoch from expires_at - created_at)::bigint from public.household_invitations
    where token_hash = sha256(convert_to(current_setting('tests.tok_carol'), 'UTF8'))),
  604800::bigint,
  'an invitation expires after 7 days by default'
);

select tests.as_user('ro1');
select throws_ok($q$select public.create_invitation(tests.id('h1'), 'x@example.invalid')$q$, '42501', 'not_authorised', 'READ_ONLY cannot invite');
select tests.as_user('rw1');
select throws_ok($q$select public.create_invitation(tests.id('h1'), 'x@example.invalid')$q$, '42501', 'not_authorised', 'READ_WRITE cannot invite');
select tests.as_user('carol');
select throws_ok($q$select public.create_invitation(tests.id('h1'), 'x@example.invalid')$q$, '42501', 'not_authorised', 'a non-member cannot invite');
select tests.as_anon();
select throws_ok($q$select public.create_invitation(tests.id('h1'), 'x@example.invalid')$q$, '42501', null, 'anon cannot invite');

select tests.as_user('alice');
select throws_ok(
  $q$select public.create_invitation(tests.id('h1'), 'x@example.invalid', 'READ_ONLY', interval '31 days')$q$,
  'P0001', 'invalid_argument', 'an invitation cannot live longer than 30 days'
);
select throws_ok(
  $q$select public.create_invitation(tests.id('h1'), 'not-an-email')$q$,
  'P0001', 'invalid_argument', 'a malformed email is rejected'
);
select is((select count(*)::int from public.household_invitations), 2, 'an ADMIN lists the household invitations');
select throws_ok(
  'select token_hash from public.household_invitations',
  '42501', null, 'the token hash column cannot be read through the API'
);
select throws_ok(
  $q$insert into public.household_invitations (household_id, role, token_hash, expires_at)
     values (tests.id('h1'), 'ADMIN', decode(repeat('cd', 32), 'hex'), now() + interval '1 day')$q$,
  '42501', null, 'invitations cannot be inserted directly (not even by an ADMIN)'
);

-- ---- accepting -------------------------------------------------------------------------------------------------
select tests.as_anon();
select throws_ok(
  $q$select public.accept_invitation(current_setting('tests.tok_carol'))$q$,
  '42501', null, 'anon cannot accept an invitation'
);

select tests.as_user('dave');
select throws_ok(
  $q$select public.accept_invitation(current_setting('tests.tok_carol'))$q$,
  'P0001', 'invalid_invitation', 'an invitation bound to carol''s email cannot be accepted by dave'
);
select throws_ok($q$select public.accept_invitation('not-a-token')$q$, 'P0001', 'invalid_invitation', 'a malformed token is rejected');
select throws_ok(
  $q$select public.accept_invitation(repeat('0', 64))$q$,
  'P0001', 'invalid_invitation', 'an unknown token gets the same error as any other failure'
);

select tests.as_user('carol');
select is(
  (select public.accept_invitation(current_setting('tests.tok_carol'))), tests.id('h1'),
  'carol accepts her invitation and learns the household id'
);
select is(
  (select role::text from public.household_members where user_id = tests.id('carol') and household_id = tests.id('h1')),
  'READ_ONLY',
  'acceptance creates a READ_ONLY membership'
);
select throws_ok(
  $q$select public.accept_invitation(current_setting('tests.tok_carol'))$q$,
  'P0001', 'invalid_invitation', 'an accepted token cannot be reused'
);

select tests.as_user('frank');
select throws_ok(
  $q$select public.accept_invitation(current_setting('tests.tok_carol'))$q$,
  'P0001', 'invalid_invitation', 'another user cannot reuse an accepted token'
);

select tests.clear();
select is(
  (select count(*)::int from public.audit_log where action = 'invitation.accepted' and actor_user_id = tests.id('carol')),
  1, 'acceptance is audited'
);
select is(
  (select count(*)::int from public.audit_log where action = 'invitation.created' and actor_user_id = tests.id('alice')
     and metadata ? 'invitation_id' and not (metadata ? 'token') and not (metadata ? 'token_hash')),
  2, 'creation is audited and the audit row holds no token'
);

-- ---- bearer invitation (no email): any signed-in user holding the token -----------------------------------------
select tests.as_user('alice');
select set_config('tests.tok_open', (select invitation_token from public.create_invitation(tests.id('h1'))), true);
select tests.as_user('frank');
select is(
  (select public.accept_invitation(current_setting('tests.tok_open'))), tests.id('h1'),
  'an invitation without an email can be accepted by whoever holds the token'
);
select throws_ok(
  $q$select public.accept_invitation(current_setting('tests.tok_open'))$q$,
  'P0001', 'invalid_invitation', 'a bearer token is single use too'
);

-- ---- email binding needs a CONFIRMED email -------------------------------------------------------------------------
select tests.as_user('alice');
select set_config('tests.tok_erin', (select invitation_token from public.create_invitation(tests.id('h1'), 'erin@example.invalid')), true);
select tests.as_user('erin');
select throws_ok(
  $q$select public.accept_invitation(current_setting('tests.tok_erin'))$q$,
  'P0001', 'invalid_invitation', 'a matching but unconfirmed email cannot accept'
);
select tests.clear();
update auth.users set email_confirmed_at = now() where id = tests.id('erin');
select tests.as_user('erin');
select lives_ok($q$select public.accept_invitation(current_setting('tests.tok_erin'))$q$, 'once the email is confirmed the invitation can be accepted');

-- ---- expiry --------------------------------------------------------------------------------------------------------
select tests.as_user('alice');
select set_config('tests.tok_old', (select invitation_token from public.create_invitation(tests.id('h1'), 'dave@example.invalid')), true);
select tests.clear();
update public.household_invitations
set created_at = now() - interval '9 days', expires_at = now() - interval '2 days'
where token_hash = sha256(convert_to(current_setting('tests.tok_old'), 'UTF8'));
select tests.as_user('dave');
select throws_ok(
  $q$select public.accept_invitation(current_setting('tests.tok_old'))$q$,
  'P0001', 'invalid_invitation', 'an expired invitation cannot be accepted'
);
select tests.clear();
select is(
  (select count(*)::int from public.household_members where user_id = tests.id('dave')), 0,
  'the expired invitation created no membership'
);

-- ---- revocation -------------------------------------------------------------------------------------------------
select tests.as_user('alice');
select set_config('tests.tok_rev', (select invitation_token from public.create_invitation(tests.id('h1'), 'dave@example.invalid')), true);
select tests.clear();
select set_config(
  'tests.inv_rev',
  (select id::text from public.household_invitations where token_hash = sha256(convert_to(current_setting('tests.tok_rev'), 'UTF8'))),
  true
);
select tests.as_user('bob');
select throws_ok(
  $q$select public.revoke_invitation(current_setting('tests.inv_rev')::uuid)$q$,
  '42501', 'not_authorised', 'an ADMIN of another household cannot revoke the invitation'
);
select tests.as_user('ro1');
select throws_ok(
  $q$select public.revoke_invitation(current_setting('tests.inv_rev')::uuid)$q$,
  '42501', 'not_authorised', 'a READ_ONLY member cannot revoke an invitation'
);
select tests.as_user('alice');
select lives_ok($q$select public.revoke_invitation(current_setting('tests.inv_rev')::uuid)$q$, 'an ADMIN can revoke an open invitation');
select throws_ok(
  $q$select public.revoke_invitation(current_setting('tests.inv_rev')::uuid)$q$,
  'P0001', 'invalid_invitation', 'a revoked invitation cannot be revoked again'
);
select tests.as_user('dave');
select throws_ok(
  $q$select public.accept_invitation(current_setting('tests.tok_rev'))$q$,
  'P0001', 'invalid_invitation', 'a revoked invitation cannot be accepted'
);
select tests.clear();
select is((select count(*)::int from public.audit_log where action = 'invitation.revoked'), 1, 'revocation is audited');

-- ---- a role above READ_ONLY is honoured only while the inviter is still an ADMIN ------------------------------------
select tests.as_user('alice');
select set_config(
  'tests.tok_rw',
  (select invitation_token from public.create_invitation(tests.id('h1'), 'dave@example.invalid', 'READ_WRITE')),
  true
);
select tests.clear();
select throws_ok(
  $q$select public.accept_invitation(current_setting('tests.tok_rw'))$q$,
  '42501', null, 'the owner role has no auth.uid() and cannot accept (needs a signed-in user)'
);
select tests.as_user('dave');
select is(
  (select public.accept_invitation(current_setting('tests.tok_rw'))), tests.id('h1'),
  'an invitation for READ_WRITE from an ADMIN grants READ_WRITE'
);
select tests.clear();
select is(
  (select role::text from public.household_members where user_id = tests.id('dave') and household_id = tests.id('h1')),
  'READ_WRITE',
  'the invited role was applied'
);

select tests.as_user('alice');
select set_config(
  'tests.tok_adm',
  (select invitation_token from public.create_invitation(tests.id('h1'), 'bob@example.invalid', 'ADMIN')),
  true
);
select tests.clear();
-- alice stops being ADMIN (rw1 is promoted first so the last-admin guard allows it)
update public.household_members set role = 'ADMIN' where user_id = tests.id('rw1');
update public.household_members set role = 'READ_ONLY' where user_id = tests.id('alice');
select tests.as_user('bob');
select throws_ok(
  $q$select public.accept_invitation(current_setting('tests.tok_adm'))$q$,
  'P0001', 'invalid_invitation', 'an ADMIN invitation is void once its inviter is no longer an ADMIN'
);

-- ---- already a member ------------------------------------------------------------------------------------------
select tests.as_user('rw1');
select set_config('tests.tok_dup', (select invitation_token from public.create_invitation(tests.id('h1'))), true);
select throws_ok(
  $q$select public.accept_invitation(current_setting('tests.tok_dup'))$q$,
  'P0001', 'already_member', 'an existing member cannot accept an invitation to the same household'
);

select * from finish();

rollback;
