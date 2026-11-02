# Credentials and Secrets

**Rule one: no real secret is ever committed, pasted into an AI prompt, written to a log or placed in a `VITE_` variable.**

## Inventory (provisional; finalised in TASK-01, 02 and 15)

| Credential | Used by | Local | Production | Notes |
|---|---|---|---|---|
| Supabase URL, public anon/publishable key | Web, Worker | `apps/web/.env.local`, `.dev.vars` | Public build config / Worker vars | Public by design; RLS and user sessions protect data; portable examples use placeholders |
| Supabase secret (service-role) key, variable `SUPABASE_SECRET_KEY` | Worker only | `.dev.vars` | Cloudflare secret | Bypasses RLS. Use only where documented. Never in the browser or CI logs |
| Tesla client ID | OAuth application identifier | `.dev.vars` | Worker vars | Public identifier visible in consent URL; use your own application |
| Tesla client secret | Worker only | `.dev.vars` | Cloudflare secret | Never in browser/code/logs; your own Tesla developer application |
| Tesla user tokens | Worker only | database (encrypted) | database (encrypted) | Never returned to clients or logged |
| Token encryption key (versioned) | Worker only | `.dev.vars` | Cloudflare secret | Back up in a password manager; rotation procedure below |
| Cloudflare API token | CI | none | GitHub Actions secret | Scope to the minimum required |
| Supabase access token / DB password | CI, owner | none | GitHub Actions secret / password manager | Needed for migrations |

## Where things live
- **Local development:** `apps/web/.env.local` (web) and `apps/worker/.dev.vars` (Worker). Both are git-ignored. Per-app `.example` files contain only placeholders; see [DEVELOPER_SETUP.md](DEVELOPER_SETUP.md).
- **Production Worker:** Cloudflare secrets (`wrangler secret put <NAME>`), never `[vars]` in config.
- **CI/CD:** GitHub repository or environment secrets, with a manual approval gate on the production environment.
- **Personal backup:** a password manager, not a file in the repo.

## Setup checklist
1. Copy `apps/web/.env.example` to `apps/web/.env.local` and `apps/worker/.dev.vars.example` to `apps/worker/.dev.vars` without overwriting existing files. Mock development needs no credentials. Use your own project for optional real Auth.
2. Confirm `git status` shows neither file.
3. Generate the encryption key locally (script provided in TASK-15) and store a copy in your password manager.
4. Add production secrets in Cloudflare and GitHub through their UIs or CLIs.

## Rotation
- **Any suspected leak:** revoke or rotate the credential at its provider first, then update stores, then investigate.
- **Encryption key:** the envelope is versioned, but this runtime currently uses version 1 and has no environment-driven rotation or automatic re-encryption tool. Do not replace the active secret or rely on old example version/previous-key variables. A separate reviewed migration/key-management plan must preserve old decryption capability before any change. Loss of the key makes stored tokens unrecoverable; reconnect requires explicit authorization.
- **Tesla tokens:** revoke through the provider and disconnect in the app; reconnecting issues new tokens.

## If a secret was committed
1. Treat it as compromised and rotate it immediately.
2. Remove it from history (for example with `git filter-repo`) and force-push only with the owner's agreement.
3. Record the incident in `docs/KNOWN_LIMITATIONS.md` or a private note.
4. Add a rule to the secrets scan so it cannot recur.

## Safeguards
`.gitignore` blocks `.env*`, `.dev.vars`, keys and certificates; CI runs a secrets scan (TASK-02); CODEOWNERS requires owner review for token and middleware code; logs are redacted by the Worker logger.
