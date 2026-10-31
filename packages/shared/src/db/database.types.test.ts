import { describe, expect, expectTypeOf, it } from 'vitest';
import { NUMERIC_COLUMNS } from './database.types';
import type { Database, Enums, Tables, TablesInsert } from './database.types';
import type { Role } from '../constants/roles';

/**
 * The generated database types and the hand-written shared types must agree where both describe the same thing.
 * These are mostly compile-time checks (they run under `tsc`); a failing one breaks `npm run typecheck`.
 */
describe('generated database types', () => {
  it('uses the same role names as the shared Role type', () => {
    expectTypeOf<Enums<'role_enum'>>().toEqualTypeOf<Role>();
  });

  it('keeps a household member role required on insert (no default role)', () => {
    expectTypeOf<TablesInsert<'household_members'>['role']>().toEqualTypeOf<Role>();
    expectTypeOf<TablesInsert<'household_members'>['household_id']>().toEqualTypeOf<string>();
  });

  it('types missing telemetry as null, not zero', () => {
    expectTypeOf<Tables<'powerwall_metrics_log'>['solar_power_w']>().toEqualTypeOf<number | null>();
    expectTypeOf<Tables<'powerwall_metrics_log'>['source']>().toEqualTypeOf<string>();
  });

  it('exposes the audited functions as the RPC surface', () => {
    type Functions = Database['public']['Functions'];
    expectTypeOf<keyof Functions>().toEqualTypeOf<
      | 'accept_invitation'
      | 'change_member_role'
      | 'create_invitation'
      | 'leave_household'
      | 'remove_member'
      | 'revoke_invitation'
      | 'set_automation_paused'
      | 'set_rule_mode'
      | 'update_household'
    >();
  });

  it('lists the numeric columns that must be read as text for money', () => {
    expect(NUMERIC_COLUMNS.utility_tariffs).toContain('flat_rate_per_kwh');
    expect(NUMERIC_COLUMNS.tariff_slots).toContain('rate_per_kwh');
    expect(NUMERIC_COLUMNS.cost_rollups_daily).toContain('net_cost');
  });
});
