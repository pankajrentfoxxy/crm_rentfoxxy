import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import toast from 'react-hot-toast';
import { getRevenueReport } from '../reportingApi';
import { inr, defaultRange, monthLabel } from '../reportingUtils';
import MetricCard from '../components/MetricCard';
import ChartCard from '../components/ChartCard';
import ReportFilters from '../components/ReportFilters';
import DataTable from '../components/DataTable';
import ExportButton from '../components/ExportButton';

export default function RevenueReportPage() {
  const [filters, setFilters] = useState(() => defaultRange());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (f = filters) => {
    setLoading(true);
    try {
      const res = await getRevenueReport(f);
      setData(res.data);
    } catch {
      toast.error('Failed to load revenue report');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, []);

  const totals = data?.totals || {};
  const invoices = data?.invoices || [];

  const chartData = useMemo(() => {
    const map = new Map();
    invoices.forEach((inv) => {
      const key = `${inv.invoice_year}-${inv.invoice_month}`;
      const cur = map.get(key) || { name: monthLabel(inv.invoice_month, inv.invoice_year), invoiced: 0, collected: 0 };
      cur.invoiced += parseFloat(inv.grand_total || 0);
      if (inv.status === 'paid') cur.collected += parseFloat(inv.grand_total || 0);
      map.set(key, cur);
    });
    return [...map.values()];
  }, [invoices]);

  const cols = [
    { key: 'invoice_number', label: 'Invoice #' },
    { key: 'customer_name', label: 'Customer', sortable: true },
    {
      key: 'month',
      label: 'Month',
      render: (r) => monthLabel(r.invoice_month, r.invoice_year),
    },
    { key: 'subtotal', label: 'Subtotal', render: (r) => inr(r.subtotal) },
    { key: 'gst_amount', label: 'GST', render: (r) => inr(r.gst_amount) },
    { key: 'credit_note_adjustment', label: 'Credit Adj', render: (r) => inr(r.credit_note_adjustment) },
    { key: 'grand_total', label: 'Total', render: (r) => inr(r.grand_total), sortable: true },
    { key: 'status', label: 'Status', sortable: true },
    {
      key: 'invoice_date',
      label: 'Date',
      render: (r) => (r.invoice_date ? String(r.invoice_date).slice(0, 10) : '—'),
      sortable: true,
    },
  ];

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Revenue Report</h1>
        <p className="text-sm text-gray-500">Customer invoices & collections</p>
      </div>

      <ReportFilters filters={filters} onChange={setFilters} onApply={load} fields={['dateRange', 'type']} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Invoiced" value={inr(totals.invoiced)} color="blue" />
        <MetricCard title="Collected" value={inr(totals.collected)} color="green" />
        <MetricCard title="Outstanding" value={inr(totals.outstanding)} color="amber" />
        <MetricCard title="Credit Notes" value={inr(totals.credit_notes_applied)} color="purple" />
      </div>

      <ChartCard title="Monthly Revenue Trend">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => `₹${(v / 100000).toFixed(1)}L`} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => inr(v)} />
            <Legend />
            <Area type="monotone" dataKey="invoiced" stroke="#2563EB" fill="#2563EB33" name="Invoiced" />
            <Area type="monotone" dataKey="collected" stroke="#16A34A" fill="#16A34A33" name="Collected" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <DataTable columns={cols} rows={invoices} loading={loading} />
      <ExportButton reportType="revenue" filters={filters} />
    </div>
  );
}
