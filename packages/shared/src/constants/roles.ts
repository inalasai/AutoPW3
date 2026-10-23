/**
 * Household roles (decision D-004, docs/SECURITY_MODEL.md section 2).
 * This is the only definition of the role names. The backend and database are
 * authoritative; the browser never decides authorisation.
 */
export const ROLES = ['READ_ONLY', 'READ_WRITE', 'ADMIN'] as const;

export type Role = (typeof ROLES)[number];

/** Role assigned to every new membership unless a household ADMIN grants more. */
export const DEFAULT_ROLE: Role = 'READ_ONLY';
