import type { TariffProblem } from '@autopw3/shared';
import { ErrorBanner } from '../../components/ui/feedback';

export interface ValidationPanelProps {
  valid: boolean;
  problems: readonly TariffProblem[];
}

export function ValidationPanel({ valid, problems }: ValidationPanelProps) {
  if (valid && problems.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-control border border-emerald-500/40 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300"
      >
        <span className="font-semibold">✓ Ready:</span>
        <span>Tariff is valid and complete with no gaps or overlaps.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ErrorBanner
        tone="error"
        title="Tariff cannot be saved"
        message="Resolve the following configuration issues before saving:"
      />
      <ul className="flex flex-col gap-1.5 pl-2 text-xs text-rose-300">
        {problems.map((p, idx) => (
          <li key={`${p.code}-${idx}`} className="flex items-start gap-1.5">
            <span className="font-mono text-rose-400">[{p.code}]</span>
            <span>{p.message}</span>
            {p.path !== '' ? <span className="text-[10px] text-ink-muted">({p.path})</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
