import { Link } from 'react-router';
import { useState } from 'react';
import { COMMAND_CAPABILITIES } from '@autopw3/shared';
import { buttonClasses } from '../../components/ui/Button';
import {
  ConnectionIndicator,
  DataTable,
  FreshnessBadge,
  GlassCard,
  TelemetryValue,
} from '../../components/ui/display';
import { EmptyState, ErrorBanner } from '../../components/ui/feedback';
import { BoltIcon, ChartIcon, PulseIcon } from '../../components/ui/icons';
import { SegmentedControl, Tabs } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/toast';
import { ReadOnlyNotice, WriteButton } from '../../features/auth/permissions';
import { Page, PlannedFeature, useDocumentTitle } from './Page';

/*
  Structured placeholders (TASK-06). They show the page frame, status area and the components each feature will
  use, with no data fetching, no authentication and no energy calculation. A dash means "no data", never zero.
*/

export function LivePage() {
  return (
    <Page
      title="Live"
      description="Real-time energy flow for your site."
      status={
        <>
          <ConnectionIndicator state="DISCONNECTED" detail="No site connected" />
          <FreshnessBadge state="UNAVAILABLE" />
        </>
      }
    >
      <GlassCard title="Now" headingLevel={2}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <TelemetryValue label="Solar" value={null} unit="kW" tone="solar" />
          <TelemetryValue label="Battery" value={null} unit="kW" tone="battery" />
          <TelemetryValue label="Grid" value={null} unit="kW" tone="grid" />
          <TelemetryValue label="Home" value={null} unit="kW" />
        </div>
      </GlassCard>
      <PlannedFeature
        title="Energy flow"
        task="09"
        icon={PulseIcon}
        description="An animated diagram of solar, battery, home and grid, with the age of the data shown honestly."
      />
    </Page>
  );
}

type Resolution = 'interval' | 'hourly' | 'daily';

export function AnalyticsPage() {
  const [resolution, setResolution] = useState<Resolution>('hourly');
  return (
    <Page
      title="Analytics"
      description="Energy and cost over time, with the resolution and completeness of the data stated."
      actions={
        <SegmentedControl
          label="Resolution"
          value={resolution}
          onValueChange={setResolution}
          options={[
            { value: 'interval', label: 'Interval' },
            { value: 'hourly', label: 'Hourly' },
            { value: 'daily', label: 'Daily' },
          ]}
        />
      }
    >
      <GlassCard>
        <Tabs
          label="Analytics views"
          tabs={[
            {
              id: 'energy',
              label: 'Energy',
              panel: (
                <EmptyState
                  headingLevel={2}
                  icon={ChartIcon}
                  title="Built in TASK-13"
                  description="Solar, battery, grid and home energy charts, with a table equivalent for every chart."
                />
              ),
            },
            {
              id: 'cost',
              label: 'Cost',
              panel: (
                <EmptyState
                  headingLevel={2}
                  icon={ChartIcon}
                  title="Built in TASK-13"
                  description="Estimated cost and savings by day and month. Estimates are labelled as estimates."
                />
              ),
            },
          ]}
        />
      </GlassCard>
    </Page>
  );
}

export function TariffsPage() {
  const toast = useToast();
  return (
    <Page
      title="Tariffs"
      description="Versioned import and export tariffs with effective dates, time-of-use slots and tax."
      actions={
        <WriteButton
          onClick={() => {
            toast.push({ title: 'Tariff editing is built in TASK-12' });
          }}
        >
          New tariff
        </WriteButton>
      }
    >
      <ReadOnlyNotice what="change tariffs" />
      <GlassCard title="Your tariffs">
        <DataTable
          caption="Tariffs"
          captionHidden
          rows={[]}
          getRowKey={(row: { id: string }) => row.id}
          emptyMessage="No tariffs yet. The tariff manager is built in TASK-12."
          columns={[
            { key: 'name', header: 'Name', render: () => null },
            { key: 'direction', header: 'Direction', render: () => null },
            { key: 'from', header: 'Effective from', render: () => null },
            { key: 'rate', header: 'Rate', numeric: true, render: () => null },
          ]}
        />
      </GlassCard>
    </Page>
  );
}

export function ControlsPage() {
  return (
    <Page
      title="Controls"
      description="Supported Powerwall controls for this site. Every command needs confirmation, and a successful request is not proof the hardware changed."
      status={<ConnectionIndicator state="DISCONNECTED" detail="No site connected" />}
    >
      <ReadOnlyNotice what="send commands" />
      <ErrorBanner
        tone="info"
        title="Controls are off"
        message="Device commands are disabled until an admin turns them on for a connected site."
      />
      <GlassCard title="Capability matrix">
        <DataTable
          caption="Capabilities"
          captionHidden
          rows={COMMAND_CAPABILITIES}
          getRowKey={(row) => row}
          columns={[
            {
              key: 'capability',
              header: 'Capability',
              render: (row) => <span className="font-mono text-xs">{row}</span>,
            },
            { key: 'status', header: 'Status', render: () => 'Not checked' },
          ]}
        />
      </GlassCard>
      <PlannedFeature
        title="Commands"
        task="17"
        icon={BoltIcon}
        description="Confirmed, audited commands with a visible lifecycle: pending, confirmed, failed or unknown."
        headingLevel={2}
      />
    </Page>
  );
}

export function AutomationPage() {
  const toast = useToast();
  return (
    <Page
      title="Automation"
      description="Rules that act on conditions such as time of day, battery level and import rate."
      actions={
        <WriteButton
          onClick={() => {
            toast.push({ title: 'Rule editing is built in TASK-18' });
          }}
        >
          New rule
        </WriteButton>
      }
    >
      <ReadOnlyNotice what="change rules" />
      <ErrorBanner
        tone="info"
        title="Automation starts switched off"
        message="New rules are disabled or dry-run. A dry run records what would have happened and never sends a command."
      />
      <PlannedFeature
        title="Rules and executions"
        task="18"
        description="Create rules, review dry-run results and see every execution with the reason it did or did not act."
      />
    </Page>
  );
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
