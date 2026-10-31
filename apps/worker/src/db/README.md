# Worker database adapters

`repository.ts` contains the full `Repository` contract and the in-memory implementation used by explicit
local/test mocks. `postgrest.ts` is a request-scoped authenticated transport; `identity-repository.ts`
implements the first durable identity, profile, household, membership, invitation and settings slice using
RLS plus existing authenticated SQL functions. `supabase-rpc.ts` remains the service-role RPC transport;
`system-client.ts` exposes only its RPC call surface and is not injected into routes.

The durable identity slice is selected after JWT verification when `SUPABASE_URL` and
`SUPABASE_ANON_KEY` are configured. Staging and production API requests remain fail-closed until the whole
application repository, durable idempotency and other durable stores are integrated. Other repository
domains remain in memory only in explicitly configured local/test execution and are not production-ready.
