import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import { DollarSign, TrendingUp, AlertCircle, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { getManagerDashboard } from '../reportingApi';
import { inr, monthLabel, trend, LEAD_STATUS_COLORS } from '../reportingUtils';
import MetricCard from '../components/MetricCard';
import ChartCard from '../components/ChartCard';
import DataTable from '../components/DataTable';
import ExportButton from '../components/ExportButton';

const PIE_DATA_KEYS = [
  { key: 'qc_passed_available', name: 'Available', fill: '#16A34A' },
  { key: 'currently_rented', name: 'Rented', fill: '#2563EB' },
  { key: 'in_qc', name: 'In QC', fill: '#D97706' },
  { key: 'in_repair', name: 'In Repair', fill: '#EA580C' },
  { key: 'qc_failed', name: 'QC Failed', fill: '#DC2626' },
];

export default function ManagerDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getManagerDashboard();
      setData(res.data?.data || res.data);
    } catch {
      toast.error('Failed to load manager dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading || !data) {
    return <div className="p-6 text-gray-500">Loading manager dashboard…</div>;
  }

  const rev = data.revenue || {};
  const cur = rev.current_month || {};
  const last = rev.last_month || {};
  const inv = data.inventory || {};
  const leads = data.leads || {};
  const floor = data.floor || {};
  const support = data.support || {};
  const vendor = data.vendor || {};

  const revenueChart = (rev.last_6_months || []).map((r) => ({
    name: monthLabel(r.month, r.year),
    Invoiced: parseFloat(r.invoiced || 0),
    Collected: parseFloat(r.collected || 0),
  }));

  const pieData = PIE_DATA_KEYS
    .map((d) => ({ name: d.name, value: inv[d.key] || 0, fill: d.fill }))
    .filter((d) => d.value > 0);

  const leadChart = (leads.by_status || []).map((r) => ({
    status: r.status,
    count: r.count,
    fill: LEAD_STATUS_COLORS[r.status] || '#6B7280',
  }));

  const now = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const monthStart = new Date();
  monthStart.setDate(1);
  const exportFilters = {
    from: monthStart.toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  };

  const pendingCols = [
    { key: 'vendor_name', label: 'Vendor' },
    {
      key: 'month',
      label: 'Month',
      render: (r) => monthLabel(r.month, r.year),
    },
    { key: 'amount', label: 'Amount', render: (r) => inr(r.amount) },
    { key: 'status', label: 'Status' },
  ];

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Manager Dashboard</h1>
          <p className="text-sm text-gray-500">{now}</p>
        </div>
        <ExportButton reportType="revenue" filters={exportFilters} label="Export Revenue" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Monthly Invoiced"
          value={inr(cur.invoiced)}
          color="blue"
          icon={DollarSign}
          trend={trend(cur.invoiced, last.invoiced)}
        />
        <MetricCard
          title="Collected"
          value={inr(cur.collected)}
          color="green"
          icon={TrendingUp}
          trend={trend(cur.collected, last.collected)}
        />
        <MetricCard
          title="Outstanding"
          value={inr(cur.outstanding)}
          color="amber"
          icon={AlertCircle}
        />
        <MetricCard
          title="Active Leads"
          value={leads.total_active || 0}
          color="purple"
          icon={Users}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Revenue — Last 6 Months">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={revenueChart}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `₹${(v / 100000).toFixed(1)}L`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => inr(v)} />
              <Legend />
              <Bar dataKey="Invoiced" fill="#2563EB" />
              <Bar dataKey="Collected" fill="#16A34A" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Inventory Status">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData.length ? pieData : [{ name: 'Empty', value: 1, fill: '#e5e7eb' }]}
                cx="50%"
                cy="50%"
                outerRadius={90}
                dataKey="value"
                label={({ name, value }) => (value ? `${name}: ${value}` : '')}
              >
                {(pieData.length ? pieData : [{ fill: '#e5e7eb' }]).map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
              <Legend verticalAlign="bottom" />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Lead Pipeline">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={leadChart}>
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="status" width={80} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#6366F1">
                {leadChart.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="grid grid-cols-2 gap-4">
          <MetricCard title="Follow-ups Overdue" value={leads.follow_up_overdue || 0} color="red" />
          <MetricCard title="Converted This Month" value={leads.converted_this_month || 0} color="green" />
          <MetricCard title="Open Support" value={support.open || 0} color="amber" />
          <MetricCard title="Highlighted Floor Tickets" value={floor.highlighted || 0} color="red" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Floor — Tickets by Stage">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={floor.by_stage || []}>
              <XAxis dataKey="stage_name" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#6366F1" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Vendor Bills Pending</h3>
            <Link to="/vendor-billing/bills" className="text-xs text-blue-600 hover:underline">View all</Link>
          </div>
          <DataTable
            columns={pendingCols}
            rows={(vendor.pending_bills_list || []).slice(0, 5)}
            emptyText="No pending vendor bills"
          />
        </div>
      </div>
    </div>
  );
}
