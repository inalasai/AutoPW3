import { useId } from 'react';
import { Button } from '../../components/ui/Button';
import type { ButtonProps } from '../../components/ui/Button';
import { ErrorBanner } from '../../components/ui/feedback';
import { useOptionalAuth, usePermissions } from './AuthProvider';

/**
 * Explains that the person can look but not change anything. It is shown only to a signed-in READ_ONLY person.
 * This is a courtesy: the Worker and the database refuse writes from anyone without the role, whatever this page shows.
 */
export function ReadOnlyNotice({ what = 'make changes' }: { what?: string }) {
  const auth = useOptionalAuth();
  const { role } = usePermissions();
  if (auth === null || role !== 'READ_ONLY') return null;
  return (
    <ErrorBanner
      tone="info"
      title="You have read-only access"
      message={`You can view this page, but you cannot ${what}. Ask a household admin if you need edit access. The server checks this too.`}
    />
  );
}

/**
 * A button for an action that needs READ_WRITE or ADMIN. For anyone else it is disabled and says why next to it.
 * In demo mode every write is off. Disabling here is a hint: it is not what stops the action.
 */
export function WriteButton(props: ButtonProps) {
  const auth = useOptionalAuth();
  const { canWrite } = usePermissions();
  const reasonId = useId();
  if (canWrite) return <Button {...props} />;
  const reason =
    auth === null
      ? 'Demo mode: changes are switched off.'
      : 'Read-only access: you cannot make changes.';
  return (
    <div className="flex flex-col items-start gap-1">
      <Button {...props} disabled aria-describedby={reasonId} />
      <p id={reasonId} className="text-xs text-ink-muted">
        {reason}
      </p>
    </div>
  );
}
