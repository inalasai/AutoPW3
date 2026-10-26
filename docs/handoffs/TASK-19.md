# AutoPW3 — Task Handoff Report

## Task completed
Number and name: TASK-19 Administration, Invitations, Audit, and Privacy Operations
Branch / commit: `Sai-AutoPW3`
Date: 2026-10-26

## Summary
The administration, member directory, invitations lifecycle, immutable audit logging, settings management, and GDPR privacy operations (Articles 17 and 20) have been fully implemented, tested, and verified. Administrative authorization is strictly household-scoped and authoritative: the backend (`apps/worker`) and database RLS verify roles per household; client-supplied headers, claims, or stored roles are never trusted. Mutations (`PATCH /members`, `DELETE /members`, `PATCH /settings`, `DELETE /invitations`, `DELETE /households`) strictly require the `ADMIN` role. Critical safety invariants are enforced: an admin cannot demote themselves (`SELF_MODIFICATION`), and the last active `ADMIN` in a household cannot be demoted or removed (`LAST_ADMIN`, HTTP 409). Member invitations generate cryptographically secure 256-bit random tokens (`crypto.getRandomValues`) with raw tokens displayed once to the inviter and stored exclusively as SHA-256 hashes (`token_hash`) in the database, allowing zero-SMTP onboarding. A comprehensive audit trail logs all security and operational actions with sensitive token redaction. GDPR compliance operations provide structured JSON exports for households and personal accounts (Article 20 Data Portability), and atomic Right to Erasure workflows (Article 17) requiring typed household name confirmation (`confirmName`) to delete a household. The glassmorphic `AdminPanel` cockpit unites member management, invitations, audit history, household settings (spend cap, telemetry retention), and privacy operations across `/admin` and `/settings` routes.

## Files created
| Path | Purpose |
|---|---|
| `apps/worker/src/routes/admin.ts` | Route handlers for member management, invitations, audit log listing, settings updates, data exports, household deletion, account deletion, and leaving households |
| `apps/worker/src/routes/admin.test.ts` | Integration unit tests verifying ADMIN role enforcement, last-admin protection, self-demotion denial, cross-field settings validation, audit filtering, export data sanitisation, and typed name deletion confirmation (9 tests) |
| `apps/web/src/features/admin/types.ts` | Data models and view interfaces for members, invitations, audit rows, settings, Tesla link status, and admin tabs |
| `apps/web/src/features/admin/use-admin.ts` | Custom React hook managing administrative operations, members, invitations, audit query, settings form, Tesla disconnect, and JSON blob export triggers |
| `apps/web/src/features/admin/MemberList.tsx` | Accessible table of household members with text search, role filter, inline role modification modal, removal confirmation, and self/last-admin safeguards |
| `apps/web/src/features/admin/InviteMemberModal.tsx` | Accessible modal form for generating member invitations with email restriction, role assignment, expiration choice, and one-click copyable invite link |
| `apps/web/src/features/admin/InvitationList.tsx` | Table of pending and expired household invitations with token link copying and revocation actions |
| `apps/web/src/features/admin/AuditLogViewer.tsx` | Comprehensive audit trail table with action filter dropdown, search filter, formatted timestamps, actor/target badges, and structured metadata modal |
| `apps/web/src/features/admin/SettingsManager.tsx` | Operational settings form (monthly spend cap in USD, stale data threshold, raw telemetry retention days, remote controls toggle) and Tesla connection status with disconnect confirmation |
| `apps/web/src/features/admin/PrivacySection.tsx` | GDPR compliance center providing Article 20 JSON exports for household and personal account data, voluntary household departure, account erasure, and confirmed household deletion requiring typed name matching |
| `apps/web/src/features/admin/AdminPanel.tsx` | Main administration cockpit uniting all tabs with `Tabs` navigation, role gating notices, and error banners |
| `apps/web/src/features/admin/AdminPanel.test.tsx` | Unit tests verifying admin cockpit rendering, search filtering, invite creation, audit tab switching, settings form, privacy export buttons, and role restrictions (9 tests) |
| `apps/web/src/features/admin/index.ts` | Barrel export for admin feature |
| `e2e/admin.spec.ts` | Playwright E2E smoke tests for READ_ONLY blocking on `/admin`, ADMIN access to all tabs and invite generation, and READ_ONLY access to `/settings` across desktop and mobile (6 tests) |
| `docs/ADMINISTRATION.md` | Operational runbook for household administration, member directory, invitations lifecycle, audit logging, and GDPR privacy operations |
| `docs/handoffs/TASK-19.md` | This task handoff report |

## Files modified
| Path | What changed and why |
|---|---|
| `apps/worker/src/db/repository.ts` | Extended `Repository` interface and `InMemoryRepository` with `removeMember`, `updateHousehold`, `updateSite`, `updateSettings`, `listAudit`, `recordAuditEvent`, `exportHouseholdData`, `deleteHousehold`, `exportMe`, `deleteAccount`, `leaveHousehold`, and seeded default household settings and audit records |
| `apps/worker/src/lib/app.ts` | Mounted routes for admin and privacy endpoints; added `DELETE` method to request body reading for `confirmName` and `confirm` JSON payloads |
| `apps/web/src/app/pages/AppPages.tsx` | Connected `/admin` and `/settings` routes to `<AdminPanel />` with appropriate default tabs and page titles; wired `useDocumentTitle` |
| `docs/DECISIONS.md` | Appended decisions D-107 (Authoritative household-scoped administration and last-admin invariant) and D-108 (Cryptographic invitation tokens and GDPR compliance operations) |
| `docs/KNOWN_LIMITATIONS.md` | Appended limitations L-114 (Admin manual invitation link sharing in v1) and L-115 (Process tracking) |
| `docs/ai-build-kit/00-README.md` | Marked TASK-19 complete in the project roadmap |

## Decisions
- **D-107 Authoritative household-scoped administration and last-admin invariant**: Administrative authority is strictly scoped to the household where the caller holds `ADMIN` membership; client-provided roles or tokens are never trusted. Self-demotion is rejected (`SELF_MODIFICATION`), and the last active `ADMIN` in a household cannot be demoted or removed (`LAST_ADMIN`, HTTP 409) to ensure households are never orphaned.
- **D-108 Cryptographic invitation tokens and GDPR compliance operations**: Member invitations use random 256-bit entropy tokens (`crypto.getRandomValues`) with raw tokens displayed once to the inviter and stored exclusively as SHA-256 hashes (`token_hash`) in the database. Full GDPR Article 20 data portability is provided via sanitized JSON exports (`/households/{id}/export` and `/me/export`) with zero credentials or tokens leaked. Right to Erasure (Article 17) provides atomic, confirmed erasure requiring exact typed household name matching (`confirmName`) for household deletion and `confirm: true` for account deletion, with last-admin guardrails enforced.

## Database changes
- Utilizes existing database schema defined in Task 03 (`household_members`, `invitations`, `audit_log`, `household_settings`, `households`).
- `removeMember` and `changeMemberRole` enforce the `last-admin` check preventing removal or demotion of the sole remaining `ADMIN`.
- `deleteHousehold` performs cascading removal of telemetry, tariffs, automation rules, member associations, and credentials.

## API changes
- `GET /api/v1/households/{householdId}/members`: Lists members of the household. Requires `ADMIN`.
- `PATCH /api/v1/households/{householdId}/members/{userId}`: Changes member role. Requires `ADMIN`. Rejects self-demotion (`SELF_MODIFICATION`) and last-admin demotion (`LAST_ADMIN`).
- `DELETE /api/v1/households/{householdId}/members/{userId}`: Removes member from household. Requires `ADMIN`. Rejects self-removal and last-admin removal.
- `GET /api/v1/households/{householdId}/invitations`: Lists pending and expired household invitations. Requires `ADMIN`.
- `POST /api/v1/households/{householdId}/invitations`: Creates an invitation with a random 256-bit token; returns raw token once. Requires `ADMIN`.
- `DELETE /api/v1/households/{householdId}/invitations/{invitationId}`: Revokes an active invitation. Requires `ADMIN`.
- `GET /api/v1/households/{householdId}/audit`: Retrieves paginated, filtered audit log entries. Requires `ADMIN`.
- `GET /api/v1/households/{householdId}/settings`: Retrieves household operational settings and spend cap. Requires membership.
- `PATCH /api/v1/households/{householdId}/settings`: Updates spend cap, stale threshold, retention days, or controls switch. Requires `ADMIN`.
- `POST /api/v1/households/{householdId}/provider/tesla/disconnect`: Disconnects Tesla link and purges tokens. Requires `ADMIN`.
- `GET /api/v1/households/{householdId}/export`: Exports sanitized household data JSON (GDPR Art. 20). Requires `ADMIN`.
- `DELETE /api/v1/households/{householdId}`: Permanently deletes household with typed name confirmation `{ "confirmName": "<name>" }` (GDPR Art. 17). Requires `ADMIN`.
- `GET /api/v1/me/export`: Exports caller's personal account data JSON (GDPR Art. 20). Requires authentication.
- `DELETE /api/v1/me`: Permanently erases user account `{ "confirm": true }` (GDPR Art. 17). Rejects if sole admin of a multi-member household.
- `DELETE /api/v1/me/memberships/{householdId}`: Member voluntarily leaves a household. Rejects if sole admin of a multi-member household.

## Checks executed
| Exact command | Executed? (yes/no) | Result | Relevant output/failure |
|---|---|---|---|
| `npm run typecheck` | yes | PASSED | Strict TypeScript check passed across all packages (`shared`, `domain`, `web`, `worker`, `e2e`) |
| `npm run lint` | yes | PASSED | ESLint, architecture rules (no floats for money, boundaries), and Prettier format passed |
| `npm test` | yes | PASSED | 532 web tests + 146 worker tests + domain/shared tests (678 total tests passing) |
| `npm run build` | yes | PASSED | Vite web build + Cloudflare Worker bundle dry-run deploy succeeded |
| `npm run secrets:scan` | yes | PASSED | Secretlint found 0 secrets |
| `npm run test:e2e` | yes | PASSED | All 38/38 Playwright tests passed (desktop & mobile) across all features |

## Verification and Acceptance Criteria
1. **Authoritative Access Control:** `/admin` route is guarded on client and server. Non-admin users are blocked from administrative mutations with HTTP 403 or rendered `<UnauthorisedPage />`.
2. **Last-Admin Safeguard:** Unit and integration tests prove that demoting or removing the sole admin of a household returns `LAST_ADMIN` / 409 conflict and is blocked.
3. **Cryptographic Invitations:** Invites generate 256-bit cryptographically secure tokens. Tokens are displayed once and stored exclusively as SHA-256 hashes.
4. **Audit Visibility and Sanitization:** Audit log entries record action, actor, target, and metadata. Sensitive credentials and tokens are strictly excluded.
5. **GDPR Operations:** Household and account JSON exports generate sanitized data. Right to Erasure requires explicit confirmation payload and validates against orphaning.
6. **E2E Smoke Tests:** Playwright tests verify desktop and mobile user journeys for admin operations, role gating, and settings navigation.
