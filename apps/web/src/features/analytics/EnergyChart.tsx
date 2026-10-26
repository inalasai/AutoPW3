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
import type { EnergyChartPoint } from './types';

export interface EnergyChartProps {
  readonly points: readonly EnergyChartPoint[];
}

export function EnergyChart({ points }: EnergyChartProps) {
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');

  if (points.length === 0) {
    return (
      <EmptyState
        title="No Energy Data"
        description="No energy intervals were recorded for the selected time range."
        icon={ChartIcon}
      />
    );
  }

  const tableColumns: DataTableColumn<EnergyChartPoint>[] = [
    { key: 'label', header: 'Period', render: (r) => r.label },
    {
      key: 'solarKwh',
      header: 'Solar (kWh)',
      numeric: true,
      render: (r) => `${formatDec(r.solarKwh, 3)} kWh`,
    },
    {
      key: 'homeKwh',
      header: 'Home (kWh)',
      numeric: true,
      render: (r) => `${formatDec(r.homeKwh, 3)} kWh`,
    },
    {
      key: 'gridImportKwh',
      header: 'Grid Import (kWh)',
      numeric: true,
      render: (r) => `${formatDec(r.gridImportKwh, 3)} kWh`,
    },
    {
      key: 'gridExportKwh',
      header: 'Grid Export (kWh)',
      numeric: true,
      render: (r) => `${formatDec(r.gridExportKwh, 3)} kWh`,
    },
    {
      key: 'batteryChargedKwh',
      header: 'Battery Charged (kWh)',
      numeric: true,
      render: (r) => `${formatDec(r.batteryChargedKwh, 3)} kWh`,
    },
    {
      key: 'batteryDischargedKwh',
      header: 'Battery Discharged (kWh)',
      numeric: true,
      render: (r) => `${formatDec(r.batteryDischargedKwh, 3)} kWh`,
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
        <h3 className="text-sm font-semibold text-ink">Energy Generation & Consumption</h3>
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
          caption="Energy flows for selected period"
          columns={tableColumns}
          rows={points}
          getRowKey={(r) => r.timestamp}
        />
      ) : (
        <div className="h-80 w-full rounded-card border border-line bg-space-900/40 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={points as EnergyChartPoint[]}
              margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} tickLine={false} />
              <YAxis
                stroke="#94a3b8"
                fontSize={11}
                tickLine={false}
                unit=" kWh"
                domain={[0, 'auto']}
              />
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
              <Bar dataKey="solarKwh" name="Solar" fill="#f59e0b" radius={[2, 2, 0, 0]} />
              <Bar dataKey="homeKwh" name="Home" fill="#06b6d4" radius={[2, 2, 0, 0]} />
              <Bar
                dataKey="gridImportKwh"
                name="Grid Import"
                fill="#6366f1"
                radius={[2, 2, 0, 0]}
              />
              <Bar
                dataKey="gridExportKwh"
                name="Grid Export"
                fill="#a5b4fc"
                radius={[2, 2, 0, 0]}
              />
              <Bar
                dataKey="batteryChargedKwh"
                name="Battery Charge"
                fill="#10b981"
                radius={[2, 2, 0, 0]}
              />
              <Bar
                dataKey="batteryDischargedKwh"
                name="Battery Discharge"
                fill="#34d399"
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
