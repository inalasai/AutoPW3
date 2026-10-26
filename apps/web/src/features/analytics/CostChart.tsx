import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '../../components/ui/Button';
import { DataTable, type DataTableColumn } from '../../components/ui/display';
import { EmptyState } from '../../components/ui/feedback';
import { ChartIcon } from '../../components/ui/icons';
import { formatDec } from './format';
import type { CostChartPoint } from './types';

export interface CostChartProps {
  readonly points: readonly CostChartPoint[];
  readonly currency?: string | undefined;
}

export function CostChart({ points, currency = 'EUR' }: CostChartProps) {
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');

  if (points.length === 0) {
    return (
      <EmptyState
        title="No Financial Data"
        description="No cost calculations available for this period. Ensure active tariffs are configured."
        icon={ChartIcon}
      />
    );
  }

  const symbol = currency === 'EUR' ? '€' : currency;

  const tableColumns: DataTableColumn<CostChartPoint>[] = [
    { key: 'label', header: 'Period', render: (r) => r.label },
    {
      key: 'importCost',
      header: `Import Cost (${symbol})`,
      numeric: true,
      render: (r) => `${symbol}${formatDec(r.importCost, 2)}`,
    },
    {
      key: 'exportCredit',
      header: `Export Credit (${symbol})`,
      numeric: true,
      render: (r) => `${symbol}${formatDec(r.exportCredit, 2)}`,
    },
    {
      key: 'netCost',
      header: `Net Cost (${symbol})`,
      numeric: true,
      render: (r) => `${symbol}${formatDec(r.netCost, 2)}`,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span
          className={
            r.isGap
              ? 'rounded bg-warning/20 px-1.5 py-0.5 text-xs font-semibold text-warning'
              : 'text-xs text-ink-muted'
          }
        >
          {r.isGap ? 'GAP' : 'OK'}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Electricity Invoicing & Net Cost</h3>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setViewMode((m) => (m === 'chart' ? 'table' : 'chart'));
          }}
        >
          {viewMode === 'chart' ? 'View as Table' : 'View as Chart'}
        </Button>
      </div>

      {viewMode === 'table' ? (
        <DataTable
          caption="Financial costs and credits for selected period"
          columns={tableColumns}
          rows={points}
          getRowKey={(r) => r.timestamp}
        />
      ) : (
        <div className="h-80 w-full rounded-card border border-line bg-space-900/40 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={points as CostChartPoint[]}
              margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} tickLine={false} />
              <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} unit={` ${symbol}`} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#090d16',
                  borderColor: '#1e293b',
                  borderRadius: '0.5rem',
                  fontSize: '0.75rem',
                  color: '#e2e8f0',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '0.75rem', paddingTop: '8px' }} />
              <Bar dataKey="importCost" name="Import Cost" fill="#f87171" radius={[2, 2, 0, 0]} />
              <Bar
                dataKey="exportCredit"
                name="Export Credit"
                fill="#10b981"
                radius={[2, 2, 0, 0]}
              />
              <Bar dataKey="netCost" name="Net Cost" fill="#6366f1" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
