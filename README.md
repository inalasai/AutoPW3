# AutoPW3

Subscription-free residential energy management for Tesla Powerwall sites: live energy-flow view, tariff-aware analytics, supported device controls and safe automation.

> **Status: pre-alpha, skeleton.** The toolchain and an empty application shell exist (TASK-02); no product features yet. The project is built in small, verifiable tasks driven by the [AI build kit](docs/ai-build-kit/00-README.md). Progress is tracked there.

## Planned features
- Animated live view of solar, battery, home and grid power.
- Historical analytics with import cost, export revenue and savings, using real tariff rules (day/night, weekday/weekend, seasonal, dynamic, VAT, standing charge).
- Tariff manager with validation, versioning and DST-correct schedules.
- Device controls limited to operations the Tesla Fleet API documents and the site supports.
- Tariff-aware automation that defaults to dry-run.
- Household roles (`READ_ONLY`, `READ_WRITE`, `ADMIN`), invitations and full audit log.

## Tech stack
React, TypeScript, Vite, Tailwind CSS · Cloudflare Workers · Supabase (Auth, PostgreSQL, Row Level Security) · Tesla Fleet API · Recharts · HTML5 Canvas · Vitest, React Testing Library, Playwright, pgTAP.

## Repository map

| Path | Purpose | Details |
|---|---|---|
| [`apps/web`](apps/web/README.md) | React front end | UI, routing, feature modules |
| [`apps/worker`](apps/worker/README.md) | Cloudflare Worker | API, Tesla adapter, ingestion, automation |
| [`packages/shared`](packages/shared/README.md) | Types and Zod schemas | One source of truth, no logic |
| [`packages/domain`](packages/domain/README.md) | Pure energy logic | Telemetry, tariff engine, accounting |
| [`supabase`](supabase/README.md) | Database | Migrations, RLS, SQL tests, seed |
| [`e2e`](e2e/README.md) | End-to-end tests | Playwright |
| [`scripts`](scripts/README.md) | Helper scripts | Dev and ops |
| [`docs`](docs/README.md) | Documentation | Design, operations, handoffs |
| [`docs/ai-build-kit`](docs/ai-build-kit/00-README.md) | Build instructions | 22 phased tasks |

## Getting started
Requires Node.js 22 or newer. Details: [docs/DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md).

```bash
npm install
npm run typecheck && npm run lint && npm test && npm run build
npm run dev           # web app in demo mode, no credentials needed
npm run dev:worker    # Worker on http://localhost:8787 (run the web build first)
```

The app is designed to run locally in **demo mode** with synthetic, clearly labelled data and no Tesla or production database credentials.

## Configuration and credentials
Copy `.env.example` to `.env.local` (web) and `apps/worker/.dev.vars` (Worker) and fill in values. **Never commit real credentials.** Full guidance, including where every secret lives in production: [docs/CREDENTIALS.md](docs/CREDENTIALS.md).

## Testing
Unit, component, API, database security and end-to-end tests, with mocks before any real hardware. See [docs/TESTING.md](docs/TESTING.md).

## Contributing and workflow
One task per branch (`task-NN-<slug>`), pull request with the template, handoff report per task. See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) for AI agents.

## Security
Report vulnerabilities privately; see [SECURITY.md](SECURITY.md). Design: roles per household, RLS everywhere, Tesla tokens encrypted server-side, demo data isolated from live data.

## License
No license has been chosen yet. Until the owner adds one, all rights are reserved.
