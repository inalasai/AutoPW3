// Generates packages/shared/src/db/database.types.ts from supabase/migrations.
// Usage: npm run db:types           (write the file)
//        npm run db:types -- --check (fail if the committed file is out of date; used by CI)
//
// This is the stand-in for `supabase gen types typescript` (which needs Docker and the Supabase CLI, neither
// available here: decision D-036, limitation L-038). It applies every migration to a throwaway PostgreSQL 17 server
// (embedded-postgres, the same one db:verify uses) and reads the catalog of schema `public`, then writes a
// `Database` type in the same shape the Supabase client expects (Tables with Row/Insert/Update/Relationships,
// Functions, Enums), so `createClient<Database>()` works unchanged. When Docker is available, run
// `npx supabase gen types typescript --local > packages/shared/src/db/database.types.ts` and diff the two.
// The output is deterministic (sorted, no timestamps). Never edit the generated file by hand.
// It never connects to anything except the temporary local server it starts, and deletes it afterwards.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outPath = join(root, 'packages', 'shared', 'src', 'db', 'database.types.ts');
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const shimSql = readFileSync(join(root, 'scripts', 'db', 'local-shim.sql'), 'utf8');
const checkOnly = process.argv.includes('--check');

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

// ---------------------------------------------------------------------------------------------------------------
// Type mapping (PostgreSQL type name to TypeScript). Matches the Supabase generator's conventions, with one
// documented caveat: numeric and bigint columns are `number` here because PostgREST returns them as JSON numbers.
// They are NOT safe for money arithmetic; see NUMERIC_COLUMNS in the output and docs/DOMAIN_TYPES.md.
// ---------------------------------------------------------------------------------------------------------------
const NUMBER_TYPES = new Set(['int2', 'int4', 'int8', 'float4', 'float8', 'numeric', 'oid']);
const STRING_TYPES = new Set([
  'text',
  'varchar',
  'bpchar',
  'citext',
  'uuid',
  'name',
  'bytea',
  'interval',
  'date',
  'time',
  'timetz',
  'timestamp',
  'timestamptz',
  'inet',
]);

function tsType(oid, types) {
  const t = types.get(oid);
  if (!t) return 'unknown';
  if (t.typtype === 'e') return `Database["public"]["Enums"]["${t.typname}"]`;
  if (t.typelem !== 0 && t.typname.startsWith('_')) return `${tsType(t.typelem, types)}[]`;
  if (NUMBER_TYPES.has(t.typname)) return 'number';
  if (t.typname === 'bool') return 'boolean';
  if (STRING_TYPES.has(t.typname)) return 'string';
  if (t.typname === 'json' || t.typname === 'jsonb') return 'Json';
  if (t.typname === 'void') return 'undefined';
  return 'unknown';
}

const q = (s) => JSON.stringify(s);
const indent = (n) => '  '.repeat(n);

async function introspect(client) {
  const typeRows = (
    await client.query(
      'select oid::int as oid, typname, typtype, typelem::int as typelem from pg_type',
    )
  ).rows;
  const types = new Map(typeRows.map((r) => [r.oid, r]));

  const columns = (
    await client.query(`
      select c.relname as table_name, a.attname, a.atttypid::int as typid, a.attnotnull as not_null,
             a.atthasdef as has_default, a.attidentity as identity, a.attgenerated as generated
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname, a.attnum`)
  ).rows;

  const foreignKeys = (
    await client.query(`
      select con.conname, c.relname as table_name, rn.nspname as ref_schema, rc.relname as ref_table,
        (select array_agg(a.attname::text order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord)
           join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as columns,
        (select array_agg(a.attname::text order by k.ord) from unnest(con.confkey) with ordinality k(attnum, ord)
           join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as ref_columns,
        con.conkey::int[] as conkey, con.conrelid::int as conrelid
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_class rc on rc.oid = con.confrelid
      join pg_namespace rn on rn.oid = rc.relnamespace
      where con.contype = 'f' and n.nspname = 'public'
      order by c.relname, con.conname`)
  ).rows;

  const uniques = (
    await client.query(`
      select i.indrelid::int as relid, i.indkey::text as indkey
      from pg_index i
      join pg_class c on c.oid = i.indrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and i.indisunique and i.indpred is null`)
  ).rows;

  const enums = (
    await client.query(`
      select t.typname, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      join pg_enum e on e.enumtypid = t.oid
      where n.nspname = 'public'
      group by t.typname
      order by t.typname`)
  ).rows;

  const functions = (
    await client.query(`
      select p.proname, coalesce(p.proallargtypes, p.proargtypes::oid[])::int[] as all_types,
             p.proargmodes::text[] as proargmodes, p.proargnames::text[] as proargnames, p.pronargdefaults, p.proretset, p.prorettype::int as rettype
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('authenticated', p.oid, 'execute')
      order by p.proname`)
  ).rows;

  return { types, columns, foreignKeys, uniques, enums, functions };
}

function render(info) {
  const { types, columns, foreignKeys, uniques, enums, functions } = info;

  const byTable = new Map();
  for (const c of columns) {
    if (!byTable.has(c.table_name)) byTable.set(c.table_name, []);
    byTable.get(c.table_name).push(c);
  }

  const relationsByTable = new Map();
  for (const fk of foreignKeys) {
    if (fk.ref_schema !== 'public') continue; // references to auth.users are not part of the public schema types
    const uniqueSets = uniques
      .filter((u) => u.relid === fk.conrelid)
      .map((u) =>
        u.indkey
          .split(' ')
          .map(Number)
          .sort((a, b) => a - b)
          .join(','),
      );
    const mine = [...fk.conkey].sort((a, b) => a - b).join(',');
    const rel = {
      foreignKeyName: fk.conname,
      columns: fk.columns,
      isOneToOne: uniqueSets.includes(mine),
      referencedRelation: fk.ref_table,
      referencedColumns: fk.ref_columns,
    };
    if (!relationsByTable.has(fk.table_name)) relationsByTable.set(fk.table_name, []);
    relationsByTable.get(fk.table_name).push(rel);
  }

  const out = [];
  out.push('// GENERATED FILE. DO NOT EDIT BY HAND.');
  out.push(
    '// Source: supabase/migrations, applied to a throwaway PostgreSQL 17 by scripts/db-types.mjs (npm run db:types).',
  );
  out.push(
    '// Regenerate after every migration. `npm run db:types -- --check` fails when this file is out of date.',
  );
  out.push(
    '// This is NOT output of `supabase gen types` (needs Docker); the shape is the same. See docs/DOMAIN_TYPES.md.',
  );
  out.push('');
  out.push('export type Json =');
  out.push('  | string');
  out.push('  | number');
  out.push('  | boolean');
  out.push('  | null');
  out.push('  | { [key: string]: Json | undefined }');
  out.push('  | Json[];');
  out.push('');
  out.push('export type Database = {');
  out.push(`${indent(1)}public: {`);
  out.push(`${indent(2)}Tables: {`);

  const tableNames = [...byTable.keys()].sort();
  for (const table of tableNames) {
    const cols = byTable.get(table);
    out.push(`${indent(3)}${table}: {`);
    out.push(`${indent(4)}Row: {`);
    for (const c of cols) {
      out.push(
        `${indent(5)}${c.attname}: ${tsType(c.typid, types)}${c.not_null ? '' : ' | null'};`,
      );
    }
    out.push(`${indent(4)}};`);
    out.push(`${indent(4)}Insert: {`);
    for (const c of cols) {
      const type = tsType(c.typid, types);
      if (c.generated !== '' || c.identity === 'a') {
        out.push(`${indent(5)}${c.attname}?: never;`);
        continue;
      }
      const optional = !c.not_null || c.has_default || c.identity === 'd';
      out.push(
        `${indent(5)}${c.attname}${optional ? '?' : ''}: ${type}${c.not_null ? '' : ' | null'};`,
      );
    }
    out.push(`${indent(4)}};`);
    out.push(`${indent(4)}Update: {`);
    for (const c of cols) {
      const type = tsType(c.typid, types);
      if (c.generated !== '' || c.identity === 'a') {
        out.push(`${indent(5)}${c.attname}?: never;`);
        continue;
      }
      out.push(`${indent(5)}${c.attname}?: ${type}${c.not_null ? '' : ' | null'};`);
    }
    out.push(`${indent(4)}};`);
    const rels = relationsByTable.get(table) ?? [];
    if (rels.length === 0) {
      out.push(`${indent(4)}Relationships: [];`);
    } else {
      out.push(`${indent(4)}Relationships: [`);
      for (const r of rels) {
        out.push(`${indent(5)}{`);
        out.push(`${indent(6)}foreignKeyName: ${q(r.foreignKeyName)};`);
        out.push(`${indent(6)}columns: [${r.columns.map(q).join(', ')}];`);
        out.push(`${indent(6)}isOneToOne: ${r.isOneToOne};`);
        out.push(`${indent(6)}referencedRelation: ${q(r.referencedRelation)};`);
        out.push(`${indent(6)}referencedColumns: [${r.referencedColumns.map(q).join(', ')}];`);
        out.push(`${indent(5)}},`);
      }
      out.push(`${indent(4)}];`);
    }
    out.push(`${indent(3)}};`);
  }
  out.push(`${indent(2)}};`);
  out.push(`${indent(2)}Views: {`);
  out.push(`${indent(3)}[_ in never]: never;`);
  out.push(`${indent(2)}};`);

  out.push(`${indent(2)}Functions: {`);
  if (functions.length === 0) out.push(`${indent(3)}[_ in never]: never;`);
  for (const f of functions) {
    const modes = f.proargmodes ?? f.all_types.map(() => 'i');
    const names = f.proargnames ?? [];
    const inArgs = [];
    const outArgs = [];
    f.all_types.forEach((typeOid, i) => {
      const mode = modes[i];
      const name = names[i] || `arg${i + 1}`;
      if (mode === 'i' || mode === 'b' || mode === 'v')
        inArgs.push({ name, type: tsType(typeOid, types) });
      if (mode === 'o' || mode === 'b' || mode === 't')
        outArgs.push({ name, type: tsType(typeOid, types) });
    });
    out.push(`${indent(3)}${f.proname}: {`);
    if (inArgs.length === 0) {
      out.push(`${indent(4)}Args: Record<PropertyKey, never>;`);
    } else {
      out.push(`${indent(4)}Args: {`);
      const firstOptional = inArgs.length - f.pronargdefaults;
      inArgs.forEach((a, i) => {
        out.push(`${indent(5)}${a.name}${i >= firstOptional ? '?' : ''}: ${a.type};`);
      });
      out.push(`${indent(4)}};`);
    }
    if (outArgs.length > 0) {
      const row = outArgs.map((a) => `${a.name}: ${a.type}`).join('; ');
      out.push(`${indent(4)}Returns: { ${row} }${f.proretset ? '[]' : ''};`);
    } else {
      const t = tsType(f.rettype, types);
      out.push(`${indent(4)}Returns: ${f.proretset ? `${t}[]` : t};`);
    }
    out.push(`${indent(3)}};`);
  }
  out.push(`${indent(2)}};`);

  out.push(`${indent(2)}Enums: {`);
  if (enums.length === 0) out.push(`${indent(3)}[_ in never]: never;`);
  for (const e of enums) {
    out.push(`${indent(3)}${e.typname}: ${e.labels.map(q).join(' | ')};`);
  }
  out.push(`${indent(2)}};`);
  out.push(`${indent(2)}CompositeTypes: {`);
  out.push(`${indent(3)}[_ in never]: never;`);
  out.push(`${indent(2)}};`);
  out.push(`${indent(1)}};`);
  out.push('};');
  out.push('');
  out.push('type PublicSchema = Database["public"];');
  out.push('');
  out.push(
    'export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];',
  );
  out.push(
    'export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];',
  );
  out.push(
    'export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];',
  );
  out.push('export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];');
  out.push('');

  // numeric and bigint columns: JSON numbers through PostgREST, not exact. Listed so callers can cast them to text.
  const numericColumns = {};
  for (const table of tableNames) {
    const names = byTable
      .get(table)
      .filter((c) => {
        const t = types.get(c.typid);
        return t && (t.typname === 'numeric' || t.typname === 'int8');
      })
      .map((c) => c.attname);
    if (names.length > 0) numericColumns[table] = names;
  }
  out.push('/**');
  out.push(
    ' * Columns of type numeric or bigint. PostgREST returns them as JSON numbers, which are NOT exact. Select money,',
  );
  out.push(
    ' * rates and energy columns cast to text (`col::text`) and parse with the decimal helpers in @autopw3/shared;',
  );
  out.push(' * never do money arithmetic on a column typed `number` above (rule 8, D-014).');
  out.push(' */');
  out.push('export const NUMERIC_COLUMNS = {');
  for (const [table, names] of Object.entries(numericColumns)) {
    out.push(`${indent(1)}${table}: [${names.map(q).join(', ')}],`);
  }
  out.push('} as const;');
  out.push('');
  return out.join('\n');
}

const dataDir = mkdtempSync(join(tmpdir(), 'autopw3-pgtypes-'));
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

let exitCode = 0;
try {
  console.log(`Starting temporary PostgreSQL on port ${port} ...`);
  await server.initialise();
  await server.start();

  const connect = async (database) => {
    const c = new pg.Client({
      host: '127.0.0.1',
      port,
      user: 'postgres',
      password: 'postgres',
      database,
    });
    c.on('error', () => {}); // a server shutdown after a failure must not crash the script
    await c.connect();
    return c;
  };
  const admin = await connect('postgres');
  await admin.query('create database type_gen');
  await admin.end();

  const client = await connect('type_gen');
  await client.query(shimSql);
  for (const file of migrationFiles) {
    await client.query(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  console.log(`Applied ${migrationFiles.length} migrations`);

  const text = render(await introspect(client));
  await client.end();

  if (checkOnly) {
    let current = '';
    try {
      current = readFileSync(outPath, 'utf8').replaceAll('\r\n', '\n');
    } catch {
      // missing file counts as out of date
    }
    if (current === text) {
      console.log('ok    packages/shared/src/db/database.types.ts is up to date');
    } else {
      console.error(
        'FAIL  packages/shared/src/db/database.types.ts is out of date. Run: npm run db:types',
      );
      exitCode = 1;
    }
  } else {
    writeFileSync(outPath, text, 'utf8');
    console.log(`Wrote ${outPath} (${text.split('\n').length} lines)`);
  }
} catch (error) {
  console.error('db:types failed:', error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  await server.stop().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(exitCode);
