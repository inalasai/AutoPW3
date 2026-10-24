import { useState } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import {
  ConnectionIndicator,
  DataTable,
  FreshnessBadge,
  GlassCard,
  TelemetryValue,
} from '../../components/ui/display';
import { SelectField, Switch, TextField } from '../../components/ui/fields';
import { EmptyState, ErrorBanner, LoadingRegion, Skeleton } from '../../components/ui/feedback';
import { BatteryIcon, BoltIcon, CloseIcon, GridIcon, SunIcon } from '../../components/ui/icons';
import { ConfirmDialog, Tooltip } from '../../components/ui/overlays';
import { SegmentedControl, Tabs } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/toast';
import { useEffects } from '../effects';
import { Page } from '../pages/Page';

/**
 * Component catalogue at /dev/components, development only (see App.tsx). Every component of
 * src/components/ui in each state worth reviewing, with sample strings only: no real data, no energy logic.
 */

const SWATCHES: ReadonlyArray<{ name: string; cls: string }> = [
  { name: 'space-950', cls: 'bg-space-950' },
  { name: 'space-900', cls: 'bg-space-900' },
  { name: 'panel', cls: 'bg-panel' },
  { name: 'line', cls: 'bg-line' },
  { name: 'ink', cls: 'bg-ink' },
  { name: 'ink-muted', cls: 'bg-ink-muted' },
  { name: 'solar', cls: 'bg-solar' },
  { name: 'battery', cls: 'bg-battery' },
  { name: 'grid', cls: 'bg-grid' },
  { name: 'select', cls: 'bg-select' },
  { name: 'danger', cls: 'bg-danger' },
  { name: 'warning', cls: 'bg-warning' },
  { name: 'success', cls: 'bg-success' },
  { name: 'info', cls: 'bg-info' },
];

interface SampleRow {
  id: string;
  name: string;
  value: string;
}

const SAMPLE_ROWS: ReadonlyArray<SampleRow> = [
  { id: 'a', name: 'Sample A', value: '1.250' },
  { id: 'b', name: 'Sample B', value: '12.500' },
];

export function ComponentCatalogue() {
  const toast = useToast();
  const { effects, setEffects } = useEffects();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [segment, setSegment] = useState<'a' | 'b' | 'c'>('a');
  const [flag, setFlag] = useState(false);

  return (
    <Page
      title="Component catalogue"
      description="Development only. Sample strings, no real data. Toggle effects to check the UI stays readable without glow and animation."
      actions={
        <Switch
          label="Effects"
          checked={effects === 'on'}
          onCheckedChange={(on) => {
            setEffects(on ? 'on' : 'off');
          }}
        />
      }
    >
      <GlassCard title="Colour tokens">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {SWATCHES.map((s) => (
            <li key={s.name} className="min-w-0">
              <div className={`h-10 rounded-control border border-line ${s.cls}`} />
              <p className="mt-1 truncate font-mono text-xs text-ink-muted">{s.name}</p>
            </li>
          ))}
        </ul>
      </GlassCard>

      <GlassCard title="Glass and glow" headingLevel={2}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <GlassCard glow="solar" title="Solar" headingLevel={3}>
            <SunIcon className="text-solar" />
          </GlassCard>
          <GlassCard glow="battery" title="Battery" headingLevel={3}>
            <BatteryIcon className="text-battery" />
          </GlassCard>
          <GlassCard glow="grid" title="Grid" headingLevel={3}>
            <GridIcon className="text-grid-ink" />
          </GlassCard>
          <GlassCard glow="select" title="Selection" headingLevel={3}>
            <BoltIcon className="text-info" />
          </GlassCard>
        </div>
      </GlassCard>

      <GlassCard title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <IconButton label="Close example">
            <CloseIcon />
          </IconButton>
          <Tooltip content="Tooltips add detail; they never hold essential text.">
            <Button variant="secondary">Hover or focus me</Button>
          </Tooltip>
        </div>
      </GlassCard>

      <GlassCard title="Form controls">
        <div className="grid max-w-md gap-4">
          <TextField label="Display name" hint="Shown to other members." />
          <TextField
            label="Email"
            type="email"
            error="Enter a valid email address."
            defaultValue="not-an-email"
          />
          <SelectField label="Role" defaultValue="READ_ONLY">
            <option value="READ_ONLY">Read only</option>
            <option value="READ_WRITE">Read and write</option>
            <option value="ADMIN">Admin</option>
          </SelectField>
          <Switch label="Automation paused" checked={flag} onCheckedChange={setFlag} />
          <SegmentedControl
            label="Example choice"
            value={segment}
            onValueChange={setSegment}
            options={[
              { value: 'a', label: 'Option A' },
              { value: 'b', label: 'Option B' },
              { value: 'c', label: 'Option C' },
            ]}
          />
        </div>
      </GlassCard>

      <GlassCard title="Tabs">
        <Tabs
          label="Example tabs"
          tabs={[
            { id: 'one', label: 'First', panel: <p>First panel.</p> },
            { id: 'two', label: 'Second', panel: <p>Second panel.</p> },
            { id: 'three', label: 'Third', panel: <p>Third panel.</p> },
          ]}
        />
      </GlassCard>

      <GlassCard title="Messages and states">
        <div className="grid gap-3">
          <ErrorBanner
            title="Could not load data"
            message="The server returned an error."
            requestId="3f8b1c2e-9a4d-4e7b-8c11-6d5f0a2b7e90"
            onRetry={() => {
              toast.push({ title: 'Retry pressed' });
            }}
          />
          <ErrorBanner
            tone="warning"
            title="Data is stale"
            message="Last update was over an hour ago."
          />
          <ErrorBanner tone="info" title="For information" message="Nothing needs doing." />
          <LoadingRegion label="Loading sample">
            <div className="grid gap-2">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-16 w-full" />
            </div>
          </LoadingRegion>
          <EmptyState
            title="Nothing here yet"
            description="Say what is missing and what to do about it."
            action={<Button variant="secondary">Do something</Button>}
          />
        </div>
      </GlassCard>

      <GlassCard title="Telemetry and status">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <TelemetryValue label="Solar" value="3.42" unit="kW" tone="solar" />
          <TelemetryValue label="Battery" value="-1.20" unit="kW" tone="battery" />
          <TelemetryValue label="Grid" value="0.00" unit="kW" tone="grid" />
          <TelemetryValue label="No data" value={null} unit="kW" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <ConnectionIndicator state="CONNECTING" />
          <ConnectionIndicator state="LIVE" />
          <ConnectionIndicator state="STALE" />
          <ConnectionIndicator state="ERROR" detail="Provider unavailable" />
          <ConnectionIndicator state="DISCONNECTED" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <FreshnessBadge state="FRESH" ageLabel="updated 20 s ago" />
          <FreshnessBadge state="STALE" ageLabel="updated 3 h ago" />
          <FreshnessBadge state="UNAVAILABLE" />
        </div>
      </GlassCard>

      <GlassCard title="Table">
        <DataTable
          caption="Sample readings"
          rows={SAMPLE_ROWS}
          getRowKey={(row) => row.id}
          columns={[
            { key: 'name', header: 'Name', render: (row) => row.name },
            { key: 'value', header: 'Value (kW)', numeric: true, render: (row) => row.value },
          ]}
        />
      </GlassCard>

      <GlassCard title="Dialogs and toasts">
        <div className="flex flex-wrap gap-3">
          <Button
            variant="danger"
            onClick={() => {
              setConfirmOpen(true);
            }}
          >
            Open confirmation
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              toast.push({ tone: 'success', title: 'Saved', message: 'This closes by itself.' });
            }}
          >
            Success toast
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              toast.push({
                tone: 'error',
                title: 'Something failed',
                message: 'Errors stay until dismissed.',
              });
            }}
          >
            Error toast
          </Button>
        </div>
        <ConfirmDialog
          open={confirmOpen}
          tone="danger"
          title="Remove this member?"
          description="They lose access to the household immediately. This is recorded in the audit log."
          confirmLabel="Remove member"
          onCancel={() => {
            setConfirmOpen(false);
          }}
          onConfirm={() => {
            setConfirmOpen(false);
            toast.push({ tone: 'success', title: 'Confirmed (sample only)' });
          }}
        />
      </GlassCard>
    </Page>
  );
}
