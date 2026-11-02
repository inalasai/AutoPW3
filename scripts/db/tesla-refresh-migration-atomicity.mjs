import assert from 'node:assert/strict';

const migrations = new Set([
  '20261102120000_refresh_staging_tesla_discovery_credentials.sql',
  '20261102140000_resolve_expired_tesla_refresh_attempts.sql',
  '20261102160000_fence_staging_tesla_link_commit.sql',
]);

/** Runs before installation on throwaway PG only; simulates failure before privilege restriction. */
export async function verifyTeslaRefreshMigrationAtomicity(client, file, sql) {
  if (!migrations.has(file)) return 0;
  assert.match(sql, /^--[^]*?\bdo \$migration\$\s+begin\b/i);
  assert.match(sql, /end;\s*\$migration\$;\s*$/i);
  const snapshot = async () =>
    (
      await client.query(`select jsonb_build_object(
        'ledger',to_regclass('private.tesla_discovery_refresh_attempts')::text,
        'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,
          pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),p.proacl::text)
          order by n.nspname,p.proname,p.oid)
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname in ('private','public') and p.prokind='f')
      ) as value`)
    ).rows[0].value;
  const before = await snapshot();
  const marker = file.endsWith('_fence_staging_tesla_link_commit.sql')
    ? 'revoke all on function public.link_discovered_tesla_site'
    : 'revoke all on function private.tesla_refresh_';
  assert.ok(sql.includes(marker));
  const interrupted = sql.replace(
    marker,
    "raise exception using errcode='P0001',message='injected_install_failure';\n" + marker,
  );
  await assert.rejects(client.query(interrupted), (error) => error.code === 'P0001');
  assert.deepEqual(
    await snapshot(),
    before,
    'failed installation must restore all definitions/ACLs',
  );
  // Hosted runners may already have an outer transaction; DO must not commit it or interfere.
  await client.query('begin');
  try {
    await client.query(sql);
  } finally {
    await client.query('rollback');
  }
  assert.deepEqual(
    await snapshot(),
    before,
    'outer transaction rollback must restore installation',
  );
  return 2;
}
