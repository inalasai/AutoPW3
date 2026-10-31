# GitHub Actions workflows

CI runs type check, lint, unit tests, build, database verification/security tests and secrets scan. It has not run on GitHub in this audit. Deploy jobs in `deploy.yml` require those gates and are additionally disabled unless repository variable `AUTOPW3_DEPLOYMENT_ENABLED` is explicitly set to `true`.

- CI runs type check, lint, tests, build, a secrets scan and the database security tests on every pull request.
- Deployment remains disabled until durable PostgreSQL-backed Worker adapters and hosted setup are verified. Production also requires the repository's protected `production` environment approval.
- Secrets are stored as GitHub Actions secrets, never in the repository. See `docs/CREDENTIALS.md`.
