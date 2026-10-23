# GitHub Actions workflows

`ci.yml` exists (TASK-02) and runs `npm ci`, type check, lint, tests, build, secrets scan and `npm audit --audit-level=high`. It has **not run on GitHub yet** (no push). Database tests are added in TASK-04; deploy workflows in TASK-21.

- CI runs type check, lint, tests, build, a secrets scan and the database security tests on every pull request.
- Deploy workflows require passing CI and a manual approval for production.
- Secrets are stored as GitHub Actions secrets, never in the repository. See `docs/CREDENTIALS.md`.
