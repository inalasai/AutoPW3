/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTOR_TYPES,
  COMMAND_KINDS,
  COMMAND_ORIGINS,
  COMMAND_PHASES,
  COMMAND_STATES,
  CREDENTIAL_STATUSES,
  DAY_TYPES,
  DB_ERROR_TO_API_ERROR,
  EXECUTION_DECISIONS,
  EXPORT_PAYMENT_MODELS,
  IDEMPOTENCY_KEY,
  INTERVAL_QUALITIES,
  LEVY_KINDS,
  PERSISTED_SOURCES,
  POWER_QUALITIES,
  PRICE_MODES,
  PROVIDERS,
  PROVIDER_MODES,
  RULE_MODES,
  SETTINGS_BOUNDS,
  SITE_CONNECTION_STATES,
  TARIFF_DIRECTIONS,
  TAX_MODES,
  TEXT_LIMITS,
  TIMESTAMP_ORIGINS,
} from '../index';

/**
 * Drift guard: the closed value sets and numeric bounds in this package must equal the database CHECK constraints in
 * supabase/migrations. Change a CHECK in a new migration and the matching constant here, or this test fails.
 * It reads SQL text only; it needs no database.
 */

const migrationsDir = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const sql = files
  .map((f) => readFileSync(join(migrationsDir, f), 'utf8').replaceAll('\r\n', '\n'))
  .join('\n');

/** The text of one `create table ... public.<table> (` statement up to the next create statement. */
function tableSql(table: string): string {
  const start = sql.indexOf(`create table if not exists public.${table} (`);
  if (start < 0) throw new Error(`table ${table} not found in migrations`);
  const next = sql.indexOf('create table if not exists', start + 10);
  return sql.slice(start, next < 0 ? undefined : next);
}

/** Values of `<column> in ('A', 'B', ...)` inside one table definition. */
function inList(table: string, column: string): string[] {
  const m = new RegExp(`\\b${column} in \\(([^)]*)\\)`).exec(tableSql(table));
  if (!m) throw new Error(`no IN-list for ${table}.${column}`);
  return [...(m[1] as string).matchAll(/'([^']*)'/g)].map((x) => x[1] as string).sort();
}

/** The value of `<column> = 'A'` inside one table definition. */
function equalsValue(table: string, column: string): string {
  const m = new RegExp(`\\b${column} = '([^']*)'`).exec(tableSql(table));
  if (!m) throw new Error(`no equality CHECK for ${table}.${column}`);
  return m[1] as string;
}

const sorted = (values: readonly string[]) => [...values].sort();

describe('closed value sets equal the database CHECK constraints', () => {
  const cases: [string, string, readonly string[]][] = [
    ['energy_sites', 'connection_state', SITE_CONNECTION_STATES],
    ['tesla_credentials', 'status', CREDENTIAL_STATUSES],
    ['powerwall_metrics_log', 'timestamp_origin', TIMESTAMP_ORIGINS],
    ['powerwall_metrics_log', 'quality', POWER_QUALITIES],
    ['energy_intervals', 'quality', INTERVAL_QUALITIES],
    ['utility_tariffs', 'direction', TARIFF_DIRECTIONS],
    ['utility_tariffs', 'price_mode', PRICE_MODES],
    ['utility_tariffs', 'tax_mode', TAX_MODES],
    ['utility_tariffs', 'export_payment_model', EXPORT_PAYMENT_MODELS],
    ['tariff_slots', 'day_type', DAY_TYPES],
    ['tariff_levies', 'kind', LEVY_KINDS],
    ['automation_rules', 'mode', RULE_MODES],
    ['automation_executions', 'mode_at_evaluation', RULE_MODES],
    ['automation_executions', 'decision', EXECUTION_DECISIONS],
    ['device_command_log', 'origin', COMMAND_ORIGINS],
    ['device_command_log', 'kind', COMMAND_KINDS],
    ['device_command_log', 'provider_mode', PROVIDER_MODES],
    ['device_command_log', 'state', COMMAND_STATES],
    ['device_command_log', 'phase', COMMAND_PHASES],
    ['device_command_events', 'to_state', COMMAND_STATES],
    ['device_command_events', 'phase', COMMAND_PHASES],
    ['audit_log', 'actor_type', AUDIT_ACTOR_TYPES],
  ];

  it.each(cases)('%s.%s', (table, column, values) => {
    expect(inList(table, column)).toEqual(sorted(values));
  });

  it('allows only TESLA as a stored provider and stored source (DEMO is rejected by the database)', () => {
    expect([equalsValue('energy_sites', 'provider')]).toEqual([...PROVIDERS]);
    expect([equalsValue('powerwall_metrics_log', 'source')]).toEqual([...PERSISTED_SOURCES]);
    expect([equalsValue('energy_intervals', 'source')]).toEqual([...PERSISTED_SOURCES]);
  });

  it('lists exactly the audit actions the database allowlist writes', () => {
    const helper = readFileSync(
      join(migrationsDir, files.find((f) => f.includes('security_helpers')) as string),
      'utf8',
    );
    const actions = [...helper.matchAll(/when '([a-z_.]+)' then/g)].map((m) => m[1] as string);
    expect(sorted(actions)).toEqual(sorted(AUDIT_ACTIONS));
  });
});

describe('numeric bounds and patterns equal the database', () => {
  it('uses the same idempotency key pattern as the CHECK constraint', () => {
    expect(sql).toContain(`idempotency_key ~ '${IDEMPOTENCY_KEY.pattern.source}'`);
  });

  it('uses the same household settings minimums', () => {
    expect(sql).toContain(
      `live_background_interval_minutes >= ${SETTINGS_BOUNDS.liveBackgroundIntervalMinutesMin}`,
    );
    expect(sql).toContain(
      `live_on_demand_min_interval_seconds >= ${SETTINGS_BOUNDS.liveOnDemandMinIntervalSecondsMin}`,
    );
    expect(sql).toContain(`raw_retention_days >= ${SETTINGS_BOUNDS.rawRetentionDaysMin}`);
  });

  it('uses the same name length, slot minutes and VAT range', () => {
    expect(sql).toContain(`char_length(name) between 1 and ${TEXT_LIMITS.name}`);
    expect(sql).toContain('start_minute between 0 and 1439');
    expect(sql).toContain('end_minute between 1 and 1440');
    expect(sql).toContain('vat_rate between 0 and 100');
  });
});

describe('database error messages', () => {
  it('maps every message the functions and triggers raise, and nothing else', () => {
    const relevant = files.filter((f) => /identity_and_membership|integrity_and_audit/.test(f));
    const raised = new Set<string>();
    for (const f of relevant) {
      const text = readFileSync(join(migrationsDir, f), 'utf8');
      for (const m of text.matchAll(/raise exception '([a-z_]+)'/g)) raised.add(m[1] as string);
    }
    expect(sorted([...raised])).toEqual(sorted(Object.keys(DB_ERROR_TO_API_ERROR)));
  });
});
