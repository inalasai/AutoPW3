-- Tesla credentials and the other server-only tables: no access for anon or authenticated, whoever they are.
-- Only the Worker's secret key (service_role) reaches them. Also: anon has nothing anywhere.

begin;

select plan(29 + (select count(*)::int from pg_tables where schemaname = 'public'));

select tests.world();

-- ---- authenticated (even an ADMIN) and anon: no read, no write ---------------------------------------------------
select tests.as_user('alice');
select throws_ok(
  format('select 1 from public.%I', t), '42501', null, 'ADMIN cannot read ' || t
) from unnest(array['tesla_credentials', 'oauth_states', 'system_bootstrap', 'job_locks', 'scheduled_jobs']) as t;
select throws_ok(
  format('delete from public.%I', t), '42501', null, 'ADMIN cannot delete from ' || t
) from unnest(array['tesla_credentials', 'oauth_states', 'system_bootstrap', 'job_locks', 'scheduled_jobs']) as t;
select throws_ok(
  $q$insert into public.tesla_credentials (household_id, key_id, nonce, ciphertext, fleet_api_base_url)
     values (tests.id('h1'), 'k1', decode(repeat('00', 12), 'hex'), decode(repeat('11', 32), 'hex'), 'https://fleet.example.invalid')$q$,
  '42501', null, 'an ADMIN cannot store credentials through the API'
);

select tests.as_anon();
select throws_ok(
  format('select 1 from public.%I', t), '42501', null, 'anon cannot read ' || t
) from unnest(array['tesla_credentials', 'oauth_states', 'system_bootstrap', 'job_locks', 'scheduled_jobs']) as t;
select throws_ok(
  $q$insert into public.job_locks (key, owner, lease_expires_at) values ('x', 'anon', now() + interval '1 minute')$q$,
  '42501', null, 'anon cannot take a job lock'
);

select tests.as_user('ro1');
select throws_ok(
  format('select 1 from public.%I', t), '42501', null, 'READ_ONLY cannot read ' || t
) from unnest(array['tesla_credentials', 'oauth_states', 'system_bootstrap', 'job_locks', 'scheduled_jobs']) as t;

-- ---- the catalogue agrees -----------------------------------------------------------------------------------------
select tests.clear();
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename in ('tesla_credentials', 'oauth_states', 'system_bootstrap', 'job_locks', 'scheduled_jobs')),
  0,
  'server-only tables have no policies'
);
select is(
  (select count(*)::int
     from unnest(array['tesla_credentials', 'oauth_states', 'system_bootstrap', 'job_locks', 'scheduled_jobs']) t
     cross join unnest(array['anon', 'authenticated']) r
     cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES', 'TRIGGER']) p
    where has_table_privilege(r, 'public.' || t, p)
       or p in ('SELECT', 'INSERT', 'UPDATE')
          and exists (
            select 1 from information_schema.columns c
            where c.table_schema = 'public' and c.table_name = t and has_column_privilege(r, 'public.' || t, c.column_name, p)
          )),
  0,
  'anon and authenticated hold no table or column privilege on server-only tables'
);
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'tesla_credentials'
      and column_name ~* '(access|refresh)_token|secret|password|plaintext'),
  0,
  'tesla_credentials has no plaintext token, secret or password column'
);
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'tesla_credentials' and column_name in ('ciphertext', 'nonce', 'key_id')),
  3,
  'tesla_credentials stores ciphertext with its nonce and key id'
);
select throws_ok(
  $q$insert into public.tesla_credentials (household_id, key_id, nonce, ciphertext, fleet_api_base_url)
     values (tests.id('h1'), 'k1', decode('00', 'hex'), decode(repeat('11', 32), 'hex'), 'https://fleet.example.invalid')$q$,
  '23514', null, 'a nonce that is not 12 bytes is rejected'
);

-- ---- the Worker secret key can use them ------------------------------------------------------------------------
select tests.as_service();
select lives_ok(
  $q$insert into public.tesla_credentials (household_id, key_id, nonce, ciphertext, fleet_api_base_url)
     values (tests.id('h1'), 'k1', decode(repeat('00', 12), 'hex'), decode(repeat('11', 32), 'hex'), 'https://fleet.example.invalid')$q$,
  'service_role can store encrypted credentials'
);
select is(
  (select count(*)::int from public.tesla_credentials where household_id = tests.id('h1')), 1,
  'service_role can read them back'
);

-- ---- anon: nothing on any table -----------------------------------------------------------------------------------
select tests.as_anon();
select throws_ok(
  format('select 1 from public.%I limit 1', t.tablename), '42501', null, 'anon cannot read ' || t.tablename
) from (select tablename from pg_tables where schemaname = 'public' order by tablename) t;

select * from finish();

rollback;
