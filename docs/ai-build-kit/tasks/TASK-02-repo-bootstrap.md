# TASK 02 — Repository Bootstrap

**Phase 1 · Foundation.**

## Goal
Create a working application skeleton that installs, type-checks, lints, tests and builds, with no business features.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, approved docs from Task 01 (especially `SYSTEM_ARCHITECTURE.md` and `DECISIONS.md`), `docs/handoffs/TASK-01.md`.

## Stop conditions
- Package versions that cannot be made compatible: document the correction in `DECISIONS.md`; do not silently change architecture.
- Any need for real secrets: use placeholders.

## Plan step
List the directory tree and the pinned dependency set you intend to use, and how you will check compatibility.

## Requirements
- Structure from the architecture: web app, shared types package/folder, Worker, Supabase migrations and tests, docs, scripts.
- Strict TypeScript across all packages; path aliases or workspace imports for the shared package.
- Vite + Tailwind configured. ESLint (and formatter). Vitest configured for web, shared and Worker.
- Worker TypeScript entry with a `/health` stub and Cloudflare configuration (current format; verify).
- `.gitignore`, `.env.example` (placeholders only), `README.md`, `docs/DEVELOPMENT_SETUP.md`.
- **Agent instruction files:** `AGENTS.md` and `CLAUDE.md` already exist in the repo from the build kit. Do not recreate them. Replace the "Commands" section of `AGENTS.md` with the real scripts and keep everything else.
- **Skeleton already present:** the folder layout, a README in every code folder, root `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `.gitignore`, `.env.example`, `.editorconfig`, `docs/CREDENTIALS.md`, `docs/TESTING.md` and the PR template exist from the kit. Keep them. Add `package.json` files, configs and code; **extend** `.gitignore` and `.env.example` rather than replacing them; update each folder README's `Status` line when its contents change; keep the root README "Getting started" accurate.
- **Existing content:** inventory what is already in the repository before creating anything. Do not overwrite existing files. Integrate pre-existing code into the layout or move it to `legacy/` with a `DECISIONS.md` entry.
- **Layout:** create the structure in `docs/ai-build-kit/04-REPO-STRUCTURE.md` using npm workspaces (`@autopw3/web`, `@autopw3/worker`, `@autopw3/shared`, `@autopw3/domain`), with lint rules enforcing the import direction table.
- CI workflow (type check, lint, test, build).
- Frontend runs locally with no Tesla credentials and no production DB credentials, using a clearly labelled demo configuration.
- Pinned versions with a lockfile. Dependency audit output reported.
- Create `docs/handoffs/` and `docs/KNOWN_LIMITATIONS.md` if absent.

## Out of scope
Any energy logic, database schema, authentication, styling beyond a placeholder shell.

## Verification (run and report actual output)
```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```
Adapt to actual script names. Also confirm the dev server starts and the Worker responds locally (for example via the Cloudflare local dev tooling).

## Acceptance criteria
- All commands above pass from a clean checkout.
- The app and Worker start locally with no secrets.
- No secret-like values exist in the repo (run a secrets scan if a tool is available).
- CI config matches local scripts.

## Repo locations
Branch: `task-02-repo-bootstrap`. Commit prefix: `task-02:`. Write to: root config, `apps/web`, `apps/worker`, `packages/shared`, `packages/domain`, `.github/workflows/`, `scripts/`, `docs/DEVELOPMENT_SETUP.md`. Write elsewhere only if you explain why in the handoff.
Create the layout exactly as in `04-REPO-STRUCTURE.md`. `AGENTS.md` and `CLAUDE.md` already exist; fill in the real commands.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-02.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-02.md` with the repo tree, commands, environment variable names and any unresolved configuration issues.
