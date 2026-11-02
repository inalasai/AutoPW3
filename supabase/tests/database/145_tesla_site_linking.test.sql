begin;
select plan(49);
select tests.clear();
select tests.world();
insert into tests.fx(name,id) values('session_alice',gen_random_uuid()),('session_bob',gen_random_uuid()),('session_rw1',gen_random_uuid()),('session_ro1',gen_random_uuid());
insert into auth.sessions(id,user_id) values
  (tests.id('session_alice'),tests.id('alice')),(tests.id('session_bob'),tests.id('bob')),(tests.id('session_rw1'),tests.id('rw1')),(tests.id('session_ro1'),tests.id('ro1'));
select public.worker_save_tesla_credentials(tests.id('h1'),'v1',decode(repeat('00',12),'hex'),decode(repeat('aa',17),'hex'),1,array['openid','offline_access','energy_device_data'],'https://fleet-api.prd.eu.vn.cloud.tesla.com',now()+interval '1 hour');
select public.worker_save_tesla_credentials(tests.id('h2'),'v1',decode(repeat('00',12),'hex'),decode(repeat('bb',17),'hex'),1,array['openid','offline_access','energy_device_data'],'https://fleet-api.prd.eu.vn.cloud.tesla.com',now()+interval '1 hour');

create function tests.site_actor(p_name text) returns void language plpgsql as $$
begin
  perform tests.as_user(p_name);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',tests.id(p_name),'role','authenticated',
    'session_id',tests.id('session_'||p_name),'exp',extract(epoch from now()+interval '1 hour'))::text,true);
end;
$$;
create function tests.prepare_site(p_actor text,p_household text,p_site text,p_key text) returns uuid language sql as $$
  select public.worker_prepare_tesla_site_link(tests.id(p_household),tests.id(p_actor),tests.id('session_'||p_actor),
    now()+interval '1 hour',private.tesla_site_credential_context(tests.id(p_household),tests.id(p_actor),tests.id('session_'||p_actor),now()+interval '1 hour'),p_site,'Fixture',p_key)
$$;
-- Helpers execute as the caller; authenticated users still cannot invoke the privileged attestation.
grant execute on function tests.site_actor(text) to public;
grant execute on function tests.prepare_site(text,text,text,text) to postgres;

select ok(not has_function_privilege('anon','public.tesla_site_link_context(uuid)','EXECUTE'),'anonymous cannot read credential metadata');
select ok(not has_function_privilege('service_role','public.tesla_site_link_context(uuid)','EXECUTE'),'service role is not the authenticated user context');
select ok(not has_function_privilege('authenticated','public.worker_prepare_tesla_site_link(uuid,uuid,uuid,timestamptz,text,text,text,text)','EXECUTE'),'user cannot forge provider verification');
select ok(not has_function_privilege('anon','public.worker_prepare_tesla_site_link(uuid,uuid,uuid,timestamptz,text,text,text,text)','EXECUTE'),'anonymous cannot attest');
select ok(has_function_privilege('service_role','public.worker_prepare_tesla_site_link(uuid,uuid,uuid,timestamptz,text,text,text,text)','EXECUTE'),'backend may attest');
select ok(not has_function_privilege('anon','public.link_discovered_tesla_site(uuid,uuid,text)','EXECUTE'),'anonymous cannot link');
select ok(not has_function_privilege('service_role','public.link_discovered_tesla_site(uuid,uuid,text)','EXECUTE'),'linking must use actual user JWT');
select ok(not has_table_privilege('authenticated','private.tesla_site_link_requests','SELECT'),'verification records are private');
select ok(not has_table_privilege('service_role','private.tesla_site_link_requests','INSERT'),'backend uses narrow RPC, not table writes');
select tests.site_actor('rw1');
select throws_ok($q$select public.tesla_site_link_context(tests.id('h1'))$q$,'42501',null,'read-write member cannot discover or link');
select tests.site_actor('ro1');
select throws_ok($q$select public.tesla_site_link_context(tests.id('h1'))$q$,'42501',null,'read-only member cannot discover or link');
select tests.site_actor('bob');
select throws_ok($q$select public.tesla_site_link_context(tests.id('h1'))$q$,'42501',null,'another household administrator cannot discover');
select tests.site_actor('alice');
select ok((public.tesla_site_link_context(tests.id('h1'))->>'credentialRevision') ~ '^[0-9a-f]{64}$','current session gets only opaque credential revision');
select is((select count(*)::int from jsonb_object_keys(public.tesla_site_link_context(tests.id('h1')))),1,'context contains no credential payload');
select set_config('tests.site_revision',public.tesla_site_link_context(tests.id('h1'))->>'credentialRevision',true);
set local timezone='Pacific/Auckland';
select is(public.tesla_site_link_context(tests.id('h1'))->>'credentialRevision',current_setting('tests.site_revision'),'credential fence is independent of session timezone');
set local timezone='UTC';
select throws_ok($q$select public.link_discovered_tesla_site(tests.id('h1'),'00000000-0000-4000-8000-000000000000','fixture-key-0001')$q$,'42501',null,'invented proof cannot create a site');

reset role;
insert into tests.fx values('proof_a',tests.prepare_site('alice','h1','123','fixture-key-0001'));
select tests.site_actor('alice');
select is(public.link_discovered_tesla_site(tests.id('h1'),tests.id('proof_a'),'fixture-key-0001')->>'created','true','verified site linked atomically');
select is(public.link_discovered_tesla_site(tests.id('h1'),tests.id('proof_a'),'fixture-key-0001')->'site'->>'connectionState','CONNECTING','does not fabricate LIVE status');
select is(public.link_discovered_tesla_site(tests.id('h1'),tests.id('proof_a'),'fixture-key-0001')->'site'->>'timezone','Europe/Dublin','timezone comes from persisted household');
select is(public.link_discovered_tesla_site(tests.id('h1'),tests.id('proof_a'),'fixture-key-0001')->'site'->>'householdId',tests.id('h1')::text,'site belongs to authorized household');
select is((select count(*)::int from public.energy_sites where provider_site_id='123'),1,'idempotent retry creates one row');
select is((select capabilities_snapshot is null from public.energy_sites where provider_site_id='123'),true,'does not synthesize capabilities');
select is((select count(*)::int from public.audit_log where action='tesla.site_linked'),1,'only one audit event for retries');
select is((select actor_user_id::text from public.audit_log where action='tesla.site_linked'),tests.id('alice')::text,'audit attributed to actual JWT actor');

reset role;
select throws_ok($q$select tests.prepare_site('alice','h1','456','fixture-key-0001')$q$,'23505',null,'same key with different payload conflicts');
insert into tests.fx values('proof_b',tests.prepare_site('alice','h1','123','different-key-0002'));
select tests.site_actor('alice');
select is(public.link_discovered_tesla_site(tests.id('h1'),tests.id('proof_b'),'different-key-0002')->>'created','false','different key cannot duplicate existing household site');
reset role;
insert into tests.fx values('proof_foreign',tests.prepare_site('bob','h2','123','fixture-key-0001'));
select tests.site_actor('bob');
select throws_ok($q$select public.link_discovered_tesla_site(tests.id('h2'),tests.id('proof_foreign'),'fixture-key-0001')$q$,'23505',null,'global duplicate cannot be attached to another household');
select is((select count(*)::int from public.energy_sites where household_id=tests.id('h2') and provider_site_id='123'),0,'foreign site remains invisible under RLS');
select tests.site_actor('alice');
select throws_ok($q$select public.link_discovered_tesla_site(tests.id('h2'),tests.id('proof_a'),'fixture-key-0001')$q$,'42501',null,'proof cannot cross household boundary');

reset role;
insert into tests.fx values('proof_pending',tests.prepare_site('alice','h1','456','pending-key-0003'));
update private.tesla_site_link_requests set proof_expires_at=now()-interval '1 second' where idempotency_key='pending-key-0003';
select tests.site_actor('alice');
select throws_ok($q$select public.link_discovered_tesla_site(tests.id('h1'),tests.id('proof_pending'),'pending-key-0003')$q$,'42501',null,'expired verification cannot create a site');
reset role;
insert into tests.fx values('proof_fresh',tests.prepare_site('alice','h1','456','pending-key-0003'));
select isnt(tests.id('proof_fresh'),tests.id('proof_pending'),'retry after crash renews expired proof');
select tests.site_actor('alice');
select throws_ok($q$select public.link_discovered_tesla_site(tests.id('h1'),tests.id('proof_pending'),'pending-key-0003')$q$,'42501',null,'stale proof cannot finalize renewed request');

reset role;
-- A same-timestamp credential change still changes the opaque fingerprint.
update public.tesla_credentials set ciphertext=decode(repeat('cc',17),'hex') where household_id=tests.id('h1');
select tests.site_actor('alice');
select throws_ok($q$select public.link_discovered_tesla_site(tests.id('h1'),tests.id('proof_fresh'),'pending-key-0003')$q$,'42501',null,'credential replacement fences old-account discovery');
reset role;
insert into tests.fx values('proof_current',tests.prepare_site('alice','h1','456','pending-key-0003'));
delete from auth.sessions where id=tests.id('session_alice');
select tests.site_actor('alice');
select throws_ok($q$select public.link_discovered_tesla_site(tests.id('h1'),tests.id('proof_current'),'pending-key-0003')$q$,'42501',null,'logout blocks linking despite valid JWT expiry');
reset role;
update tests.fx set id=gen_random_uuid() where name='session_alice';
insert into auth.sessions(id,user_id) values(tests.id('session_alice'),tests.id('alice'));
select tests.site_actor('alice');
select throws_ok($q$select public.link_discovered_tesla_site(tests.id('h1'),tests.id('proof_current'),'pending-key-0003')$q$,'42501',null,'new session cannot reuse old session proof');
reset role;
insert into tests.fx values('proof_latest',tests.prepare_site('alice','h1','456','pending-key-0003'));
insert into public.household_members(household_id,user_id,role) values(tests.id('h1'),tests.id('carol'),'ADMIN');
select tests.clear();
update public.household_members set role='READ_ONLY' where household_id=tests.id('h1') and user_id=tests.id('alice');
select tests.site_actor('alice');
select throws_ok($q$select public.link_discovered_tesla_site(tests.id('h1'),tests.id('proof_latest'),'pending-key-0003')$q$,'42501',null,'demotion before commit prevents linking');
reset role;
select tests.clear();
update public.household_members set role='ADMIN' where household_id=tests.id('h1') and user_id=tests.id('alice');
select tests.site_actor('alice');
select is(public.link_discovered_tesla_site(tests.id('h1'),tests.id('proof_latest'),'pending-key-0003')->>'created','true','current administrator can recover and complete');
select is((select count(*)::int from public.energy_sites where provider_site_id='456'),1,'recovered flow persists one durable row');
reset role;
select throws_ok($q$select tests.prepare_site('alice','h1','../123','invalid-key-0004')$q$,'22023',null,'numeric ID required at database boundary');
select throws_ok($q$select tests.prepare_site('alice','h1','789','bad')$q$,'22023',null,'bounded idempotency key enforced');
select throws_ok($q$select tests.prepare_site('bob','h1','789','foreign-key-0004')$q$,'42501',null,'backend attestation also enforces household authority');
insert into tests.fx values('scoped_a',tests.prepare_site('alice','h1','800','tenant-key-0007'));
insert into tests.fx values('scoped_b',tests.prepare_site('bob','h2','900','tenant-key-0007'));
select tests.site_actor('alice');
select is(public.link_discovered_tesla_site(tests.id('h1'),tests.id('scoped_a'),'tenant-key-0007')->>'created','true','idempotency key scoped to actor and household');
select tests.site_actor('bob');
select is(public.link_discovered_tesla_site(tests.id('h2'),tests.id('scoped_b'),'tenant-key-0007')->'site'->>'householdId',tests.id('h2')::text,'same key works independently for another household');
reset role;
select tests.clear();
update private.tesla_site_link_requests set created_at=now()-interval '25 hours'
  where household_id=tests.id('h1') and actor_user_id=tests.id('alice') and idempotency_key='fixture-key-0001';
insert into tests.fx values('expired_key_fresh',tests.prepare_site('alice','h1','901','fixture-key-0001'));
select isnt(tests.id('expired_key_fresh'),tests.id('proof_a'),'24-hour expiry replaces the stale verification capability');
select tests.site_actor('alice');
select throws_ok($q$select public.link_discovered_tesla_site(tests.id('h1'),tests.id('proof_a'),'fixture-key-0001')$q$,'42501',null,'expired result proof cannot authorize new payload');
select is(public.link_discovered_tesla_site(tests.id('h1'),tests.id('expired_key_fresh'),'fixture-key-0001')->>'created','true','freshly verified payload may reuse expired key');
select is((select controls_enabled from public.household_settings where household_id=tests.id('h1')),false,'linking never enables controls');
reset role;
update public.tesla_credentials set scopes=array['openid','offline_access','energy_device_data','energy_cmds'] where household_id=tests.id('h1');
select tests.site_actor('alice');
select throws_ok($q$select public.tesla_site_link_context(tests.id('h1'))$q$,'55000',null,'control scope credentials cannot enter this workflow');
select is((select count(*)::int from public.audit_log where action='tesla.site_linked'),4,'failures never commit extra audits');
select * from finish();
rollback;
