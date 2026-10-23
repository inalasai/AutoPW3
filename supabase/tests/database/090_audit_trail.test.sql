-- Audit rows for privileged actions, the metadata allowlist, and who may read the trail.
-- Membership, invitation and bootstrap audit rows are asserted in 040, 050 and 060.

begin;

select plan(22);

select tests.world();

-- ---- actions through the API produce audit rows --------------------------------------------------------------------
select tests.as_user('rw1');
select lives_ok(
  $q$insert into public.utility_tariffs (household_id, name, direction, price_mode, currency, timezone, effective_from, flat_rate_per_kwh)
     values (tests.id('h1'), 'audited tariff', 'EXPORT', 'FLAT', 'EUR', 'Europe/Dublin', date '2025-01-01', 0.01)$q$,
  'READ_WRITE creates a tariff version'
);
select lives_ok($q$select public.set_rule_mode(tests.id('r1'), 'DISABLED')$q$, 'READ_WRITE changes a rule mode');
select lives_ok($q$select public.set_automation_paused(tests.id('h1'), true)$q$, 'READ_WRITE pauses automation');
select lives_ok(
  $q$insert into public.device_command_log (household_id, site_id, origin, kind, params, params_hash, idempotency_key, provider_mode)
     values (tests.id('h1'), tests.id('s1'), 'USER', 'SET_BACKUP_RESERVE', '{"reservePercent":30}'::jsonb, decode(repeat('ab', 32), 'hex'), 'key-aud-0001', 'MOCK')$q$,
  'READ_WRITE records a command'
);

select tests.as_user('alice');
select lives_ok($q$select public.set_automation_paused(tests.id('h1'), false)$q$, 'ADMIN resumes automation');
select lives_ok(
  $q$update public.household_settings set monthly_spend_cap_usd = 4, raw_retention_days = 30 where household_id = tests.id('h1')$q$,
  'ADMIN changes settings'
);
select lives_ok(
  $q$delete from public.utility_tariffs where name = 'audited tariff'$q$,
  'ADMIN deletes a tariff version'
);

select tests.clear();
select is(
  (select count(*)::int from public.audit_log
    where action = 'tariff.version_created' and actor_user_id = tests.id('rw1') and metadata ? 'tariff_id' and metadata ? 'version'),
  1,
  'tariff creation is audited with the actor'
);
select is(
  (select count(*)::int from public.audit_log
    where action = 'tariff.deleted' and actor_user_id = tests.id('alice')),
  1,
  'tariff deletion is audited'
);
select is(
  (select count(*)::int from public.audit_log
    where action = 'rule.mode_changed' and actor_user_id = tests.id('rw1')
      and metadata ->> 'old_mode' = 'DRY_RUN' and metadata ->> 'new_mode' = 'DISABLED'),
  1,
  'a rule mode change is audited with old and new mode'
);
select is(
  (select count(*)::int from public.audit_log where action = 'automation.paused' and actor_user_id = tests.id('rw1')), 1,
  'pausing automation is audited'
);
select is(
  (select count(*)::int from public.audit_log where action = 'automation.resumed' and actor_user_id = tests.id('alice')), 1,
  'resuming automation is audited'
);
select is(
  (select count(*)::int from public.audit_log
    where action = 'settings.changed' and actor_user_id = tests.id('alice')
      and metadata -> 'changed' = '["monthly_spend_cap_usd", "raw_retention_days"]'::jsonb),
  1,
  'a settings change is audited with the names of the changed settings, not their values'
);
select is(
  (select count(*)::int from public.audit_log
    where action = 'command.requested' and actor_user_id = tests.id('rw1')
      and metadata ->> 'kind' = 'SET_BACKUP_RESERVE' and not (metadata ? 'params')),
  1,
  'a command request is audited without its parameters'
);
select is(
  (select count(*)::int from public.audit_log where action = 'member.added' and actor_type = 'SYSTEM'), 4,
  'memberships created by the owner role are audited as SYSTEM actions'
);

-- ---- the allowlist ---------------------------------------------------------------------------------------------------
select private.touch_audit(
  tests.id('h1'), 'settings.changed', 'household_settings', tests.id('h1')::text,
  '{"changed": ["a"], "token": "secret-value", "access_token": "x", "payload": {"k": 1}}'::jsonb
);
select is(
  (select metadata from public.audit_log where action = 'settings.changed' and target_id = tests.id('h1')::text
     and metadata ? 'changed' and metadata -> 'changed' = '["a"]'::jsonb order by id desc limit 1),
  '{"changed": ["a"]}'::jsonb,
  'keys outside the allowlist (tokens, payloads) never reach the audit log'
);
select throws_ok(
  $q$select private.touch_audit(null, 'made.up.action', null, null, '{}'::jsonb)$q$,
  '22023', null, 'an unknown audit action is rejected'
);

-- ---- who can read the trail ---------------------------------------------------------------------------------------
select tests.as_user('alice');
select ok((select count(*) from public.audit_log) > 0, 'an ADMIN reads their household''s audit log');
select is(
  (select count(*)::int from public.audit_log where household_id <> tests.id('h1')), 0,
  'an ADMIN never sees another household''s audit rows'
);
select tests.as_user('rw1');
select is((select count(*)::int from public.audit_log), 0, 'READ_WRITE cannot read the audit log');
select tests.as_user('bob');
select is(
  (select count(*)::int from public.audit_log where household_id = tests.id('h1')), 0,
  'an ADMIN of h2 cannot read the h1 audit log'
);
select tests.as_user('alice');
select throws_ok(
  $q$select private.touch_audit(tests.id('h1'), 'settings.changed', null, null, '{}'::jsonb)$q$,
  '42501', null, 'the audit writer is not callable by authenticated users'
);

select * from finish();

rollback;
