# Stage 1 durable runtime audit

**Status:** TASK NOT COMPLETE. The runtime remains intentionally unavailable in staging and production because the full application repository and transaction-safe idempotency are not present.

## Runtime dependency map

| Runtime path | Current dependency | Durable adapter status |
|---|---|---|
| `index.ts` `fetch` | Calls `handleApiRequest(request, env)` with no dependencies | No repository is constructed. Deploy API requests return `PROVIDER_UNAVAILABLE` before route dispatch. |
| `lib/app.ts` | Defaults to singleton `InMemoryRepository`, `defaultIdempotencyStore`, `defaultRateLimiter`, `InMemoryOAuthStateStore`, and an in-memory token store when configured | `SupabaseDurableJobStore`, `SupabaseTokenStore`, `SupabaseOAuthStateStore`, and `SupabaseRateLimiter` exist but are not constructed here. |
| `index.ts` `scheduled` | For local execution, creates `InMemoryRepository` and `InMemoryTokenStore`, then calls `dispatchScheduledCronJobs` | Staging/production throw before dispatch. Durable queue dispatcher and executor exist, but no durable application repository or job handlers are provided. |
| API and route tests | Supply `InMemoryRepository` and process-local stores via `AppDependencies` | Mock-based tests only. They do not prove Supabase persistence or Worker isolation behavior. |

## Current in-memory boundaries

The repository interface covers household membership and invitations, settings, sites, Tesla-link state,
tariffs, rules, automation executions, commands/events, telemetry, rollups, provider usage, retention,
audit, export and account deletion. Its only implementation is `InMemoryRepository` in
`apps/worker/src/db/repository.ts`. The idempotency implementation in `apps/worker/src/lib/idempotency.ts`
uses a process-local map and the API currently performs `get`, dispatches the business handler, then `set`.
The rate limiter and OAuth state defaults are also process-local. There is no durable repository or durable
idempotency adapter selected by the actual entry point.

## Safety changes in this stage

The in-memory API path now requires `ENVIRONMENT=local` and `LOCAL_MOCKS=true`; `ENVIRONMENT=test` is the
explicit test-only mode. Local scheduled mocks require the same opt-in. Staging, production and other
non-local runtime labels do not fall through to process-local state. Staging and production remain
fail-closed regardless of supplied test dependencies.

## Exact blockers

1. No implementation of the full repository interface exists. `Repository` operations include composite
   writes (membership/invitation, tariff children, command/event, account deletion/export) and must preserve
   the existing constraints and semantics. Direct service-role table calls bypass RLS, so each operation
   needs tenant-scoped query predicates and an explicit application authorization boundary.
2. Several existing public SQL functions derive their actor from `auth.uid()` and are granted to
   `authenticated`. Calling them with the service-role key does not preserve the verified request actor.
   The Worker needs narrow service-only wrappers that accept an actor ID and independently validate its
   household membership and required role, or a verified user-scoped PostgREST client.
3. Current generic idempotency performs separate database-independent `get` and `set` calls around route
   execution. A durable reservation alone cannot determine whether the route mutation committed before a
   Worker crash. Releasing an expired reservation may repeat a committed mutation; retaining it forever
   avoids duplicates but strands requests. Crash-safe retries require operation-specific idempotency to
   participate in the same database transaction as each mutation (or a business mutation proven idempotent).
4. No production job handler set can be assembled against a durable repository. Enabling cron before that
   is complete risks claiming work that cannot be safely performed.

Until these are resolved and tested, staging/production API and cron must remain disabled. No hosted
Supabase migration or Cloudflare deployment has been performed.
