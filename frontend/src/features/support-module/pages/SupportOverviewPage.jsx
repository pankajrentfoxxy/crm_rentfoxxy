import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { Loader2 } from 'lucide-react';
import api from '../../../utils/api';
import MetricCard from '../../reporting/components/MetricCard';
import { formatRelative } from '../../../components/support/utils';

const TYPE_COLORS = {
  complaint: '#2563EB',
  replacement: '#8B5CF6',
  pickup: '#D97706',
  loan: '#14B8A6',
};

export default function SupportOverviewPage() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [avgHours, setAvgHours] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const [dash, recent, overdue, unassigned, techs, stats] = await Promise.all([
        api.get('/support/dashboard'),
        api.get('/support/tickets?view=active&limit=8'),
        api.get('/support/tickets?view=overdue&limit=10'),
        api.get('/support/tickets?view=pending_assign&limit=10'),
        api.get('/support/technicians'),
        api.get('/reports/support-stats', { params: { from, to } }).catch(() => ({ data: {} })),
      ]);
      setSummary(dash.data.summary || dash.data);
      setTickets(recent.data.tickets || []);
      setOverdueList(overdue.data.tickets || []);
      setUnassignedList(unassigned.data.tickets || []);
      setTechnicians(techs.data.technicians || []);
      setAvgHours(stats.data?.avg_resolution_hours ?? null);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const [overdueList, setOverdueList] = useState([]);
  const [unassignedList, setUnassignedList] = useState([]);

  useEffect(() => { load(); }, [load]);

  const typeChart = useMemo(() => {
    const counts = { complaint: 0, replacement: 0, pickup: 0, loan: 0 };
    tickets.forEach((t) => {
      (t.items || []).forEach((i) => {
        if (counts[i.item_type] != null) counts[i.item_type] += 1;
      });
    });
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value, fill: TYPE_COLORS[name] }));
  }, [tickets]);

  const replacementsActive = useMemo(() => {
    return tickets.filter((t) => t.has_replacement_pending || (t.items || []).some((i) => i.item_type === 'replacement' && !['resolved', 'closed'].includes(i.status))).length;
  }, [tickets]);

  const assignTicket = async (ticketId, userId) => {
    setAssigning(ticketId);
    try {
      await api.post(`/support/tickets/${ticketId}/assign-all`, { assigned_to: Number(userId) });
      load();
    } finally {
      setAssigning(null);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[#534AB7]" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <MetricCard title="Open Tickets" value={summary?.open_total ?? 0} color="blue" />
        <MetricCard title="Overdue (>48h)" value={summary?.overdue_total ?? 0} color="red" subtitle="Needs immediate attention" />
        <MetricCard title="Resolved Today" value={summary?.resolved_today ?? 0} color="green" />
        <MetricCard title="Pending Pickups" value={summary?.pending_pickups ?? 0} color="amber" />
        <MetricCard title="Replacements Active" value={replacementsActive} color="purple" />
        <MetricCard title="Avg Resolution" value={avgHours != null ? `${avgHours}h` : '—'} color="blue" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Tickets by Type</h3>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={typeChart.length ? typeChart : [{ name: 'None', value: 1, fill: '#e5e7eb' }]} dataKey="value" cx="50%" cy="50%" outerRadius={80} label>
                  {(typeChart.length ? typeChart : [{ fill: '#e5e7eb' }]).map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 overflow-x-auto">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Recent Tickets</h3>
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="p-2">#</th><th className="p-2">Customer</th><th className="p-2">Type</th>
                <th className="p-2">Status</th><th className="p-2">Age</th><th className="p-2">Assigned</th>
              </tr>
            </thead>
            <tbody>
              {tickets.slice(0, 8).map((t) => {
                const type = t.ticket_category || t.items?.[0]?.item_type || 'complaint';
                const tech = [...new Set((t.items || []).map((i) => i.assigned_to_name).filter(Boolean))].join(', ') || '—';
                const ageH = t.hours_since_last_update || 0;
                return (
                  <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/support/tickets/${t.id}`)}>
                    <td className="p-2 font-mono text-xs">#{t.id}</td>
                    <td className="p-2">{t.customer_name}</td>
                    <td className="p-2"><span className="text-xs px-2 py-0.5 rounded-full capitalize" style={{ background: `${TYPE_COLORS[type]}22`, color: TYPE_COLORS[type] }}>{type}</span></td>
                    <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded-full ${t.status === 'closed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{t.status}</span></td>
                    <td className={`p-2 text-xs ${ageH > 48 ? 'text-red-600 font-medium' : ''}`}>{ageH < 24 ? `${Math.round(ageH)}h ago` : `${Math.round(ageH / 24)}d`}</td>
                    <td className="p-2 text-xs">{tech}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Overdue Tickets</h3>
          {overdueList.length ? overdueList.slice(0, 5).map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 py-2 border-b border-gray-50 text-sm">
              <div>
                <p className="font-medium">{t.customer_name}</p>
                <p className="text-xs text-gray-500">{t.items?.[0]?.issue_category_label || 'Issue'}</p>
                <p className="text-xs text-red-600 font-medium">{Math.round(t.hours_since_last_update || 0)}h overdue</p>
              </div>
              <Link to={`/support/tickets/${t.id}`} className="text-blue-600 text-xs hover:underline shrink-0">View</Link>
            </div>
          )) : (
            <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">No overdue tickets</p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Unassigned Tickets</h3>
          {unassignedList.length ? unassignedList.slice(0, 5).map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-gray-50 text-sm">
              <div>
                <p className="font-medium">{t.customer_name}</p>
                <p className="text-xs text-gray-500 capitalize">{t.items?.[0]?.item_type} · {formatRelative(t.created_at)}</p>
              </div>
              <select
                className="border rounded-lg text-xs px-2 py-1"
                disabled={assigning === t.id}
                defaultValue=""
                onChange={(e) => { if (e.target.value) assignTicket(t.id, e.target.value); }}
              >
                <option value="">Assign…</option>
                {technicians.map((tech) => <option key={tech.user_id} value={tech.user_id}>{tech.name}</option>)}
              </select>
            </div>
          )) : (
            <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">All tickets assigned</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 overflow-x-auto">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Technician Workload</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="p-2">Technician</th><th className="p-2">Active</th><th className="p-2">Open Items</th><th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {technicians.map((tech) => (
              <tr key={tech.user_id} className="border-b border-gray-50">
                <td className="p-2 font-medium">{tech.name}</td>
                <td className="p-2">{tech.open_ticket_count ?? 0}</td>
                <td className="p-2">{tech.open_item_count ?? 0}</td>
                <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded-full ${tech.active ? 'bg-green-100 text-green-700' : 'bg-gray-100'}`}>{tech.active ? 'Active' : 'Inactive'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
