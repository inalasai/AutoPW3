import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@autopw3/shared';
import { SupabaseRepository } from './supabase-repository';

function makeMockSupabaseClient(tableHandlers: Record<string, unknown>): SupabaseClient<Database> {
  return {
    from: vi.fn((table: string) => {
      const handler = tableHandlers[table];
      if (typeof handler === 'function') {
        return handler();
      }
      return (
        handler ?? {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      );
    }),
  } as unknown as SupabaseClient<Database>;
}

describe('SupabaseRepository Multi-Tenant Isolation', () => {
  it('returns null for membership when user is not in the target household (prevents cross-user access)', async () => {
    const mockClient = makeMockSupabaseClient({
      household_members: {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
    });

    const repo = new SupabaseRepository('https://mock.supabase.co', 'mock-key', mockClient);
    const membership = await repo.getMembership('household-111', 'attacker-user-222');

    // Strict null: never falls back to in-memory demo data
    expect(membership).toBeNull();
  });

  it('returns empty array for memberships when a user has no households', async () => {
    const mockClient = makeMockSupabaseClient({
      household_members: {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        // Mock data empty
        then: (resolve: (val: unknown) => void) => resolve({ data: [], error: null }),
      },
    });

    const repo = new SupabaseRepository('https://mock.supabase.co', 'mock-key', mockClient);
    const memberships = await repo.getHouseholdMemberships('new-user-333');

    // Strict empty list: never leaks demo households
    expect(memberships).toEqual([]);
  });

  it('resolves membership details accurately when user belongs to household', async () => {
    const mockClient = makeMockSupabaseClient({
      household_members: {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            role: 'ADMIN',
            user_id: 'user-valid',
            user_profiles: { display_name: 'Valid User' },
          },
          error: null,
        }),
      },
    });

    const repo = new SupabaseRepository('https://mock.supabase.co', 'mock-key', mockClient);
    const membership = await repo.getMembership('household-111', 'user-valid');

    expect(membership).toEqual({
      role: 'ADMIN',
      userId: 'user-valid',
      displayName: 'Valid User',
    });
  });

  it('returns null for site, tariff, rule, and command resolution if non-existent or inaccessible', async () => {
    const mockClient = makeMockSupabaseClient({
      energy_sites: {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
      utility_tariffs: {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
      automation_rules: {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
      device_command_log: {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
    });

    const repo = new SupabaseRepository('https://mock.supabase.co', 'mock-key', mockClient);

    expect(await repo.getHouseholdIdForSite('non-existent-site')).toBeNull();
    expect(await repo.getHouseholdIdForTariff('non-existent-tariff')).toBeNull();
    expect(await repo.getHouseholdIdForRule('non-existent-rule')).toBeNull();
    expect(await repo.getHouseholdIdForCommand('non-existent-command')).toBeNull();
  });
});
