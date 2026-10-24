import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { GlassCard } from '../../../components/ui/display';
import { ErrorBanner } from '../../../components/ui/feedback';
import { buttonClasses } from '../../../components/ui/Button';
import { useDocumentTitle } from '../../../app/pages/Page';

/** Card used by every sign-in related page: the page `h1` (focus target), a description, then the content. */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  useDocumentTitle(title);
  return (
    <GlassCard>
      <h1 id="page-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight">
        {title}
      </h1>
      {description !== undefined ? (
        <p className="mb-4 mt-1 text-sm text-ink-muted">{description}</p>
      ) : null}
      <div className={description === undefined ? 'mt-4' : undefined}>{children}</div>
    </GlassCard>
  );
}

/** Shown on the sign-in pages in demo mode, where nobody signs in. */
export function DemoModeSignInNotice({ title }: { title: string }) {
  return (
    <AuthCard title={title}>
      <div className="grid gap-4">
        <ErrorBanner
          tone="info"
          title="Sign-in is off in demo mode"
          message="Demo mode shows synthetic data only and needs no account. Real sites need sign-in to be configured."
        />
        <Link to="/live" className={buttonClasses('primary', 'md', 'w-full')}>
          Explore the demo
        </Link>
      </div>
    </AuthCard>
  );
}
