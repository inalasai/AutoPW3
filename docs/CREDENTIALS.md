# Credentials and Secrets

**Rule one: no real secret is ever committed, pasted into an AI prompt, written to a log or placed in a `VITE_` variable.**

## Inventory (provisional; finalised in TASK-01, 02 and 15)

| Credential | Used by | Local | Production | Notes |
|---|---|---|---|---|
| Supabase URL, anon key | Web, Worker | `.env.local`, `.dev.vars` | Build-time config / Worker secret | Anon key is public by design; RLS protects data |
| Supabase service-role key | Worker only | `.dev.vars` | Cloudflare secret | Bypasses RLS. Use only where documented. Never in the browser or CI logs |
| Tesla client ID and secret | Worker only | `.dev.vars` | Cloudflare secret | Created in the Tesla developer portal (TASK-00 setup steps) |
| Tesla user tokens | Worker only | database (encrypted) | database (encrypted) | Never returned to clients or logged |
| Token encryption key (versioned) | Worker only | `.dev.vars` | Cloudflare secret | Back up in a password manager; rotation procedure below |
| Cloudflare API token | CI | none | GitHub Actions secret | Scope to the minimum required |
| Supabase access token / DB password | CI, owner | none | GitHub Actions secret / password manager | Needed for migrations |

## Where things live
- **Local development:** `.env.local` (web) and `apps/worker/.dev.vars` (Worker). Both are git-ignored. `.env.example` holds placeholders only.
- **Production Worker:** Cloudflare secrets (`wrangler secret put <NAME>`), never `[vars]` in config.
- **CI/CD:** GitHub repository or environment secrets, with a manual approval gate on the production environment.
- **Personal backup:** a password manager, not a file in the repo.

## Setup checklist
1. Copy `.env.example` to `.env.local` and `apps/worker/.dev.vars`; fill in values.
2. Confirm `git status` shows neither file.
3. Generate the encryption key locally (script provided in TASK-15) and store a copy in your password manager.
4. Add production secrets in Cloudflare and GitHub through their UIs or CLIs.

## Rotation
- **Any suspected leak:** revoke or rotate the credential at its provider first, then update stores, then investigate.
- **Encryption key:** keys are versioned. Add the new key as the active version, re-encrypt stored tokens in a controlled job, then retire the old key. If a key is lost, tokens are unrecoverable and users must reconnect Tesla.
- **Tesla tokens:** revoke through the provider and disconnect in the app; reconnecting issues new tokens.

## If a secret was committed
1. Treat it as compromised and rotate it immediately.
2. Remove it from history (for example with `git filter-repo`) and force-push only with the owner's agreement.
3. Record the incident in `docs/KNOWN_LIMITATIONS.md` or a private note.
4. Add a rule to the secrets scan so it cannot recur.

## Safeguards
`.gitignore` blocks `.env*`, `.dev.vars`, keys and certificates; CI runs a secrets scan (TASK-02); CODEOWNERS requires owner review for token and middleware code; logs are redacted by the Worker logger.
