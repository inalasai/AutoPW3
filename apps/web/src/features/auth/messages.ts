import { PASSWORD_MIN_LENGTH } from './types';
import type { AuthFailureKind } from './types';

/**
 * What to tell the person for each failure kind. One wording per kind, so the same message appears whether an
 * address exists or not (no account enumeration): a wrong password and an unknown address both read as
 * "email or password is not correct", and an invitation that is expired, used, withdrawn or unknown reads the same.
 */
export function failureMessage(kind: AuthFailureKind): string {
  switch (kind) {
    case 'invalid_credentials':
      return 'The email or password is not correct.';
    case 'email_not_confirmed':
      return 'Confirm your email address first: use the link in the email we sent, then sign in.';
    case 'weak_password':
      return `Choose a longer or less common password. It needs at least ${PASSWORD_MIN_LENGTH} characters.`;
    case 'same_password':
      return 'Choose a password that is different from your current one.';
    case 'invalid_input':
      return 'Check the email address and try again.';
    case 'rate_limited':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'network':
      return 'We could not reach the server. Check your connection and try again.';
    case 'expired_session':
      return 'Your session has ended. Sign in again.';
    case 'invalid_invitation':
      return 'This invitation is not valid. It may have expired, been used already, or been withdrawn. Ask the household admin for a new one.';
    case 'not_authorised':
      return 'You are not allowed to do that.';
    case 'unknown':
      return 'Something went wrong. Try again.';
  }
}
