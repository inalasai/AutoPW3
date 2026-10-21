# Handoff Report Template

At the end of every task, create `docs/handoffs/TASK-NN.md` using exactly this structure. Do not include secret values anywhere.

```markdown
# AutoPW3 — Task Handoff Report

## Task completed
Number and name:
Branch / commit:
Date:

## Summary
Two to five sentences: what now exists that did not before.

## Files created
| Path | Purpose |

## Files modified
| Path | What changed and why |

## Decisions
New or changed decisions (also appended to docs/DECISIONS.md), with rationale.

## Database changes
Migrations, tables, policies, grants, functions.

## API changes
Endpoints, request/response contracts, authorisation rules.

## Checks executed
| Exact command | Executed? (yes/no) | Result | Relevant output/failure |

## Manual verification
What was checked by hand and how.

## Acceptance criteria
| Criterion | Status (VERIFIED / MOCK_ONLY / NOT_EXECUTED / FAILED) | Evidence |

## Verification status register
Items marked: VERIFIED, MOCK_ONLY, AWAITING_CREDENTIALS, AWAITING_PROVIDER_APPROVAL, UNSUPPORTED_BY_DEVICE, UNVERIFIED.

## Outstanding issues
Known defects, incomplete items, external dependencies, questions for the owner.

## Environment variables
Names only, with where each is set (local, Cloudflare secret, Supabase, CI).

## Instructions for the next task
Exact files, contracts and commands the next task must reuse. Anything it must not change.

## Next task
Recommended next task and its prerequisites.
```

If any critical acceptance criterion is not met, the report must state **TASK NOT COMPLETE** at the top and list the blockers.
