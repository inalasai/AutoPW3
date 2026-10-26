import type { CounterfactualAnalysis } from '@autopw3/domain';
import { GlassCard } from '../../components/ui/display';

export interface SavingsCardProps {
  readonly counterfactuals: CounterfactualAnalysis | null;
  readonly actualNetCost: string | null;
  readonly currency?: string | undefined;
}

export function SavingsCard({
  counterfactuals,
  actualNetCost,
  currency = 'EUR',
}: SavingsCardProps) {
  if (!counterfactuals) return null;

  const symbol = currency === 'EUR' ? '€' : currency;

  return (
    <GlassCard title="Counterfactual Savings & Optimisation" headingLevel={3}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
          <p className="text-xs text-ink-muted">
            Baseline:{' '}
            <strong className="text-ink">
              100% household demand imported with zero solar and zero battery storage.
            </strong>
          </p>
          <span className="rounded-pill border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
            ESTIMATE
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-card border border-line bg-space-900/40 p-3">
            <span className="text-xs text-ink-muted">Actual Net Cost</span>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-ink">
              {actualNetCost ? `${symbol}${actualNetCost}` : '—'}
            </div>
          </div>

          <div className="rounded-card border border-line bg-space-900/40 p-3">
            <span className="text-xs text-ink-muted">Baseline Cost (No Solar/Battery)</span>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-danger">
              {symbol}
              {counterfactuals.counterfactualNoSolarNoBatteryNetCost ?? '—'}
            </div>
          </div>

          <div className="rounded-card border border-line bg-space-900/40 p-3">
            <span className="text-xs text-ink-muted">Avoided Grid Import Cost</span>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-select">
              {symbol}
              {counterfactuals.avoidedGridImportCost}
            </div>
          </div>

          <div className="rounded-card border border-success/30 bg-success/10 p-3">
            <span className="text-xs text-success font-medium">Estimated Net Savings</span>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-success">
              {symbol}
              {counterfactuals.estimatedNetSavings}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-control border border-line bg-space-900/30 px-3 py-2 text-xs">
          <span className="text-ink-muted">Tariff Arbitrage / Optimisation Benefit:</span>
          <span className="font-mono font-semibold tabular-nums text-select">
            {symbol}
            {counterfactuals.tariffOptimisationBenefit}
          </span>
        </div>
      </div>
    </GlassCard>
  );
}
