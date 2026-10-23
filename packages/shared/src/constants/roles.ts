/**
 * Household roles (decision D-004, docs/SECURITY_MODEL.md section 2).
 * This is the only definition of the role names. The backend and database are
 * authoritative; the browser never decides authorisation.
 */
export const ROLES = ['READ_ONLY', 'READ_WRITE', 'ADMIN'] as const;

export type Role = (typeof ROLES)[number];

/** Role assigned to every new membership unless a household ADMIN grants more. */
export const DEFAULT_ROLE: Role = 'READ_ONLY';

const ROLE_RANK: Readonly<Record<Role, number>> = {
  READ_ONLY: 1,
  READ_WRITE: 2,
  ADMIN: 3,
};

/**
 * True when `role` is at least `minimum`. For hiding or disabling controls and for tests only:
 * the Worker and the database re-check every action (`private.has_role_at_least`).
 */
export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}
