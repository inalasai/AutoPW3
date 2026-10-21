# TASK 06 — Design System and Application Shell

**Phase 2 · Frontend foundation.**

## Goal
Implement the AutoPW3 visual identity and layout without any energy logic.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md` (visual identity), `docs/SYSTEM_ARCHITECTURE.md`, `docs/handoffs/TASK-05.md`, the repo. Before designing, read `/mnt/skills/public/frontend-design/SKILL.md` if your tool provides skills; otherwise apply its principle: distinctive and coherent, not template-like.

## Stop conditions
- Needing energy calculations or Tesla commands inside design components: stop; that belongs elsewhere.

## Plan step
Describe design tokens, component inventory and page layout, and how reduced-motion and contrast will be handled.

## Requirements
- Design tokens (colours from the identity, spacing, typography, radii, glow levels) in Tailwind config / CSS variables. Glow effects can be turned off through a single switch and the UI stays readable.
- Components: app shell, responsive header, sidebar/mobile navigation, page title and status, cards (glass panels), buttons, inputs, selects, tabs/segmented controls, skeleton loaders, empty states, error banners, confirmation dialogs, tooltips, toasts, accessible tables, connection and data-freshness indicators, **demo-mode banner/indicator**.
- Routes with structured placeholder pages: `/login`, `/register`, `/live`, `/analytics`, `/tariffs`, `/automation`, `/controls`, `/admin`, `/settings`, plus a not-found page.
- Accessibility: keyboard navigation, focus rings, ARIA roles for dialogs/tabs/tables, WCAG AA contrast for text, `prefers-reduced-motion` respected.
- Responsive with mobile-safe overflow; no horizontal page scroll at 360px.
- Monospace for telemetry values.

## Out of scope
Auth logic, data fetching, charts, energy calculations.

## Deliverables
Tokens, components, layout, route config, page skeletons, component tests, `docs/DESIGN_SYSTEM.md` (including a component catalogue page route such as `/dev/components`, available only in development).

## Verification
Type check, lint, tests, build. Run the app and report what you actually inspected at mobile and desktop widths. Add axe-based accessibility tests if feasible.

## Acceptance criteria
- All routes render; mobile navigation opens, closes and is keyboard operable.
- Demo indicator is visible when demo mode is on.
- UI is readable with glow and animation disabled.
- Component tests pass.

## Repo locations
Branch: `task-06-design-system-shell`. Commit prefix: `task-06:`. Write to: `apps/web/src/components/ui`, `apps/web/src/app`, `apps/web/src/styles`, `docs/DESIGN_SYSTEM.md`. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-06.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-06.md`.
