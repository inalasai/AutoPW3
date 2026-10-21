# TASK 14 — Cloudflare Worker API Core

**Phase 4 · Backend and Tesla.** Uses the demo provider. Tesla comes in Task 15.

## Goal
Provide a secure backend that enforces authorisation independently of the frontend.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, `docs/API_CONTRACT.md`, `docs/SECURITY_MODEL.md`, `docs/RLS_POLICY_MATRIX.md`, shared contracts, `docs/handoffs/TASK-04.md`, `TASK-05.md`, `TASK-13.md`.

## Stop conditions
- Unsure of the current Supabase JWT verification method: consult current official docs; do not guess. Record the choice in `DECISIONS.md`.
- Any endpoint that would need the service-role key for ordinary user data: stop and justify; prefer calling the database as the user so RLS applies.

## Plan step
List endpoints, middleware order (CORS, size limit, auth, role, validation, rate limit, handler), and where service-level access is genuinely required.

## Endpoints
Health; energy-site list; live site status (via provider interface); historical telemetry (paginated, bounded range); device capabilities; tariff CRUD (versioned); automation-rule CRUD (default `DRY_RUN`/`DISABLED`); invitations (create, list, revoke, accept); command submission stub returning `NOT_IMPLEMENTED` until Task 17; command history; admin: member listing and role mutation (final behaviour finished in Task 19, but authorisation scaffolding here).

## Requirements
- Authenticate every protected request; verify JWT properly; load authoritative role and household membership from the database; never trust client claims.
- Validate all bodies/queries with shared schemas; bounded request sizes; consistent status codes and the shared error shape.
- Pagination with caps. Strict CORS allowlist from configuration.
- Rate limiting where appropriate (document approach and limits).
- Idempotency-key support for mutating routes where the contract requires.
- Use user-scoped database access so RLS applies; use trusted service access only for explicitly justified operations, each documented.
- Sanitise errors and logs; never log tokens, JWTs or telemetry payloads in bulk. Add request IDs.
- Cross-household access returns 404 or 403 per the contract, consistently.
- Never return secrets.

## Out of scope
Tesla calls, ingestion, real commands.

## Deliverables
Worker source, middleware, typed handlers, configuration updates, API tests, `docs/API_OPERATIONS.md`.

## Required tests
Success paths; invalid payloads; unauthenticated; expired/forged JWT; forbidden roles per endpoint; cross-household; oversize bodies; CORS; pagination caps; idempotency replay; error sanitisation.

## Verification
Type check, lint, tests, build. Report actual results. Include a test showing a request that bypasses the frontend with a READ_ONLY token fails on every mutating endpoint.

## Acceptance criteria
- Every protected endpoint rejects unauthorised requests even if the frontend is bypassed.
- No endpoint uses a client-supplied role or household claim.
- Service-level access is documented and minimal.

## Repo locations
Branch: `task-14-worker-api-core`. Commit prefix: `task-14:`. Write to: `apps/worker/src/routes`, `middleware`, `db`, `lib`, `docs/API_OPERATIONS.md`. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-14.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-14.md` with endpoint table, authorisation matrix and configuration names.
