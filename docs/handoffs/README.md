# Handoffs

One report per task: `TASK-NN.md`, using [`../ai-build-kit/03-HANDOFF-TEMPLATE.md`](../ai-build-kit/03-HANDOFF-TEMPLATE.md). The next task starts from the previous handoff. A task with unmet critical acceptance criteria must begin with **TASK NOT COMPLETE**.

The non-numbered Stage 1 handoff [`STAGE-1-DURABLE-REPOSITORY.md`](STAGE-1-DURABLE-REPOSITORY.md) records an incomplete durable-runtime task and its blockers.
The Stage 1 identity repository implementation handoff [`STAGE-1-IDENTITY-REPOSITORY.md`](STAGE-1-IDENTITY-REPOSITORY.md) records the scoped authenticated slice and verification blockers.
The staging identity read handoff [`STAGING-IDENTITY-READ.md`](STAGING-IDENTITY-READ.md) records the disabled-by-default durable `/me` exception and its local verification boundary.
The security follow-up [`STAGING-IDENTITY-HARDENING.md`](STAGING-IDENTITY-HARDENING.md) records strict staging JWT audience validation and credential-bearing redirect rejection.
The durable site-read foundation [`DURABLE-SITE-READS.md`](DURABLE-SITE-READS.md) records the two scoped persisted-site reads, Sai query reuse, and local isolation verification.
