import React, { useCallback, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import toast from 'react-hot-toast';
import { getCollectionsReport } from '../reportingApi';
import { inr, monthLabel } from '../reportingUtils';
import MetricCard from '../components/MetricCard';
import ChartCard from '../components/ChartCard';
import ReportFilters from '../components/ReportFilters';
import DataTable from '../components/DataTable';
import ExportButton from '../components/ExportButton';
import { useReportFiltersFromUrl } from '../hooks/useReportFiltersFromUrl';

const COLLECTIONS_DEFAULTS = {
  month: new Date().getMonth() + 1,
  year: new Date().getFullYear(),
};
const COLLECTIONS_FILTER_KEYS = ['month', 'year'];

export default function CollectionsReportPage() {
  const [filters, setFilters] = useReportFiltersFromUrl(COLLECTIONS_DEFAULTS, COLLECTIONS_FILTER_KEYS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (f = filters) => {
    setLoading(true);
    try {
      const res = await getCollectionsReport(f);
      setData(res.data);
    } catch {
      toast.error('Failed to load collections report');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(filters); }, []);

  const summary = data?.summary || {};
  const trend = (data?.monthly_trend || []).map((r) => ({
    name: monthLabel(r.month, r.year),
    Collected: parseFloat(r.collected || 0),
    Outstanding: parseFloat(r.invoiced || 0) - parseFloat(r.collected || 0),
  }));

  const cols = [
    { key: 'customer_name', label: 'Customer' },
    { key: 'invoiced', label: 'Invoiced', render: (r) => inr(r.invoiced) },
    { key: 'collected', label: 'Collected', render: (r) => inr(r.collected) },
    {
      key: 'outstanding',
      label: 'Outstanding',
      sortable: true,
      render: (r) => (
        <span className={parseFloat(r.outstanding) > 0 ? 'text-red-600 font-medium' : ''}>
          {inr(r.outstanding)}
        </span>
      ),
    },
    {
      key: 'oldest_unpaid_date',
      label: 'Oldest Unpaid',
      render: (r) => (r.oldest_unpaid_date ? String(r.oldest_unpaid_date).slice(0, 10) : '—'),
    },
    { key: 'status', label: 'Status' },
  ];

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Collections Report</h1>
        <p className="text-sm text-gray-500">Invoiced vs collected by customer</p>
      </div>

      <ReportFilters filters={filters} onChange={setFilters} onApply={load} fields={['month', 'year']} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Invoiced" value={inr(summary.total_invoiced)} color="blue" />
        <MetricCard title="Collected" value={inr(summary.total_collected)} color="green" />
        <MetricCard title="Outstanding" value={inr(summary.outstanding)} color="amber" />
        <MetricCard title="Overdue" value={inr(summary.overdue)} color="red" />
      </div>

      <ChartCard title="Collections Trend">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={trend}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => `₹${(v / 100000).toFixed(1)}L`} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => inr(v)} />
            <Legend />
            <Bar dataKey="Collected" stackId="a" fill="#16A34A" />
            <Bar dataKey="Outstanding" stackId="a" fill="#EF4444" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <DataTable columns={cols} rows={data?.by_customer || []} loading={loading} />
      <ExportButton reportType="collections" filters={filters} />
    </div>
  );
}
