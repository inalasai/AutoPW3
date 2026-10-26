import type { Tariff } from '@autopw3/shared';
import { TARIFF_EXAMPLES, TARIFF_FIXTURE_NOTICE } from '@autopw3/domain';
import { Modal } from '../../components/ui/overlays';
import { Button } from '../../components/ui/Button';

export interface TemplateModalProps {
  open: boolean;
  onClose: () => void;
  onSelectTemplate: (template: Tariff) => void;
}

const TEMPLATES: Array<{ key: string; name: string; description: string; tariff: Tariff }> = [
  {
    key: 'DAY_NIGHT_IMPORT',
    name: 'Day & Night Import (TOU)',
    description: 'Off-peak night 23:00–08:00 (crossing midnight) at 0.18, day at 0.35, 13.5% VAT.',
    tariff: TARIFF_EXAMPLES.DAY_NIGHT_IMPORT,
  },
  {
    key: 'DAY_NIGHT_PEAK_IMPORT',
    name: 'Day, Night & Peak Import',
    description: '3 time-of-use bands plus per-kWh and per-day levies with 23% VAT.',
    tariff: TARIFF_EXAMPLES.DAY_NIGHT_PEAK_IMPORT,
  },
  {
    key: 'FLAT_IMPORT',
    name: 'Flat Import Tariff',
    description: 'Standard flat rate at 0.30/kWh, standing charge 0.60/day, 23% VAT.',
    tariff: TARIFF_EXAMPLES.FLAT_IMPORT,
  },
  {
    key: 'SEASONAL_WEEKDAY_WEEKEND_IMPORT',
    name: 'Seasonal & Date Overrides',
    description: 'Summer vs winter seasons, separate weekday/weekend schedules, festive overrides.',
    tariff: TARIFF_EXAMPLES.SEASONAL_WEEKDAY_WEEKEND_IMPORT,
  },
  {
    key: 'EXPORT_PER_KWH',
    name: 'Feed-in Export (Paid per kWh)',
    description: 'Credit paid at 0.10/kWh for exported solar/battery energy.',
    tariff: TARIFF_EXAMPLES.EXPORT_PER_KWH,
  },
  {
    key: 'EXPORT_NONE',
    name: 'Export Unpaid',
    description: 'Explicit zero-credit export tariff model.',
    tariff: TARIFF_EXAMPLES.EXPORT_NONE,
  },
];

export function TemplateModal({ open, onClose, onSelectTemplate }: TemplateModalProps) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="template-modal-title">
      <div className="flex flex-col gap-4">
        <div>
          <h2 id="template-modal-title" className="text-lg font-semibold text-ink">
            Example Tariff Templates
          </h2>
          <p className="mt-1 text-xs text-amber-300/90 font-medium bg-amber-950/40 border border-amber-500/30 rounded-control p-2">
            ⚠️ {TARIFF_FIXTURE_NOTICE}
          </p>
        </div>

        <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-1">
          {TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.key}
              type="button"
              onClick={() => {
                onSelectTemplate(tmpl.tariff);
                onClose();
              }}
              className="flex flex-col items-start gap-1 p-3 rounded-control border border-field-border bg-space-900 text-left hover:border-select hover:bg-space-800 transition-colors"
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-medium text-sm text-ink">{tmpl.name}</span>
                <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-space-950 text-ink-muted">
                  {tmpl.tariff.direction}
                </span>
              </div>
              <p className="text-xs text-ink-muted">{tmpl.description}</p>
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
