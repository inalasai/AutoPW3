# Durable identity repository: Stage 1

**Status: PARTIAL FOUNDATION IMPLEMENTED.** This stage adds request-local authenticated database access and a durable first repository slice. It does not complete the `Repository` contract and does not enable staging or production API traffic.

## Durable methods

`SupabaseIdentityRepository` implements:

- `getProfile` and `updateProfile` (profile update is repository-only; no HTTP update route exists yet).
- `getHouseholdMemberships`, `getHousehold`, `updateHousehold`, `getMembership`, and `listMembers`.
- `updateMemberRole`, `createInvitation`, `listInvitations`, `revokeInvitation`, `acceptInvitation`.
- `getSettings`, `updateSettings`, `removeMember`, and `leaveHousehold`.

It intentionally does not implement household creation: the schema reserves creation for the one-time service-only bootstrap function. Household rename/timezone update, exports, audit listing, deletion, sites, tariffs, automation, commands, telemetry, rollups, usage, and retention still use the existing repository interface and have no durable user-repository implementation in this stage.

## Access and actor flow

After asymmetric JWT verification, `handleApiRequest` constructs a new `AuthenticatedPostgrestClient` with the project URL, anon key, and the exact bearer from that request. The client has no service-role credential and is not cached. Profile, household, membership, invitation listing, and settings operations use authenticated PostgREST so database RLS applies. Invitation lifecycle and member-role operations call the existing authenticated SQL functions, which derive `auth.uid()`, enforce roles, and trigger audit records.

The service-role transport remains separate in `system-client.ts`; no privileged client is passed to the API app or routes. Staging and production continue to return `PROVIDER_UNAVAILABLE` before API dispatch until all application and durable idempotency dependencies are complete.

## Transaction and data limits

The existing invitation and membership functions remain the transaction boundary for those multirow changes. Settings use one RLS-protected PATCH; its trigger stamps `updated_by` and records the authenticated actor. Household metadata updates use the new authenticated `public.update_household` RPC, with a row trigger that audits every allowed metadata update in the same transaction.

Monthly spend is not present in the current usage schema. Durable settings responses therefore return `spentUsd: null` and `state: UNKNOWN`; this is not budget enforcement. The existing API idempotency cache remains process-local, so this stage is not sufficient to enable the invitation mutation route in a multi-Worker deployment.

## Verification boundary

Worker transport, repository mapping, and runtime wiring have unit tests, but Vitest could not start in this Windows sandbox because Vite config resolution returned `spawn EPERM`. The 19-assertion SQL test passed on the throwaway PostgreSQL 17 harness together with the other database tests. A local harness pass is not hosted Supabase verification. Real Supabase JWT/PostgREST behavior and Worker deployment remain unverified until staging is authorized and configured.
