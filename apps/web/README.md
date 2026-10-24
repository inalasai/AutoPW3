# apps/web — React front end

**Status:** design system and application shell done (TASK-06); authentication and permission-aware UI done (TASK-07): Supabase Auth adapter, dev-only mock adapter, route guards, role-aware nav, waiting-for-invitation and unauthorised pages. Pages hold no data or charts yet; features arrive in TASK-08 onward. Sign-in setup: [`../../docs/AUTHENTICATION_SETUP.md`](../../docs/AUTHENTICATION_SETUP.md). Component catalogue at `/dev/components` in `npm run dev` only. See [`../../docs/DESIGN_SYSTEM.md`](../../docs/DESIGN_SYSTEM.md). Run with `npm run dev` (see `docs/DEVELOPMENT_SETUP.md`).

## Purpose
The browser application: routing, layout, feature screens and the design system. It displays data and sends requests; it never decides authorisation.

## Where code goes
| Path | Content | Task |
|---|---|---|
| `src/app/` | `App` (adds `BrowserRouter`), `AppFrame` (providers and routes, takes the `AuthClient`; used by tests), `routes.ts` (route inventory as data), `StartupError.tsx`, `effects.tsx`, `shell/` (header, sidebar, mobile menu), `pages/` (placeholders), `dev/` (dev-only catalogue) | 06, 07 |
| `src/components/ui/` | Design system components. No energy logic | 06 |
| `src/test/` | `renderApp` (takes `account: Role \| 'NO_HOUSEHOLD' \| null`) and axe helpers for component tests | 06, 07 |
| `src/features/auth/` | Public API in `index.ts`: `AuthProvider`, `useAuth`, `usePermissions`, `RequireSession`, `RequireRole`, `PublicOnly`, `WriteButton`, `ReadOnlyNotice`, `AccountControls`, `createAuthClient`. `supabase-client.ts` is the live adapter (lazy loaded); `mock/` is the development-only adapter (never in a production build); pages in `pages/` | 07 |
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
- Roles shown in the UI come from the server (the RLS-protected `household_members` query), never from local storage, JWT claims or user metadata. Nav hiding, route guards and disabled controls are hints only; the Worker and database authorise.
- Never write an error message that distinguishes "no such account" from "wrong password" (no account enumeration). Messages for each failure kind live in `features/auth/messages.ts`.
- Do not import `mock/` or `supabase-client.ts` outside `features/auth/create-client.ts` and tests.
- Components in `components/ui` receive formatted strings; no energy calculations, Tesla code or fetching there.
- Effects (glow, blur, animation) are controlled only by `<html data-effects>`; never hard-code a glow.
- Demo data is always labelled and shows a visible demo indicator.

## Configuration
`VITE_DEMO_MODE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`, and (development only) `VITE_AUTH_MODE=mock`. `src/lib/config.ts` validates them and refuses privileged keys. See [`../../.env.example`](../../.env.example).

## Tests
Component and unit tests live next to code as `*.test.tsx`. End-to-end tests are in [`../../e2e`](../../e2e/README.md). See [`../../docs/TESTING.md`](../../docs/TESTING.md).
