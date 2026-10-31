import { describe, expect, it, vi } from 'vitest';
import { AuthenticatedPostgrestClient } from './postgrest';
import { SupabaseSiteReadRepository } from './site-read-repository';

const ACTOR_A = '11111111-1111-4111-8111-111111111111';
const ACTOR_B = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HOUSEHOLD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SITE_1 = '00000001-0000-4000-8000-000000000001';
const SITE_2 = '00000002-0000-4000-8000-000000000002';
const SITE_3 = '00000003-0000-4000-8000-000000000003';
const SITE_B = '00000004-0000-4000-8000-000000000004';

const site = (id: string, household = HOUSEHOLD_A) => ({
  id,
  household_id: household,
  provider: 'TESLA',
  provider_site_id: `persisted-provider-${id}`,
  name: null,
  timezone: 'Europe/Dublin',
  connection_state: 'CONNECTING',
});

/** HTTP mocks prove transport/scoping contracts; the SQL suite independently exercises actual RLS. */
function fixture(actor = ACTOR_A, household = HOUSEHOLD_A, token = 'synthetic-user-jwt-a') {
  const state: {
    members: { household_id: string; user_id: string }[];
    sites: ReturnType<typeof site>[];
    siteReply?: unknown;
    memberReply?: unknown;
    failure?: { table: string; status: number };
    beforeReply?: (table: string) => Promise<void>;
  } = {
    members: [{ household_id: household, user_id: actor }],
    sites: [site(SITE_3), site(SITE_1), site(SITE_2), site(SITE_B, HOUSEHOLD_B)],
  };
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const table = url.pathname.split('/').at(-1)!;
    expect(url.origin).toBe('https://project.supabase.co');
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init?.headers);
    expect(headers.get('apikey')).toBe('synthetic-public-key');
    expect(headers.get('authorization')).toBe(`Bearer ${token}`);
    await state.beforeReply?.(table);
    if (state.failure?.table === table) {
      return Response.json(
        { code: '42501', message: 'must-not-leak' },
        { status: state.failure.status },
      );
    }
    if (table === 'household_members') {
      expect(url.searchParams.get('user_id')).toBe(`eq.${actor}`);
      expect(url.searchParams.get('select')).toBe('household_id,user_id');
      expect(url.searchParams.get('limit')).toBe('1');
      return Response.json(
        state.memberReply !== undefined
          ? state.memberReply
          : state.members.filter(
              (m) =>
                `eq.${m.household_id}` === url.searchParams.get('household_id') &&
                m.user_id === actor,
            ),
      );
    }
    if (table === 'energy_sites') {
      expect(url.searchParams.get('select')).toBe(
        'id,household_id,provider,provider_site_id,name,timezone,connection_state',
      );
      expect(url.searchParams.get('provider')).toBe('eq.TESLA');
      if (state.siteReply !== undefined) return Response.json(state.siteReply);
      const householdFilter = url.searchParams.get('household_id');
      const idFilter = url.searchParams.get('id');
      if (householdFilter) expect(url.searchParams.get('order')).toBe('id.asc');
      const rows = state.sites
        .filter((s) =>
          state.members.some((m) => m.user_id === actor && m.household_id === s.household_id),
        )
        .filter((s) => !householdFilter || householdFilter === `eq.${s.household_id}`)
        .filter(
          (s) =>
            !idFilter ||
            (idFilter.startsWith('gt.') ? s.id > idFilter.slice(3) : idFilter === `eq.${s.id}`),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, Number(url.searchParams.get('limit')));
      return Response.json(rows);
    }
    throw new Error('Unexpected outbound operation');
  });
  const db = new AuthenticatedPostgrestClient(
    'https://project.supabase.co',
    'synthetic-public-key',
    token,
    fetcher,
  );
  return { state, fetcher, repo: new SupabaseSiteReadRepository(db, { userId: actor }) };
}

describe('authenticated durable site reads', () => {
  it('returns only stored metadata, including real household/provider IDs and a nullable name', async () => {
    const f = fixture();
    const result = await f.repo.getSite(SITE_1);
    expect(result).toEqual({
      id: SITE_1,
      householdId: HOUSEHOLD_A,
      provider: 'TESLA',
      providerSiteId: `persisted-provider-${SITE_1}`,
      name: null,
      timezone: 'Europe/Dublin',
      connectionState: 'CONNECTING',
    });
    expect(result).not.toHaveProperty('capabilitiesSummary');
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses consistent UUID keyset pagination with a bounded lookahead and no duplicates', async () => {
    const f = fixture();
    const first = await f.repo.listSites(HOUSEHOLD_A, 2);
    expect(first.items.map((s) => s.id)).toEqual([SITE_1, SITE_2]);
    expect(first.nextCursor).toBeTruthy();
    const second = await f.repo.listSites(HOUSEHOLD_A, 2, first.nextCursor!);
    expect(second.items.map((s) => s.id)).toEqual([SITE_3]);
    expect(second.nextCursor).toBeNull();
    const queries = f.fetcher.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((u) => u.pathname.endsWith('/energy_sites'));
    expect(queries[0]?.searchParams.get('limit')).toBe('3');
    expect(queries[1]?.searchParams.get('id')).toBe(`gt.${SITE_2}`);
    expect(
      queries.every(
        (u) =>
          u.searchParams.get('household_id') === `eq.${HOUSEHOLD_A}` &&
          u.searchParams.get('order') === 'id.asc',
      ),
    ).toBe(true);
  });

  it('continues correctly if the cursor row was deleted between pages', async () => {
    const f = fixture();
    const first = await f.repo.listSites(HOUSEHOLD_A, 2);
    f.state.sites = f.state.sites.filter((s) => s.id !== SITE_2);
    expect(
      (await f.repo.listSites(HOUSEHOLD_A, 2, first.nextCursor!)).items.map((s) => s.id),
    ).toEqual([SITE_3]);
  });

  it('uses the default and maximum limits without allowing unbounded reads', async () => {
    const f = fixture();
    expect((await f.repo.listSites(HOUSEHOLD_A)).nextCursor).toBeNull();
    await f.repo.listSites(HOUSEHOLD_A, 200);
    const limits = f.fetcher.mock.calls
      .filter(([input]) => String(input).includes('/energy_sites'))
      .map(([input]) => new URL(String(input)).searchParams.get('limit'));
    expect(limits).toEqual(['51', '201']);
  });

  it.each([0, -1, 201, 1.5, Number.NaN, Infinity])(
    'rejects invalid limit %s before querying',
    async (limit) => {
      const f = fixture();
      await expect(f.repo.listSites(HOUSEHOLD_A, limit)).rejects.toMatchObject({ status: 400 });
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );

  it('distinguishes an authorized empty household from a denied household', async () => {
    const f = fixture();
    f.state.sites = [];
    await expect(f.repo.listSites(HOUSEHOLD_A)).resolves.toEqual({ items: [], nextCursor: null });
    await expect(f.repo.listSites(HOUSEHOLD_B)).rejects.toMatchObject({ status: 404 });
    await expect(f.repo.listSites('cccccccc-cccc-4ccc-8ccc-cccccccccccc')).rejects.toMatchObject({
      status: 404,
    });
    expect(
      f.fetcher.mock.calls.filter(([url]) => String(url).includes('/energy_sites')),
    ).toHaveLength(1);
  });

  it('hides foreign and nonexistent sites without consulting an in-memory repository', async () => {
    const f = fixture();
    await expect(f.repo.getSite(SITE_B)).resolves.toBeNull();
    await expect(f.repo.getSite('cccccccc-cccc-4ccc-8ccc-cccccccccccc')).resolves.toBeNull();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it('denies a returned site if current actor membership cannot be confirmed', async () => {
    const f = fixture();
    f.state.siteReply = [site(SITE_B, HOUSEHOLD_B)];
    await expect(f.repo.getSite(SITE_B)).resolves.toBeNull();
  });

  it('does not cache membership after it is revoked', async () => {
    const f = fixture();
    expect(await f.repo.getSite(SITE_1)).not.toBeNull();
    f.state.members = [];
    await expect(f.repo.getSite(SITE_1)).resolves.toBeNull();
    await expect(f.repo.listSites(HOUSEHOLD_A)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps interleaved request clients and actor contexts isolated', async () => {
    const a = fixture();
    const b = fixture(ACTOR_B, HOUSEHOLD_B, 'synthetic-user-jwt-b');
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    a.state.beforeReply = async () => {
      started();
      await held;
    };
    const pendingA = a.repo.listSites(HOUSEHOLD_A);
    await ready;
    const resultB = await b.repo.listSites(HOUSEHOLD_B);
    release();
    expect((await pendingA).items.every((s) => s.householdId === HOUSEHOLD_A)).toBe(true);
    expect(resultB.items.map((s) => s.id)).toEqual([SITE_B]);
    await expect(b.repo.getSite(SITE_1)).resolves.toBeNull();
  });

  it('rejects foreign or malformed response rows instead of returning partial results', async () => {
    const f = fixture();
    f.state.siteReply = [site(SITE_1), site(SITE_B, HOUSEHOLD_B)];
    await expect(f.repo.listSites(HOUSEHOLD_A)).rejects.toMatchObject({ status: 502 });
    f.state.siteReply = [site(SITE_2), site(SITE_1)];
    await expect(f.repo.listSites(HOUSEHOLD_A)).rejects.toMatchObject({ status: 502 });
    f.state.siteReply = [site(SITE_1), site(SITE_1)];
    await expect(f.repo.listSites(HOUSEHOLD_A)).rejects.toMatchObject({ status: 502 });
    f.state.siteReply = [site(SITE_2)];
    await expect(f.repo.getSite(SITE_1)).rejects.toMatchObject({ status: 502 });
  });

  it.each(
    [
      null,
      {},
      [{ ...site(SITE_1), provider_site_id: '' }],
      [{ ...site(SITE_1), provider_site_id: null }],
      [{ ...site(SITE_1), provider: 'DEMO' }],
      [{ ...site(SITE_1), timezone: 'invalid/zone' }],
      [{ ...site(SITE_1), connection_state: 'INVALID' }],
      [{ ...site(SITE_1), id: 'invalid' }],
    ].map((reply) => ({ reply })),
  )('rejects malformed site response $reply', async ({ reply }) => {
    const f = fixture();
    f.state.siteReply = reply;
    await expect(f.repo.getSite(SITE_1)).rejects.toMatchObject({ status: 502 });
  });

  it('rejects mismatched membership actors and database errors without granting access', async () => {
    const f = fixture();
    f.state.memberReply = [{ household_id: HOUSEHOLD_A, user_id: ACTOR_B }];
    await expect(f.repo.listSites(HOUSEHOLD_A)).rejects.toMatchObject({ status: 502 });
    expect(f.fetcher.mock.calls.every(([url]) => String(url).includes('/household_members'))).toBe(
      true,
    );
  });

  it.each(
    ['household_members', 'energy_sites'].flatMap((table) =>
      [401, 403, 500].map((status) => ({ table, status })),
    ),
  )(
    'propagates sanitized database failure $table/$status instead of an empty success',
    async ({ table, status }) => {
      const f = fixture();
      f.state.failure = { table, status };
      const error: unknown = await f.repo.listSites(HOUSEHOLD_A).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ status });
      expect(String(error)).not.toContain('must-not-leak');
    },
  );

  it.each([
    '',
    '$not-base64',
    btoa('not json'),
    SITE_1,
    'x'.repeat(513),
    btoa(JSON.stringify({ version: 2, householdId: HOUSEHOLD_A, afterId: SITE_1 })),
    btoa(JSON.stringify({ version: 1, householdId: HOUSEHOLD_B, afterId: SITE_1 })),
    btoa(JSON.stringify({ version: 1, householdId: HOUSEHOLD_A, afterId: 'invalid' })),
  ])('rejects malformed or cross-household cursor %s before querying', async (cursor) => {
    const f = fixture();
    await expect(f.repo.listSites(HOUSEHOLD_A, 2, cursor)).rejects.toMatchObject({ status: 400 });
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it('rejects invalid site, household and actor identifiers without database access', async () => {
    const f = fixture();
    await expect(f.repo.getSite('id.eq.other')).rejects.toMatchObject({ status: 400 });
    await expect(f.repo.listSites('invalid')).rejects.toMatchObject({ status: 400 });
    const db = new AuthenticatedPostgrestClient(
      'https://project.supabase.co',
      'public',
      'jwt',
      f.fetcher,
    );
    expect(() => new SupabaseSiteReadRepository(db, { userId: '' })).toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { url: '', key: 'public', jwt: 'jwt' },
    { url: 'https://project.supabase.co', key: '', jwt: 'jwt' },
    { url: 'https://project.supabase.co', key: 'public', jwt: '' },
  ])(
    'missing authenticated configuration fails before constructing usable reads: %j',
    ({ url, key, jwt }) => {
      expect(
        () =>
          new SupabaseSiteReadRepository(new AuthenticatedPostgrestClient(url, key, jwt), {
            userId: ACTOR_A,
          }),
      ).toThrow();
    },
  );
});
