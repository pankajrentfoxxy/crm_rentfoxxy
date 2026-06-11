import React, { useCallback, useEffect, useState } from 'react';
import api from '../../../utils/api';
import ReportFilters from '../../reporting/components/ReportFilters';
import DataTable from '../../reporting/components/DataTable';
import MetricCard from '../../reporting/components/MetricCard';
import { defaultRange } from '../../reporting/reportingUtils';

export default function SupportStatsPage() {
  const [filters, setFilters] = useState(() => defaultRange());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (f = filters) => {
    setLoading(true);
    try {
      const res = await api.get('/reports/support-stats', { params: f });
      setData(res.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, []);

  const techCols = [
    { key: 'name', label: 'Technician' },
    { key: 'tickets', label: 'Tickets', sortable: true },
    { key: 'avg_hours', label: 'Avg Hours', render: (r) => r.avg_hours ?? '—' },
    { key: 'under48h_pct', label: '<48h Rate%', render: (r) => `${r.under48h_pct}%` },
  ];

  const catCols = [
    { key: 'label', label: 'Category' },
    { key: 'count', label: 'Count', sortable: true },
    { key: 'resolved', label: 'Resolved' },
    { key: 'open', label: 'Open' },
    { key: 'avg_hours', label: 'Avg Hours' },
  ];

  const repeatCols = [
    { key: 'customer_name', label: 'Customer' },
    { key: 'total', label: 'Total Tickets', sortable: true },
    { key: 'resolved', label: 'Resolved' },
    { key: 'repeat_rate', label: 'Repeat Rate %', render: (r) => `${r.repeat_rate}%` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Stats & Reports</h2>
        <p className="text-sm text-gray-500">Support resolution metrics</p>
      </div>

      <ReportFilters filters={filters} onChange={setFilters} onApply={load} fields={['dateRange']} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <MetricCard title="Avg Time to Close" value={data?.avg_resolution_hours != null ? `${data.avg_resolution_hours}h` : '—'} color="blue" />
        <MetricCard title="Median Time" value={data?.median_resolution_hours != null ? `${data.median_resolution_hours}h` : '—'} color="purple" />
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">By Technician</h3>
        <DataTable columns={techCols} rows={data?.by_technician || []} loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Issue Categories</h3>
          <DataTable columns={catCols} rows={data?.by_category || []} loading={loading} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Customer Repeat Tickets</h3>
          <DataTable columns={repeatCols} rows={data?.repeat_customers || []} loading={loading} />
        </div>
      </div>
    </div>
  );
}
