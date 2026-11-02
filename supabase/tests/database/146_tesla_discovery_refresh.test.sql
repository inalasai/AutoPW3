begin;
select plan(70);
select tests.clear();
select tests.world();
insert into tests.fx(name,id) values('refresh_session',gen_random_uuid()),('refresh_owner',gen_random_uuid()),('refresh_owner2',gen_random_uuid());
insert into auth.sessions(id,user_id) values(tests.id('refresh_session'),tests.id('alice'));
create function tests.refresh_actor(p_name text default 'alice') returns void language plpgsql as $$
begin
  perform tests.as_user(p_name);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',tests.id(p_name),'role','authenticated',
    'session_id',tests.id('refresh_session'),'exp',extract(epoch from now()+interval '1 hour'))::text,true);
end;
$$;
create function tests.refresh_reset() returns void language plpgsql as $$
begin
  perform tests.clear();
  delete from private.tesla_discovery_refresh_attempts;
  delete from public.job_locks where key='token:'||tests.id('h1')::text;
  insert into auth.sessions(id,user_id) values(tests.id('refresh_session'),tests.id('alice')) on conflict do nothing;
  perform public.worker_save_tesla_credentials(tests.id('h1'),'v1',decode(repeat('00',12),'hex'),decode(repeat('aa',17),'hex'),1,
    array['openid','offline_access','energy_device_data'],'https://fleet-api.prd.eu.vn.cloud.tesla.com',now()-interval '1 hour');
  update public.tesla_credentials set last_refresh_at=null where household_id=tests.id('h1');
end;
$$;
create function tests.refresh_payload() returns jsonb language sql as $$
  select jsonb_build_object('outcome','TOKEN','keyId','v1','version',1,'nonce','\x'||repeat('11',12),
    'ciphertext','\x'||repeat('bb',17),'scopes',jsonb_build_array('openid','offline_access','energy_device_data'),
    'region','https://fleet-api.prd.eu.vn.cloud.tesla.com','expiresAt',clock_timestamp()+interval '1 hour')
$$;
create function tests.refresh_begin() returns uuid language sql as $$
  select (public.begin_tesla_discovery_refresh(tests.id('h1'),
    public.tesla_discovery_refresh_context(tests.id('h1'))->>'credentialRevision',
    tests.id('refresh_owner'),clock_timestamp()+interval '20 seconds')->>'attemptId')::uuid
$$;
grant execute on function tests.refresh_actor(text),tests.refresh_payload(),tests.refresh_begin(),tests.refresh_reset() to public;
select tests.refresh_reset();

select ok(not has_table_privilege('authenticated','private.tesla_discovery_refresh_attempts','SELECT'),'users cannot read pending encrypted rotations');
select ok(not has_table_privilege('service_role','private.tesla_discovery_refresh_attempts','UPDATE'),'service has no direct ledger update grant');
select ok(not has_function_privilege('service_role','public.finish_tesla_discovery_refresh(uuid,uuid,uuid)','EXECUTE'),'service role cannot activate credentials');
select ok(not has_function_privilege('service_role','public.begin_tesla_discovery_refresh(uuid,text,uuid,timestamptz)','EXECUTE'),'service cannot manufacture actor/session authority');
select ok(not has_function_privilege('anon','public.tesla_discovery_refresh_context(uuid)','EXECUTE'),'anonymous preflight denied');
select ok(not has_function_privilege('authenticated','public.worker_stage_tesla_discovery_refresh(uuid,uuid,jsonb)','EXECUTE'),'user cannot forge encrypted provider output');
select ok(has_function_privilege('service_role','public.worker_stage_tesla_discovery_refresh(uuid,uuid,jsonb)','EXECUTE'),'server can stage only');
select tests.refresh_actor();
select is(public.tesla_discovery_refresh_context(tests.id('h1'))->>'needsRefresh','true','expired ACTIVE record eligible for refresh');
select throws_ok($q$select public.tesla_site_link_context(tests.id('h1'))$q$,'55000',null,'link freshness remains strict');
select is((select count(*)::int from jsonb_object_keys(public.tesla_discovery_refresh_context(tests.id('h1')))),2,'preflight returns only opaque metadata');
select set_config('tests.refresh_revision',public.tesla_discovery_refresh_context(tests.id('h1'))->>'credentialRevision',true);
select throws_ok($q$select public.tesla_discovery_refresh_context(tests.id('h2'))$q$,'42501',null,'foreign household preflight denied');
insert into tests.fx values('refresh_attempt',tests.refresh_begin());
select throws_ok($q$select tests.refresh_begin()$q$,'55P03',null,'concurrent owner cannot acquire live lease');
select throws_ok($q$select public.worker_stage_tesla_discovery_refresh(tests.id('refresh_attempt'),tests.id('refresh_owner'),tests.refresh_payload())$q$,'42501',null,'authenticated actor cannot stage even its own attempt');
select tests.clear();
select is((select state from private.tesla_discovery_refresh_attempts where id=tests.id('refresh_attempt')),'SENT','attempt is durable before provider dispatch');
update public.job_locks set lease_expires_at=transaction_timestamp()-interval '1 second' where key='token:'||tests.id('h1')::text;
select tests.refresh_actor();
select throws_ok($q$select public.begin_tesla_discovery_refresh(tests.id('h1'),current_setting('tests.refresh_revision'),tests.id('refresh_owner2'),clock_timestamp()+interval '20 seconds')$q$,'55000',null,'lease expiry never resets SENT ambiguity barrier');

select tests.refresh_reset();
select tests.refresh_actor();
update tests.fx set id=tests.refresh_begin() where name='refresh_attempt';
select tests.as_service();
select ok(public.worker_stage_tesla_discovery_refresh(tests.id('refresh_attempt'),tests.id('refresh_owner'),tests.refresh_payload()),'server stages encrypted rotation');
select tests.clear();
select is((select state from private.tesla_discovery_refresh_attempts where id=tests.id('refresh_attempt')),'READY','staging does not activate');
select ok((select access_expires_at<now() from public.tesla_credentials where household_id=tests.id('h1')),'expired credential untouched by service staging');
select throws_ok($q$select public.finish_tesla_discovery_refresh(tests.id('h1'),tests.id('refresh_attempt'),tests.id('refresh_owner'))$q$,'42501',null,'owner role without authenticated JWT cannot activate');
select tests.refresh_actor();
select is(public.finish_tesla_discovery_refresh(tests.id('h1'),tests.id('refresh_attempt'),tests.id('refresh_owner'))->>'outcome','TOKEN','actual user JWT activates encrypted rotation');
select is(public.tesla_discovery_refresh_context(tests.id('h1'))->>'needsRefresh','false','rotation restores freshness');
select is(public.tesla_site_link_context(tests.id('h1'))->>'credentialRevision',public.tesla_discovery_refresh_context(tests.id('h1'))->>'credentialRevision','refresh and strict link revisions agree');
select is(public.finish_tesla_discovery_refresh(tests.id('h1'),tests.id('refresh_attempt'),tests.id('refresh_owner'))->>'outcome','TOKEN','lost commit response is replayable');
select tests.clear();
select ok((select last_refresh_at is not null from public.tesla_credentials where household_id=tests.id('h1')),'successful refresh records last_refresh_at');
select is((select count(*)::int from public.audit_log where action='tesla.token_refreshed'),1,'idempotent replay adds no audit');
select is((select actor_user_id::text from public.audit_log where action='tesla.token_refreshed'),tests.id('alice')::text,'audit actor derives from authenticated commit');
select ok((select payload is null from private.tesla_discovery_refresh_attempts where id=tests.id('refresh_attempt')),'committed staged tokens are erased');
select is((select count(*)::int from public.audit_log where action='tesla.connected'),0,'refresh does not fabricate OAuth connection audit');

select tests.refresh_reset();
select tests.refresh_actor();
update tests.fx set id=tests.refresh_begin() where name='refresh_attempt';
select tests.as_service();
select ok(public.worker_stage_tesla_discovery_refresh(tests.id('refresh_attempt'),tests.id('refresh_owner'),' {"outcome":"REAUTH"}'::jsonb),'fixed terminal rejection may be staged');
select tests.refresh_actor();
select is(public.finish_tesla_discovery_refresh(tests.id('h1'),tests.id('refresh_attempt'),tests.id('refresh_owner'))->>'outcome','REAUTH','terminal rejection commits under current actor');
select tests.clear();
select is((select status from public.tesla_credentials where household_id=tests.id('h1')),'NEEDS_REAUTH','rejected refresh never activates credentials');
select is((select count(*)::int from public.audit_log where action='tesla.reauth_required'),1,'terminal rejection audited once');
select tests.refresh_actor();
select throws_ok($q$select public.tesla_discovery_refresh_context(tests.id('h1'))$q$,'55000',null,'NEEDS_REAUTH is not refresh eligible');

select tests.refresh_reset();
update public.tesla_credentials set status='REVOKED' where household_id=tests.id('h1');
select tests.refresh_actor();
select throws_ok($q$select public.tesla_discovery_refresh_context(tests.id('h1'))$q$,'55000',null,'REVOKED is not refresh eligible');
select tests.refresh_reset();
update public.tesla_credentials set scopes=array['openid','offline_access','energy_device_data','energy_cmds'] where household_id=tests.id('h1');
select tests.refresh_actor();
select throws_ok($q$select public.tesla_discovery_refresh_context(tests.id('h1'))$q$,'55000',null,'control scope remains forbidden');
select tests.refresh_reset();
update public.tesla_credentials set fleet_api_base_url='https://unapproved.invalid' where household_id=tests.id('h1');
select tests.refresh_actor();
select throws_ok($q$select public.tesla_discovery_refresh_context(tests.id('h1'))$q$,'55000',null,'unapproved Fleet region remains forbidden');
select tests.refresh_reset();
select tests.refresh_actor('rw1');
select throws_ok($q$select public.tesla_discovery_refresh_context(tests.id('h1'))$q$,'42501',null,'READ_WRITE cannot refresh');
select tests.refresh_actor('ro1');
select throws_ok($q$select public.tesla_discovery_refresh_context(tests.id('h1'))$q$,'42501',null,'READ_ONLY cannot refresh');

select tests.refresh_actor();
update tests.fx set id=tests.refresh_begin() where name='refresh_attempt';
select tests.as_service();
select throws_ok($q$select public.worker_stage_tesla_discovery_refresh(tests.id('refresh_attempt'),tests.id('refresh_owner2'),tests.refresh_payload())$q$,'23505',null,'wrong staging owner rejected');
select throws_ok($q$select public.worker_stage_tesla_discovery_refresh(tests.id('refresh_attempt'),tests.id('refresh_owner'),'{}'::jsonb)$q$,'22023',null,'malformed encrypted result rejected');
select ok(public.worker_stage_tesla_discovery_refresh(tests.id('refresh_attempt'),tests.id('refresh_owner'),tests.refresh_payload()),'valid staged result retained for recovery');
select tests.clear();
delete from auth.sessions where id=tests.id('refresh_session');
select tests.refresh_actor();
select throws_ok($q$select public.finish_tesla_discovery_refresh(tests.id('h1'),tests.id('refresh_attempt'),tests.id('refresh_owner'))$q$,'42501',null,'logout blocks activation after provider exchange');
select tests.clear();
select is((select state from private.tesla_discovery_refresh_attempts where id=tests.id('refresh_attempt')),'READY','logout does not erase durable rotation ledger');
insert into auth.sessions(id,user_id) values(tests.id('refresh_session'),tests.id('alice'));
update public.job_locks set lease_expires_at=transaction_timestamp()-interval '1 second' where key='token:'||tests.id('h1')::text;
select tests.refresh_actor();
select is(public.begin_tesla_discovery_refresh(tests.id('h1'),public.tesla_discovery_refresh_context(tests.id('h1'))->>'credentialRevision',tests.id('refresh_owner2'),clock_timestamp()+interval '20 seconds')->>'state','READY','same session can resume encrypted result with a new owner');
select throws_ok($q$select public.finish_tesla_discovery_refresh(tests.id('h1'),tests.id('refresh_attempt'),tests.id('refresh_owner'))$q$,'42501',null,'late previous owner cannot use renewed deadline');
select is(public.finish_tesla_discovery_refresh(tests.id('h1'),tests.id('refresh_attempt'),tests.id('refresh_owner2'))->>'outcome','TOKEN','recovery commits without exchanging again');

select tests.refresh_reset();
select tests.refresh_actor();
update tests.fx set id=tests.refresh_begin() where name='refresh_attempt';
select tests.as_service();
select ok(public.worker_stage_tesla_discovery_refresh(tests.id('refresh_attempt'),tests.id('refresh_owner'),tests.refresh_payload()),'prepare deadline/revision tests');
select tests.clear();
update private.tesla_discovery_refresh_attempts set deadline=clock_timestamp()-interval '1 second';
select tests.refresh_actor();
select throws_ok($q$select public.finish_tesla_discovery_refresh(tests.id('h1'),tests.id('refresh_attempt'),tests.id('refresh_owner'))$q$,'23505',null,'deadline checked at commit after locks');
select tests.clear();
update private.tesla_discovery_refresh_attempts set deadline=clock_timestamp()+interval '20 seconds';
update public.tesla_credentials set ciphertext=decode(repeat('cc',17),'hex') where household_id=tests.id('h1');
select tests.refresh_actor();
select throws_ok($q$select public.finish_tesla_discovery_refresh(tests.id('h1'),tests.id('refresh_attempt'),tests.id('refresh_owner'))$q$,'23505',null,'replacement revision cannot be overwritten');
select tests.clear();
select is((select encode(ciphertext,'hex') from public.tesla_credentials where household_id=tests.id('h1')),repeat('cc',17),'replacement ciphertext preserved');
select is((select controls_enabled from public.household_settings where household_id=tests.id('h1')),false,'refresh never enables controls');

-- Synthetic ageing models a rotated generation whose access token expired while READY.
select tests.refresh_reset();
select set_config('tests.reauth_count',(select count(*)::text from public.audit_log where action='tesla.reauth_required'),true);
select tests.refresh_actor();
update tests.fx set id=tests.refresh_begin() where name='refresh_attempt';
select tests.as_service();
select ok(public.worker_stage_tesla_discovery_refresh(tests.id('refresh_attempt'),tests.id('refresh_owner'),tests.refresh_payload()),'stage next generation before ageing');
select tests.clear();
update private.tesla_discovery_refresh_attempts set payload=jsonb_set(payload,'{expiresAt}',to_jsonb(clock_timestamp()-interval '1 second'))
  where id=tests.id('refresh_attempt');
update public.job_locks set lease_expires_at=transaction_timestamp()-interval '1 second' where key='token:'||tests.id('h1')::text;
select tests.refresh_actor();
select is(public.begin_tesla_discovery_refresh(tests.id('h1'),public.tesla_discovery_refresh_context(tests.id('h1'))->>'credentialRevision',tests.id('refresh_owner2'),clock_timestamp()+interval '20 seconds')->>'state','READY','expired READY resumes only to authenticated terminalization');
select throws_ok($q$select public.finish_tesla_discovery_refresh(tests.id('h1'),tests.id('refresh_attempt'),tests.id('refresh_owner'))$q$,'42501',null,'old owner cannot terminalize');
select is(public.finish_tesla_discovery_refresh(tests.id('h1'),tests.id('refresh_attempt'),tests.id('refresh_owner2'))->>'outcome','REAUTH','expired staged access produces explicit terminal outcome');
select is(public.finish_tesla_discovery_refresh(tests.id('h1'),tests.id('refresh_attempt'),tests.id('refresh_owner2'))->>'outcome','REAUTH','terminal result replays without mutation');
select throws_ok($q$select public.tesla_discovery_refresh_context(tests.id('h1'))$q$,'55000','tesla_reauthorization_required','repeated preflight returns explicit reauthorization state');
select throws_ok($q$select public.tesla_site_link_context(tests.id('h1'))$q$,'55000',null,'expired staged pair never becomes linkable');
select tests.clear();
select is((select status from public.tesla_credentials where household_id=tests.id('h1')),'NEEDS_REAUTH','old credential generation is quarantined');
select is((select encode(ciphertext,'hex') from public.tesla_credentials where household_id=tests.id('h1')),repeat('aa',17),'expired staged ciphertext never overwrites active encrypted credentials');
select ok((select last_refresh_at is null from public.tesla_credentials where household_id=tests.id('h1')),'expiry terminalization is not recorded as successful refresh');
select is((select state from private.tesla_discovery_refresh_attempts where id=tests.id('refresh_attempt')),'COMMITTED','terminal no-reexchange barrier retained');
select ok((select payload is null from private.tesla_discovery_refresh_attempts where id=tests.id('refresh_attempt')),'expired pending pair ciphertext erased atomically');
select is((select count(*)::int from public.audit_log where action='tesla.reauth_required')-current_setting('tests.reauth_count')::int,1,'terminalization audited exactly once');
select ok((select bool_and(actor_user_id=tests.id('alice')) from public.audit_log where action='tesla.reauth_required'),'terminalization audit uses JWT actor');
select is((select count(*)::int from auth.sessions where id=tests.id('refresh_session')),1,'Tesla reauth does not log out Supabase session');

-- A later authorized OAuth replacement is independent of the terminal parent generation.
select public.worker_save_tesla_credentials(tests.id('h1'),'v1',decode(repeat('22',12),'hex'),decode(repeat('dd',17),'hex'),1,
  array['openid','offline_access','energy_device_data'],'https://fleet-api.prd.eu.vn.cloud.tesla.com',clock_timestamp()+interval '1 hour');
select tests.refresh_actor();
select is(public.tesla_discovery_refresh_context(tests.id('h1'))->>'needsRefresh','false','new OAuth credentials are not blocked by old terminal attempt');
select throws_ok($q$select public.finish_tesla_discovery_refresh(tests.id('h1'),tests.id('refresh_attempt'),tests.id('refresh_owner2'))$q$,'23505',null,'old terminal replay cannot act on newer OAuth revision');
select tests.clear();
select is((select encode(ciphertext,'hex') from public.tesla_credentials where household_id=tests.id('h1')),repeat('dd',17),'new OAuth ciphertext remains intact');
select is((select state from private.tesla_discovery_refresh_attempts where id=tests.id('refresh_attempt')),'COMMITTED','new OAuth never deletes the prior barrier');
select * from finish();
rollback;
