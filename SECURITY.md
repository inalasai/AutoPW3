# Security Policy

## Reporting a vulnerability
Do not open a public issue. Use GitHub's **private vulnerability reporting** for this repository (Security tab → Report a vulnerability), or contact the repository owner privately. Include steps to reproduce and impact. Expect an acknowledgement and a fix timeline from the owner.

## Scope
This project handles energy telemetry and, where supported, device configuration for a home battery system, plus OAuth tokens for a third-party account. Treat anything that exposes tokens, bypasses role checks, crosses household boundaries or sends unintended device commands as high severity.

## Security principles
- Row Level Security on every exposed table; the database enforces authorisation independently of the app.
- Roles are per household membership and are never trusted from the browser.
- Tesla tokens are encrypted at rest with keys held in server-side secrets, never returned to clients and never logged.
- Service-role credentials exist only in trusted server code.
- Commands are capability-checked, idempotent, audited and never reported successful without confirmation.
- Automation defaults to dry-run.

## If a credential leaks
Follow the rotation steps in [docs/CREDENTIALS.md](docs/CREDENTIALS.md) immediately: revoke, rotate, then clean history if needed.
