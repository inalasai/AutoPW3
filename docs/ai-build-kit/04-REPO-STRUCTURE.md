# Repository Structure and Conventions

Status: **proposed default**. TASK-01 must ratify or amend it and record any change in `docs/DECISIONS.md`. TASK-02 creates it. Every later task puts code where this document says.

## 1. Layout
The folders below already exist in the repository with a README each (and `.gitkeep` in empty leaves). TASK-02 adds the toolchain; later tasks add code. Keep each folder's README accurate.

```
AutoPW3/
├─ AGENTS.md                      # agent rules (all AIs)
├─ CLAUDE.md                      # imports AGENTS.md
├─ README.md                      # human overview, links to docs
├─ package.json                   # npm workspaces + root scripts
├─ package-lock.json
├─ tsconfig.base.json             # strict TS shared by all packages
├─ eslint.config.js
├─ .env.example                   # placeholders only
├─ .gitignore
├─ .github/
│  ├─ workflows/                  # ci.yml, deploy-*.yml (TASK-02, 21)
│  ├─ pull_request_template.md
│  └─ CODEOWNERS
├─ apps/
│  ├─ web/                        # React + Vite + Tailwind
│  │  ├─ index.html
│  │  ├─ vite.config.ts
│  │  └─ src/
│  │     ├─ app/                  # router, providers, layout, route config
│  │     ├─ components/ui/        # design system only (no energy logic)
│  │     ├─ features/
│  │     │  ├─ auth/              # TASK-07
│  │     │  ├─ live/              # TASK-09: flow-model, canvas, battery widget
│  │     │  ├─ tariffs/           # TASK-12
│  │     │  ├─ analytics/         # TASK-13
│  │     │  ├─ controls/          # TASK-17
│  │     │  ├─ automation/        # TASK-18
│  │     │  ├─ admin/             # TASK-19
│  │     │  └─ settings/
│  │     ├─ lib/                  # api client, supabase client, config
│  │     └─ styles/               # tokens, tailwind layers
│  └─ worker/                     # Cloudflare Worker (API + cron)
│     ├─ wrangler.toml (or current format)
│     └─ src/
│        ├─ index.ts              # fetch + scheduled entry points
│        ├─ routes/               # one file per resource (TASK-14, 19)
│        ├─ middleware/           # cors, auth, role, validate, rate-limit, request-id
│        ├─ providers/
│        │  ├─ demo/              # demo provider wrapper
│        │  └─ tesla/             # adapter, oauth, capability registry, mock (TASK-15)
│        ├─ services/
│        │  ├─ tokens/            # encryption, refresh (TASK-15)
│        │  ├─ ingestion/         # live + historical sync, rollups (TASK-16)
│        │  ├─ commands/          # command lifecycle (TASK-17)
│        │  └─ automation/        # scheduler, rules, locks (TASK-18)
│        ├─ db/                   # user-scoped and service clients (documented use)
│        └─ lib/                  # errors, logging (redacting), config
├─ packages/
│  ├─ shared/                     # types, Zod schemas, constants. NO logic, NO I/O
│  │  └─ src/
│  │     ├─ schemas/ types/ constants/
│  │     └─ db/database.types.ts  # generated; never hand-edited
│  └─ domain/                     # pure energy logic, deterministic, no I/O
│     └─ src/
│        ├─ telemetry/            # normalisers, quality utils, provider interface (TASK-08)
│        ├─ tariff/               # tariff engine (TASK-10)
│        ├─ accounting/           # energy and financial accounting (TASK-11)
│        └─ fixtures/             # DEMO datasets, tariff fixtures, golden values
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/                 # versioned SQL only (TASK-03, 04, 16)
│  ├─ tests/                      # pgTAP security tests (TASK-04)
│  └─ seed.sql                    # local-only, labelled
├─ e2e/                           # Playwright (from TASK-07)
├─ scripts/                       # dev and ops helper scripts
└─ docs/
   ├─ ai-build-kit/               # this kit (instructions)
   │  ├─ 00-README.md … 04-REPO-STRUCTURE.md
   │  └─ tasks/TASK-00 … TASK-21
   ├─ handoffs/                   # TASK-NN.md reports
   ├─ research/                   # TASK-00 outputs
   └─ *.md                        # design and operations docs produced by tasks
```

## 2. Import direction (enforce with lint rules from TASK-02)

| Package | May import | Must not import |
|---|---|---|
| `packages/shared` | nothing app-specific (zod, decimal lib only) | `domain`, `apps/*` |
| `packages/domain` | `shared` | `apps/*`, network, DB, `Date.now()` without an injected clock |
| `apps/web` | `shared`, `domain` | `apps/worker`, service-role keys, Tesla code |
| `apps/worker` | `shared`, `domain` | `apps/web` |

Workspace package names: `@autopw3/shared`, `@autopw3/domain`, `@autopw3/web`, `@autopw3/worker`.

Rules that follow from this:
- One definition of every type and schema, in `packages/shared`.
- Tariff and accounting logic exists once, in `packages/domain`, and is reused by UI, Worker rollups and automation.
- Provider-specific (Tesla) types live only in `apps/worker/src/providers/tesla` and are normalised at that boundary.
- Anything needing time takes an injected clock so tests can use fake time.

## 3. Naming and style
- TypeScript strict. Files `kebab-case.ts`; React components `PascalCase.tsx`; tests next to code as `*.test.ts(x)`.
- Units in names: `solarPowerW`, `energyWh`, `batterySocPercent`, `importRatePerKwh`. DB columns snake_case with units (`solar_power_w`).
- Migrations: `YYYYMMDDHHMMSS_<verb>_<noun>.sql`, never edited after merge; add a new migration instead.
- Env: all variable names listed in `.env.example`; browser-exposed variables use the `VITE_` prefix and must never contain secrets.

## 4. What must never be committed
Real Tesla client secrets or tokens, Supabase service-role key, encryption keys, `.env` files, production database dumps, personal energy data. `.gitignore` and a secrets scan in CI enforce this (TASK-02).

## 5. Git workflow
- `main` is always green and deployable. Branch per task: `task-NN-<slug>`.
- Commits: `task-NN: <imperative summary>`. Small and frequent.
- Open a pull request using the template; paste real check output. Migrations, RLS, tokens, commands and middleware need owner review (CODEOWNERS).
- After merge, tag `task-NN-done`. This gives a rollback point.
- Never force-push `main`. Never merge with a failing security test.

## 6. Where each task writes

| Task | Writes to |
|---|---|
| 00 | `docs/research/` |
| 01 | `docs/*.md` design docs, `docs/DECISIONS.md`; may amend this file |
| 02 | root config, `apps/*`, `packages/*`, `.github/workflows/`, `scripts/` |
| 03 | `supabase/migrations/`, `supabase/seed.sql`, DB docs |
| 04 | `supabase/migrations/`, `supabase/tests/`, RLS docs |
| 05 | `packages/shared/src/` |
| 06 | `apps/web/src/components/ui`, `app`, `styles` |
| 07 | `apps/web/src/features/auth`, `e2e/` |
| 08 | `packages/domain/src/telemetry`, `fixtures` |
| 09 | `apps/web/src/features/live` |
| 10 | `packages/domain/src/tariff` |
| 11 | `packages/domain/src/accounting` |
| 12 | `apps/web/src/features/tariffs` |
| 13 | `apps/web/src/features/analytics` |
| 14 | `apps/worker/src/{routes,middleware,db,lib}` |
| 15 | `apps/worker/src/providers/tesla`, `services/tokens` |
| 16 | `apps/worker/src/services/ingestion`, `supabase/migrations/` |
| 17 | `apps/worker/src/services/commands`, `apps/web/src/features/controls` |
| 18 | `apps/worker/src/services/automation`, `apps/web/src/features/automation` |
| 19 | `apps/web/src/features/admin`, `apps/worker/src/routes/admin` |
| 20 | `docs/` audit and report files; minimal fixes anywhere |
| 21 | `.github/workflows/`, `README.md`, deployment docs |

A task that needs to write outside its paths must say why in its handoff.

## 7. Existing repository content
If AutoPW3 already contains code or a README, do not overwrite it. TASK-02 must first inventory what exists, report it, and either integrate it into this layout or move it to `legacy/` with a note in `docs/DECISIONS.md`.
