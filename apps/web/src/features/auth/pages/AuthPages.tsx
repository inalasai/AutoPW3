import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { Button, buttonClasses } from '../../../components/ui/Button';
import { ErrorBanner, LoadingRegion, Skeleton } from '../../../components/ui/feedback';
import { TextField } from '../../../components/ui/fields';
import { useToast } from '../../../components/ui/toast';
import { useOptionalAuth } from '../AuthProvider';
import { AuthCard, DemoModeSignInNotice } from '../components/AuthCard';
import { readLoginState } from '../redirect';
import { failureMessage } from '../messages';
import { PASSWORD_MIN_LENGTH, isAuthFailure } from '../types';

const LINK = 'text-info underline underline-offset-2';

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function messageFor(error: unknown): string {
  return failureMessage(isAuthFailure(error) ? error.kind : 'unknown');
}

/** Move keyboard focus to the first field that failed validation, so the error is found at once. */
function focusFirstInvalid(ids: ReadonlyArray<string>): void {
  const first = ids.map((id) => document.getElementById(id)).find((element) => element !== null);
  first?.focus();
}

export function LoginPage() {
  const auth = useOptionalAuth();
  const location = useLocation();
  const info = readLoginState(location.state);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (auth === null) return <DemoModeSignInNotice title="Sign in" />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (auth === null) return;
    const next: { email?: string; password?: string } = {};
    if (!looksLikeEmail(email)) next.email = 'Enter your email address.';
    if (password === '') next.password = 'Enter your password.';
    setErrors(next);
    setFormError(null);
    if (next.email !== undefined || next.password !== undefined) {
      focusFirstInvalid([next.email !== undefined ? 'login-email' : '', 'login-password']);
      return;
    }
    setSubmitting(true);
    try {
      await auth.signIn(email.trim(), password);
    } catch (error) {
      setFormError(messageFor(error));
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Sign in" description="Use the email and password of your AutoPW3 account.">
      <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
        {info.reason === 'expired' ? (
          <ErrorBanner
            tone="warning"
            title="Your session has ended"
            message="Sign in again to continue."
          />
        ) : null}
        {formError !== null ? <ErrorBanner title="Could not sign in" message={formError} /> : null}
        <TextField
          id="login-email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          {...(errors.email !== undefined ? { error: errors.email } : {})}
        />
        <TextField
          id="login-password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          {...(errors.password !== undefined ? { error: errors.password } : {})}
        />
        <Button type="submit" loading={submitting}>
          Sign in
        </Button>
      </form>
      <p className="mt-4 text-sm text-ink-muted">
        <Link to="/forgot-password" className={LINK}>
          Forgot your password?
        </Link>
      </p>
      <p className="mt-2 text-sm text-ink-muted">
        New here?{' '}
        <Link to="/register" className={LINK}>
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}

export function RegisterPage() {
  const auth = useOptionalAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (auth === null) return <DemoModeSignInNotice title="Create account" />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (auth === null) return;
    const next: { email?: string; password?: string; confirm?: string } = {};
    if (!looksLikeEmail(email)) next.email = 'Enter a valid email address.';
    if (password.length < PASSWORD_MIN_LENGTH) {
      next.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
    }
    if (confirm !== password) next.confirm = 'The passwords do not match.';
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0) {
      focusFirstInvalid([
        next.email !== undefined ? 'register-email' : '',
        next.password !== undefined ? 'register-password' : '',
        'register-confirm',
      ]);
      return;
    }
    setSubmitting(true);
    try {
      await auth.signUp(email.trim(), password);
      // The same message for a new and an existing address: the form cannot be used to find accounts.
      setDone(true);
    } catch (error) {
      setFormError(messageFor(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthCard title="Create account">
        <div className="grid gap-4">
          <ErrorBanner
            tone="info"
            title="Check your email"
            message="If this address can be registered, we have sent a link to confirm it. Confirm it, then sign in."
          />
          <Link to="/login" className={buttonClasses('primary', 'md', 'w-full')}>
            Go to sign in
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create account"
      description="A new account has no access until a household admin invites you."
    >
      <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
        {formError !== null ? (
          <ErrorBanner title="Could not create the account" message={formError} />
        ) : null}
        <TextField
          id="register-email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          {...(errors.email !== undefined ? { error: errors.email } : {})}
        />
        <TextField
          id="register-password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          {...(errors.password !== undefined ? { error: errors.password } : {})}
        />
        <TextField
          id="register-confirm"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => {
            setConfirm(event.target.value);
          }}
          {...(errors.confirm !== undefined ? { error: errors.confirm } : {})}
        />
        <Button type="submit" loading={submitting}>
          Create account
        </Button>
      </form>
      <p className="mt-4 text-sm text-ink-muted">
        Already have an account?{' '}
        <Link to="/login" className={LINK}>
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const auth = useOptionalAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (auth === null) return <DemoModeSignInNotice title="Reset your password" />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (auth === null) return;
    setFormError(null);
    if (!looksLikeEmail(email)) {
      setError('Enter a valid email address.');
      focusFirstInvalid(['forgot-email']);
      return;
    }
    setError(undefined);
    setSubmitting(true);
    try {
      await auth.requestPasswordReset(email.trim());
      setDone(true);
    } catch (failure) {
      setFormError(messageFor(failure));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email address and we will send a link to choose a new password."
    >
      {done ? (
        <div className="grid gap-4">
          <ErrorBanner
            tone="info"
            title="Check your email"
            message="If an account exists for that address, we have sent a link to reset the password."
          />
          <Link to="/login" className={buttonClasses('secondary', 'md', 'w-full')}>
            Back to sign in
          </Link>
        </div>
      ) : (
        <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
          {formError !== null ? (
            <ErrorBanner title="Could not send the link" message={formError} />
          ) : null}
          <TextField
            id="forgot-email"
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            {...(error !== undefined ? { error } : {})}
          />
          <Button type="submit" loading={submitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

/** Where the emailed reset link lands. The person arrives with a recovery session and chooses a new password. */
export function ResetPasswordPage() {
  const auth = useOptionalAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (auth === null) return <DemoModeSignInNotice title="Choose a new password" />;
  const status = auth.state.status;

  if (status === 'loading') {
    return (
      <AuthCard title="Choose a new password">
        <LoadingRegion label="Checking your reset link">
          <Skeleton className="h-10 w-full" />
        </LoadingRegion>
      </AuthCard>
    );
  }
  if (status === 'unauthenticated' || status === 'expired') {
    return (
      <AuthCard title="Choose a new password">
        <div className="grid gap-4">
          <ErrorBanner
            title="This reset link is not valid"
            message="It may have expired or been used already. Request a new link."
          />
          <Link to="/forgot-password" className={buttonClasses('primary', 'md', 'w-full')}>
            Request a new link
          </Link>
        </div>
      </AuthCard>
    );
  }
  if (status === 'error') {
    return (
      <AuthCard title="Choose a new password">
        <ErrorBanner
          title="Could not check your link"
          message={auth.state.message}
          onRetry={auth.retry}
        />
      </AuthCard>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (auth === null) return;
    const next: { password?: string; confirm?: string } = {};
    if (password.length < PASSWORD_MIN_LENGTH) {
      next.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
    }
    if (confirm !== password) next.confirm = 'The passwords do not match.';
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0) {
      focusFirstInvalid([next.password !== undefined ? 'reset-password' : '', 'reset-confirm']);
      return;
    }
    setSubmitting(true);
    try {
      await auth.updatePassword(password);
      toast.push({ tone: 'success', title: 'Password changed' });
      void navigate('/live', { replace: true });
    } catch (error) {
      setFormError(messageFor(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Choose a new password">
      <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
        {formError !== null ? (
          <ErrorBanner title="Could not change the password" message={formError} />
        ) : null}
        <TextField
          id="reset-password"
          label="New password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          {...(errors.password !== undefined ? { error: errors.password } : {})}
        />
        <TextField
          id="reset-confirm"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => {
            setConfirm(event.target.value);
          }}
          {...(errors.confirm !== undefined ? { error: errors.confirm } : {})}
        />
        <Button type="submit" loading={submitting}>
          Change password
        </Button>
      </form>
    </AuthCard>
  );
}

/** Where the email-confirmation link lands. The identity library finishes the sign-in; this page waits for it. */
export function AuthCallbackPage() {
  const auth = useOptionalAuth();
  if (auth === null) return <DemoModeSignInNotice title="Confirming your email" />;
  switch (auth.state.status) {
    case 'authorised':
    case 'no-household':
      return <Navigate to="/live" replace />;
    case 'loading':
      return (
        <AuthCard title="Confirming your email">
          <LoadingRegion label="Confirming your email">
            <Skeleton className="h-10 w-full" />
          </LoadingRegion>
        </AuthCard>
      );
    default:
      return (
        <AuthCard title="Confirming your email">
          <div className="grid gap-4">
            <ErrorBanner
              tone="warning"
              title="We could not sign you in from this link"
              message="It may have expired, or it was opened in a different browser. If you already confirmed your email, sign in now."
            />
            <Link to="/login" className={buttonClasses('primary', 'md', 'w-full')}>
              Go to sign in
            </Link>
          </div>
        </AuthCard>
      );
  }
}
