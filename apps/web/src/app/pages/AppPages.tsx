import { Link } from 'react-router';
import { buttonClasses } from '../../components/ui/Button';
import { DataTable, GlassCard } from '../../components/ui/display';
import { ReadOnlyNotice } from '../../features/auth/permissions';
import { Analytics } from '../../features/analytics';
import { AutomationManager } from '../../features/automation';
import { ControlMatrix } from '../../features/controls';
import { TariffManager } from '../../features/tariffs';
import { Page, PlannedFeature, useDocumentTitle } from './Page';

/*
  Structured placeholders (TASK-06). They show the page frame, status area and the components each feature will
  use, with no data fetching, no authentication and no energy calculation. A dash means "no data", never zero.
*/

export function AnalyticsPage() {
  return <Analytics />;
}

export function TariffsPage() {
  return <TariffManager />;
}

export function ControlsPage() {
  return <ControlMatrix />;
}

export function AutomationPage() {
  return <AutomationManager />;
}

export function SettingsPage() {
  return (
    <Page title="Settings" description="Your profile, the Tesla connection, budget and data.">
      <ReadOnlyNotice what="change household settings" />
      <PlannedFeature title="Profile" task="19" description="Display name and locale." />
      <PlannedFeature
        title="Tesla connection"
        task="15"
        description="Connect or disconnect the Tesla account. Admins only."
      />
      <PlannedFeature
        title="Budget and retention"
        task="19"
        description="Monthly API spend cap and data retention. Admins only."
      />
      <PlannedFeature title="Your data" task="19" description="Export or delete your data." />
    </Page>
  );
}

export function AdminPage() {
  return (
    <Page
      title="Admin"
      description="Household members, invitations, roles and the audit log. Admins only."
    >
      <GlassCard title="Members">
        <DataTable
          caption="Members"
          captionHidden
          rows={[]}
          getRowKey={(row: { id: string }) => row.id}
          emptyMessage="Members appear here. Built in TASK-19."
          columns={[
            { key: 'name', header: 'Name', render: () => null },
            { key: 'role', header: 'Role', render: () => null },
            { key: 'joined', header: 'Joined', render: () => null },
          ]}
        />
      </GlassCard>
    </Page>
  );
}

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <>
      <h1 id="page-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight">
        Page not found
      </h1>
      <p className="mb-6 mt-2 text-ink-muted">There is nothing at this address.</p>
      <Link to="/live" className={buttonClasses('primary', 'md')}>
        Go to Live
      </Link>
    </>
  );
}
