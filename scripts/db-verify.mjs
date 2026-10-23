// Verifies supabase/migrations against a throwaway real PostgreSQL server (embedded-postgres, PG 17).
// Usage: npm run db:verify
//
// This is the TASK-03 stand-in for `supabase db reset` when Docker and the Supabase CLI are not available.
// It proves: migrations apply from an empty database; they apply again on top of themselves (idempotent);
// a full reset and re-apply works; the seed applies twice; every required table exists with RLS on and no
// access for anon, authenticated or PUBLIC; and the constraints reject bad data.
// It is NOT a substitute for the pgTAP security tests in TASK-04 or for a run on a real Supabase stack.
// Safe to re-run: it creates and deletes a temporary server in the OS temp directory and writes nothing else.
// It never connects to anything except that temporary local server.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const shimSql = readFileSync(join(root, 'scripts', 'db', 'local-shim.sql'), 'utf8');
const seedSql = readFileSync(join(root, 'supabase', 'seed.sql'), 'utf8');

const REQUIRED_TABLES = [
  'user_profiles',
  'households',
  'household_members',
  'household_invitations',
  'household_settings',
  'system_bootstrap',
  'energy_sites',
  'tesla_credentials',
  'oauth_states',
  'powerwall_metrics_log',
  'energy_intervals',
  'telemetry_rollups_hourly',
  'telemetry_rollups_daily',
  'cost_rollups_daily',
  'telemetry_sync_state',
  'provider_usage_daily',
  'utility_tariffs',
  'tariff_seasons',
  'tariff_slots',
  'tariff_overrides',
  'tariff_levies',
  'tariff_price_points',
  'device_command_log',
  'device_command_events',
  'automation_rules',
  'automation_executions',
  'scheduled_jobs',
  'job_locks',
  'audit_log',
];

let failures = 0;
const pass = (name) => console.log(`ok    ${name}`);
const fail = (name, detail) => {
  failures += 1;
  console.error(`FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
};

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

const dataDir = mkdtempSync(join(tmpdir(), 'autopw3-pg-'));
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

async function freshDatabase(name) {
  const admin = await connect('postgres');
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const client = await connect(name);
  await client.query(shimSql);
  return client;
}

async function applyMigrations(client) {
  for (const file of migrationFiles) {
    await client.query(readFileSync(join(migrationsDir, file), 'utf8'));
  }
}

async function snapshot(client) {
  const { rows } = await client.query(`
    select 'table' as kind, table_name as name from information_schema.tables where table_schema = 'public'
    union all select 'column', table_name || '.' || column_name from information_schema.columns where table_schema = 'public'
    union all select 'constraint', conrelid::regclass::text || '.' || conname from pg_constraint
      where connamespace = 'public'::regnamespace
    union all select 'index', indexname from pg_indexes where schemaname = 'public'
    union all select 'trigger', tgrelid::regclass::text || '.' || tgname from pg_trigger
      where not tgisinternal and tgrelid::regclass::text like 'public.%'
    order by 1, 2`);
  return JSON.stringify(rows);
}

// Runs sql in a transaction that is always rolled back. `expect` is a SQLSTATE or 'ok'.
async function check(client, name, expect, sql, params = []) {
  await client.query('begin');
  try {
    await client.query(sql, params);
    if (expect === 'ok') pass(name);
    else fail(name, `expected error ${expect} but statement succeeded`);
  } catch (err) {
    if (expect !== 'ok' && err.code === expect) pass(name);
    else fail(name, `expected ${expect}, got ${err.code ?? 'no code'}: ${err.message}`);
  } finally {
    await client.query('rollback');
  }
}

// Same, but with fixtures and a callback that runs several statements; the first statement that throws is the verdict.
async function checkFlow(client, name, expect, flow) {
  await client.query('begin');
  try {
    const f = await fixtures(client);
    await flow(f);
    if (expect === 'ok') pass(name);
    else fail(name, `expected error ${expect} but flow succeeded`);
  } catch (err) {
    if (expect !== 'ok' && err.code === expect) pass(name);
    else fail(name, `expected ${expect}, got ${err.code ?? 'no code'}: ${err.message}`);
  } finally {
    await client.query('rollback');
  }
}

async function fixtures(client) {
  const userId = randomUUID();
  await client.query('insert into auth.users (id, email) values ($1, $2)', [
    userId,
    `${userId}@example.invalid`,
  ]);
  const h1 = (
    await client.query(
      `insert into households (name, timezone) values ('H1', 'Europe/Dublin') returning id`,
    )
  ).rows[0].id;
  const h2 = (
    await client.query(
      `insert into households (name, timezone) values ('H2', 'Europe/Dublin') returning id`,
    )
  ).rows[0].id;
  const s1 = (
    await client.query(
      `insert into energy_sites (household_id, provider, provider_site_id, timezone) values ($1, 'TESLA', $2, 'Europe/Dublin') returning id`,
      [h1, `site-${randomUUID()}`],
    )
  ).rows[0].id;
  const s2 = (
    await client.query(
      `insert into energy_sites (household_id, provider, provider_site_id, timezone) values ($1, 'TESLA', $2, 'Europe/Dublin') returning id`,
      [h2, `site-${randomUUID()}`],
    )
  ).rows[0].id;
  return { userId, h1, h2, s1, s2 };
}

const hash32 = "decode(repeat('ab', 32), 'hex')";
const tariffInsert = (cols) =>
  `insert into utility_tariffs (household_id, name, direction, price_mode, currency, timezone, effective_from, effective_to${cols.extraCols ?? ''})
   values ($1, 't', '${cols.direction ?? 'IMPORT'}', '${cols.price_mode ?? 'TIME_OF_USE'}', 'EUR', 'Europe/Dublin', '${cols.from}', ${cols.to ? `'${cols.to}'` : 'null'}${cols.extraVals ?? ''}) returning id`;

try {
  console.log(`Starting temporary PostgreSQL on port ${port} ...`);
  await server.initialise();
  await server.start();

  // 1. Apply from empty.
  let client = await freshDatabase('verify_a');
  const version = (await client.query('show server_version')).rows[0].server_version;
  console.log(`PostgreSQL ${version}; ${migrationFiles.length} migration files`);
  try {
    await applyMigrations(client);
    pass('migrations apply from an empty database');
  } catch (err) {
    fail('migrations apply from an empty database', err.message);
    throw err;
  }
  const snap1 = await snapshot(client);

  // 2. Apply again on top of the migrated database (idempotency).
  try {
    await applyMigrations(client);
    const snap2 = await snapshot(client);
    if (snap1 === snap2) pass('migrations re-apply cleanly and change nothing (idempotent)');
    else
      fail(
        'migrations re-apply cleanly and change nothing (idempotent)',
        'schema differs after second apply',
      );
  } catch (err) {
    fail('migrations re-apply cleanly (idempotent)', err.message);
  }

  // 3. Seed twice.
  try {
    await client.query(seedSql);
    await client.query(seedSql);
    const n = (await client.query('select count(*)::int as n from utility_tariffs')).rows[0].n;
    if (n === 2) pass('seed.sql applies twice with no duplicates');
    else fail('seed.sql applies twice with no duplicates', `expected 2 tariffs, found ${n}`);
  } catch (err) {
    fail('seed.sql applies twice', err.message);
  }
  await client.query('begin');
  await client.query(`insert into system_bootstrap (id) values (true)`);
  try {
    await client.query(seedSql);
    fail('seed.sql refuses to run on a bootstrapped database', 'it ran');
  } catch (err) {
    if (/bootstrapped/.test(err.message))
      pass('seed.sql refuses to run on a bootstrapped database');
    else fail('seed.sql refuses to run on a bootstrapped database', err.message);
  }
  await client.query('rollback');
  await client.end();

  // 4. Full reset and re-apply gives the same schema.
  client = await freshDatabase('verify_b');
  try {
    await applyMigrations(client);
    const snapB = await snapshot(client);
    if (snapB === snap1) pass('reset and re-apply from scratch gives an identical schema');
    else fail('reset and re-apply from scratch gives an identical schema', 'schema differs');
  } catch (err) {
    fail('reset and re-apply from scratch', err.message);
  }

  // 5. Required tables, RLS, privileges.
  const tables = (
    await client.query(`select tablename from pg_tables where schemaname = 'public'`)
  ).rows.map((r) => r.tablename);
  const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
  if (missing.length === 0) pass(`all ${REQUIRED_TABLES.length} design tables exist`);
  else fail('all design tables exist', `missing: ${missing.join(', ')}`);
  const extra = tables.filter((t) => !REQUIRED_TABLES.includes(t));
  if (extra.length === 0) pass('no undocumented tables');
  else fail('no undocumented tables', extra.join(', '));

  const noRls = (
    await client.query(
      `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`,
    )
  ).rows;
  if (noRls.length === 0) pass('row level security is enabled on every public table');
  else
    fail(
      'row level security is enabled on every public table',
      noRls.map((r) => r.relname).join(', '),
    );

  const policies = (
    await client.query(`select count(*)::int as n from pg_policies where schemaname = 'public'`)
  ).rows[0].n;
  if (policies === 0) pass('no policies yet (default deny; policies are TASK-04)');
  else fail('no policies yet', `${policies} found`);

  const leaks = (
    await client.query(`
      select r.rolname, c.relname, p.priv
      from pg_roles r
      cross join pg_class c
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
      where r.rolname in ('anon', 'authenticated')
        and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        and has_table_privilege(r.rolname, c.oid, p.priv)`)
  ).rows;
  if (leaks.length === 0) pass('anon and authenticated have no privileges on any public table');
  else
    fail(
      'anon and authenticated have no privileges',
      leaks
        .map((l) => `${l.rolname}:${l.relname}:${l.priv}`)
        .slice(0, 5)
        .join(', '),
    );

  const publicLeaks = (
    await client.query(`
      select c.relname from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        and exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee = 0)`)
  ).rows;
  if (publicLeaks.length === 0) pass('PUBLIC has no privileges on any public table');
  else fail('PUBLIC has no privileges', publicLeaks.map((r) => r.relname).join(', '));

  const privateExec = (
    await client.query(
      `select has_schema_privilege('anon', 'private', 'USAGE') or has_schema_privilege('authenticated', 'private', 'USAGE') as leak`,
    )
  ).rows[0].leak;
  if (!privateExec) pass('anon and authenticated cannot use the private schema');
  else fail('anon and authenticated cannot use the private schema');

  const credPriv = (
    await client.query(
      `select has_table_privilege('authenticated', 'public.tesla_credentials', 'SELECT') or has_table_privilege('anon', 'public.tesla_credentials', 'SELECT') as leak`,
    )
  ).rows[0].leak;
  if (!credPriv) pass('tesla_credentials is not readable by anon or authenticated');
  else fail('tesla_credentials is not readable by anon or authenticated');

  // Units: every measured telemetry column carries its unit in the name and a comment stating it (signs for power).
  const measureTables = [
    'powerwall_metrics_log',
    'energy_intervals',
    'telemetry_rollups_hourly',
    'telemetry_rollups_daily',
  ];
  const allowedNames = /(_w|_wh|_percent|_count)$|_seconds(_min|_max)?$|^(id|completeness)$/;
  const numericCols = (
    await client.query(
      `select c.relname as t, a.attname as col, col_description(c.oid, a.attnum) as comment
       from pg_attribute a join pg_class c on c.oid = a.attrelid
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname = any($1)
         and a.attnum > 0 and not a.attisdropped
         and a.atttypid in ('numeric'::regtype, 'integer'::regtype, 'bigint'::regtype, 'smallint'::regtype)`,
      [measureTables],
    )
  ).rows;
  const badNames = numericCols.filter((r) => !allowedNames.test(r.col));
  if (badNames.length === 0)
    pass(
      `every numeric telemetry column carries a unit in its name (${numericCols.length} checked)`,
    );
  else
    fail(
      'every numeric telemetry column carries a unit in its name',
      badNames.map((r) => `${r.t}.${r.col}`).join(', '),
    );
  const uncommented = numericCols.filter((r) => /(_w|_wh|_percent)$/.test(r.col) && !r.comment);
  const powerCols = numericCols.filter((r) => /_power_w$/.test(r.col));
  const noSign = powerCols.filter(
    (r) => !/(>=? ?0|> 0|< 0|discharging|charging|importing|exporting)/i.test(r.comment ?? ''),
  );
  const wh = numericCols.filter((r) => /_wh$/.test(r.col) && r.t === 'energy_intervals');
  if (uncommented.length === 0)
    pass('every power, energy and percent column has a documented comment');
  else
    fail(
      'every power, energy and percent column has a documented comment',
      uncommented.map((r) => `${r.t}.${r.col}`).join(', '),
    );
  if (powerCols.length > 0 && noSign.length === 0)
    pass(`every power column comment states its sign (${powerCols.length} columns)`);
  else
    fail(
      'every power column comment states its sign',
      noSign.map((r) => `${r.t}.${r.col}`).join(', '),
    );
  if (wh.length === 6) pass('energy_intervals has the six directional energy columns');
  else fail('energy_intervals has the six directional energy columns', `found ${wh.length}`);

  // Optional: regenerate docs/DATABASE_DICTIONARY.md from the real catalog (npm run db:dictionary).
  if (process.argv.includes('--dictionary')) {
    const cols = (
      await client.query(
        `select c.relname as t, obj_description(c.oid, 'pg_class') as tcomment, a.attname as col,
                format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as notnull,
                pg_get_expr(d.adbin, d.adrelid) as dflt, col_description(c.oid, a.attnum) as comment
         from pg_attribute a
         join pg_class c on c.oid = a.attrelid
         left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
         where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
         order by c.relname, a.attnum`,
      )
    ).rows;
    const esc = (s) =>
      String(s ?? '')
        .replaceAll('|', '\\|')
        .replaceAll('\n', ' ');
    const out = [
      '# Database Data Dictionary',
      '',
      'Status: **generated** by `npm run db:dictionary` from the applied migrations (PostgreSQL ' +
        version +
        '). Do not edit by hand: change the migration comments and regenerate.',
      '',
      'Units and signs are also stated once in `docs/ENERGY_ACCOUNTING.md` section 2. Column names carry units (`_w` watts, `_wh` watt-hours, `_percent`, `_per_kwh`, `_seconds`). Power sign convention: solar >= 0; battery > 0 discharging, < 0 charging; grid > 0 importing, < 0 exporting; load >= 0. A NULL energy value means the provider did not supply it; it is never zero.',
      '',
    ];
    let current = '';
    for (const r of cols) {
      if (r.t !== current) {
        current = r.t;
        out.push(`## ${r.t}`, '');
        if (r.tcomment) out.push(esc(r.tcomment), '');
        out.push(
          '| Column | Type | Null | Default | Meaning, unit, sign |',
          '|---|---|---|---|---|',
        );
      }
      out.push(
        `| \`${r.col}\` | ${esc(r.type)} | ${r.notnull ? 'no' : 'yes'} | ${r.dflt ? '`' + esc(r.dflt) + '`' : ''} | ${esc(r.comment)} |`,
      );
      const next = cols[cols.indexOf(r) + 1];
      if (!next || next.t !== r.t) out.push('');
    }
    writeFileSync(join(root, 'docs', 'DATABASE_DICTIONARY.md'), out.join('\n'), 'utf8');
    pass('docs/DATABASE_DICTIONARY.md regenerated');
  }

  // 6. Constraints.
  // Roles
  await checkFlow(client, 'invalid role is rejected', '22P02', async (f) => {
    await client.query(
      `insert into household_members (household_id, user_id, role) values ($1, $2, 'SUPERUSER')`,
      [f.h1, f.userId],
    );
  });
  await checkFlow(
    client,
    'membership without a role is rejected (no default role)',
    '23502',
    async (f) => {
      await client.query(`insert into household_members (household_id, user_id) values ($1, $2)`, [
        f.h1,
        f.userId,
      ]);
    },
  );
  await checkFlow(client, 'valid membership is accepted', 'ok', async (f) => {
    await client.query(
      `insert into household_members (household_id, user_id, role) values ($1, $2, 'READ_ONLY')`,
      [f.h1, f.userId],
    );
  });
  await checkFlow(client, 'invitation role defaults to READ_ONLY', 'ok', async (f) => {
    const r = await client.query(
      `insert into household_invitations (household_id, token_hash, expires_at) values ($1, ${hash32}, now() + interval '1 day') returning role`,
      [f.h1],
    );
    if (r.rows[0].role !== 'READ_ONLY') throw new Error(`default role was ${r.rows[0].role}`);
  });

  // Timezones
  await checkFlow(client, 'invalid household timezone is rejected', '22023', async () => {
    await client.query(`insert into households (name, timezone) values ('x', 'Mars/Olympus')`);
  });
  await checkFlow(client, 'posix timezone alias is rejected', '22023', async () => {
    await client.query(
      `insert into households (name, timezone) values ('x', 'posix/Europe/Dublin')`,
    );
  });
  await checkFlow(client, 'invalid site timezone is rejected', '22023', async (f) => {
    await client.query(
      `insert into energy_sites (household_id, provider, provider_site_id, timezone) values ($1, 'TESLA', 'tz-bad', 'Nowhere/Land')`,
      [f.h1],
    );
  });
  await checkFlow(client, 'invalid tariff timezone is rejected', '22023', async (f) => {
    await client.query(
      `insert into utility_tariffs (household_id, name, direction, price_mode, currency, timezone, effective_from, flat_rate_per_kwh)
       values ($1, 't', 'IMPORT', 'FLAT', 'EUR', 'Bad/Zone', '2026-01-01', 0.1)`,
      [f.h1],
    );
  });

  // Sites and credentials
  await checkFlow(client, 'DEMO provider is rejected for energy_sites', '23514', async (f) => {
    await client.query(
      `insert into energy_sites (household_id, provider, provider_site_id, timezone) values ($1, 'DEMO', 'd1', 'UTC')`,
      [f.h1],
    );
  });
  await checkFlow(
    client,
    'credential nonce of the wrong length is rejected',
    '23514',
    async (f) => {
      await client.query(
        `insert into tesla_credentials (household_id, key_id, nonce, ciphertext, fleet_api_base_url)
       values ($1, 'k1', decode('00', 'hex'), decode(repeat('aa', 40), 'hex'), 'https://example.invalid')`,
        [f.h1],
      );
    },
  );
  await checkFlow(client, 'non-https Fleet API base URL is rejected', '23514', async (f) => {
    await client.query(
      `insert into tesla_credentials (household_id, key_id, nonce, ciphertext, fleet_api_base_url)
       values ($1, 'k1', decode(repeat('00', 12), 'hex'), decode(repeat('aa', 40), 'hex'), 'http://example.invalid')`,
      [f.h1],
    );
  });
  await checkFlow(client, 'one credential row per household', '23505', async (f) => {
    const sql = `insert into tesla_credentials (household_id, key_id, nonce, ciphertext, fleet_api_base_url)
       values ($1, 'k1', decode(repeat('00', 12), 'hex'), decode(repeat('aa', 40), 'hex'), 'https://example.invalid')`;
    await client.query(sql, [f.h1]);
    await client.query(sql, [f.h1]);
  });

  // Telemetry
  const sample = (soc, source = 'TESLA') =>
    `insert into powerwall_metrics_log (site_id, sampled_at, timestamp_origin, solar_power_w, battery_power_w, grid_power_w, load_power_w, battery_soc_percent, source)
     values ($1, '2026-03-29 00:00:00+00', 'PROVIDER', 100, -50, 20, 70, ${soc}, '${source}')`;
  await checkFlow(
    client,
    'valid power sample is accepted (charging battery, importing grid)',
    'ok',
    async (f) => {
      await client.query(sample(55), [f.s1]);
    },
  );
  await checkFlow(client, 'battery_soc_percent above 100 is rejected', '23514', async (f) => {
    await client.query(sample(100.5), [f.s1]);
  });
  await checkFlow(client, 'battery_soc_percent below 0 is rejected', '23514', async (f) => {
    await client.query(sample(-0.1), [f.s1]);
  });
  await checkFlow(client, 'battery_soc_percent bounds 0 and 100 are accepted', 'ok', async (f) => {
    await client.query(sample(0), [f.s1]);
    await client.query(sample(100).replace('00:00:00+00', '00:05:00+00'), [f.s1]);
  });
  await checkFlow(client, 'duplicate (site, timestamp) sample is rejected', '23505', async (f) => {
    await client.query(sample(50), [f.s1]);
    await client.query(sample(51), [f.s1]);
  });
  await checkFlow(client, 'same timestamp on a different site is accepted', 'ok', async (f) => {
    await client.query(sample(50), [f.s1]);
    await client.query(sample(50), [f.s2]);
  });
  await checkFlow(
    client,
    'DEMO source is rejected in powerwall_metrics_log',
    '23514',
    async (f) => {
      await client.query(sample(50, 'DEMO'), [f.s1]);
    },
  );
  await checkFlow(client, 'negative solar power is rejected', '23514', async (f) => {
    await client.query(
      `insert into powerwall_metrics_log (site_id, sampled_at, timestamp_origin, solar_power_w, source) values ($1, now(), 'PROVIDER', -1, 'TESLA')`,
      [f.s1],
    );
  });
  await checkFlow(client, 'negative load power is rejected', '23514', async (f) => {
    await client.query(
      `insert into powerwall_metrics_log (site_id, sampled_at, timestamp_origin, load_power_w, source) values ($1, now(), 'PROVIDER', -1, 'TESLA')`,
      [f.s1],
    );
  });
  await checkFlow(client, 'DEMO source is rejected in energy_intervals', '23514', async (f) => {
    await client.query(
      `insert into energy_intervals (site_id, interval_start, interval_end, resolution_seconds, source) values ($1, '2026-01-01', '2026-01-01 00:05', 300, 'DEMO')`,
      [f.s1],
    );
  });
  await checkFlow(client, 'interval with end before start is rejected', '23514', async (f) => {
    await client.query(
      `insert into energy_intervals (site_id, interval_start, interval_end, resolution_seconds, source) values ($1, '2026-01-01 00:05', '2026-01-01', 300, 'TESLA')`,
      [f.s1],
    );
  });
  await checkFlow(client, 'negative interval energy is rejected', '23514', async (f) => {
    await client.query(
      `insert into energy_intervals (site_id, interval_start, interval_end, resolution_seconds, grid_import_wh, source) values ($1, '2026-01-01', '2026-01-01 00:05', 300, -1, 'TESLA')`,
      [f.s1],
    );
  });
  await checkFlow(
    client,
    'interval with NULL energy fields is accepted (unavailable is not zero)',
    'ok',
    async (f) => {
      await client.query(
        `insert into energy_intervals (site_id, interval_start, interval_end, resolution_seconds, source) values ($1, '2026-01-01', '2026-01-01 00:05', 300, 'TESLA')`,
        [f.s1],
      );
    },
  );
  await checkFlow(client, 'duplicate interval key is rejected', '23505', async (f) => {
    const sql = `insert into energy_intervals (site_id, interval_start, interval_end, resolution_seconds, source) values ($1, '2026-01-01', '2026-01-01 00:05', 300, 'TESLA')`;
    await client.query(sql, [f.s1]);
    await client.query(sql, [f.s1]);
  });
  await checkFlow(
    client,
    'hourly rollup bucket not on the hour is rejected',
    '23514',
    async (f) => {
      await client.query(
        `insert into telemetry_rollups_hourly (site_id, bucket_start, completeness) values ($1, '2026-01-01 00:30:00+00', 1)`,
        [f.s1],
      );
    },
  );
  await checkFlow(client, 'completeness above 1 is rejected', '23514', async (f) => {
    await client.query(
      `insert into telemetry_rollups_hourly (site_id, bucket_start, completeness) values ($1, '2026-01-01 00:00:00+00', 1.01)`,
      [f.s1],
    );
  });
  await checkFlow(client, 'daily rollup for a 23-hour DST day is accepted', 'ok', async (f) => {
    await client.query(
      `insert into telemetry_rollups_daily (site_id, local_date, timezone, day_start_utc, day_end_utc, completeness)
       values ($1, '2026-03-29', 'Europe/Dublin', '2026-03-29 00:00:00+00', '2026-03-29 23:00:00+00', 1)`,
      [f.s1],
    );
  });
  await checkFlow(client, 'daily rollup spanning 30 hours is rejected', '23514', async (f) => {
    await client.query(
      `insert into telemetry_rollups_daily (site_id, local_date, timezone, day_start_utc, day_end_utc, completeness)
       values ($1, '2026-03-29', 'Europe/Dublin', '2026-03-29 00:00:00+00', '2026-03-30 06:00:00+00', 1)`,
      [f.s1],
    );
  });
  await checkFlow(client, 'sync state with an unknown stream is rejected', '23514', async (f) => {
    await client.query(
      `insert into telemetry_sync_state (site_id, stream) values ($1, 'STREAMING')`,
      [f.s1],
    );
  });
  await checkFlow(client, 'usage errors above requests are rejected', '23514', async (f) => {
    await client.query(
      `insert into provider_usage_daily (household_id, usage_day, category, request_count, error_count) values ($1, '2026-01-01', 'DATA', 1, 2)`,
      [f.h1],
    );
  });

  // Settings
  await checkFlow(
    client,
    'stale_after_seconds not above the polling interval is rejected',
    '23514',
    async (f) => {
      await client.query(
        `insert into household_settings (household_id, live_background_interval_minutes, stale_after_seconds) values ($1, 30, 1800)`,
        [f.h1],
      );
    },
  );
  await checkFlow(
    client,
    'default settings are accepted (cap 9.00, controls off, not paused)',
    'ok',
    async (f) => {
      const r = await client.query(
        `insert into household_settings (household_id) values ($1) returning monthly_spend_cap_usd::text as cap, controls_enabled, automation_paused`,
        [f.h1],
      );
      const row = r.rows[0];
      if (row.cap !== '9.00' || row.controls_enabled !== false || row.automation_paused !== false)
        throw new Error(JSON.stringify(row));
    },
  );
  await check(
    client,
    'system_bootstrap rejects id = false',
    '23514',
    `insert into system_bootstrap (id) values (false)`,
  );
  await checkFlow(client, 'system_bootstrap allows only one row', '23505', async () => {
    await client.query(`insert into system_bootstrap (id) values (true)`);
    await client.query(`insert into system_bootstrap (id) values (true)`);
  });

  // Tariffs
  await checkFlow(client, 'invalid tariff direction is rejected', '23514', async (f) => {
    await client.query(
      tariffInsert({
        direction: 'BOTH',
        from: '2026-01-01',
        extraCols: ', flat_rate_per_kwh',
        extraVals: ', 0.1',
        price_mode: 'FLAT',
      }),
      [f.h1],
    );
  });
  await checkFlow(client, 'FLAT tariff without a rate is rejected', '23514', async (f) => {
    await client.query(tariffInsert({ price_mode: 'FLAT', from: '2026-01-01' }), [f.h1]);
  });
  await checkFlow(client, 'standing charge on an EXPORT tariff is rejected', '23514', async (f) => {
    await client.query(
      tariffInsert({
        direction: 'EXPORT',
        from: '2026-01-01',
        extraCols: ', standing_charge_per_day',
        extraVals: ', 0.5',
      }),
      [f.h1],
    );
  });
  await checkFlow(client, 'taxed tariff without a VAT rate is rejected', '23514', async (f) => {
    await client.query(
      tariffInsert({ from: '2026-01-01', extraCols: ', tax_mode', extraVals: ", 'EXCLUSIVE'" }),
      [f.h1],
    );
  });
  await checkFlow(
    client,
    'effective_to not after effective_from is rejected',
    '23514',
    async (f) => {
      await client.query(tariffInsert({ from: '2026-02-01', to: '2026-01-01' }), [f.h1]);
    },
  );
  await checkFlow(
    client,
    'overlapping tariff dates (same household, direction) are rejected',
    '23P01',
    async (f) => {
      await client.query(tariffInsert({ from: '2026-01-01', to: '2026-07-01' }), [f.h1]);
      await client.query(tariffInsert({ from: '2026-06-30', to: '2026-12-31' }), [f.h1]);
    },
  );
  await checkFlow(
    client,
    'back-to-back tariff versions [from, to) are accepted',
    'ok',
    async (f) => {
      await client.query(tariffInsert({ from: '2026-01-01', to: '2026-07-01' }), [f.h1]);
      await client.query(tariffInsert({ from: '2026-07-01', to: null }), [f.h1]);
    },
  );
  await checkFlow(client, 'open-ended tariff overlaps a later tariff', '23P01', async (f) => {
    await client.query(tariffInsert({ from: '2026-01-01' }), [f.h1]);
    await client.query(tariffInsert({ from: '2030-01-01' }), [f.h1]);
  });
  await checkFlow(client, 'IMPORT and EXPORT tariffs may cover the same dates', 'ok', async (f) => {
    await client.query(tariffInsert({ from: '2026-01-01' }), [f.h1]);
    await client.query(tariffInsert({ direction: 'EXPORT', from: '2026-01-01' }), [f.h1]);
  });
  await checkFlow(
    client,
    'a site-specific tariff must use a site of the same household',
    '23503',
    async (f) => {
      await client.query(
        `insert into utility_tariffs (household_id, site_id, name, direction, price_mode, currency, timezone, effective_from, flat_rate_per_kwh)
       values ($1, $2, 't', 'IMPORT', 'FLAT', 'EUR', 'Europe/Dublin', '2026-01-01', 0.1)`,
        [f.h1, f.s2],
      );
    },
  );
  const slotSql = (a, b, extra = '') =>
    `insert into tariff_slots (tariff_id, day_type, start_minute, end_minute, rate_per_kwh${extra ? ', ' + extra.cols : ''}) values ($1, 'ALL', ${a}, ${b}, 0.1${extra ? ', ' + extra.vals : ''})`;
  await checkFlow(client, 'overlapping tariff slots are rejected', '23P01', async (f) => {
    const t = (await client.query(tariffInsert({ from: '2026-01-01' }), [f.h1])).rows[0].id;
    await client.query(slotSql(0, 600), [t]);
    await client.query(slotSql(599, 1440), [t]);
  });
  await checkFlow(
    client,
    'adjacent tariff slots covering the whole day are accepted',
    'ok',
    async (f) => {
      const t = (await client.query(tariffInsert({ from: '2026-01-01' }), [f.h1])).rows[0].id;
      await client.query(slotSql(0, 480), [t]);
      await client.query(slotSql(480, 1440), [t]);
    },
  );
  await checkFlow(
    client,
    'slot with end_minute not after start_minute is rejected',
    '23514',
    async (f) => {
      const t = (await client.query(tariffInsert({ from: '2026-01-01' }), [f.h1])).rows[0].id;
      await client.query(slotSql(600, 600), [t]);
    },
  );
  await checkFlow(client, 'slot minute above 1440 is rejected', '23514', async (f) => {
    const t = (await client.query(tariffInsert({ from: '2026-01-01' }), [f.h1])).rows[0].id;
    await client.query(slotSql(0, 1441), [t]);
  });
  await checkFlow(client, 'negative slot rate is rejected', '23514', async (f) => {
    const t = (await client.query(tariffInsert({ from: '2026-01-01' }), [f.h1])).rows[0].id;
    await client.query(
      `insert into tariff_slots (tariff_id, start_minute, end_minute, rate_per_kwh) values ($1, 0, 60, -0.01)`,
      [t],
    );
  });
  await checkFlow(
    client,
    'a slot cannot reference a season of another tariff',
    '23503',
    async (f) => {
      const t1 = (
        await client.query(tariffInsert({ from: '2026-01-01', direction: 'IMPORT' }), [f.h1])
      ).rows[0].id;
      const t2 = (
        await client.query(tariffInsert({ from: '2026-01-01', direction: 'EXPORT' }), [f.h1])
      ).rows[0].id;
      const season = (
        await client.query(
          `insert into tariff_seasons (tariff_id, name, start_month, start_day, end_month, end_day) values ($1, 's', 4, 1, 9, 30) returning id`,
          [t2],
        )
      ).rows[0].id;
      await client.query(slotSql(0, 60, { cols: 'season_id', vals: `'${season}'` }), [t1]);
    },
  );
  await checkFlow(
    client,
    'a slot cannot reference both a season and an override',
    '23514',
    async (f) => {
      const t = (await client.query(tariffInsert({ from: '2026-01-01' }), [f.h1])).rows[0].id;
      const season = (
        await client.query(
          `insert into tariff_seasons (tariff_id, name, start_month, start_day, end_month, end_day) values ($1, 's', 4, 1, 9, 30) returning id`,
          [t],
        )
      ).rows[0].id;
      const ov = (
        await client.query(
          `insert into tariff_overrides (tariff_id, name, date_from, date_to) values ($1, 'o', '2026-12-25', '2026-12-26') returning id`,
          [t],
        )
      ).rows[0].id;
      await client.query(
        slotSql(0, 60, { cols: 'season_id, override_id', vals: `'${season}', '${ov}'` }),
        [t],
      );
    },
  );
  await checkFlow(client, 'season month 13 is rejected', '23514', async (f) => {
    const t = (await client.query(tariffInsert({ from: '2026-01-01' }), [f.h1])).rows[0].id;
    await client.query(
      `insert into tariff_seasons (tariff_id, name, start_month, start_day, end_month, end_day) values ($1, 's', 13, 1, 9, 30)`,
      [t],
    );
  });
  await checkFlow(
    client,
    'equal-priority overlapping overrides are rejected',
    '23P01',
    async (f) => {
      const t = (await client.query(tariffInsert({ from: '2026-01-01' }), [f.h1])).rows[0].id;
      await client.query(
        `insert into tariff_overrides (tariff_id, name, date_from, date_to, priority) values ($1, 'a', '2026-12-24', '2026-12-27', 1)`,
        [t],
      );
      await client.query(
        `insert into tariff_overrides (tariff_id, name, date_from, date_to, priority) values ($1, 'b', '2026-12-26', '2026-12-30', 1)`,
        [t],
      );
    },
  );
  await checkFlow(
    client,
    'different-priority overlapping overrides are accepted',
    'ok',
    async (f) => {
      const t = (await client.query(tariffInsert({ from: '2026-01-01' }), [f.h1])).rows[0].id;
      await client.query(
        `insert into tariff_overrides (tariff_id, name, date_from, date_to, priority) values ($1, 'a', '2026-12-24', '2026-12-27', 1)`,
        [t],
      );
      await client.query(
        `insert into tariff_overrides (tariff_id, name, date_from, date_to, priority) values ($1, 'b', '2026-12-26', '2026-12-30', 2)`,
        [t],
      );
    },
  );
  await checkFlow(client, 'overlapping dynamic price points are rejected', '23P01', async (f) => {
    const t = (
      await client.query(tariffInsert({ from: '2026-01-01', price_mode: 'DYNAMIC' }), [f.h1])
    ).rows[0].id;
    await client.query(
      `insert into tariff_price_points (tariff_id, interval_start, interval_end, rate_per_kwh) values ($1, '2026-01-01 00:00+00', '2026-01-01 00:30+00', 0.2)`,
      [t],
    );
    await client.query(
      `insert into tariff_price_points (tariff_id, interval_start, interval_end, rate_per_kwh) values ($1, '2026-01-01 00:15+00', '2026-01-01 00:45+00', 0.2)`,
      [t],
    );
  });
  await checkFlow(client, 'half-hourly dynamic price points are accepted', 'ok', async (f) => {
    const t = (
      await client.query(tariffInsert({ from: '2026-01-01', price_mode: 'DYNAMIC' }), [f.h1])
    ).rows[0].id;
    await client.query(
      `insert into tariff_price_points (tariff_id, interval_start, interval_end, rate_per_kwh) values ($1, '2026-01-01 00:00+00', '2026-01-01 00:30+00', 0.2)`,
      [t],
    );
    await client.query(
      `insert into tariff_price_points (tariff_id, interval_start, interval_end, rate_per_kwh) values ($1, '2026-01-01 00:30+00', '2026-01-01 01:00+00', 0.25)`,
      [t],
    );
  });
  await checkFlow(client, 'currency must be a three-letter upper-case code', '23514', async (f) => {
    await client.query(
      `insert into utility_tariffs (household_id, name, direction, price_mode, currency, timezone, effective_from, flat_rate_per_kwh)
       values ($1, 't', 'IMPORT', 'FLAT', 'eur', 'Europe/Dublin', '2026-01-01', 0.1)`,
      [f.h1],
    );
  });
  await checkFlow(
    client,
    'rate scale is exact (0.123456 round-trips, not a float)',
    'ok',
    async (f) => {
      const r = await client.query(
        `insert into utility_tariffs (household_id, name, direction, price_mode, currency, timezone, effective_from, flat_rate_per_kwh)
       values ($1, 't', 'IMPORT', 'FLAT', 'EUR', 'Europe/Dublin', '2026-01-01', 0.123456) returning flat_rate_per_kwh::text as v`,
        [f.h1],
      );
      if (r.rows[0].v !== '0.123456') throw new Error(`got ${r.rows[0].v}`);
    },
  );

  // Commands and automation
  const cmdSql = (kind, key, state = 'PENDING') =>
    `insert into device_command_log (household_id, site_id, origin, kind, params, params_hash, idempotency_key, provider_mode, state)
     values ($1, $2, 'USER', '${kind}', '{}'::jsonb, ${hash32}, '${key}', 'MOCK', '${state}')`;
  await checkFlow(client, 'a documented command kind is accepted', 'ok', async (f) => {
    await client.query(cmdSql('SET_BACKUP_RESERVE', 'key-0001-aaaa'), [f.h1, f.s1]);
  });
  await checkFlow(
    client,
    'a NOT_SUPPORTED command kind (forced charge) is not representable',
    '23514',
    async (f) => {
      await client.query(cmdSql('FORCE_CHARGE', 'key-0002-aaaa'), [f.h1, f.s1]);
    },
  );
  await checkFlow(client, 'invalid command state is rejected', '23514', async (f) => {
    await client.query(cmdSql('SET_BACKUP_RESERVE', 'key-0003-aaaa', 'SUCCESS'), [f.h1, f.s1]);
  });
  await checkFlow(client, 'command state defaults to PENDING/RECORDED', 'ok', async (f) => {
    const r = await client.query(
      cmdSql('SET_BACKUP_RESERVE', 'key-0004-aaaa') + ' returning state, phase',
      [f.h1, f.s1],
    );
    if (r.rows[0].state !== 'PENDING' || r.rows[0].phase !== 'RECORDED')
      throw new Error(JSON.stringify(r.rows[0]));
  });
  await checkFlow(
    client,
    'duplicate idempotency key for a site is rejected',
    '23505',
    async (f) => {
      await client.query(cmdSql('SET_BACKUP_RESERVE', 'key-0005-aaaa'), [f.h1, f.s1]);
      await client.query(cmdSql('SET_STORM_MODE', 'key-0005-aaaa'), [f.h1, f.s1]);
    },
  );
  await checkFlow(
    client,
    'same idempotency key on a different site is accepted',
    'ok',
    async (f) => {
      await client.query(cmdSql('SET_BACKUP_RESERVE', 'key-0006-aaaa'), [f.h1, f.s1]);
      await client.query(cmdSql('SET_BACKUP_RESERVE', 'key-0006-aaaa'), [f.h2, f.s2]);
    },
  );
  await checkFlow(client, 'too-short idempotency key is rejected', '23514', async (f) => {
    await client.query(cmdSql('SET_BACKUP_RESERVE', 'short'), [f.h1, f.s1]);
  });
  await checkFlow(
    client,
    'a command cannot name a site of another household',
    '23503',
    async (f) => {
      await client.query(cmdSql('SET_BACKUP_RESERVE', 'key-0007-aaaa'), [f.h1, f.s2]);
    },
  );
  await checkFlow(client, 'params_hash must be 32 bytes', '23514', async (f) => {
    await client.query(
      `insert into device_command_log (household_id, site_id, origin, kind, params, params_hash, idempotency_key, provider_mode)
       values ($1, $2, 'USER', 'SET_BACKUP_RESERVE', '{}'::jsonb, decode('abcd', 'hex'), 'key-0008-aaaa', 'MOCK')`,
      [f.h1, f.s1],
    );
  });
  const ruleSql = (mode) =>
    `insert into automation_rules (household_id, site_id, name, ${mode ? 'mode, ' : ''}definition) values ($1, $2, 'r', ${mode ? `'${mode}', ` : ''}'{}'::jsonb) returning id, mode`;
  await checkFlow(client, 'automation rule mode defaults to DISABLED', 'ok', async (f) => {
    const r = await client.query(ruleSql(null), [f.h1, f.s1]);
    if (r.rows[0].mode !== 'DISABLED') throw new Error(`default mode was ${r.rows[0].mode}`);
  });
  await checkFlow(
    client,
    'rule modes DISABLED, DRY_RUN and ACTIVE are accepted',
    'ok',
    async (f) => {
      for (const m of ['DISABLED', 'DRY_RUN', 'ACTIVE'])
        await client.query(ruleSql(m), [f.h1, f.s1]);
    },
  );
  await checkFlow(client, 'invalid rule mode is rejected', '23514', async (f) => {
    await client.query(ruleSql('ENABLED'), [f.h1, f.s1]);
  });
  await checkFlow(client, 'a rule cannot name a site of another household', '23503', async (f) => {
    await client.query(ruleSql('DRY_RUN'), [f.h1, f.s2]);
  });
  const execSql = (mode, decision) =>
    `insert into automation_executions (rule_id, site_id, scheduled_slot, mode_at_evaluation, decision) values ($1, $2, now(), '${mode}', '${decision}')`;
  await checkFlow(client, 'a DRY_RUN execution can never be ACTED', '23514', async (f) => {
    const rule = (await client.query(ruleSql('DRY_RUN'), [f.h1, f.s1])).rows[0].id;
    await client.query(execSql('DRY_RUN', 'ACTED'), [rule, f.s1]);
  });
  await checkFlow(client, 'a DRY_RUN execution can be WOULD_ACT', 'ok', async (f) => {
    const rule = (await client.query(ruleSql('DRY_RUN'), [f.h1, f.s1])).rows[0].id;
    await client.query(execSql('DRY_RUN', 'WOULD_ACT'), [rule, f.s1]);
  });
  await checkFlow(
    client,
    'duplicate execution for one rule and slot is rejected',
    '23505',
    async (f) => {
      const rule = (await client.query(ruleSql('ACTIVE'), [f.h1, f.s1])).rows[0].id;
      await client.query(
        `insert into automation_executions (rule_id, site_id, scheduled_slot, mode_at_evaluation, decision) values ($1, $2, '2026-01-01 00:00+00', 'ACTIVE', 'NO_ACTION')`,
        [rule, f.s1],
      );
      await client.query(
        `insert into automation_executions (rule_id, site_id, scheduled_slot, mode_at_evaluation, decision) values ($1, $2, '2026-01-01 00:00+00', 'ACTIVE', 'NO_ACTION')`,
        [rule, f.s1],
      );
    },
  );
  await checkFlow(
    client,
    'an execution cannot name a site different from its rule',
    '23503',
    async (f) => {
      const rule = (await client.query(ruleSql('ACTIVE'), [f.h1, f.s1])).rows[0].id;
      await client.query(execSql('ACTIVE', 'NO_ACTION'), [rule, f.s2]);
    },
  );

  // Jobs and locks
  await checkFlow(client, 'duplicate job dedupe_key is rejected', '23505', async () => {
    const sql = `insert into scheduled_jobs (kind, dedupe_key, run_at) values ('rollup', 'rollup:site:2026-01-01T00:00', now())`;
    await client.query(sql);
    await client.query(sql);
  });
  await checkFlow(client, 'unknown job kind is rejected', '23514', async () => {
    await client.query(
      `insert into scheduled_jobs (kind, dedupe_key, run_at) values ('mine_bitcoin', 'x', now())`,
    );
  });
  await checkFlow(client, 'job defaults to QUEUED', 'ok', async () => {
    const r = await client.query(
      `insert into scheduled_jobs (kind, dedupe_key, run_at) values ('rollup', 'k1', now()) returning state`,
    );
    if (r.rows[0].state !== 'QUEUED') throw new Error(r.rows[0].state);
  });
  await checkFlow(client, 'job_locks key is unique', '23505', async () => {
    const sql = `insert into job_locks (key, owner, lease_expires_at) values ('token:abc', 'w1', now() + interval '30 seconds')`;
    await client.query(sql);
    await client.query(sql);
  });

  // Append-only behaviour and cascades
  await checkFlow(client, 'device_command_events cannot be updated', '55000', async (f) => {
    const cmd = (
      await client.query(cmdSql('SET_BACKUP_RESERVE', 'key-0009-aaaa') + ' returning id', [
        f.h1,
        f.s1,
      ])
    ).rows[0].id;
    await client.query(
      `insert into device_command_events (command_id, to_state) values ($1, 'PENDING')`,
      [cmd],
    );
    await client.query(
      `update device_command_events set to_state = 'CONFIRMED' where command_id = $1`,
      [cmd],
    );
  });
  await checkFlow(
    client,
    'device_command_events cannot be deleted directly',
    '55000',
    async (f) => {
      const cmd = (
        await client.query(cmdSql('SET_BACKUP_RESERVE', 'key-0010-aaaa') + ' returning id', [
          f.h1,
          f.s1,
        ])
      ).rows[0].id;
      await client.query(
        `insert into device_command_events (command_id, to_state) values ($1, 'PENDING')`,
        [cmd],
      );
      await client.query(`delete from device_command_events where command_id = $1`, [cmd]);
    },
  );
  await checkFlow(client, 'audit_log cannot be updated', '55000', async (f) => {
    await client.query(
      `insert into audit_log (household_id, actor_type, action) values ($1, 'SYSTEM', 'settings.changed')`,
      [f.h1],
    );
    await client.query(`update audit_log set action = 'tampered'`);
  });
  await checkFlow(client, 'audit_log cannot be deleted directly', '55000', async (f) => {
    await client.query(
      `insert into audit_log (household_id, actor_type, action) values ($1, 'SYSTEM', 'settings.changed')`,
      [f.h1],
    );
    await client.query(`delete from audit_log`);
  });
  await checkFlow(
    client,
    'deleting a household cascades through sites, commands, events and audit rows',
    'ok',
    async (f) => {
      const cmd = (
        await client.query(cmdSql('SET_BACKUP_RESERVE', 'key-0011-aaaa') + ' returning id', [
          f.h1,
          f.s1,
        ])
      ).rows[0].id;
      await client.query(
        `insert into device_command_events (command_id, to_state) values ($1, 'PENDING')`,
        [cmd],
      );
      await client.query(
        `insert into audit_log (household_id, actor_type, action) values ($1, 'SYSTEM', 'settings.changed')`,
        [f.h1],
      );
      await client.query(`delete from households where id = $1`, [f.h1]);
      const left = (
        await client.query(
          `select (select count(*) from energy_sites where household_id = $1) + (select count(*) from device_command_log where id = $2)
              + (select count(*) from device_command_events where command_id = $2) + (select count(*) from audit_log where household_id = $1) as n`,
          [f.h1, cmd],
        )
      ).rows[0].n;
      if (Number(left) !== 0) throw new Error(`${left} rows remained`);
    },
  );
  await checkFlow(
    client,
    'deleting a user keeps the audit row and removes the link to the person',
    'ok',
    async (f) => {
      await client.query(
        `insert into audit_log (household_id, actor_type, actor_user_id, action) values ($1, 'USER', $2, 'member.role_changed')`,
        [f.h1, f.userId],
      );
      await client.query(`delete from auth.users where id = $1`, [f.userId]);
      const r = await client.query(
        `select actor_user_id, action from audit_log where household_id = $1`,
        [f.h1],
      );
      if (r.rows.length !== 1 || r.rows[0].actor_user_id !== null)
        throw new Error(JSON.stringify(r.rows));
    },
  );
  await checkFlow(
    client,
    'deleting a user removes their memberships and profile',
    'ok',
    async (f) => {
      await client.query(
        `insert into household_members (household_id, user_id, role) values ($1, $2, 'READ_WRITE')`,
        [f.h1, f.userId],
      );
      await client.query(`insert into user_profiles (user_id) values ($1)`, [f.userId]);
      await client.query(`delete from auth.users where id = $1`, [f.userId]);
      const r = await client.query(
        `select (select count(*) from household_members where user_id = $1) + (select count(*) from user_profiles where user_id = $1) as n`,
        [f.userId],
      );
      if (Number(r.rows[0].n) !== 0) throw new Error('rows remained');
    },
  );

  await client.end();
} catch (err) {
  failures += 1;
  console.error(`ERROR ${err.stack ?? err}`);
} finally {
  try {
    await server.stop();
  } catch {
    // server may not have started
  }
  rmSync(dataDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} database check(s) failed`);
  process.exit(1);
}
console.log('\nAll database checks passed');
