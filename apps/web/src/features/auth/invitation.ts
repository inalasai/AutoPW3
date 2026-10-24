import { InvitationTokenSchema } from '@autopw3/shared';

/**
 * Find an invitation token in what a person pasted: the whole link (`https://…/invite/<token>`) or the token
 * alone. Returns `null` if there is no well-formed token (64 lowercase hex characters).
 */
export function extractInvitationToken(input: string): string | null {
  const text = input.trim();
  const direct = InvitationTokenSchema.safeParse(text);
  if (direct.success) return direct.data;
  const match = /\/invite\/([^/?#\s]+)/.exec(text);
  const candidate = match?.[1];
  if (candidate === undefined) return null;
  const parsed = InvitationTokenSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
