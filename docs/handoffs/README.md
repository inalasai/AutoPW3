# Handoffs

Status: [secure GitHub publication](SECURE-GITHUB-PUBLICATION.md) records attribution approval,
sanitization, validation and publication. [Developer setup](../DEVELOPER_SETUP.md) is authoritative.

One report per task: `TASK-NN.md`, using [`../ai-build-kit/03-HANDOFF-TEMPLATE.md`](../ai-build-kit/03-HANDOFF-TEMPLATE.md). The next task starts from the previous handoff. A task with unmet critical acceptance criteria must begin with **TASK NOT COMPLETE**.

The non-numbered Stage 1 handoff [`STAGE-1-DURABLE-REPOSITORY.md`](STAGE-1-DURABLE-REPOSITORY.md) records an incomplete durable-runtime task and its blockers.
The Stage 1 identity repository implementation handoff [`STAGE-1-IDENTITY-REPOSITORY.md`](STAGE-1-IDENTITY-REPOSITORY.md) records the scoped authenticated slice and verification blockers.
The staging identity read handoff [`STAGING-IDENTITY-READ.md`](STAGING-IDENTITY-READ.md) records the disabled-by-default durable `/me` exception and its local verification boundary.
The security follow-up [`STAGING-IDENTITY-HARDENING.md`](STAGING-IDENTITY-HARDENING.md) records strict staging JWT audience validation and credential-bearing redirect rejection.
The durable site-read foundation [`DURABLE-SITE-READS.md`](DURABLE-SITE-READS.md) records the two scoped persisted-site reads, Sai query reuse, and local isolation verification.

The [Phase 2 OAuth handoff](PHASE-2-DURABLE-TESLA-OAUTH.md) records the gated durable staging connect/callback flow, security boundaries, verification and external prerequisites.

The [Phase 3 live-status handoff](PHASE-3-TESLA-LIVE-STATUS.md) records the isolated manual staging snapshot, native-sign/nullable response contract, reuse comparison and verification results. No live provider call was made.


The [Tesla OAuth browser-correlation handoff](TESLA-OAUTH-BROWSER-CORRELATION.md) records the staging-only
cookie verifier, bounded pending-attempt ownership, security regressions and migration-free rollout.

The [session/fencing follow-up](TESLA-OAUTH-SESSION-FENCING.md) supersedes that patch's cookie cleanup,
logout policy and unfenced persistence. It records the required local migration and coordinated
staging rollout; neither deployment nor hosted migration has been executed.

The [Tesla discovery/linking handoff](TESLA-SITE-ONBOARDING.md) records the new default-false staging
gate, provider-verified metadata contract, authenticated transactional persistence, idempotency and
local migration. It does not activate live telemetry or establish hosted verification.


The [staging discovery refresh handoff](TESLA-DISCOVERY-REFRESH.md) records the local encrypted
rotation workflow, authenticated activation, durable no-reexchange barrier, migration and checks.

Status: see [expired READY recovery](TESLA-DISCOVERY-REFRESH-RECOVERY.md) for the terminal recovery
lifecycle, atomic-install follow-up and current verification results.

Status: [Tesla staging integration](TESLA-STAGING-INTEGRATION.md) continues refresh recovery through
built-frontend tests, read-only hosted evidence and one consolidated deployment approval.

Status: hosted staging workflow VERIFIED on 2026-11-02. Three approved forward migrations and Worker REDACTED_RUNTIME_ID are installed; real ADMIN login, safe refresh, discovery and user-performed linking are verified with one persisted site/audit. Live telemetry, controls, automation and cron remain disabled. Fresh OAuth consent was not repeated. See the [final handoff](TESLA-STAGING-INTEGRATION.md).
