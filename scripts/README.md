# scripts — helper scripts

**Status:** empty.

Small, documented scripts for development and operations (for example key generation, local setup, secrets scan). Each script must:
- start with a comment explaining purpose and usage,
- never print or store secrets,
- be safe to re-run, and say so if it is not.

Prefer npm scripts in the root `package.json` for common commands.
