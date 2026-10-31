// Runs the SQL security tests in supabase/tests/database against a throwaway real PostgreSQL server
// (embedded-postgres, PG 17), after applying every migration. Usage: npm run db:test
//
// This is the stand-in for `supabase test db` (pgTAP) when Docker and the Supabase CLI are not available.
// The test files are plain pgTAP-style SQL; here they run with scripts/db/pgtap-lite.sql (a tiny pgTAP
// look-alike) instead of the real pgTAP extension, on top of scripts/db/local-shim.sql (a stand-in for
// auth.users, auth.uid() and the Supabase roles). Both are TEST-ONLY and are listed in KNOWN_LIMITATIONS L-026.
// It also checks that the policies in the database equal the manifest in docs/RLS_POLICY_MATRIX.md.
// A passing run does NOT prove behaviour on a real Supabase stack. Run `supabase test db` there (NOT_EXECUTED so far).
// It never connects to anything except the temporary local server it starts, and deletes it afterwards.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const migrationsDir = join(root, 'supabase', 'migrations');
const testsDir = join(root, 'supabase', 'tests', 'database');
const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const testFiles = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.sql'))
  .sort();
const shimSql = readFileSync(join(root, 'scripts', 'db', 'local-shim.sql'), 'utf8');
const pgtapLiteSql = readFileSync(join(root, 'scripts', 'db', 'pgtap-lite.sql'), 'utf8');
const matrixPath = join(root, 'docs', 'RLS_POLICY_MATRIX.md');

let totalOk = 0;
let totalNotOk = 0;
let hardFailures = 0;

function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolvePort(port));
    });
  });
}

const dataDir = mkdtempSync(join(tmpdir(), 'autopw3-pgtest-'));
const port = await freePort();
const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: false,
  onLog: () => {},
  onError: () => {},
});

const connect = async (database) => {
  const client = new pg.Client({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password: 'postgres',
    database,
  });
  await client.connect();
  return client;
};

async function verifyConcurrentJobClaims(client) {
  const suffix = `job-concurrency-${crypto.randomUUID()}`;
  const inserted = await client.query(
    `insert into public.scheduled_jobs (kind, dedupe_key, run_at)
     values ('sync_live', $1, now() - interval '2 minutes'),
            ('sync_live', $2, now() - interval '1 minute')
     returning id, dedupe_key`,
    [`${suffix}-locked`, `${suffix}-available`],
  );
  const lockedId = inserted.rows.find((row) => row.dedupe_key.endsWith('-locked')).id;
  const availableId = inserted.rows.find((row) => row.dedupe_key.endsWith('-available')).id;
  const workerA = await connect('security_tests');
  const workerB = await connect('security_tests');

  try {
    await workerA.query('begin');
    await workerA.query('select id from public.scheduled_jobs where id = $1 for update', [
      lockedId,
    ]);

    await workerB.query('begin');
    await workerB.query('set local role service_role');
    const claimB = await workerB.query('select id from private.claim_jobs($1, $2, $3)', [
      'worker-b',
      1,
      60,
    ]);
    await workerB.query('commit');

    await workerA.query('set local role service_role');
    const claimA = await workerA.query('select id from private.claim_jobs($1, $2, $3)', [
      'worker-a',
      1,
      60,
    ]);
    await workerA.query('commit');

    if (claimB.rows.length !== 1 || claimB.rows[0].id !== availableId) {
      throw new Error('second worker did not skip the row locked by the first worker');
    }
    if (claimA.rows.length !== 1 || claimA.rows[0].id !== lockedId) {
      throw new Error('first worker did not claim its locked row after releasing its lock');
    }
    if (claimA.rows[0].id === claimB.rows[0].id) {
      throw new Error('concurrent workers claimed the same job');
    }

    totalOk += 1;
    console.log(
      'ok    concurrent job claims: SKIP LOCKED produced disjoint claims for two workers',
    );
  } finally {
    try {
      await workerA.query('rollback');
    } catch {
      /* transaction already committed or rolled back */
    }
    try {
      await workerB.query('rollback');
    } catch {
      /* transaction already committed or rolled back */
    }
    await workerA.end();
    await workerB.end();
    await client.query('delete from public.scheduled_jobs where id = any($1::uuid[])', [
      [lockedId, availableId],
    ]);
  }
}

async function verifyConcurrentCronScheduling(client) {
  const workerA = await connect('security_tests');
  const workerB = await connect('security_tests');
  const scheduledAt = '2026-10-31T12:00:00Z';

  try {
    await client.query('select tests.world()');
    await client.query(
      "update public.energy_sites set connection_state = 'LIVE' where id = tests.id('s1')",
    );
    const households = (
      await client.query(
        "select id from public.households where id in (tests.id('h1'), tests.id('h2'))",
      )
    ).rows.map((r) => r.id);

    const runCron = async (worker) => {
      await worker.query('begin');
      await worker.query('set local role service_role');
      const result = await worker.query(
        'select public.worker_schedule_due_jobs($1::timestamptz, $2, $3) as inserted',
        [scheduledAt, 100, 100],
      );
      await worker.query('commit');
      return Number(result.rows[0].inserted);
    };
    const inserted = await Promise.all([runCron(workerA), runCron(workerB)]);
    const jobs = await client.query(
      `select count(*)::int as count, count(distinct dedupe_key)::int as distinct_count
         from public.scheduled_jobs where household_id = any($1::uuid[])`,
      [households],
    );
    const count = jobs.rows[0].count;
    const distinctCount = jobs.rows[0].distinct_count;
    if (inserted[0] + inserted[1] !== 6 || count !== 6 || distinctCount !== 6) {
      throw new Error(
        `overlapping cron scheduled ${count} rows (${distinctCount} unique) with ${inserted} insert results`,
      );
    }
    totalOk += 1;
    console.log(
      'ok    concurrent cron scheduling: overlapping invocations created one deterministic set of jobs',
    );
  } finally {
    try {
      await workerA.query('rollback');
    } catch {
      /* already committed or rolled back */
    }
    try {
      await workerB.query('rollback');
    } catch {
      /* already committed or rolled back */
    }
    await workerA.end();
    await workerB.end();
    await client.query("delete from public.households where name in ('H1', 'H2')");
    await client.query(
      "delete from auth.users where email in ('alice@example.invalid', 'rw1@example.invalid', 'ro1@example.invalid', 'bob@example.invalid', 'carol@example.invalid')",
    );
    await client.query('delete from tests.fx');
  }
}

// Rows of every statement result, flattened to the TAP lines they contain.
function tapLines(result) {
  const results = Array.isArray(result) ? result : [result];
  const lines = [];
  for (const r of results) {
    for (const row of r.rows ?? []) {
      for (const value of Object.values(row)) {
        if (typeof value === 'string') lines.push(...value.split('\n'));
      }
    }
  }
  return lines.filter((l) => /^(ok |not ok|1\.\.|#)/.test(l));
}

function readManifest() {
  const text = readFileSync(matrixPath, 'utf8');
  const m = text.match(/<!-- policy-manifest:start -->([\s\S]*?)<!-- policy-manifest:end -->/);
  if (!m) throw new Error('policy manifest markers not found in docs/RLS_POLICY_MATRIX.md');
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('```'))
    .map((l) => l.split(/\s+/).join(' '))
    .sort();
}

try {
  console.log(`Starting temporary PostgreSQL on port ${port} ...`);
  await server.initialise();
  await server.start();

  const admin = await connect('postgres');
  await admin.query('create database security_tests');
  await admin.end();

  const client = await connect('security_tests');
  const version = (await client.query('show server_version')).rows[0].server_version;
  console.log(
    `PostgreSQL ${version}; ${migrationFiles.length} migrations; ${testFiles.length} test files`,
  );

  await client.query(shimSql);
  for (const file of migrationFiles) {
    try {
      await client.query(readFileSync(join(migrationsDir, file), 'utf8'));
    } catch (err) {
      console.error(`FAIL  migration ${file}: ${err.message}`);
      throw err;
    }
  }
  console.log('ok    migrations applied');
  await client.query(pgtapLiteSql);

  for (const file of testFiles) {
    const sql = readFileSync(join(testsDir, file), 'utf8');
    let lines;
    try {
      lines = tapLines(await client.query(sql));
    } catch (err) {
      hardFailures += 1;
      console.error(`FAIL  ${file}: ${err.message}`);
      try {
        await client.query('rollback');
      } catch {
        /* nothing to roll back */
      }
      continue;
    }
    const ok = lines.filter((l) => /^ok /.test(l)).length;
    const notOk = lines.filter((l) => /^not ok/.test(l)).length;
    totalOk += ok;
    totalNotOk += notOk;
    const plan = lines.find((l) => /^1\.\./.test(l));
    const planned = plan ? Number(plan.slice(3)) : null;
    if (notOk > 0 || planned === null || planned !== ok + notOk) {
      hardFailures += 1;
      console.error(`FAIL  ${file}: ${ok} ok, ${notOk} not ok, plan ${plan ?? 'missing'}`);
      for (const l of lines) if (!/^ok /.test(l) && !/^1\.\./.test(l)) console.error(`      ${l}`);
    } else {
      console.log(`ok    ${file}: ${ok} tests`);
    }
  }

  try {
    await verifyConcurrentJobClaims(client);
  } catch (err) {
    hardFailures += 1;
    console.error(`FAIL  concurrent job claims: ${err.message}`);
  }

  try {
    await verifyConcurrentCronScheduling(client);
  } catch (err) {
    hardFailures += 1;
    console.error(`FAIL  concurrent cron scheduling: ${err.message}`);
  }

  // The policies in the database must equal the manifest in docs/RLS_POLICY_MATRIX.md.
  try {
    const expected = readManifest();
    const actual = (
      await client.query(
        `select tablename || ' ' || policyname || ' ' || cmd as line from pg_policies where schemaname = 'public'`,
      )
    ).rows
      .map((r) => r.line)
      .sort();
    const missing = expected.filter((l) => !actual.includes(l));
    const undocumented = actual.filter((l) => !expected.includes(l));
    if (missing.length === 0 && undocumented.length === 0) {
      console.log(`ok    policy matrix manifest matches pg_policies (${actual.length} policies)`);
    } else {
      hardFailures += 1;
      console.error('FAIL  policy matrix manifest differs from pg_policies');
      for (const l of missing) console.error(`      documented but not implemented: ${l}`);
      for (const l of undocumented) console.error(`      implemented but not documented: ${l}`);
    }
  } catch (err) {
    hardFailures += 1;
    console.error(`FAIL  policy matrix manifest: ${err.message}`);
  }

  await client.end();
} catch (err) {
  hardFailures += 1;
  console.error(`FAIL  ${err.message}`);
} finally {
  try {
    await server.stop();
  } catch {
    /* already stopped */
  }
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\nTAP results: ${totalOk} ok, ${totalNotOk} not ok across ${testFiles.length} files`);
if (hardFailures > 0) {
  console.error(`\n${hardFailures} failure(s)`);
  process.exit(1);
}
console.log('All security tests passed');
