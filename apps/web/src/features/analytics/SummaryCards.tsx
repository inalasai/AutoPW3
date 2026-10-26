import { useState } from 'react';
import type { AccountingResult } from '@autopw3/domain';
import { GlassCard, TelemetryValue } from '../../components/ui/display';
import { InfoIcon } from '../../components/ui/icons';

export interface SummaryCardsProps {
  readonly accounting: AccountingResult | null;
}

export function SummaryCards({ accounting }: SummaryCardsProps) {
  const [showAssumptions, setShowAssumptions] = useState(false);

  if (!accounting) return null;

  const { energyTotals, costTotals, efficiency, counterfactuals } = accounting;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {/* Solar */}
        <GlassCard glow="solar" className="flex flex-col justify-between">
          <TelemetryValue
            label="Solar Generated"
            value={energyTotals.solarGeneratedKwh}
            unit="kWh"
            tone="solar"
          />
          <div className="mt-3 text-xs text-ink-muted">
            Self-consumed:{' '}
            <strong className="text-solar">
              {efficiency.selfConsumptionPercent !== null
                ? `${efficiency.selfConsumptionPercent}%`
                : '—'}
            </strong>
          </div>
        </GlassCard>

        {/* Home Demand */}
        <GlassCard className="flex flex-col justify-between">
          <TelemetryValue
            label="Home Demand"
            value={energyTotals.homeConsumedKwh}
            unit="kWh"
            tone="select"
          />
          <div className="mt-3 text-xs text-ink-muted">
            Self-sufficiency:{' '}
            <strong className="text-select">
              {efficiency.selfSufficiencyPercent !== null
                ? `${efficiency.selfSufficiencyPercent}%`
                : '—'}
            </strong>
          </div>
        </GlassCard>

        {/* Grid Import/Export */}
        <GlassCard glow="grid" className="flex flex-col justify-between">
          <TelemetryValue
            label="Grid Import"
            value={energyTotals.gridImportKwh}
            unit="kWh"
            tone="grid"
          />
          <div className="mt-3 text-xs text-ink-muted">
            Exported: <strong className="text-grid-ink">{energyTotals.gridExportKwh} kWh</strong>
          </div>
        </GlassCard>

        {/* Battery */}
        <GlassCard glow="battery" className="flex flex-col justify-between">
          <TelemetryValue
            label="Battery Charged"
            value={energyTotals.batteryChargedKwh}
            unit="kWh"
            tone="battery"
          />
          <div className="mt-3 text-xs text-ink-muted">
            Round-trip eff:{' '}
            <strong className="text-battery">
              {efficiency.batteryEfficiencyPercent !== null
                ? `${efficiency.batteryEfficiencyPercent}%`
                : '—'}
            </strong>
          </div>
        </GlassCard>

        {/* Net Cost */}
        <GlassCard className="flex flex-col justify-between">
          <TelemetryValue
            label="Net Cost"
            value={costTotals ? costTotals.rounded.netCost.totalAmount : null}
            {...(costTotals ? { unit: costTotals.currency } : {})}
            tone="neutral"
          />
          <div className="mt-3 text-xs text-ink-muted">
            {costTotals ? (
              <span>
                Imp: €{costTotals.rounded.importEnergyCost.totalAmount} / Exp: -€
                {costTotals.rounded.exportRevenueCredit.totalAmount}
              </span>
            ) : (
              'No tariff active'
            )}
          </div>
        </GlassCard>

        {/* Counterfactual Savings */}
        <GlassCard className="flex flex-col justify-between border-success/30 bg-success/5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Net Savings
            </span>
            <span
              className="rounded-pill border border-success/50 bg-success/20 px-1.5 py-0.5 text-[10px] font-bold text-success"
              title="Estimate based on counterfactual 'no solar, no battery' baseline."
            >
              ESTIMATE
            </span>
          </div>

          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-success">
            {counterfactuals ? `€${counterfactuals.estimatedNetSavings}` : '—'}
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-ink-muted">
            <span>
              Avoided:{' '}
              <strong className="text-ink">
                {counterfactuals ? `€${counterfactuals.avoidedGridImportCost}` : '—'}
              </strong>
            </span>
            <button
              type="button"
              onClick={() => {
                setShowAssumptions((prev) => !prev);
              }}
              className="inline-flex items-center gap-1 text-ink-muted underline hover:text-ink focus-visible:outline-2 focus-visible:outline-select"
              aria-expanded={showAssumptions}
              aria-controls="financial-assumptions-panel"
            >
              <InfoIcon className="size-3.5" />
              <span>Assumptions</span>
            </button>
          </div>
        </GlassCard>
      </div>

      {showAssumptions && (
        <div
          id="financial-assumptions-panel"
          className="rounded-card border border-line bg-space-900/90 p-4 text-xs text-ink-muted shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <h4 className="font-semibold text-ink">Financial & Energy Model Disclosures</h4>
            <button
              type="button"
              onClick={() => {
                setShowAssumptions(false);
              }}
              className="text-ink-muted hover:text-ink"
            >
              Close
            </button>
          </div>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-ink">A-01 (Standing charges):</strong> Charged per local
              calendar date in full for any date containing recorded intervals.
            </li>
            <li>
              <strong className="text-ink">A-02 (Counterfactual Baseline):</strong> Avoided grid
              cost and estimated net savings assume 100% of household demand would have been
              imported at the active import tariff with zero solar and zero battery storage.
            </li>
            <li>
              <strong className="text-ink">A-03 (Battery Efficiency):</strong> Computed as total
              discharged kWh divided by total charged kWh across the requested window.
            </li>
            <li>
              <strong className="text-ink">A-04 (Tariff Optimisation):</strong> Load shifting
              benefit evaluated against the volume-weighted average flat import rate.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
