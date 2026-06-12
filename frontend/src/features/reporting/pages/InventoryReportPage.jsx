import React, { useCallback, useEffect, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import toast from 'react-hot-toast';
import { getInventoryReport } from '../reportingApi';
import { inr, defaultRange } from '../reportingUtils';
import MetricCard from '../components/MetricCard';
import ChartCard from '../components/ChartCard';
import ReportFilters from '../components/ReportFilters';
import DataTable from '../components/DataTable';
import ExportButton from '../components/ExportButton';

export default function InventoryReportPage() {
  const [filters, setFilters] = useState(() => defaultRange());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (f = filters) => {
    setLoading(true);
    try {
      const res = await getInventoryReport(f);
      setData(res.data);
    } catch {
      toast.error('Failed to load inventory report');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, []);

  const summary = data?.summary || {};
  const byBrand = data?.by_brand || [];
  const topCustomers = data?.top_customers || [];

  const available = byBrand.reduce((s, r) => s + (r.available || 0), 0);
  const rented = byBrand.reduce((s, r) => s + (r.rented || 0), 0);
  const inRepair = byBrand.reduce((s, r) => s + (r.in_repair || 0), 0);

  const pieData = [
    { name: 'Available', value: available, fill: '#16A34A' },
    { name: 'Rented', value: rented, fill: '#2563EB' },
    { name: 'In Repair', value: inRepair, fill: '#EA580C' },
  ].filter((d) => d.value > 0);

  const brandCols = [
    { key: 'brand', label: 'Brand' },
    { key: 'total', label: 'Total', sortable: true },
    { key: 'available', label: 'Available' },
    { key: 'rented', label: 'Rented' },
    { key: 'in_repair', label: 'In Repair' },
  ];

  const customerCols = [
    { key: 'customer_name', label: 'Customer' },
    { key: 'laptop_count', label: 'Laptops', sortable: true },
    { key: 'monthly_value', label: 'Monthly Value', render: (r) => inr(r.monthly_value) },
  ];

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Inventory Utilisation</h1>
        <p className="text-sm text-gray-500">Fleet status & rental customers</p>
      </div>

      <ReportFilters filters={filters} onChange={setFilters} onApply={load} fields={['dateRange']} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Fleet" value={summary.total_fleet || 0} color="blue" />
        <MetricCard title="Available" value={available} color="green" />
        <MetricCard title="Rented" value={rented} color="purple" />
        <MetricCard title="Utilisation %" value={`${summary.avg_utilised_pct || 0}%`} color="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Current Status">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData.length ? pieData : [{ name: '—', value: 1, fill: '#e5e7eb' }]} cx="50%" cy="50%" outerRadius={90} dataKey="value" label>
                {pieData.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">By Brand</h3>
          <DataTable columns={brandCols} rows={byBrand} loading={loading} />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Top Rental Customers</h3>
        <DataTable columns={customerCols} rows={topCustomers} loading={loading} />
      </div>

      <ExportButton reportType="inventory" filters={filters} />
    </div>
  );
}
