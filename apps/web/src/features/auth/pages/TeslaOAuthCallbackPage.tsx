import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useOptionalAuth } from '../AuthProvider';

/** The Tesla navigation cannot supply a bearer. Complete only with this browser's current session. */
export function TeslaOAuthCallbackPage() {
  const auth = useOptionalAuth();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const completion = useRef<Promise<void> | null>(null);
  useEffect(() => {
    if (auth?.state.status === 'loading') return;
    if (completion.current) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    // Strip the authorization code immediately. It is never put in storage or UI text.
    window.history.replaceState(null, '', window.location.pathname);
    const state = params.get('tesla_state');
    const code = params.get('tesla_code');
    if (
      !auth ||
      auth.state.status !== 'authorised' ||
      !state ||
      (!code && params.get('tesla_error') !== 'authorization_denied')
    ) {
      setFailed(true);
      return;
    }
    completion.current = auth.completeTeslaOAuth(
      code ? { state, code } : { state, error: 'authorization_denied' },
    );
    void completion.current.then(
      () => {
        void navigate('/settings?tesla=connected', { replace: true });
      },
      () => {
        setFailed(true);
      },
    );
  }, [auth, navigate]);
  return (
    <div role="status">
      {failed ? (
        <>
          <p>
            Tesla connection was not completed. Sign in with the initiating account and start a new
            connection.
          </p>
          <Link to="/settings">Return to settings</Link>
        </>
      ) : (
        <p>Completing Tesla connection…</p>
      )}
    </div>
  );
}
