# GitHub Actions workflows

Created in TASK-02 (`ci.yml`) and TASK-21 (deploy workflows).

- CI runs type check, lint, tests, build, a secrets scan and the database security tests on every pull request.
- Deploy workflows require passing CI and a manual approval for production.
- Secrets are stored as GitHub Actions secrets, never in the repository. See `docs/CREDENTIALS.md`.
