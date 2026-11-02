# Worker database adapters

`repository.ts` contains the full `Repository` contract and the in-memory implementation used by explicit
local/test mocks. `postgrest.ts` is a request-scoped authenticated transport; `identity-repository.ts`
implements the first durable identity, profile, household, membership, invitation and settings slice using
RLS plus existing authenticated SQL functions. `supabase-rpc.ts` remains the service-role RPC transport;
`system-client.ts` exposes only its RPC call surface and is not injected into routes.

The durable identity slice is selected after JWT verification when `SUPABASE_URL` and
`SUPABASE_ANON_KEY` are configured. Staging and production API requests remain fail-closed until the whole
application repository, durable idempotency and other durable stores are integrated, apart from the
explicitly gated staging-only `GET /api/v1/me` slice in `lib/staging-identity.ts` and the separate
read-only OAuth gate in `lib/staging-tesla-oauth.ts`. That path always
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

**Status:** Authenticated PostgREST and privileged RPC transports share `supabase-fetch.ts`. It invokes
injected/global fetch with the global receiver, uses Workers-supported `redirect: 'manual'`, and rejects
all 3xx responses before reading their bodies. `redirects.test.ts` verifies that real local redirects
receive no forwarded credentials. `../lib/staging-identity-workerd.test.ts` runs the actual transports
in workerd, covering default global fetch, RPC/profile/membership reads and redirect rejection.

**Staging onboarding:** `site-link-repository.ts` is a separate authenticated domain slice. It reads
only opaque credential revisions and calls `link_discovered_tesla_site` with the actual user JWT.
The service-only provider verification capability is never a user repository dependency. The local
`20261101170000` migration commits the site, original-actor audit and idempotent response atomically.
No complete Repository implementation or production readiness is claimed.


**Status: discovery refresh authority split implemented locally.** Discovery preflight, begin and
finish use the actual user JWT. The service allowlist adds only encrypted-result staging, which
accepts no actor/session identifiers and cannot activate credentials. A private durable ledger fences
revision, request owner and deadline; live session/ADMIN checks run again after commit locks.
Existing linking RPCs remain strict. Hosted migration/grants remain unverified.

**Status: explicit Tesla recovery tags implemented locally.** Only fixed `refresh_recovery_required`
and `tesla_reauthorization_required` database tags cross the transport boundary; raw response text
is discarded. No new service capability or authenticated RPC signature is introduced.
