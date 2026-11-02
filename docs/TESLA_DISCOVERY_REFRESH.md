# Staging discovery refresh contract

Status: security contract implemented and locally verified; the later approved staging integration
was verified separately in the [integration handoff](handoffs/TESLA-STAGING-INTEGRATION.md).
Publication/onboarding authorizes no new hosted action. This document preserves the recovery rules.

This document resolves the security contract before implementation. Scope is only the existing
staging discovery GET. Site linking keeps its strict fresh-credential context. No flags, frontend
assets, scheduled tasks, telemetry, automation, control scopes or control endpoints change.

## Rotation and ambiguous persistence

### Expired READY lifecycle follow-up (2026-11-02)

Plan before implementation: add a forward migration replacing refresh context/finish, wrap the
unshipped base migration and the follow-up in single DO statements, update Worker recovery mapping,
and extend Worker, SQL, real concurrency and migration atomicity tests. Preserve the existing branch
and dirty working tree (D-125); no task number, hosted changes, OAuth reconnection or commit.

The rotated pair staged in READY is a distinct credential generation. It is never used for another
exchange while pending. Tesla documents single-use rotation and saving each new refresh token;
the documented grace period does not prove whether an ambiguous request consumed a generation.
This implementation chooses explicit reauthorization instead of introducing a second exchange from
pending ciphertext. Under the original actor/session, lease, deadline and original revision locks,
finish converts an expired/expiring staged TOKEN result to REAUTH, marks only that matching ACTIVE
credential NEEDS_REAUTH, writes the existing reauth audit, clears the pending ciphertext and retains
the COMMITTED barrier atomically. Repeated discovery returns a fixed reauthorization-required state.
SENT/ambiguous outcomes retain their barrier and return a separate recovery-required state.

Only a successfully activated pair can participate in a subsequent normal refresh: its encrypted
credential revision differs from its parent and receives its own durable SENT attempt. Ambiguity in
that next generation never permits retrying either generation. Tests must cover expired READY,
repetition, concurrent terminalization, newer OAuth credentials, revocation, logout/demotion and an
ambiguous refresh after successful first-generation activation. No automatic reconnect is performed.

Security-definer definitions and grants must be one atomic SQL statement even for an autocommit
executor. A DO block provides that property without nested BEGIN/COMMIT interfering with a hosted
migration runner's outer transaction. Injected installation failures must leave definitions and ACLs
unchanged. No migration executor or migration history is modified on a hosted database.

Discovery uses the existing CONFLICT envelope (HTTP 409), with detail path `provider.tesla` and fixed
issue `TESLA_REAUTHORIZATION_REQUIRED` for terminal REAUTH/NEEDS_REAUTH, or `TESLA_RECOVERY_REQUIRED`
for a durable ambiguous SENT barrier. No raw database/provider message crosses this boundary.

Tesla rotates refresh tokens. There is no atomic transaction spanning Tesla and PostgreSQL.
Before sending a token request, an authenticated ADMIN transaction records a private SENT attempt,
unique per household and credential revision. SENT means the exchange may have happened, including
when its HTTP response was lost. It is never automatically retried, even after the lease expires.
A crash before sending can therefore conservatively block that revision too.

The Worker encrypts a successful rotated pair once with the existing AES-GCM envelope. A service-only
RPC stages that exact encrypted result, idempotently. A separate authenticated RPC activates it.
If staging/commit reports an ambiguous failure, only that authenticated commit may be attempted;
the token exchange is never repeated. A subsequent discovery can resume a READY result for the
same actor/session with a new lease owner, without another token request. An expired or expiring
staged access token terminalizes as REAUTH instead of looping. COMMITTED replay is
idempotent and checks the current credential revision. Successfully committed attempts erase their
staged ciphertext. An unpersisted rotation is unrecoverable by this workflow: SENT remains blocked
and requires separately authorized recovery. No automatic OAuth reconnection or lease-expiry reset.

Tesla documents a last-used refresh-token grace period, but correctness does not depend on it:
https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens#refresh-tokens

## Commit-time authority

Preflight, begin and finish use public key plus the actual user's JWT. PostgreSQL derives auth.uid(),
session_id and exp and checks the live auth.sessions row and current household ADMIN membership.
Begin binds the attempt to that actor/session and credential revision. Finish accepts only household,
attempt and owner identifiers, never caller-supplied actor/session IDs or encrypted credentials.
The service role cannot execute these authenticated functions. Its staging RPC accepts no actor or
session identifiers, cannot activate credentials, and can only attach an encrypted result to an
existing, unexpired, revision-bound SENT attempt. Ordinary users cannot stage results or access the
private ledger. Authorization, activation, last_refresh_at and actor-attributed audit commit together.

## Timing, leases and fencing

Discovery has one 25-second budget starting at route entry. Credential-bearing fetches inherit this
abort signal in addition to their existing per-call limits; response body reads are bounded too.
Before and after each orchestration phase the budget is checked. A fixed deadline is passed to begin;
PostgreSQL caps it at 25 seconds and the JWT expiry. The existing token:<household> lease machinery
is reused, with a distinct owner for every request. No waiting loop or background renewal is used.

Lock order is session, membership, token lease, credentials, attempt. Service staging takes only the
latter three in the same order. Deadline/owner/revision are rechecked after locks. All locks remain
held through commit, so delayed requests cannot overwrite a replacement or commit under a successor's
lease. READY recovery changes the owner; old owners cannot finish. A transaction already holding the
required locks linearizes before a conflicting logout/replacement, as in the existing OAuth contract.
No database transaction remains open during a Tesla request. Finally releases only the matching owner.

## Validation and audit

Expired ACTIVE credentials are eligible for refresh only through the new authenticated preflight.
Missing/inactive records, malformed envelopes, extra/missing read-only scopes and unapproved regions
remain closed. Refresh responses use bounded transport and the authorization exchange's validated
token/scope normalization; both rotated tokens, Bearer type and bounded positive lifetime are required.
The region remains the stored approved region. Definite login_required results may stage a fixed
reauthorization outcome; finish marks only the same ACTIVE revision NEEDS_REAUTH. Transient and
unknown outcomes do not declare consent revoked. Neither result signs the user out of Supabase.

Success emits tesla.token_refreshed and terminal rejection emits tesla.reauth_required, attributed to
the authenticated committer, with no token, ciphertext, provider body or exception text in audit/logs.
Existing tesla.connected and tesla.site_linked behavior is unchanged. Discovery captures the revision
after its own refresh and retains the existing post-products revision check.

## Files and verification

Runtime: staging-tesla-sites.ts; db/site-link-repository.ts and system-client.ts; a request-budget
helper; services/tokens/discovery-refresh.ts and supabase-store.ts; providers/tesla/oauth.ts and
http.ts; shared audit constants; one forward migration adding private ledger and scoped RPCs.
Tests: targeted Worker/OAuth/store regressions, exhaustive SQL privileges and security/expiry cases,
real two-connection claim/commit/logout/replacement/late-owner races wired into scripts/db-test.mjs.
Regenerate database types through the existing generator. Update touched READMEs, append decisions
and limitations, and write a dedicated handoff. Preserve the existing dirty working tree and branch;
no commits, deployment, hosted migrations or live Tesla calls. No new task number is assigned.

Stop if authenticated commit authority, durable no-reexchange fencing, lease/revision ordering or
secret confinement cannot be established. Local tests do not establish hosted PostgREST/Auth behavior.


## Verification and remaining boundary

The full Worker suite passed (694 tests); shared suite passed (236 tests). The database security
suite passed 690 checks, including 51 new SQL assertions and eight new real row-lock races. Native
workerd also exercised RequestBudget, bounded token transport and redirect rejection. Generated types
match all 20 migrations. The final handoff records exact commands and the repository-wide lint
failure caused by the pre-existing generated .wrangler-tesla-check/index.js artifact.

Follow-up verification supersedes those original counts: 703 Worker tests, 236 shared tests and 721
database checks (693 SQL assertions, 24 concurrency checks including 16 refresh cases, four atomic
installation/outer-transaction rollback checks). Schema install/reapply/reset, generated type check,
typecheck, targeted ESLint, architecture lint and secret scan passed. See
[the follow-up handoff](handoffs/TESLA-DISCOVERY-REFRESH-RECOVERY.md) for exact commands and limits.

The forward migration extends private.touch_audit with two empty-metadata actions and preserves
all prior action allowlists. The drift test reads the latest forward definition. Existing server-only
credential RPCs remain available to their prior trusted callers; this change secures the discovery
workflow and does not claim to constrain all privileged/manual database writers. Hosted migration,
PostgREST visibility, Supabase Auth compatibility and real Tesla renewal remain unverified.

## End-to-end integration follow-up

The shared error schema and browser now accept only the two fixed recovery CONFLICT details, with a
4 KiB parsing bound; recovery stops rediscovery without expiring Supabase login. Staging telemetry is
explicitly demo and controls remain off. Migration 20261102160000 adds post-lock link authority and
freshness checks without changing RPC signatures, scopes, region or refresh policy. See
[the integration handoff](handoffs/TESLA-STAGING-INTEGRATION.md) and
[the consolidated rollout plan](TESLA_STAGING_ROLLOUT.md). Hosted changes require explicit approval.

Manual OAuth initiation is now available only through an explicit ADMIN action. The existing session
bridge completes it; redirect validation enforces the Tesla origin, exact read-only scopes and PKCE.
Recovery errors never start OAuth automatically. Real reconnection was not performed.
