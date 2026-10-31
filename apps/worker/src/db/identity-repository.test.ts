import { describe, expect, it, vi } from 'vitest';
import { SupabaseIdentityRepository } from './identity-repository';
import { AuthenticatedPostgrestClient } from './postgrest';

const actor = '11111111-1111-4111-8111-111111111111';

describe('SupabaseIdentityRepository', () => {
  it('bounds identity reads to the JWT actor and rejects caller-supplied actor substitution', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('user_id')).toBe(`eq.${actor}`);
      return Response.json([{ user_id: actor, display_name: 'A', locale: 'en-IE' }]);
    });
    const repo = new SupabaseIdentityRepository(
      new AuthenticatedPostgrestClient('https://project.supabase.co', 'anon', 'jwt-a', fetcher),
      actor,
    );
    await expect(repo.getProfile(actor)).resolves.toEqual({
      userId: actor,
      displayName: 'A',
      locale: 'en-IE',
    });
    await expect(repo.getProfile('22222222-2222-4222-8222-222222222222')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('uses the authenticated membership RPC and never sends a caller actor argument', async () => {
    const requests: string[] = [];

    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname;
      requests.push(`${init?.method ?? 'GET'} ${path}`);

      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer jwt-a');

      if (path.endsWith('/rpc/change_member_role')) {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          p_household_id: 'household-a',
          p_user_id: 'member-b',
          p_role: 'READ_ONLY',
        });
        return new Response(null, { status: 204 });
      }

      if (path.endsWith('/household_members')) {
        expect(init?.method ?? 'GET').toBe('GET');
        expect(url.searchParams.get('household_id')).toBe('eq.household-a');
        expect(url.searchParams.get('user_id')).toBe('eq.member-b');
        return Response.json([
          {
            user_id: 'member-b',
            role: 'READ_ONLY',
            created_at: '2026-10-31T12:00:00Z',
          },
        ]);
      }

      if (path.endsWith('/user_profiles')) {
        expect(url.searchParams.get('user_id')).toBe('eq.member-b');
        return Response.json([
          {
            user_id: 'member-b',
            display_name: 'Member B',
          },
        ]);
      }

      throw new Error(`Unexpected database request: ${path}`);
    });

    const repo = new SupabaseIdentityRepository(
      new AuthenticatedPostgrestClient('https://project.supabase.co', 'anon', 'jwt-a', fetcher),
      actor,
    );

    await expect(
      repo.updateMemberRole('household-a', actor, 'member-b', 'READ_ONLY'),
    ).resolves.toEqual({
      success: true,
      member: {
        userId: 'member-b',
        role: 'READ_ONLY',
        displayName: 'Member B',
        createdAt: '2026-10-31T12:00:00Z',
      },
    });

    expect(requests).toHaveLength(3);
    expect(requests[0]).toContain('/rpc/change_member_role');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('sends only schema-granted household settings fields and requests the updated representation', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('PATCH');
      expect(new Headers(init?.headers).get('prefer')).toBe('return=representation');
      expect(JSON.parse(String(init?.body))).toEqual({
        controls_enabled: false,
        stale_after_seconds: 4000,
      });
      return Response.json([
        {
          monthly_spend_cap_usd: '9.00',
          stale_after_seconds: 4000,
          automation_paused: false,
          controls_enabled: false,
        },
      ]);
    });
    const repo = new SupabaseIdentityRepository(
      new AuthenticatedPostgrestClient('https://project.supabase.co', 'anon', 'jwt-a', fetcher),
      actor,
    );
    await expect(
      repo.updateSettings('household-a', { controlsEnabled: false, staleAfterSeconds: 4000 }),
    ).resolves.toMatchObject({
      controlsEnabled: false,
      staleAfterSeconds: 4000,
      budget: { capUsd: '9.00', spentUsd: null },
    });
  });

  it('uses the authenticated household update RPC and returns its persisted row', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/rest/v1/rpc/update_household');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer jwt-a');
      expect(JSON.parse(String(init?.body))).toEqual({
        p_household_id: 'household-a',
        p_name: 'New name',
        p_timezone: null,
      });
      return Response.json([{ id: 'household-a', name: 'New name', timezone: 'Europe/Dublin' }]);
    });
    const repo = new SupabaseIdentityRepository(
      new AuthenticatedPostgrestClient('https://project.supabase.co', 'anon', 'jwt-a', fetcher),
      actor,
    );
    await expect(repo.updateHousehold('household-a', { name: 'New name' })).resolves.toEqual({
      id: 'household-a',
      name: 'New name',
      timezone: 'Europe/Dublin',
    });
  });
});
