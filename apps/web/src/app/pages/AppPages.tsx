import { Link } from 'react-router';
import { buttonClasses } from '../../components/ui/Button';
import { Analytics } from '../../features/analytics';
import { AutomationManager } from '../../features/automation';
import { ControlMatrix } from '../../features/controls';
import { TariffManager } from '../../features/tariffs';
import { AdminPanel } from '../../features/admin';
import { useDocumentTitle } from './Page';

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
  useDocumentTitle('Settings');
  return (
    <AdminPanel
      defaultTab="settings"
      title="Settings"
      description="Your household configuration, Tesla connection, spend caps, and privacy data."
    />
  );
}

export function AdminPage() {
  useDocumentTitle('Admin');
  return (
    <AdminPanel
      defaultTab="members"
      title="Admin"
      description="Household members, invitations, roles and the audit log. Admins only."
    />
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
