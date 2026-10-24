import { GlassCard } from '../components/ui/display';
import { ErrorBanner } from '../components/ui/feedback';

/**
 * Shown instead of the app when it cannot start safely, for example when live mode has no sign-in settings.
 * The message names the settings, never their values, so it is safe to display.
 */
export function StartupError({ message }: { message: string }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <GlassCard>
        <h1 className="text-2xl font-semibold tracking-tight">AutoPW3 cannot start</h1>
        <div className="mt-4">
          <ErrorBanner title="Configuration problem" message={message} />
        </div>
        <p className="mt-4 text-sm text-ink-muted">
          If you run this app, see docs/AUTHENTICATION_SETUP.md. If someone else runs it, tell them
          about this message.
        </p>
      </GlassCard>
    </main>
  );
}
