import assert from 'node:assert/strict';

/** Real PostgreSQL row contention with synthetic encrypted records; never a provider request. */
export async function verifyTeslaDiscoveryRefreshConcurrency(client, connect) {
  const first = await connect('security_tests');
  const second = await connect('security_tests');
  let pending;
  let checks = 0;
  const owner = crypto.randomUUID();
  const successor = crypto.randomUUID();
  const session = crypto.randomUUID();
  let household;
  let actor;
  const claims = async (connection) => {
    await connection.query('set local role authenticated');
    await connection.query(
      `select set_config('request.jwt.claim.sub',$1,true),
      set_config('request.jwt.claims',jsonb_build_object('sub',$1::text,'role','authenticated',
      'session_id',$2::text,'exp',extract(epoch from now()+interval '1 hour'))::text,true)`,
      [actor, session],
    );
  };
  const begin = async (connection, leaseOwner = owner) => {
    await connection.query('begin');
    await claims(connection);
    const context = (
      await connection.query('select public.tesla_discovery_refresh_context($1) as value', [
        household,
      ])
    ).rows[0].value;
    return (
      await connection.query(
        `select public.begin_tesla_discovery_refresh($1,$2,$3,clock_timestamp()+interval '20 seconds') as value`,
        [household, context.credentialRevision, leaseOwner],
      )
    ).rows[0].value;
  };
  const finish = async (connection, attempt, leaseOwner = owner) => {
    await connection.query('begin');
    await claims(connection);
    return (
      await connection.query('select public.finish_tesla_discovery_refresh($1,$2,$3) as value', [
        household,
        attempt,
        leaseOwner,
      ])
    ).rows[0].value;
  };
  const reset = async () => {
    await client.query('select tests.clear()');
    await client.query(
      'delete from private.tesla_discovery_refresh_attempts where household_id=$1',
      [household],
    );
    await client.query("delete from public.job_locks where key='token:'||$1::text", [household]);
    await client.query(
      'insert into auth.sessions(id,user_id) values($1,$2) on conflict do nothing',
      [session, actor],
    );
    await client.query(
      "update public.household_members set role='ADMIN' where household_id=$1 and user_id=$2",
      [household, actor],
    );
    await client.query(
      `select public.worker_save_tesla_credentials($1,'v1',decode(repeat('00',12),'hex'),decode(repeat('aa',17),'hex'),1,
      array['openid','offline_access','energy_device_data'],'https://fleet-api.prd.eu.vn.cloud.tesla.com',now()-interval '1 hour')`,
      [household],
    );
  };
  const ready = async (expired = false) => {
    const result = await begin(first);
    await first.query('commit');
    await client.query(
      `select public.worker_stage_tesla_discovery_refresh($1,$2,jsonb_build_object(
      'outcome','TOKEN','keyId','v1','version',1,'nonce','\\x'||repeat('11',12),'ciphertext','\\x'||repeat('bb',17),
      'scopes',jsonb_build_array('openid','offline_access','energy_device_data'),
      'region','https://fleet-api.prd.eu.vn.cloud.tesla.com','expiresAt',clock_timestamp()+interval '1 hour'))`,
      [result.attemptId, owner],
    );
    if (expired)
      await client.query(
        "update private.tesla_discovery_refresh_attempts set payload=jsonb_set(payload,'{expiresAt}',to_jsonb(clock_timestamp()-interval '1 second')) where id=$1",
        [result.attemptId],
      );
    return result.attemptId;
  };
  const pid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;
  const blocked = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        (await client.query('select wait_event_type from pg_stat_activity where pid=$1', [pid]))
          .rows[0]?.wait_event_type === 'Lock'
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Expected refresh row-lock contention not observed');
  };
  const rejected = (operation) =>
    operation.then(
      (value) => ({ value }),
      (error) => ({ code: error.code }),
    );
  try {
    await first.query("set statement_timeout='10s'");
    await second.query("set statement_timeout='10s'");
    await client.query('select tests.world()');
    ({ household, actor } = (
      await client.query("select tests.id('h1') as household,tests.id('alice') as actor")
    ).rows[0]);
    await client.query(
      "insert into public.household_members(household_id,user_id,role) values($1,tests.id('carol'),'ADMIN')",
      [household],
    );
    await reset();
    await begin(first);
    pending = rejected(begin(second, successor));
    await blocked();
    await first.query('commit');
    assert.equal((await pending).code, '55P03');
    pending = undefined;
    await second.query('rollback');
    checks++;

    let attempt;
    for (const expired of [false, true]) {
      await reset();
      attempt = await ready(expired);
      const result = await finish(first, attempt);
      assert.equal(result.outcome, expired ? 'REAUTH' : 'TOKEN');
      pending = rejected(finish(second, attempt));
      await blocked();
      await first.query('commit');
      assert.deepEqual((await pending).value, result);
      pending = undefined;
      await second.query('commit');
      const action = expired ? 'tesla.reauth_required' : 'tesla.token_refreshed';
      assert.equal(
        (
          await client.query('select count(*)::int as n from public.audit_log where action=$1', [
            action,
          ])
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await client.query(
            'select payload from private.tesla_discovery_refresh_attempts where id=$1',
            [attempt],
          )
        ).rows[0].payload,
        null,
      );
      checks++;
    }

    for (const expired of [false, true]) {
      for (const change of ['replacement', 'logout', 'demotion', 'revocation', 'deadline']) {
        await reset();
        attempt = await ready(expired);
        await first.query('begin');
        if (change === 'logout')
          await first.query('delete from auth.sessions where id=$1', [session]);
        else if (change === 'demotion')
          await first.query(
            "update public.household_members set role='READ_ONLY' where household_id=$1 and user_id=$2",
            [household, actor],
          );
        else if (change === 'replacement')
          await first.query(
            "update public.tesla_credentials set ciphertext=decode(repeat('cc',17),'hex') where household_id=$1",
            [household],
          );
        else if (change === 'revocation')
          await first.query(
            "update public.tesla_credentials set status='REVOKED' where household_id=$1",
            [household],
          );
        else
          await first.query(
            'select 1 from public.tesla_credentials where household_id=$1 for update',
            [household],
          );
        pending = rejected(finish(second, attempt));
        await blocked();
        if (change === 'deadline')
          await client.query(
            "update private.tesla_discovery_refresh_attempts set deadline=clock_timestamp()-interval '1 second' where id=$1",
            [attempt],
          );
        await first.query('commit');
        assert.equal(
          (await pending).code,
          ['logout', 'demotion'].includes(change) ? '42501' : '23505',
        );
        pending = undefined;
        await second.query('rollback');
        checks++;
      }
    }
    for (const expired of [true, false]) {
      await reset();
      attempt = await ready(expired);
      await client.query(
        "update public.job_locks set lease_expires_at=clock_timestamp()-interval '1 second' where key='token:'||$1::text",
        [household],
      );
      const recovered = await begin(first, successor);
      pending = rejected(begin(second, crypto.randomUUID()));
      await blocked();
      await first.query('commit');
      assert.equal((await pending).code, '55P03');
      pending = undefined;
      await second.query('rollback');
      assert.equal(recovered.state, 'READY');
      assert.equal((await rejected(finish(second, attempt))).code, '42501');
      await second.query('rollback');
      assert.equal((await finish(first, attempt, successor)).outcome, expired ? 'REAUTH' : 'TOKEN');
      await first.query('commit');
      checks++;
    }

    // A successfully activated rotated pair is a new generation with its own SENT barrier.
    const parentRevision = (
      await client.query(
        'select credential_revision from private.tesla_discovery_refresh_attempts where id=$1',
        [attempt],
      )
    ).rows[0].credential_revision;
    await client.query("delete from public.job_locks where key='token:'||$1::text", [household]);
    await client.query(
      "update public.tesla_credentials set access_expires_at=clock_timestamp()-interval '1 second' where household_id=$1",
      [household],
    );
    const next = await begin(first);
    pending = rejected(begin(second, successor));
    await blocked();
    await first.query('commit');
    assert.equal((await pending).code, '55P03');
    pending = undefined;
    await second.query('rollback');
    const generation = (
      await client.query(
        'select credential_revision,state from private.tesla_discovery_refresh_attempts where id=$1',
        [next.attemptId],
      )
    ).rows[0];
    assert.notEqual(generation.credential_revision, parentRevision);
    assert.equal(generation.state, 'SENT');
    await client.query(
      "update public.job_locks set lease_expires_at=clock_timestamp()-interval '1 second' where key='token:'||$1::text",
      [household],
    );
    assert.equal((await rejected(begin(second, successor))).code, '55000');
    await second.query('rollback');
    assert.equal(
      (
        await client.query(
          'select state from private.tesla_discovery_refresh_attempts where id=$1',
          [attempt],
        )
      ).rows[0].state,
      'COMMITTED',
    );
    checks++;
    return checks;
  } finally {
    await Promise.all([first.query('rollback'), second.query('rollback')]);
    if (pending) await pending.catch(() => undefined);
    await first.end();
    await second.end();
    await client.query('select tests.clear()');
    await client.query('delete from public.households where id in (select id from tests.fx)');
    await client.query('delete from auth.users where id in (select id from tests.fx)');
    await client.query('delete from tests.fx');
  }
}
