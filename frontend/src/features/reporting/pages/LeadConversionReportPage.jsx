import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import toast from 'react-hot-toast';
import { getLeadConversion } from '../reportingApi';
import { defaultRange, LEAD_STATUS_COLORS } from '../reportingUtils';
import ChartCard from '../components/ChartCard';
import ReportFilters from '../components/ReportFilters';
import DataTable from '../components/DataTable';
import ExportButton from '../components/ExportButton';

export default function LeadConversionReportPage() {
  const [filters, setFilters] = useState(() => defaultRange());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (f = filters) => {
    setLoading(true);
    try {
      const res = await getLeadConversion(f);
      setData(res.data);
    } catch {
      toast.error('Failed to load lead conversion report');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, []);

  const funnel = data?.funnel || [];
  const total = funnel.reduce((s, r) => s + (r.count || 0), 0);

  const funnelSteps = useMemo(() => {
    const byStatus = Object.fromEntries(funnel.map((r) => [r.status, r.count || 0]));
    const coldWarmHot = (byStatus.Cold || 0) + (byStatus.Warm || 0) + (byStatus.Hot || 0);
    const hot = byStatus.Hot || 0;
    const dealDemo = (byStatus.Deal || 0) + (byStatus.Demo || 0);
    return [
      { step: 'All Leads', count: total, pct: 100 },
      { step: 'Cold+Warm+Hot', count: coldWarmHot, pct: total ? ((coldWarmHot / total) * 100).toFixed(1) : 0 },
      { step: 'Hot', count: hot, pct: total ? ((hot / total) * 100).toFixed(1) : 0 },
      { step: 'Deal/Demo', count: dealDemo, pct: total ? ((dealDemo / total) * 100).toFixed(1) : 0 },
    ];
  }, [funnel, total]);

  const funnelChart = funnel.map((r) => ({
    status: r.status,
    count: r.count,
    fill: LEAD_STATUS_COLORS[r.status] || '#6B7280',
  }));

  const spCols = [
    { key: 'user_name', label: 'Name' },
    { key: 'total_leads', label: 'Total', sortable: true },
    { key: 'converted', label: 'Converted', sortable: true },
    { key: 'lost', label: 'Lost' },
    { key: 'conversion_rate_pct', label: 'Conv Rate%', render: (r) => `${r.conversion_rate_pct}%` },
    { key: 'avg_days_to_convert', label: 'Avg Days', render: (r) => r.avg_days_to_convert ?? '—' },
  ];

  const sourceCols = [
    { key: 'source', label: 'Source' },
    { key: 'count', label: 'Total', sortable: true },
    { key: 'converted', label: 'Converted' },
    { key: 'conversion_rate_pct', label: 'Conv Rate%', render: (r) => `${r.conversion_rate_pct}%` },
  ];

  const stageCols = [
    { key: 'status', label: 'Stage' },
    { key: 'avg_days', label: 'Avg Days', sortable: true },
  ];

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Lead Conversion</h1>
        <p className="text-sm text-gray-500">Funnel, sources & salesperson performance</p>
      </div>

      <ReportFilters filters={filters} onChange={setFilters} onApply={load} fields={['dateRange']} />

      <ChartCard title="Lead Funnel" subtitle="Pipeline progression">
        <div className="space-y-2 mb-4">
          {funnelSteps.map((s) => (
            <div key={s.step} className="flex items-center gap-3 text-sm">
              <span className="w-32 text-gray-600 shrink-0">{s.step}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                <div
                  className="bg-indigo-500 h-full rounded-full flex items-center px-2 text-white text-xs"
                  style={{ width: `${Math.max(Number(s.pct), 8)}%` }}
                >
                  {s.count}
                </div>
              </div>
              <span className="text-gray-500 w-12 text-right">{s.pct}%</span>
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart layout="vertical" data={funnelChart}>
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="status" width={80} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="count">
              {funnelChart.map((e, i) => <Cell key={i} fill={e.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">By Salesperson</h3>
        <DataTable columns={spCols} rows={data?.by_salesperson || []} loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">By Source</h3>
          <DataTable columns={sourceCols} rows={data?.sources || []} loading={loading} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Avg Time per Stage</h3>
          <DataTable columns={stageCols} rows={data?.avg_days_per_stage || []} loading={loading} />
        </div>
      </div>

      <ExportButton reportType="lead_conversion" filters={filters} />
    </div>
  );
}
