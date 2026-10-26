# Household Administration, Audit, and Privacy Operations

AutoPW3 operational runbook for household administrators and privacy operations.

---

## 1. Overview and Authority

In AutoPW3, administrative authority is strictly household-scoped:
- The backend (`apps/worker`) and database row-level security (`supabase/migrations/`) are authoritative. Client-supplied headers, claims, or stored roles are never trusted.
- Roles are structured in monotonic hierarchy: `READ_ONLY` < `READ_WRITE` < `ADMIN`.
- Administrative mutations (changing member roles, removing members, modifying household spend caps or telemetry retention, revoking invitations, and viewing sensitive audit logs) require the `ADMIN` role within the caller's household.
- A user belonging to multiple households has distinct roles per household. Cross-household mutations return HTTP 404 (`NOT_FOUND`) to prevent enumeration.

---

## 2. Household Member Directory & Role Management

### 2.1 Viewing Members
Only users with `ADMIN` role may view the complete member directory:
```http
GET /api/v1/households/{householdId}/members?limit=50
Authorization: Bearer <user_jwt>
```
Response:
```json
{
  "items": [
    {
      "userId": "44444444-4444-4444-8444-444444444444",
      "displayName": "Alice Admin",
      "role": "ADMIN",
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ],
  "nextCursor": null
}
```

### 2.2 Updating Member Roles
```http
PATCH /api/v1/households/{householdId}/members/{userId}
Content-Type: application/json

{ "role": "READ_WRITE" }
```
**Safety Safeguards:**
- **Self-Modification Denial:** An admin cannot demote themselves (`SELF_MODIFICATION`).
- **Last-Admin Protection:** The last remaining active `ADMIN` in a household cannot be demoted or removed (`LAST_ADMIN`, HTTP 409).

### 2.3 Removing a Member
```http
DELETE /api/v1/households/{householdId}/members/{userId}
```
Removes household membership and revokes all household device access immediately.

---

## 3. Invitations Lifecycle

AutoPW3 does not require an outbound SMTP service to onboard members:
1. An `ADMIN` generates an invitation via:
   ```http
   POST /api/v1/households/{householdId}/invitations
   Content-Type: application/json

   {
     "email": "partner@example.com",
     "role": "READ_WRITE",
     "expiresInDays": 7
   }
   ```
2. The server creates an invitation record with a cryptographically secure 256-bit token (`crypto.getRandomValues`). The raw token is displayed once to the admin to copy and share (e.g., `https://autopw3.app/invite/{token}`).
3. The database stores only the SHA-256 hash of the token (`token_hash`).
4. An invitee signs in or registers, visits `/invite/{token}`, and accepts. If an invitee email was specified during creation, acceptance is strictly restricted to that authenticated email address.
5. Pending invitations can be revoked at any time by an admin via `DELETE /api/v1/households/{householdId}/invitations/{invitationId}`.

---

## 4. Audit Log & Compliance

All sensitive actions produce structured, immutable audit log entries:
- **Actions Logged:**
  - `bootstrap.completed`: Initial household and first admin setup
  - `member.added`: New member joined via invitation
  - `member.role_changed`: Member role promoted or demoted
  - `member.removed`: Member removed from household
  - `invitation.created`, `invitation.accepted`, `invitation.revoked`
  - `settings.changed`: Household spend cap, stale threshold, or telemetry retention updated
  - `rule.mode_changed`: Automation rule toggled (`DISABLED`, `DRY_RUN`, `ACTIVE`)
  - `automation.paused`, `automation.resumed`: Emergency pause activated or cleared
  - `command.requested`: Manual control command dispatched
  - `tariff.version_created`, `tariff.deleted`

### 4.1 Viewing Audit Logs
```http
GET /api/v1/households/{householdId}/audit?action=rule.mode_changed&limit=50
Authorization: Bearer <admin_jwt>
```
Audit entries contain `actorType` (`USER` | `SYSTEM`), `actorUserId`, `targetType`, `targetId`, `metadata`, `requestId`, and ISO-8601 timestamp. Credentials, passwords, and tokens are strictly excluded and never recorded in metadata.

---

## 5. Household Settings & Fleet API Link

Administrators configure household-level operational boundaries via `PATCH /api/v1/households/{householdId}/settings`:
- **Monthly Spend Cap (`capUsd`):** Estimated ceiling on Tesla Fleet API query charges (defaults to $9.00 USD, staying within Tesla's $10 monthly discount).
- **Stale Data Threshold (`staleAfterSeconds`):** Maximum acceptable telemetry age (minimum 300s, must exceed the background ingestion interval).
- **Raw Telemetry Retention (`rawRetentionDays`):** Retention period for high-frequency Powerwall telemetry (minimum 90 days). Older samples are purged by scheduled jobs.
- **Controls Enabled (`controlsEnabled`):** Global switch governing hardware controls. When false, all device control requests are blocked.
- **Tesla Fleet Disconnect:** Admins can disconnect Tesla authorization via `POST /api/v1/households/{householdId}/provider/tesla/disconnect`, purging all encrypted tokens immediately.

---

## 6. Privacy & GDPR Compliance

AutoPW3 adheres to GDPR Article 17 (Right to Erasure) and Article 20 (Data Portability):

### 6.1 Data Portability (Article 20)
- **Household Data Export (`GET /api/v1/households/{householdId}/export`):**
  Admins can export all household data as a clean, structured JSON file. Includes household metadata, member list (names, roles, join dates), current settings, automation rules, tariffs, and sanitized audit trail.
- **Personal Account Export (`GET /api/v1/me/export`):**
  Any user can export their personal account data, profile details, and list of household memberships.

### 6.2 Right to Erasure / Account Deletion (Article 17)
- **Leave Household (`DELETE /api/v1/me/memberships/{householdId}`):**
  A member can leave a household voluntarily. If the user is the last active `ADMIN` and other members remain, departure is blocked until another admin is designated.
- **Delete Account (`DELETE /api/v1/me`):**
  Permanently erases the user's account and personal profile. Requires `{ "confirm": true }`. Blocked if the user is the sole admin of an active multi-member household.
- **Delete Household (`DELETE /api/v1/households/{householdId}`):**
  Admins can permanently erase an entire household. Requires typed name confirmation matching the exact household name (`{ "confirmName": "<householdName>" }`). Irrevocably purges all telemetry, tariffs, automation rules, member associations, and encrypted credentials.
