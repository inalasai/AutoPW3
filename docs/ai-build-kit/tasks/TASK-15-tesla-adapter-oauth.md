# TASK 15 — Tesla Adapter and OAuth

**Phase 4 · Backend and Tesla.** High risk: vendor behaviour must come from current official documentation.

## Goal
Implement a server-side Tesla provider (OAuth, discovery, live status, history, capability discovery) plus a tested mock adapter, without inventing any behaviour.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, all `docs/research/TESLA_*.md` from Task 00, `docs/SECURITY_MODEL.md`, provider interface (Task 08), Worker API (Task 14), `docs/handoffs/TASK-14.md`.

## Stop conditions
- Re-check current official Tesla docs for anything you use. If the documentation differs from Task 00, **stop and report the difference**.
- Any endpoint, scope or field you cannot cite: mark `UNVERIFIED`, implement only against the mock.
- Do not make live calls without the owner supplying credentials; never run live control calls.

## Plan step
List each module, the documentation reference behind each external call, and which parts will be `MOCK_ONLY`.

## Requirements
- OAuth: state + CSRF protection (single-use, expiring, bound to user/session), PKCE if documented, callback handler, scope checking, redirect URI validation.
- Token handling: expiry tracking, refresh with concurrency control (avoid double refresh and refresh-token loss), encrypted persistence (authenticated encryption, per-record nonce, key version for rotation), keys only from Cloudflare secrets, revocation and reconnect flows, token material never leaves the server and never appears in logs.
- Region-specific base URL handling per Task 00.
- Site discovery; live status; historical retrieval; normalisation to internal types using the central sign convention; handle missing fields explicitly.
- Capability registry: each command classified `SUPPORTED`, `UNSUPPORTED` or `UNVERIFIED` with documentation reference and hardware conditions; default for unknown is unsupported. No claim for forced charging, forced export, solar bypass or islanding unless documented and confirmed for the site.
- Typed provider errors; rate-limit awareness (honour retry hints, backoff); sanitised logs.
- A mock adapter implementing the same interface, driven by fixtures. The live path is `UNVERIFIED` until tested against an authorised site.

## Out of scope
Ingestion scheduling (Task 16), control UI and command dispatch (Task 17).

## Deliverables
Adapter modules, OAuth routes, encryption module, capability registry, mock adapter, tests, `docs/TESLA_INTEGRATION.md`, `docs/TESLA_CAPABILITY_MATRIX.md` (final), and a list of steps requiring a Tesla developer account, permissions, a compatible device, or approval.

## Required tests (mocked HTTP)
Successful OAuth; invalid or reused state; expired state; token expiry and refresh; concurrent refresh; refresh failure and reconnect; encryption round-trip, tamper detection, key rotation; discovery; missing telemetry fields; rate limit; unsupported capability; provider error mapping; log-redaction test proving tokens never appear.

## Verification
Type check, lint, tests, build. Report actual results. State clearly: live integration status = `UNVERIFIED` unless the owner ran a real authorised test and you saw the result.

## Acceptance criteria
- Mock tests pass; encryption and OAuth-state tests pass.
- No token material is reachable from any API response (test).
- The matrix and docs state the verification status of each capability.

## Repo locations
Branch: `task-15-tesla-adapter-oauth`. Commit prefix: `task-15:`. Write to: `apps/worker/src/providers/tesla`, `apps/worker/src/services/tokens`, `docs/TESLA_INTEGRATION.md`, `docs/TESLA_CAPABILITY_MATRIX.md`. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-15.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-15.md` with the capability registry contents and the manual steps the owner must perform.
