import { useEffect, useRef, useState } from 'react';
import type { DiscoveredSite, TeslaSiteLinkResponse } from '@autopw3/shared';
import { Button } from '../../components/ui/Button';
import { GlassCard } from '../../components/ui/display';
import { useOptionalAuth } from '../auth/AuthProvider';
import { TeslaSiteFailure } from '../auth/tesla-sites';
import type { TeslaSiteActions } from '../auth/tesla-sites';

function failureMessage(error: unknown, linking: boolean): string {
  const kind = error instanceof TeslaSiteFailure ? error.kind : 'unavailable';
  switch (kind) {
    case 'expired_session':
      return 'Your session has expired. Sign in again to continue.';
    case 'forbidden':
      return 'Access denied. Current household ADMIN authorization is required.';
    case 'conflict':
      return 'The link conflicts with existing data or the Tesla connection changed. Discover sites again before starting another link.';
    case 'reauthorization_required':
      return 'Your Tesla connection requires reauthorization. Ask the household ADMIN to explicitly reconnect Tesla. Finding sites again cannot renew this connection.';
    case 'recovery_required':
      return 'A previous Tesla token renewal has an uncertain outcome. An ADMIN must arrange connection recovery before trying again. No token renewal is automatically retried.';
    case 'rate_limited':
      return 'Too many requests. Wait before retrying.';
    case 'invalid_request':
      return 'The site selection could not be accepted. Discover sites again.';
    default:
      return linking
        ? 'The link could not be confirmed. Retry linking to check the same operation safely.'
        : 'Tesla site discovery is unavailable. Try again later. No demo sites are used.';
  }
}

/** No network activity until an ADMIN explicitly requests it. No telemetry or control actions. */
export function TeslaSiteSetup() {
  const auth = useOptionalAuth();
  if (!auth?.teslaSites) return null;
  const state = auth.state;
  return (
    <GlassCard title="Tesla Energy Site">
      {state.status !== 'authorised' ? (
        <p>Sign in to manage your household's Tesla site.</p>
      ) : state.membership.role !== 'ADMIN' ? (
        <p>A current household ADMIN must discover and link Tesla sites.</p>
      ) : (
        <SiteForm
          key={`${state.user.id}:${state.membership.householdId}`}
          actions={auth.teslaSites}
          householdName={state.membership.name}
        />
      )}
    </GlassCard>
  );
}

function SiteForm({
  actions,
  householdName,
}: {
  actions: TeslaSiteActions;
  householdName: string;
}) {
  const [sites, setSites] = useState<DiscoveredSite[] | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState<'discover' | 'link' | 'connect' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TeslaSiteLinkResponse | null>(null);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  // Retain the key after ambiguous failures. Reloads can safely recover via server duplicate protection.
  const attempt = useRef<{ providerSiteId: string; key: string } | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), []);

  async function run(operation: 'discover' | 'link' | 'connect') {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setBusy(operation);
    setError(null);
    try {
      if (operation === 'connect') {
        if (!actions.connect) return;
        const response = await actions.connect(controller.signal);
        if (controller.signal.aborted) return;
        window.location.assign(response.authorizeUrl);
      } else if (operation === 'discover') {
        const response = await actions.discover(controller.signal);
        if (controller.signal.aborted) return;
        setSites(response.items);
        if (!response.items.some((site) => site.providerSiteId === selected)) {
          setSelected('');
          attempt.current = null;
        }
      } else {
        if (!sites?.some((site) => site.providerSiteId === selected)) return;
        if (attempt.current?.providerSiteId !== selected) {
          attempt.current = { providerSiteId: selected, key: crypto.randomUUID() };
        }
        const response = await actions.link(selected, attempt.current.key, controller.signal);
        if (controller.signal.aborted) return;
        setResult(response);
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(
          operation === 'connect'
            ? 'Tesla authorization could not start. Verify your current ADMIN session before explicitly trying again.'
            : failureMessage(caught, operation === 'link'),
        );
        if (
          caught instanceof TeslaSiteFailure &&
          ['reauthorization_required', 'recovery_required'].includes(caught.kind)
        ) {
          setRecoveryRequired(true);
          setSites(null);
          setSelected('');
        }
      }
    } finally {
      if (!controller.signal.aborted) setBusy(null);
      if (inFlight.current === controller) inFlight.current = null;
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Discover sites authorized by your existing Tesla connection, then link one to{' '}
        {householdName}. This does not start telemetry, polling, automation or controls.
      </p>
      <Button
        disabled={busy !== null || recoveryRequired}
        loading={busy === 'discover'}
        onClick={() => void run('discover')}
      >
        Find Tesla energy sites
      </Button>
      {actions.connect && (
        <details className="text-sm text-ink-muted">
          <summary>Connect or reconnect Tesla (manual)</summary>
          <p className="my-2">
            Only start this when you intend to authorize Tesla. It restarts any pending
            authorization for this account and requests read-only energy access. It does not enable
            controls.
          </p>
          <Button
            disabled={busy !== null}
            loading={busy === 'connect'}
            onClick={() => void run('connect')}
          >
            Start read-only Tesla authorization
          </Button>
        </details>
      )}
      {sites?.length === 0 && (
        <p role="status">No Tesla energy sites were returned for this account.</p>
      )}
      {sites !== null && sites.length > 0 && (
        <div className="space-y-3">
          <label className="block text-sm" htmlFor="tesla-energy-site">
            Authorized Tesla energy site
          </label>
          <select
            id="tesla-energy-site"
            className="w-full rounded border border-slate-700 bg-slate-900 p-2 text-slate-100"
            value={selected}
            disabled={busy !== null}
            onChange={(event) => {
              setSelected(event.target.value);
              attempt.current = null;
              setResult(null);
              setError(null);
            }}
          >
            <option value="">Select a site</option>
            {sites.map((site) => (
              <option key={site.providerSiteId} value={site.providerSiteId}>
                {site.name ?? 'Name not provided'} — {site.providerSiteId}
              </option>
            ))}
          </select>
          <Button
            disabled={!selected || busy !== null || result?.site.providerSiteId === selected}
            loading={busy === 'link'}
            onClick={() => void run('link')}
          >
            {attempt.current && !result ? 'Retry linking site' : 'Link selected site'}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="space-y-1 text-sm">
          <p>
            {result.created
              ? 'Tesla energy site linked.'
              : 'This Tesla energy site was already linked.'}
          </p>
          <p>
            {result.site.name ?? 'Name not provided'} — Tesla site {result.site.providerSiteId}
          </p>
          <p>Persisted site: {result.site.id}</p>
          <p>
            Connection state: {result.site.connectionState}. Timezone: {result.site.timezone}.
          </p>
          <p>Site linkage is confirmed. Live telemetry remains separate.</p>
        </div>
      )}
    </div>
  );
}
