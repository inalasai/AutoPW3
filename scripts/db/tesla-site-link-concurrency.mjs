// TEST-ONLY: real two-connection site-link races in the runner's throwaway PostgreSQL.
// Never connects independently or contacts a hosted service. No provider credentials are used.
export async function verifyTeslaSiteLinkConcurrency(client, connect) {
  const first = await connect('security_tests');
  const second = await connect('security_tests');
  let pending;
  const claims = async (connection, actor, expires = null) => {
    await connection.query('set local role authenticated');
    await connection.query(
      `select set_config('request.jwt.claim.sub',$1,true),
      set_config('request.jwt.claims',jsonb_build_object('sub',$1::text,'role','authenticated',
        'session_id',$2::text,'exp',coalesce($3::numeric,extract(epoch from now()+interval '1 hour')))::text,true)`,
      [actor.user, actor.session, expires],
    );
  };
  const prepare = async (connection, actor, id, key) => {
    await connection.query('begin');
    await claims(connection, actor);
    const context = (
      await connection.query('select public.tesla_site_link_context($1) as context', [
        actor.household,
      ])
    ).rows[0].context;
    await connection.query('set local role service_role');
    const proof = (
      await connection.query(
        `select public.worker_prepare_tesla_site_link(
      $1,$2,$3,now()+interval '1 hour',$4,$5,'Fixture',$6) as proof`,
        [actor.household, actor.user, actor.session, context.credentialRevision, id, key],
      )
    ).rows[0].proof;
    await connection.query('commit');
    return proof;
  };
  const link = async (connection, actor, proof, key, expires = null) => {
    await connection.query('begin');
    await claims(connection, actor, expires);
    return (
      await connection.query('select public.link_discovered_tesla_site($1,$2,$3) as result', [
        actor.household,
        proof,
        key,
      ])
    ).rows[0].result;
  };
  const blocked = async (pid, phase) => {
    let observed;
    for (let attempt = 0; attempt < 100; attempt++) {
      const row = (
        await client.query('select state,wait_event_type from pg_stat_activity where pid=$1', [pid])
      ).rows[0];
      observed = row;
      if (row?.wait_event_type === 'Lock') return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(
      `Expected site-link lock contention not observed during ${phase} (state=${observed?.state}, wait=${observed?.wait_event_type})`,
    );
  };
  try {
    await first.query("set statement_timeout='10s'");
    await second.query("set statement_timeout='10s'");
    await client.query('delete from public.households where id in (select id from tests.fx)');
    await client.query('delete from auth.users where id in (select id from tests.fx)');
    await client.query('select tests.world()');
    await client.query(
      "insert into public.household_members(household_id,user_id,role) values(tests.id('h1'),tests.id('carol'),'ADMIN')",
    );
    const actors = {};
    for (const [name, hh] of [
      ['alice', 'h1'],
      ['carol', 'h1'],
      ['bob', 'h2'],
    ]) {
      const ids = (
        await client.query('select tests.id($1) as "user",tests.id($2) as household', [name, hh])
      ).rows[0];
      const session = crypto.randomUUID();
      await client.query('insert into auth.sessions(id,user_id) values($1,$2)', [
        session,
        ids.user,
      ]);
      actors[name] = { ...ids, session };
    }
    for (const actor of [actors.alice, actors.bob])
      await client.query(
        `select public.worker_save_tesla_credentials(
      $1,'v1',decode(repeat('00',12),'hex'),decode(repeat('aa',17),'hex'),1,
      array['openid','offline_access','energy_device_data'],'https://fleet-api.prd.eu.vn.cloud.tesla.com',now()+interval '1 hour')`,
        [actor.household],
      );
    const pid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;

    const proofA = await prepare(first, actors.alice, '123', 'concurrent-key-0001');
    const resultA = await link(first, actors.alice, proofA, 'concurrent-key-0001');
    pending = prepare(second, actors.alice, '123', 'concurrent-key-0001');
    await blocked(pid, 'same-key replay');
    await first.query('commit');
    const proofB = await pending;
    pending = undefined;
    const resultB = await link(second, actors.alice, proofB, 'concurrent-key-0001');
    await second.query('commit');
    if (proofA !== proofB || JSON.stringify(resultA) !== JSON.stringify(resultB))
      throw new Error('Concurrent idempotency did not replay the committed result');

    const p2a = await prepare(first, actors.alice, '456', 'concurrent-key-0002');
    const p2b = await prepare(second, actors.carol, '456', 'concurrent-key-0002');
    const r2a = await link(first, actors.alice, p2a, 'concurrent-key-0002');
    pending = link(second, actors.carol, p2b, 'concurrent-key-0002');
    await blocked(pid, 'two ADMINs');
    await first.query('commit');
    const r2b = await pending;
    pending = undefined;
    await second.query('commit');
    if (!r2a.created || r2b.created || r2a.site.id !== r2b.site.id)
      throw new Error('Concurrent ADMINs duplicated a natural site key');

    const p3a = await prepare(first, actors.alice, '789', 'concurrent-key-0003');
    const p3b = await prepare(second, actors.bob, '789', 'concurrent-key-0003');
    await link(first, actors.alice, p3a, 'concurrent-key-0003');
    // Attach a rejection handler immediately while PostgreSQL waits on the unique index.
    pending = link(second, actors.bob, p3b, 'concurrent-key-0003').then(
      (result) => ({ result }),
      (error) => ({ error }),
    );
    await blocked(pid, 'cross-household uniqueness');
    await first.query('commit');
    const foreign = await pending;
    pending = undefined;
    await second.query('rollback');
    if (foreign.error?.code !== '23505')
      throw new Error('Cross-household concurrent link was not rejected');
    const counts = (
      await client.query(`select
      (select count(*)::int from public.energy_sites where provider_site_id in ('123','456','789')) as sites,
      (select count(*)::int from public.audit_log where action='tesla.site_linked') as audits,
      (select household_id from public.energy_sites where provider_site_id='789') as household`)
    ).rows[0];
    if (counts.sites !== 3 || counts.audits !== 3 || counts.household !== actors.alice.household)
      throw new Error('Site persistence/audit/tenant race invariant failed');
    // Time-based authority must be rechecked after request-row and unique-index waits.
    for (const kind of ['jwt-row', 'jwt-index', 'credential-row']) {
      const id = kind === 'jwt-row' ? '881' : kind === 'jwt-index' ? '882' : '883';
      const key = `expiry-${kind}-fixture`;
      if (kind === 'credential-row')
        await client.query(
          "update public.tesla_credentials set access_expires_at=clock_timestamp()+interval '35 seconds' where household_id=$1",
          [actors.alice.household],
        );
      const proof = await prepare(first, actors.alice, id, key);
      await first.query('begin');
      if (kind === 'jwt-index')
        await first.query(
          "insert into public.energy_sites(household_id,provider,provider_site_id,timezone) values($1,'TESLA',$2,'UTC')",
          [actors.alice.household, id],
        );
      else
        await first.query(
          'select 1 from private.tesla_site_link_requests where proof_id=$1 for update',
          [proof],
        );
      // Give setup/transport enough time to reach the intended lock before authority expires.
      // Use the database clock for both the JWT and the later expiry wait (no host-clock skew).
      const jwtExpires = kind.startsWith('jwt')
        ? (
            await client.query(
              "select extract(epoch from clock_timestamp()+interval '5 seconds') as expires",
            )
          ).rows[0].expires
        : null;
      pending = link(second, actors.alice, proof, key, jwtExpires).then(
        (result) => ({ result }),
        (error) => ({ error }),
      );
      await blocked(pid, kind);
      if (kind === 'credential-row')
        await client.query(
          "select pg_sleep(greatest(0,extract(epoch from access_expires_at-interval '30 seconds'-clock_timestamp()))+0.15) from public.tesla_credentials where household_id=$1",
          [actors.alice.household],
        );
      else
        await client.query(
          'select pg_sleep(greatest(0,$1::numeric-extract(epoch from clock_timestamp()))+0.15)',
          [jwtExpires],
        );
      await first.query('commit');
      const outcome = await pending;
      pending = undefined;
      await second.query('rollback');
      if (outcome.error?.code !== (kind === 'credential-row' ? '55000' : '42501'))
        throw new Error(`Link accepted expired authority after ${kind} lock wait`);
      const row = (
        await client.query(
          'select result from private.tesla_site_link_requests where proof_id=$1',
          [proof],
        )
      ).rows[0];
      if (row.result !== null) throw new Error('Rejected link persisted an idempotency result');
      await client.query(
        "update public.tesla_credentials set access_expires_at=clock_timestamp()+interval '1 hour' where household_id=$1",
        [actors.alice.household],
      );
    }
    return 6;
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
