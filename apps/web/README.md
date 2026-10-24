# apps/web — React front end

**Status:** design system and application shell done (TASK-06): tokens and effects switch, UI components, responsive shell, routing with placeholder pages, demo banner. Pages hold no data, authentication or charts yet; features arrive in TASK-07 onward. Component catalogue at `/dev/components` in `npm run dev` only. See [`../../docs/DESIGN_SYSTEM.md`](../../docs/DESIGN_SYSTEM.md). Run with `npm run dev` (see `docs/DEVELOPMENT_SETUP.md`).

## Purpose
The browser application: routing, layout, feature screens and the design system. It displays data and sends requests; it never decides authorisation.

## Where code goes
| Path | Content | Task |
|---|---|---|
| `src/app/` | `App` (adds `BrowserRouter`), `AppFrame` (providers and routes, used by tests), `routes.ts` (route inventory as data), `effects.tsx`, `shell/` (header, sidebar, mobile menu), `pages/` (placeholders), `dev/` (dev-only catalogue) | 06 |
| `src/components/ui/` | Design system components. No energy logic | 06 |
| `src/test/` | `renderApp` and axe helpers for component tests | 06 |
| `src/features/auth/` | Login, register, session, route guards | 07 |
| `src/features/live/` | Live View: flow model, canvas renderer, battery widget | 09 |
| `src/features/tariffs/` | Tariff manager | 12 |
| `src/features/analytics/` | Charts, summaries, CSV export | 13 |
| `src/features/controls/` | Device control matrix | 17 |
| `src/features/automation/` | Rules and execution history | 18 |
| `src/features/admin/` | Members, invitations, audit viewer | 19 |
| `src/features/settings/` | Site and account settings | 19 |
| `src/lib/` | API client, Supabase client, config. `api-contract.ts` (TASK-05) builds paths and validates responses from the shared `ROUTES` table | 05, 07 |
| `src/styles/` | Design tokens and Tailwind layers | 06 |

## Rules
- Imports only `@autopw3/shared` and `@autopw3/domain`. Never imports `apps/worker`.
- No service-role keys, no Tesla code, no secrets. `VITE_` variables are public.
- Roles shown in the UI come from the server, never from local storage. Nav hiding is a hint only (`visibleNavRoutes`).
- Components in `components/ui` receive formatted strings; no energy calculations, Tesla code or fetching there.
- Effects (glow, blur, animation) are controlled only by `<html data-effects>`; never hard-code a glow.
- Demo data is always labelled and shows a visible demo indicator.

## Configuration
`VITE_DEMO_MODE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`. See [`../../.env.example`](../../.env.example).

## Tests
Component and unit tests live next to code as `*.test.tsx`. End-to-end tests are in [`../../e2e`](../../e2e/README.md). See [`../../docs/TESTING.md`](../../docs/TESTING.md).
