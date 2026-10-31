# AutoPW3 — Task Handoff Report

## Task completed
Number and name: Durable site-read foundation for future read-only Tesla discovery and authorization
Branch / commit: `Raj-AutoPW3` / base `3e0fd633d36869e340f50b32909295d032d5c13d`; changes uncommitted
Date: 2026-10-31

## Summary
Added a scoped authenticated PostgreSQL site-read repository using Raj's request-scoped PostgREST transport. Adapted the useful projections from Sai commit `1e25918b2105f34168e5926b1ace0f7c3c7dee89`, correcting pagination and adding explicit actor membership checks and strict result validation. Only `listSites` and `getSite` are implemented. No HTTP route, OAuth, token refresh, provider request, command, cron or deployment capability is activated.

## Files created
| Path | Purpose |
|---|---|
| `apps/worker/src/db/site-read-repository.ts` | `SiteReadRepository`, internal `StoredSite`, and authenticated bounded list/lookup implementation. |
| `apps/worker/src/db/site-read-repository.test.ts` | Forty-three Worker regression cases for transport scoping, actor isolation, pagination, authorization, missing configuration and database failures. |
| `supabase/tests/database/142_authenticated_site_reads.test.sql` | Twenty-four real local PostgreSQL RLS assertions for membership, persisted site reads, pagination, role boundaries and revocation. |
| `docs/handoffs/DURABLE-SITE-READS.md` | This implementation and verification record. |

## Files modified
| Path | What changed and why |
|---|---|
| `apps/worker/src/db/README.md` | Document the scoped adapter, internal metadata contract and unchanged API boundary. |
| `supabase/tests/database/README.md` | Describe the new local site-read RLS tests. |
| `docs/DECISIONS.md` | Append D-119 for the selected two methods, authenticated access and cursor design. |
| `docs/KNOWN_LIMITATIONS.md` | Append L-134 for runtime/hosted integration and snapshot boundaries. |
| `docs/handoffs/README.md` | Link this handoff. |

## Decisions
D-119: Raw Tesla product discovery uses a user-authorized provider request and credentials; it does not require stored sites. Persisted-site reconciliation and authorization for a subsequent site-specific operation need listing and a full authorized metadata lookup. `getSite` returns the actual household and provider IDs, making separate `getHouseholdIdForSite` and `getProviderSiteId` methods redundant in this slice. Those methods were not implemented.

Use a separate two-method interface, with no `InMemoryRepository` inheritance and no claim to implement the full application `Repository`. The internal projection includes persisted IDs, nullable name, timezone and connection state; it does not synthesize sites, provider IDs or capability summaries and must not be sent directly as the public `EnergySite` DTO.

`listSites` validates the actor's membership, then queries `energy_sites` under RLS with a household filter and `provider=TESLA`. Order, cursor filter and cursor output all use UUID `id`. The versioned opaque cursor is bound to the household and has the shared maximum length. Limits are integer 1–200 with one lookahead row; malformed cursors, duplicate/out-of-order rows and invalid database payloads fail closed. The cursor is a position, not an authorization credential, and needs no secret/signature.

`getSite` uses an RLS-protected site-ID lookup and then confirms current actor membership in the stored household. Each method makes at most two bounded database requests and caches no membership. Database errors propagate as sanitized transport errors. An unauthorized/nonexistent list scope throws generic 404; an RLS-hidden or no-longer-authorized site returns null. Valid empty households return an empty page. The transport already rejects missing URL/public key/JWT configuration, applies timeouts and rejects redirects; there is no fallback path in this adapter.

## Database changes
No migration, table, grant, policy, RPC or generated-type changes. Reuse `energy_sites`, `household_members`, `energy_sites_select_member` and existing membership RLS. The new SQL tests seed and roll back isolated fixtures on the temporary local harness only.

## API changes
None. `app.ts`, `index.ts`, routes, staging identity behavior, feature flags, Wrangler and workflows are unchanged. The new repository is a foundation for a later explicitly authorized runtime slice. Instantiate it only after verifying a request JWT, using that exact request's authenticated client and `VerifiedUser`; never use a service-role client or caller-supplied actor as a shortcut.

## Checks executed
| Exact command | Executed? (yes/no) | Result | Relevant output/failure |
|---|---|---|---|
| `npm run test --workspace @autopw3/worker -- --configLoader native --pool threads --maxWorkers 4` | yes | PASS | 338 Worker tests across 30 files, including 43 new site-read cases and the existing staging identity/deployment guard tests. |
| `npm run typecheck` | yes | PASS | All workspaces and e2e TypeScript checks. |
| `npm run typecheck --workspace @autopw3/worker` | yes | PASS | Confirmed the new adapter after the lint import correction. |
| `npm run lint` | yes | PASS on final run | First run found one `consistent-type-imports` error for `AuthenticatedPostgrestClient`; corrected to a type-only import, then ESLint, architecture rules and Prettier passed. |
| `npm run db:verify` | yes | PASS | PostgreSQL 17.10; 16 migrations applied/reapplied idempotently, local reset reproduced the schema, and all 30 design-table/schema/constraint checks passed. |
| `npm run db:test` | yes | PASS | 518 assertions across 20 files; all 24 new site-read assertions passed; both concurrency checks passed; 52-policy matrix matched. |
| `npm run secrets:scan` | yes | PASS | No secret findings. |
| `git diff --check` | yes | PASS | No whitespace errors. |

Worker tests use the existing native config loader/thread-pool invocation because the default loader previously encountered Windows sandbox `spawn EPERM`. No test, dependency or isolation setting was weakened. Full application tests and production builds were not run for this foundation-only change.

## Manual verification
Confirmed the call-site distinction between raw Tesla product discovery, persisted-site listing and authorization for later telemetry. Reviewed the pinned Sai site projections and corrected their timestamp/ID cursor mismatch using a single UUID key. Confirmed the new module imports only the authenticated transport type and sanitized error class; it has no privileged client, in-memory facade, environment fallback or provider dependency. Only the intended source/tests and supporting documentation changed from the clean baseline.

## Acceptance criteria
| Criterion | Status (VERIFIED / MOCK_ONLY / NOT_EXECUTED / FAILED) | Evidence |
|---|---|---|
| Minimum two-method scoped repository | VERIFIED | Only `listSites` and `getSite`; internal metadata carries both stored scope IDs. |
| User bearer/public key preserved and request contexts isolated | MOCK_ONLY | HTTP transport assertions and interleaved actor tests; actual HTTP runtime wiring is deferred. |
| Actor/household isolation and role-correct site reads | VERIFIED | Local PostgreSQL RLS tests cover ADMIN, READ_WRITE, READ_ONLY, foreign household, unassociated user, revoked membership and anon. |
| Correct bounded cursor pagination | VERIFIED | Unit tests cover lookahead, maximum/default limits, deletion of cursor row, malformed/cross-household cursors; SQL tests use equal creation timestamps with UUID ordering. |
| Missing configuration, authorization and database failures fail closed | VERIFIED | No usable authenticated client with missing configuration; denied scopes, malformed rows and backend errors have no empty-success or in-memory fallback. |
| No synthetic sites, capabilities or provider IDs | VERIFIED | Stored-row schema validation, actual provider-ID checks, nullable-name preservation and no capability fields. |
| Existing staging identity and deployment guards preserved | VERIFIED | Full Worker suite passes; no runtime/configuration/route changes. |
| Real hosted Supabase/PostgREST and Cloudflare integration | NOT_EXECUTED | Local tests only; no hosted database, provider or deployment operation performed. |

## Verification status register
Local TypeScript/lint/secrets: VERIFIED. Worker adapter assertions: VERIFIED with mocked HTTP. Local PostgreSQL RLS and schema verification: VERIFIED. Actual request-scoped site repository runtime wiring, hosted PostgREST and Cloudflare: NOT_EXECUTED. Local checks do not establish production readiness.

## Outstanding issues
- No public site endpoint or Tesla discovery integration consumes this new adapter yet. A later runtime slice must construct it after JWT verification, translate its errors and choose an appropriate public response projection without invented capability data.
- The results are point-in-time reads, not transaction-wide snapshots or grants for later provider requests. Future provider operations must reauthorize the current actor/site association.
- OAuth/state/token runtime wiring and the existing Tesla audience, region, HTTP safety and payload-validation gaps remain separate work. Existing Raj adapters should be reused rather than importing Sai's parallel stores.
- No site create/update methods or telemetry persistence were added; discovery reconciliation writes need a separately scoped transaction/authorization design.

## Environment variables
No new bindings or credential changes. This repository receives an already constructed authenticated PostgREST client, using `SUPABASE_URL`, the public `SUPABASE_ANON_KEY` and the verified request JWT. It does not require the service-role credential, Tesla credentials, encryption key or a new feature flag. The current staging identity flag remains disabled by default.

## Instructions for the next task
Review this uncommitted implementation on `Raj-AutoPW3`. Reuse `SiteReadRepository` and the internal `StoredSite` projection. Preserve RLS, request-local JWTs, UUID cursor validation, explicit database errors and all route/cron/deployment guards. Keep the full repository, provider and token boundaries separate; do not enable a broad API or copy Sai's facade/factory as a shortcut.

## Next task
GO for the next separately authorized local implementation phase after review: narrowly scoped runtime use of these reads and existing Raj OAuth/token stores, with the identified Tesla OAuth/HTTP fixes. Live telemetry calls, hosted migrations and deployment remain NO-GO until the required integration and environment verification are authorized and completed.
