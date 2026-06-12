import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import toast from 'react-hot-toast';
import usePermission from '../../../hooks/usePermission';
import { getSalesDashboard, getSalespersonReport } from '../reportingApi';
import { defaultRange, LEAD_STATUS_COLORS } from '../reportingUtils';
import MetricCard from '../components/MetricCard';
import ChartCard from '../components/ChartCard';
import DataTable from '../components/DataTable';

export default function SalesDashboardPage() {
  const { user } = usePermission();
  const isSales = user?.role === 'sales';
  const [data, setData] = useState(null);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, teamRes] = await Promise.all([
        getSalesDashboard(),
        !isSales ? getSalespersonReport(defaultRange()) : Promise.resolve(null),
      ]);
      setData(dashRes.data?.data || dashRes.data);
      if (teamRes) {
        setTeam(teamRes.data?.salespeople || []);
      }
    } catch {
      toast.error('Failed to load sales dashboard');
    } finally {
      setLoading(false);
    }
  }, [isSales]);

  useEffect(() => { load(); }, [load]);

  if (loading || !data) {
    return <div className="p-6 text-gray-500">Loading sales dashboard…</div>;
  }

  const leads = data.my_leads || {};
  const quot = data.quotations || {};
  const conv = data.conversions || {};

  const leadChart = (leads.by_status || []).map((r) => ({
    status: r.status,
    count: r.count,
    fill: LEAD_STATUS_COLORS[r.status] || '#6B7280',
  }));

  const teamCols = [
    { key: 'name', label: 'Salesperson', render: (r) => r.name },
    { key: 'active', label: 'Active Leads', render: (r) => r.leads?.active ?? 0, sortable: true },
    { key: 'converted', label: 'Converted', render: (r) => r.leads?.converted ?? 0, sortable: true },
    { key: 'sent', label: 'Quotations', render: (r) => r.quotations?.sent ?? 0 },
    { key: 'hit_rate', label: 'Hit Rate', render: (r) => `${r.quotations?.hit_rate_pct ?? 0}%` },
    { key: 'overdue', label: 'Overdue Follow-ups', render: (r) => r.follow_ups?.overdue ?? 0, sortable: true },
  ];

  const teamRows = team.map((sp) => ({
    ...sp,
    active: sp.leads?.active,
    converted: sp.leads?.converted,
    sent: sp.quotations?.sent,
    hit_rate: sp.quotations?.hit_rate_pct,
    overdue: sp.follow_ups?.overdue,
  }));

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          {isSales ? 'My Performance' : 'Sales Dashboard'}
        </h1>
        <p className="text-sm text-gray-500">Leads, quotations & conversions</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="My Active Leads" value={leads.total || 0} color="purple" />
        <MetricCard title="Follow-ups Today" value={leads.follow_up_today || 0} color="blue" />
        <MetricCard title="Follow-ups Overdue" value={leads.follow_up_overdue || 0} color="red" />
        <MetricCard title="Converted This Month" value={conv.this_month || 0} color="green" />
      </div>

      <ChartCard title="My Leads by Status">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={leadChart}>
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="status" width={80} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="count">
              {leadChart.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard title="Quotations Sent (month)" value={quot.sent_this_month || 0} color="blue" />
        <MetricCard title="Quotations Approved" value={quot.approved_this_month || 0} color="green" />
        <MetricCard title="Hit Rate" value={`${quot.hit_rate_pct || 0}%`} color="amber" />
      </div>

      {!isSales && team.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Team Overview</h3>
          <DataTable columns={teamCols} rows={teamRows} />
        </div>
      )}
    </div>
  );
}
