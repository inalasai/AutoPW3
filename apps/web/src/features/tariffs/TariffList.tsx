import type { Tariff } from '@autopw3/shared';
import { GlassCard } from '../../components/ui/display';
import { Button } from '../../components/ui/Button';

export interface TariffListProps {
  tariffs: readonly Tariff[];
  selectedId: string | null;
  onSelect: (tariff: Tariff) => void;
  onClone: (tariff: Tariff) => void;
  onArchive: (tariff: Tariff) => void;
  disabled?: boolean;
}

export function TariffList({
  tariffs,
  selectedId,
  onSelect,
  onClone,
  onArchive,
  disabled = false,
}: TariffListProps) {
  const imports = tariffs.filter((t) => t.direction === 'IMPORT');
  const exports = tariffs.filter((t) => t.direction === 'EXPORT');

  const renderSection = (title: string, list: readonly Tariff[]) => {
    if (list.length === 0) return null;

    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted px-1">
          {title} ({list.length})
        </h3>
        <div className="flex flex-col gap-2">
          {list.map((t) => {
            const isSelected = t.id === selectedId;
            const isOngoing = t.effectiveTo === null;

            return (
              <div
                key={t.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  onSelect(t);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(t);
                  }
                }}
                className={`flex flex-col gap-1.5 p-3 rounded-control border text-left transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-select bg-select/10 ring-1 ring-select'
                    : 'border-field-border bg-space-900/60 hover:border-line'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm text-ink truncate">{t.name}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-space-950 text-ink-muted shrink-0">
                    v{t.version}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-ink-muted">
                  <span>{t.priceMode}</span>
                  <span>
                    {t.effectiveFrom} → {t.effectiveTo ?? 'Present'}
                  </span>
                </div>

                {isSelected ? (
                  <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-line/40 pt-2 text-xs">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        onClone(t);
                      }}
                    >
                      Clone
                    </Button>
                    {isOngoing ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          onArchive(t);
                        }}
                      >
                        End / Archive
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <GlassCard title="Configured Tariffs">
      <div className="flex flex-col gap-5 max-h-[70vh] overflow-y-auto pr-1">
        {renderSection('Import Tariffs', imports)}
        {renderSection('Export Tariffs', exports)}
        {tariffs.length === 0 ? (
          <p className="text-xs text-ink-muted text-center py-4">No tariffs configured yet.</p>
        ) : null}
      </div>
    </GlassCard>
  );
}
