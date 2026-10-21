# apps/web — React front end

**Status:** not started (created in TASK-02, shell in TASK-06).

## Purpose
The browser application: routing, layout, feature screens and the design system. It displays data and sends requests; it never decides authorisation.

## Where code goes
| Path | Content | Task |
|---|---|---|
| `src/app/` | Router, providers, layout, route config | 06 |
| `src/components/ui/` | Design system components. No energy logic | 06 |
| `src/features/auth/` | Login, register, session, route guards | 07 |
| `src/features/live/` | Live View: flow model, canvas renderer, battery widget | 09 |
| `src/features/tariffs/` | Tariff manager | 12 |
| `src/features/analytics/` | Charts, summaries, CSV export | 13 |
| `src/features/controls/` | Device control matrix | 17 |
| `src/features/automation/` | Rules and execution history | 18 |
| `src/features/admin/` | Members, invitations, audit viewer | 19 |
| `src/features/settings/` | Site and account settings | 19 |
| `src/lib/` | API client, Supabase client, config | 07 |
| `src/styles/` | Design tokens and Tailwind layers | 06 |

## Rules
- Imports only `@autopw3/shared` and `@autopw3/domain`. Never imports `apps/worker`.
- No service-role keys, no Tesla code, no secrets. `VITE_` variables are public.
- Roles shown in the UI come from the server, never from local storage.
- Demo data is always labelled and shows a visible demo indicator.

## Configuration
`VITE_DEMO_MODE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`. See [`../../.env.example`](../../.env.example).

## Tests
Component and unit tests live next to code as `*.test.tsx`. End-to-end tests are in [`../../e2e`](../../e2e/README.md). See [`../../docs/TESTING.md`](../../docs/TESTING.md).
