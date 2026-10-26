import { useEffect, useMemo, useState } from 'react';
import type { Tariff } from '@autopw3/shared';
import { Page } from '../../app/pages/Page';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/overlays';
import { useToast } from '../../components/ui/toast';
import { useOptionalAuth, usePermissions } from '../auth/AuthProvider';
import { ReadOnlyNotice, WriteButton } from '../auth/permissions';
import { defaultInMemoryTariffRepository } from './repository';
import { SchedulePreview } from './SchedulePreview';
import { TariffEditor } from './TariffEditor';
import { TariffList } from './TariffList';
import { TemplateModal } from './TemplateModal';
import type { TariffFormState, TariffRepository } from './types';
import { validateTariffForm } from './validate';
import { createDefaultFormState, formStateToCreateRequest, tariffToFormState } from './windows';

export interface TariffManagerProps {
  repository?: TariffRepository;
}

export function TariffManager({
  repository = defaultInMemoryTariffRepository,
}: TariffManagerProps) {
  const toast = useToast();
  const auth = useOptionalAuth();
  const { role, canWrite } = usePermissions();

  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [selectedTariff, setSelectedTariff] = useState<Tariff | null>(null);
  const [formState, setFormState] = useState<TariffFormState>(() => createDefaultFormState());
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Tariff | null>(null);
  const [pendingSelection, setPendingSelection] = useState<Tariff | null>(null);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);

  // Load tariffs on mount
  useEffect(() => {
    let active = true;
    void repository.listTariffs().then((list) => {
      if (!active) return;
      setTariffs(list);
      const first = list[0];
      if (first !== undefined) {
        setSelectedTariff(first);
        setFormState(tariffToFormState(first));
        setIsDirty(false);
      }
    });
    return () => {
      active = false;
    };
  }, [repository]);

  // Live validation
  const validation = useMemo(() => validateTariffForm(formState), [formState]);

  // Construct a previewable Tariff object from current form state
  const previewTariff: Tariff = useMemo(() => {
    const req = formStateToCreateRequest(formState);
    return {
      ...req,
      id: formState.id ?? 'preview-tariff',
      tariffKey: formState.tariffKey ?? 'preview-key',
      version: formState.version ?? 1,
      createdAt: new Date().toISOString(),
    };
  }, [formState]);

  const handleSelect = (t: Tariff) => {
    if (isDirty) {
      setPendingSelection(t);
      setDiscardDialogOpen(true);
      return;
    }
    setSelectedTariff(t);
    setFormState(tariffToFormState(t));
    setIsDirty(false);
    setSaveError(null);
  };

  const handleNewTariff = () => {
    const newState = createDefaultFormState();
    setSelectedTariff(null);
    setFormState(newState);
    setIsDirty(true);
    setSaveError(null);
  };

  const handleClone = (t: Tariff) => {
    const { id: _id, tariffKey: _tk, ...rest } = tariffToFormState(t);
    setFormState({
      ...rest,
      version: 1,
      name: `${t.name} (Copy)`,
    });
    setSelectedTariff(null);
    setIsDirty(true);
    toast.push({ title: `Cloned "${t.name}" into new tariff profile.` });
  };

  const handleSelectTemplate = (template: Tariff) => {
    const { id: _id, tariffKey: _tk, ...rest } = tariffToFormState(template);
    setFormState({
      ...rest,
      version: 1,
      name: `${template.name} (from template)`,
    });
    setSelectedTariff(null);
    setIsDirty(true);
    toast.push({ title: `Loaded template "${template.name}".` });
  };

  const handleSave = async () => {
    if (!canWrite && auth !== null) {
      setSaveError('You have read-only access and cannot save tariffs.');
      return;
    }

    if (!validation.valid) {
      setSaveError('Please resolve all validation errors before saving.');
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const request = formStateToCreateRequest(formState);
      const saved = await repository.saveTariff(request, role);
      const updatedList = await repository.listTariffs();
      setTariffs(updatedList);
      setSelectedTariff(saved);
      setFormState(tariffToFormState(saved));
      setIsDirty(false);
      toast.push({
        title: `Saved "${saved.name}" (version ${saved.version})`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save tariff';
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (archiveTarget === null) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      await repository.endTariff(archiveTarget.id, today, role);
      const updatedList = await repository.listTariffs();
      setTariffs(updatedList);
      if (selectedTariff?.id === archiveTarget.id) {
        const refreshed = updatedList.find((t) => t.id === archiveTarget.id);
        if (refreshed !== undefined) {
          setSelectedTariff(refreshed);
          setFormState(tariffToFormState(refreshed));
        }
      }
      toast.push({ title: `Archived "${archiveTarget.name}" (ended ${today}).` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to archive tariff';
      toast.push({ title: message });
    } finally {
      setArchiveTarget(null);
    }
  };

  return (
    <Page
      title="Tariffs"
      description="Versioned electricity import and export profiles with time-of-use slots, seasons and tax."
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={!canWrite && auth !== null}
            onClick={() => {
              setTemplateModalOpen(true);
            }}
          >
            Example Templates
          </Button>
          <WriteButton onClick={handleNewTariff}>New tariff</WriteButton>
        </div>
      }
    >
      <ReadOnlyNotice what="change tariffs" />

      {/* Versioning Explanation Notice */}
      {selectedTariff !== null ? (
        <div className="mb-4 rounded-control border border-sky-500/30 bg-sky-950/20 px-4 py-2.5 text-xs text-sky-200">
          <span className="font-semibold">
            Effective-dated versioning (Version {selectedTariff.version}):
          </span>
          {
            ' Editing an existing tariff creates a new version rather than rewriting history. Historical telemetry and invoices preserve their original pricing.'
          }
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Configured Tariffs List */}
        <div className="lg:col-span-4">
          <TariffList
            tariffs={tariffs}
            selectedId={selectedTariff?.id ?? null}
            disabled={!canWrite && auth !== null}
            onSelect={handleSelect}
            onClone={handleClone}
            onArchive={(t) => {
              setArchiveTarget(t);
            }}
          />
        </div>

        {/* Center/Right Column: Editor & Live Preview */}
        <div className="flex flex-col gap-6 lg:col-span-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-ink">
                {selectedTariff !== null ? `Edit: ${selectedTariff.name}` : 'New Tariff'}
              </h2>
              {isDirty ? (
                <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                  Unsaved changes
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {isDirty && selectedTariff !== null ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setFormState(tariffToFormState(selectedTariff));
                    setIsDirty(false);
                    setSaveError(null);
                  }}
                >
                  Reset
                </Button>
              ) : null}

              <Button
                variant="primary"
                loading={saving}
                disabled={!canWrite && auth !== null}
                onClick={() => {
                  void handleSave();
                }}
              >
                {selectedTariff !== null ? 'Save New Version' : 'Create Tariff'}
              </Button>
            </div>
          </div>

          {saveError !== null ? (
            <div
              role="alert"
              className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {saveError}
            </div>
          ) : null}

          {/* Form Editor */}
          <TariffEditor
            state={formState}
            disabled={!canWrite && auth !== null}
            fieldErrors={validation.fieldErrors}
            onChange={(updated) => {
              setFormState(updated);
              setIsDirty(true);
            }}
          />

          {/* Validation Status */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Tariff Engine Validation
            </h3>
            <div role="region" aria-label="Tariff Engine Validation">
              {validation.valid ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center gap-2 rounded-control border border-emerald-500/40 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300"
                >
                  <span className="font-semibold">✓ Ready:</span>
                  <span>Tariff is valid and complete with no gaps or overlaps.</span>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div
                    role="alert"
                    className="rounded-control border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-300"
                  >
                    <span className="font-semibold">Tariff cannot be saved:</span>
                    <ul className="mt-1 list-disc pl-4">
                      {validation.problems.map((p, idx) => (
                        <li key={`${p.code}-${idx}`}>{p.message}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 24-Hour Schedule Preview */}
          <SchedulePreview tariff={previewTariff} />
        </div>
      </div>

      {/* Example Templates Modal */}
      <TemplateModal
        open={templateModalOpen}
        onClose={() => {
          setTemplateModalOpen(false);
        }}
        onSelectTemplate={handleSelectTemplate}
      />

      {/* Confirm Discard Dialog */}
      <ConfirmDialog
        open={discardDialogOpen}
        title="Discard unsaved changes?"
        description="You have unsaved edits in the current profile. Switching to another tariff will discard them."
        confirmLabel="Discard changes"
        tone="danger"
        onConfirm={() => {
          if (pendingSelection !== null) {
            setSelectedTariff(pendingSelection);
            setFormState(tariffToFormState(pendingSelection));
            setIsDirty(false);
            setSaveError(null);
          }
          setDiscardDialogOpen(false);
          setPendingSelection(null);
        }}
        onCancel={() => {
          setDiscardDialogOpen(false);
          setPendingSelection(null);
        }}
      />

      {/* Archive / End Tariff Dialog */}
      <ConfirmDialog
        open={archiveTarget !== null}
        title={`End "${archiveTarget?.name ?? ''}"?`}
        description="This will set the effective end date of this tariff version to today, archiving it for historical reference."
        confirmLabel="End Tariff"
        onConfirm={() => {
          void handleArchive();
        }}
        onCancel={() => {
          setArchiveTarget(null);
        }}
      />
    </Page>
  );
}
