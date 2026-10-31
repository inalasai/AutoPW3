-- SQL equivalents of the scoped site's membership check, list, UUID cursor and lookup queries.
-- Runs under the real authenticated role/RLS on local PostgreSQL; not hosted PostgREST verification.
begin;
select plan(24);
select tests.world();
select tests.new_site('s3', 'h1');
select tests.new_site('s4', 'h1');
select tests.new_household('empty');
select tests.new_member('empty', 'alice', 'READ_ONLY');
select tests.clear();
update public.energy_sites set created_at = '2026-10-31T00:00:00Z'
  where household_id = tests.id('h1');

select tests.as_user('alice');
select is((select count(*)::int from public.household_members
  where household_id = tests.id('h1') and user_id = auth.uid()), 1,
  'actor membership precheck permits their household');
select is((select count(*)::int from public.household_members
  where household_id = tests.id('h2') and user_id = auth.uid()), 0,
  'actor membership precheck hides another household');
select is((select count(*)::int from (select id from public.energy_sites
  where household_id = tests.id('h1') and provider = 'TESLA' order by id limit 201) s), 3,
  'bounded household list returns only persisted household sites');
select is((select count(*)::int from public.energy_sites
  where id = tests.id('s2') and provider = 'TESLA'), 0,
  'site-id lookup cannot reveal another household site');
select is((select household_id from public.energy_sites where id = tests.id('s1')), tests.id('h1'),
  'lookup preserves the stored household association');
select is((select provider_site_id from public.energy_sites where id = tests.id('s1')), 'site-s1',
  'lookup returns the actual stored provider id');
select is((select count(*)::int from public.household_members
  where household_id = tests.id('empty') and user_id = auth.uid()), 1,
  'an authorized household can exist without sites');
select is((select count(*)::int from public.energy_sites where household_id = tests.id('empty')), 0,
  'authorized empty household remains empty without synthetic sites');
select is((select count(*)::int from public.energy_sites
  where household_id = tests.id('h1') and capabilities_snapshot is null), 3,
  'persisted sites do not imply a capability assessment');

with page_one as (
  select id from public.energy_sites where household_id = tests.id('h1')
    and provider = 'TESLA' order by id limit 2
), page_two as (
  select id from public.energy_sites where household_id = tests.id('h1')
    and provider = 'TESLA' and id > (select id from page_one order by id desc limit 1)
    order by id limit 2
), all_pages as (select id from page_one union all select id from page_two)
select is((select count(*)::int from all_pages), 3,
  'UUID keyset pages cover the household despite identical creation timestamps');
with page_one as (
  select id from public.energy_sites where household_id = tests.id('h1')
    and provider = 'TESLA' order by id limit 2
), page_two as (
  select id from public.energy_sites where household_id = tests.id('h1')
    and provider = 'TESLA' and id > (select id from page_one order by id desc limit 1)
    order by id limit 2
), all_pages as (select id from page_one union all select id from page_two)
select is((select count(distinct id)::int from all_pages), 3,
  'UUID cursor pages do not duplicate a site');

select tests.as_user('rw1');
select is((select count(*)::int from public.household_members
  where household_id = tests.id('h1') and user_id = auth.uid()), 1,
  'READ_WRITE can confirm their own membership');
select is((select count(*)::int from public.energy_sites where household_id = tests.id('h1')), 3,
  'READ_WRITE can read their household sites');
select is((select count(*)::int from public.energy_sites where provider_site_id = 'site-s2'), 0,
  'knowing a foreign provider id does not grant access');

select tests.as_user('ro1');
select is((select count(*)::int from public.energy_sites where id = tests.id('s1')), 1,
  'READ_ONLY can retrieve an authorized site');
select is((select count(*)::int from public.energy_sites where household_id = tests.id('h1')), 3,
  'READ_ONLY can list authorized sites');
select is((select count(*)::int from public.energy_sites where id = tests.id('s2')), 0,
  'READ_ONLY cannot retrieve another household site');

select tests.as_user('bob');
select is((select count(*)::int from public.energy_sites where household_id = tests.id('h1')), 0,
  'another household ADMIN cannot list the first household sites');
select is((select count(*)::int from public.energy_sites where household_id = tests.id('h2')), 1,
  'another household ADMIN can still read their own site');

select tests.as_user('carol');
select is((select count(*)::int from public.household_members where user_id = auth.uid()), 0,
  'unassociated authenticated user has no membership proof');
select is((select count(*)::int from public.energy_sites), 0,
  'unassociated authenticated user cannot read any site');

select tests.clear();
delete from public.household_members where household_id = tests.id('h1') and user_id = tests.id('rw1');
select tests.as_user('rw1');
select is((select count(*)::int from public.energy_sites where id = tests.id('s1')), 0,
  'membership revocation removes site access');
select is((select count(*)::int from public.household_members
  where household_id = tests.id('h1') and user_id = auth.uid()), 0,
  'membership revocation removes the authorization precheck');

select tests.as_anon();
select throws_ok($q$select id from public.energy_sites$q$, '42501', null,
  'anonymous callers have no site table access');
select * from finish();
rollback;
