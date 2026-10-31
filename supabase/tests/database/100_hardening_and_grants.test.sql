-- Structural security checks read from the catalogue: SECURITY DEFINER hardening, function execute grants, RLS
-- everywhere, policy targets, no views, privileges of anon and authenticated.

begin;

select plan(22);

select tests.clear();

-- ---- functions ----------------------------------------------------------------------------------------------------
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not coalesce(p.proconfig @> array['search_path=""'], false)),
  0,
  'every SECURITY DEFINER function in public and private has a fixed empty search_path'
);
select ok(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef) >= 15,
  'the SECURITY DEFINER functions of TASK-04 exist (sanity check on the count)'
);
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)),
  0,
  'no function in public or private is executable by PUBLIC'
);
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'anon can execute no function in public or private'
);
select is(
  (select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  'private.has_role_at_least, private.is_member, public.accept_invitation, public.change_member_role, '
    || 'public.create_invitation, public.leave_household, public.remove_member, public.revoke_invitation, '
    || 'public.set_automation_paused, public.set_rule_mode, public.update_household',
  'authenticated can execute exactly the two policy helpers and the nine authenticated RPC functions'
);
select ok(
  has_function_privilege('service_role', 'private.bootstrap_first_admin(text, text, text)', 'EXECUTE'),
  'service_role can execute the bootstrap'
);
select ok(
  not has_function_privilege('authenticated', 'private.bootstrap_first_admin(text, text, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'private.bootstrap_first_admin(text, text, text)', 'EXECUTE'),
  'neither authenticated nor anon can execute the bootstrap'
);

select tests.world();
select tests.as_user('alice');
select throws_ok($q$select count(*) from private.claim_jobs('attacker', 1, 60)$q$, '42501', null, 'authenticated cannot invoke job claiming');
select throws_ok($q$select private.acquire_lock('attacker-lock', 'attacker', 60)$q$, '42501', null, 'authenticated cannot acquire service job locks');
select throws_ok($q$select private.release_lock('attacker-lock', 'attacker')$q$, '42501', null, 'authenticated cannot release service job locks');
select throws_ok($q$select private.record_provider_call(tests.id('h1'), 'telemetry', true)$q$, '42501', null, 'authenticated cannot forge provider usage counters');
select tests.clear();

-- ---- schemas -------------------------------------------------------------------------------------------------------
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon cannot use the private schema');
select ok(has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated uses private only to evaluate the two policy helpers');

-- ---- tables, policies, views ------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0,
  'row level security is enabled on every table in public'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and (roles <> array['authenticated']::name[])),
  0,
  'every policy applies to authenticated only (anon and PUBLIC have no policy)'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and cmd = 'ALL'),
  0,
  'no policy uses FOR ALL: each operation is granted explicitly'
);
select is(
  (select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')),
  0,
  'there are no views or materialised views in public (views would bypass RLS)'
);
select is(
  (select count(*)::int
     from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'S')
      and (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
           or exists (select 1 from aclexplode(c.relacl) a where a.grantee = 'anon'::regrole::oid))),
  0,
  'anon holds no privilege on any table or sequence in public'
);
select is(
  (select count(*)::int from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and (has_table_privilege('authenticated', c.oid, 'TRUNCATE')
        or has_table_privilege('authenticated', c.oid, 'TRIGGER')
        or has_table_privilege('authenticated', c.oid, 'REFERENCES'))),
  0,
  'authenticated holds no TRUNCATE, TRIGGER or REFERENCES privilege'
);
select is(
  (select count(*)::int from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and has_table_privilege('authenticated', c.oid, 'SELECT')
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)),
  0,
  'every table authenticated can read has policies (nothing readable by grant alone)'
);
select is(
  (select count(*)::int from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and (has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
           or has_table_privilege('authenticated', c.oid, 'DELETE')
           or exists (select 1 from information_schema.columns k
                      where k.table_schema = 'public' and k.table_name = c.relname
                        and (has_column_privilege('authenticated', c.oid, k.column_name, 'INSERT')
                          or has_column_privilege('authenticated', c.oid, k.column_name, 'UPDATE'))))
      and c.relname in ('household_members', 'household_invitations', 'audit_log', 'powerwall_metrics_log', 'energy_intervals',
                        'telemetry_rollups_hourly', 'telemetry_rollups_daily', 'telemetry_sync_state', 'cost_rollups_daily',
                        'provider_usage_daily', 'automation_executions', 'device_command_events', 'tesla_credentials',
                        'oauth_states', 'system_bootstrap', 'job_locks', 'scheduled_jobs')),
  0,
  'authenticated has no write privilege (table or column) on membership, invitation, audit, telemetry or server-only tables'
);
select is(
  (select count(*)::int from pg_trigger t
    where t.tgrelid = 'auth.users'::regclass and t.tgname = 'on_auth_user_created' and not t.tgisinternal),
  1,
  'the auth trigger that creates user_profiles is installed'
);

select * from finish();

rollback;
