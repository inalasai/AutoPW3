# Worker database adapters

`repository.ts` contains the full `Repository` contract and the in-memory implementation used by explicit
local/test mocks. `postgrest.ts` is a request-scoped authenticated transport; `identity-repository.ts`
implements the first durable identity, profile, household, membership, invitation and settings slice using
RLS plus existing authenticated SQL functions. `supabase-rpc.ts` remains the service-role RPC transport;
`system-client.ts` exposes only its RPC call surface and is not injected into routes.

The durable identity slice is selected after JWT verification when `SUPABASE_URL` and
`SUPABASE_ANON_KEY` are configured. Staging and production API requests remain fail-closed until the whole
application repository, durable idempotency and other durable stores are integrated, apart from the
explicitly gated staging-only `GET /api/v1/me` slice in `lib/staging-identity.ts`. That path always
constructs an authenticated identity repository and fails closed if configuration is missing. Other repository
domains remain in memory only in explicitly configured local/test execution and are not production-ready,
apart from the separate site-read foundation described below.

**Site-read status:** `site-read-repository.ts` implements only authenticated `listSites` and `getSite`
over existing tables. Construct it per request with that request's authenticated PostgREST client and
verified actor. It checks membership explicitly while RLS remains authoritative on every database read.
Its internal `StoredSite` metadata includes the real household/provider IDs and omits capabilities;
it is not the public `EnergySite` DTO. Pagination uses ascending UUIDs and a versioned household-bound
cursor. Separate household/provider lookup methods are unnecessary because `getSite` returns both.
No site HTTP endpoint, new staging flag, provider call or scheduled handler is enabled by this adapter.

**Status:** Both authenticated PostgREST and privileged RPC transports set `redirect: 'error'` so their
credentials cannot follow an HTTP redirect. `redirects.test.ts` exercises actual local HTTP redirects
with synthetic credentials and verifies that redirected destinations receive no requests.
