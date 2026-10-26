import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { GlassCard } from '../../components/ui/display';
import { ErrorBanner, LoadingRegion, Skeleton } from '../../components/ui/feedback';
import { Tabs } from '../../components/ui/Tabs';
import { Page } from '../../app/pages/Page';
import { CompletenessBadge } from './CompletenessBadge';
import { CostChart } from './CostChart';
import { buildCostCsv, buildEnergyCsv, downloadCsv } from './csvExport';
import { EnergyChart } from './EnergyChart';
import { RangeControls } from './RangeControls';
import { SavingsCard } from './SavingsCard';
import { SummaryCards } from './SummaryCards';
import { useAnalyticsData, type UseAnalyticsOptions } from './useAnalyticsData';

export type AnalyticsProps = UseAnalyticsOptions;

export function Analytics(props: AnalyticsProps = {}) {
  const {
    range,
    resolution,
    availableResolutions,
    accounting,
    energyPoints,
    costPoints,
    source,
    loading,
    error,
    setPreset,
    setCustomRange,
    setResolution,
  } = useAnalyticsData(props);

  const [activeTab, setActiveTab] = useState<'energy' | 'cost'>('energy');

  const handleExportCsv = () => {
    const filenamePrefix = activeTab === 'energy' ? 'energy-analytics' : 'cost-analytics';
    const filename = `${filenamePrefix}-${range.startDate}-to-${range.endDate}-${resolution}.csv`;
    const content =
      activeTab === 'energy'
        ? buildEnergyCsv(energyPoints)
        : buildCostCsv(costPoints, accounting?.costTotals?.currency ?? 'EUR');
    downloadCsv(filename, content);
  };

  return (
    <Page
      title="Analytics"
      description="Historical energy flows, tariff-aware costing, and counterfactual savings driven by the universal accounting engine."
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={handleExportCsv}
            disabled={
              loading ||
              (activeTab === 'energy' ? energyPoints.length === 0 : costPoints.length === 0)
            }
            title="Download displayed data points as CSV"
          >
            Export CSV
          </Button>
        </div>
      }
    >
      {source === 'DEMO' && (
        <div
          role="note"
          className="flex items-center justify-between rounded-control border border-warning/40 bg-warning/10 px-3.5 py-2 text-xs text-warning"
        >
          <span>
            <strong>DEMO TELEMETRY:</strong> Displaying deterministic synthetic telemetry from the
            Dublin site model. Numbers are calculated by the real domain accounting engine.
          </span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider">
            Source: DEMO
          </span>
        </div>
      )}

      {error !== null && (
        <ErrorBanner tone="error" title="Analytics Computation Error" message={error} />
      )}

      <GlassCard>
        <div className="flex flex-col gap-4">
          <RangeControls
            range={range}
            resolution={resolution}
            availableResolutions={availableResolutions}
            onPresetChange={setPreset}
            onCustomRangeChange={setCustomRange}
            onResolutionChange={setResolution}
          />

          <div className="flex items-center justify-between border-t border-line pt-3">
            <CompletenessBadge completeness={accounting?.completeness ?? null} />
            <span className="text-xs text-ink-muted">
              Period: {range.startDate} to {range.endDate}
            </span>
          </div>
        </div>
      </GlassCard>

      {loading ? (
        <LoadingRegion label="Calculating analytics">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
          <Skeleton className="mt-4 h-96" />
        </LoadingRegion>
      ) : (
        <>
          <SummaryCards accounting={accounting} />

          <GlassCard>
            <Tabs
              label="Analytics views"
              defaultTabId={activeTab}
              tabs={[
                {
                  id: 'energy',
                  label: 'Energy Flows',
                  panel: (
                    <div
                      onClick={() => {
                        setActiveTab('energy');
                      }}
                    >
                      <EnergyChart points={energyPoints} />
                    </div>
                  ),
                },
                {
                  id: 'cost',
                  label: 'Cost & Net Invoicing',
                  panel: (
                    <div
                      onClick={() => {
                        setActiveTab('cost');
                      }}
                    >
                      <CostChart
                        points={costPoints}
                        {...(accounting?.costTotals?.currency
                          ? { currency: accounting.costTotals.currency }
                          : {})}
                      />
                    </div>
                  ),
                },
              ]}
            />
          </GlassCard>

          <SavingsCard
            counterfactuals={accounting?.counterfactuals ?? null}
            actualNetCost={accounting?.costTotals?.rounded.netCost.totalAmount ?? null}
            {...(accounting?.costTotals?.currency
              ? { currency: accounting.costTotals.currency }
              : {})}
          />
        </>
      )}
    </Page>
  );
}
