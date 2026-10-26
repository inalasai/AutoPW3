import { useState } from 'react';
import { PageHeader } from '../../components/ui/display';
import { Tabs } from '../../components/ui/Tabs';
import { usePermissions } from '../auth/AuthProvider';
import { AuditLogViewer } from './AuditLogViewer';
import { InvitationList } from './InvitationList';
import { InviteMemberModal } from './InviteMemberModal';
import { MemberList } from './MemberList';
import { PrivacySection } from './PrivacySection';
import { SettingsManager } from './SettingsManager';
import { useDocumentTitle } from '../../app/pages/Page';
import type { AdminTab } from './types';
import { useAdmin } from './use-admin';

export interface AdminPanelProps {
  readonly defaultTab?: AdminTab;
  readonly title?: string;
  readonly description?: string;
}

export function AdminPanel({
  defaultTab = 'members',
  title = 'Household Administration',
  description = 'Manage household members, access roles, invitations, settings, audit trails, and privacy operations.',
}: AdminPanelProps) {
  useDocumentTitle(title);
  const { canAdmin } = usePermissions();
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

  const {
    members,
    invitations,
    auditEntries,
    settings,
    teslaLink,
    error,
    householdName,
    currentUserId,
    changeMemberRole,
    removeMember,
    createInvitation,
    revokeInvitation,
    updateSettings,
    disconnectTesla,
    exportHousehold,
    exportAccount,
    deleteHousehold,
    deleteAccount,
    leaveHousehold,
  } = useAdmin();

  const tabs = [
    {
      id: 'members',
      label: 'Members & Invitations',
      panel: (
        <div className="space-y-6">
          <MemberList
            members={members}
            currentUserId={currentUserId}
            canAdmin={canAdmin}
            onChangeRole={changeMemberRole}
            onRemoveMember={removeMember}
          />

          <InvitationList
            invitations={invitations}
            canAdmin={canAdmin}
            onOpenInviteModal={() => setIsInviteModalOpen(true)}
            onRevokeInvitation={revokeInvitation}
          />

          <InviteMemberModal
            isOpen={isInviteModalOpen}
            onClose={() => setIsInviteModalOpen(false)}
            onInvite={createInvitation}
          />
        </div>
      ),
    },
    {
      id: 'audit',
      label: 'Audit History',
      panel: <AuditLogViewer auditEntries={auditEntries} canAdmin={canAdmin} />,
    },
    {
      id: 'settings',
      label: 'Household Settings',
      panel: (
        <SettingsManager
          settings={settings}
          teslaLink={teslaLink}
          canAdmin={canAdmin}
          onUpdateSettings={updateSettings}
          onDisconnectTesla={disconnectTesla}
        />
      ),
    },
    {
      id: 'privacy',
      label: 'Privacy & Data',
      panel: (
        <PrivacySection
          householdName={householdName}
          canAdmin={canAdmin}
          onExportHousehold={exportHousehold}
          onExportAccount={exportAccount}
          onDeleteHousehold={deleteHousehold}
          onDeleteAccount={deleteAccount}
          onLeaveHousehold={leaveHousehold}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />

      {/* Non-Admin Notice */}
      {!canAdmin && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <p className="font-semibold text-amber-300">Read-Only Administrative Access</p>
          <p className="mt-1 text-xs text-amber-200/80">
            You do not have the ADMIN role in this household. Directory management, invitation
            creation, and configuration changes are restricted to administrators. You may still view
            household data and export your personal account information.
          </p>
        </div>
      )}

      {/* Global Error Banner */}
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          <p className="font-semibold">Operation Notice</p>
          <p className="mt-1 text-xs text-rose-200/90">{error}</p>
        </div>
      )}

      {/* Navigation Tabs */}
      <Tabs label="Administration Navigation" tabs={tabs} defaultTabId={defaultTab} />
    </div>
  );
}
