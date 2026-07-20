import React, { useCallback, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import toast from 'react-hot-toast';
import { getVendorSpendReport } from '../reportingApi';
import { inr, defaultRange, monthLabel } from '../reportingUtils';
import MetricCard from '../components/MetricCard';
import ChartCard from '../components/ChartCard';
import ReportFilters from '../components/ReportFilters';
import DataTable from '../components/DataTable';
import ExportButton from '../components/ExportButton';
import { useReportFiltersFromUrl } from '../hooks/useReportFiltersFromUrl';

const DATE_RANGE_KEYS = ['from', 'to'];

export default function VendorSpendReportPage() {
  const [filters, setFilters] = useReportFiltersFromUrl(defaultRange(), DATE_RANGE_KEYS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (f = filters) => {
    setLoading(true);
    try {
      const res = await getVendorSpendReport(f);
      setData(res.data);
    } catch {
      toast.error('Failed to load vendor spend report');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(filters); }, []);

  const vendors = data?.vendors || [];
  const totalPayable = vendors.reduce((s, v) => s + parseFloat(v.total_payable || 0), 0);
  const totalPaid = vendors.reduce((s, v) => s + parseFloat(v.total_paid || 0), 0);
  const debitAdj = vendors.reduce((s, v) => s + parseFloat(v.debit_adjustments || 0), 0);
  const outstanding = totalPayable - totalPaid;

  const trend = (data?.monthly_trend || []).map((r) => ({
    name: monthLabel(r.month, r.year),
    spend: parseFloat(r.total_payable || 0),
  }));

  const cols = [
    { key: 'vendor_name', label: 'Vendor' },
    { key: 'po_type', label: 'PO Type', render: (r) => r.po_type || '—' },
    { key: 'total_bills', label: 'Bills', sortable: true },
    { key: 'total_payable', label: 'Total Payable', render: (r) => inr(r.total_payable), sortable: true },
    { key: 'total_paid', label: 'Paid', render: (r) => inr(r.total_paid) },
    { key: 'debit_adjustments', label: 'Debit Adj', render: (r) => inr(r.debit_adjustments) },
    { key: 'net_payable', label: 'Net Payable', render: (r) => inr(r.net_payable) },
  ];

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Vendor Spend</h1>
        <p className="text-sm text-gray-500">Vendor bills & debit adjustments</p>
      </div>

      <ReportFilters filters={filters} onChange={setFilters} onApply={load} fields={['dateRange']} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Payable" value={inr(totalPayable)} color="blue" />
        <MetricCard title="Total Paid" value={inr(totalPaid)} color="green" />
        <MetricCard title="Outstanding" value={inr(outstanding)} color="amber" />
        <MetricCard title="Debit Adjustments" value={inr(debitAdj)} color="purple" />
      </div>

      <ChartCard title="Monthly Vendor Spend">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={trend}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => `₹${(v / 100000).toFixed(1)}L`} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => inr(v)} />
            <Bar dataKey="spend" fill="#2563EB" name="Payable" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <DataTable columns={cols} rows={vendors} loading={loading} />
      <ExportButton reportType="vendor_spend" filters={filters} />
    </div>
  );
}
