# Contributing

## Workflow
1. Pick the next unchecked task in [`docs/ai-build-kit/00-README.md`](docs/ai-build-kit/00-README.md).
2. Branch: `task-NN-<slug>` from an up-to-date `main`.
3. Read `AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, the task file and the previous handoff.
4. Commit small and often: `task-NN: <imperative summary>`.
5. Run the checks (see [docs/TESTING.md](docs/TESTING.md)) and paste real output into the pull request.
6. Open a PR with the template. Write `docs/handoffs/TASK-NN.md`.
7. Merge when green and reviewed; tag `task-NN-done`.

## Standards
- TypeScript strict; no `any` without a justifying comment.
- Respect the import direction rules in `docs/ai-build-kit/04-REPO-STRUCTURE.md`.
- Money is decimal-safe and serialised as strings. Time is UTC plus IANA timezone.
- Every change to migrations, RLS, tokens, commands or middleware needs owner review.
- No secrets, tokens, `.env` files or personal energy data in commits.
- Keep the README in each folder accurate when you change what that folder contains.

## What blocks a merge
Failing type check, lint, tests or security tests; unreviewed migrations; an unverified Tesla capability enabled; demo data able to reach live tables; any claim of a passing check that was not executed.
