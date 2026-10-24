/**
 * A path to return to after signing in, taken from router state. Only same-site paths are accepted, so a crafted
 * link cannot send someone to another site after they sign in (open redirect).
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  // Control characters (tab, newline and the like) are never part of a path the app produced.
  for (const char of value) {
    if (char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f) return null;
  }
  return value;
}

/** What the sign-in page is told when a guard sends someone there. */
export interface LoginRedirectState {
  from: string;
  reason: 'signed-out' | 'expired';
}

/** Read router state defensively: anything unexpected is ignored. */
export function readLoginState(state: unknown): Partial<LoginRedirectState> {
  if (typeof state !== 'object' || state === null) return {};
  const record = state as Record<string, unknown>;
  const from = safeReturnPath(record['from']);
  const reason = record['reason'];
  return {
    ...(from !== null ? { from } : {}),
    ...(reason === 'expired' || reason === 'signed-out' ? { reason } : {}),
  };
}
