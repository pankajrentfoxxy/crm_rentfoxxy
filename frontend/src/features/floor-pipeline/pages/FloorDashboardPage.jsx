import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Loader2, Package, TrendingUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchFloorDashboard } from '../floorPipelineApi';

function BarChart({ data, valueKey = 'count' }) {
  const max = Math.max(...data.map((d) => d[valueKey] || 0), 1);
  return (
    <div className="space-y-2">
      {data.map((row) => (
        <div key={row.stage_name} className="flex items-center gap-2 text-xs">
          <span className="w-32 truncate text-slate-600" title={row.stage_name}>{row.stage_name}</span>
          <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full"
              style={{ width: `${((row[valueKey] || 0) / max) * 100}%` }}
            />
          </div>
          <span className="w-8 text-right font-semibold">{row[valueKey] || 0}</span>
        </div>
      ))}
    </div>
  );
}

export default function FloorDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFloorDashboard()
      .then(({ data: res }) => {
        if (res.success) setData(res);
        else toast.error(res.message || 'Failed');
      })
      .catch((e) => toast.error(e.response?.data?.message || 'Dashboard failed'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }
  if (!data) return null;

  const activeTotal = (data.byStage || []).reduce((s, r) => s + (r.count || 0), 0);
  const inQc = (data.byStage || [])
    .filter((r) => ['QC1', 'QC2'].includes(r.stage_name))
    .reduce((s, r) => s + (r.count || 0), 0);
  const highlighted = (data.byStage || []).reduce((s, r) => s + (r.highlighted_count || 0), 0);
  const salesPri = data.priorityCounts?.sales_order || 0;
  const qcTotal = (data.qcFailRate?.passed || 0) + (data.qcFailRate?.failed || 0);
  const failPct = qcTotal ? Math.round(((data.qcFailRate?.failed || 0) / qcTotal) * 100) : 0;

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Floor Dashboard</h1>
        <p className="text-sm text-slate-500">Pipeline overview for floor managers</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Active Tickets', value: activeTotal, icon: TrendingUp, color: 'text-blue-600' },
          { label: 'In QC', value: inQc, icon: Package, color: 'text-indigo-600' },
          { label: 'Highlighted', value: highlighted, icon: AlertTriangle, color: 'text-amber-600' },
          { label: 'Sales Order Priority', value: salesPri, icon: AlertTriangle, color: 'text-red-600' }
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <k.icon className={`w-5 h-5 ${k.color} mb-2`} />
            <p className="text-2xl font-bold">{k.value}</p>
            <p className="text-xs text-slate-500">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="font-semibold mb-3">Stage distribution</h2>
          <BarChart data={data.byStage || []} />
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="font-semibold mb-3">QC fail rate (30 days)</h2>
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 rounded-full border-8 border-green-500 flex items-center justify-center text-lg font-bold"
              style={{ borderRightColor: failPct > 0 ? '#DC2626' : '#16A34A' }}>
              {failPct}%
            </div>
            <div className="text-sm text-slate-600">
              <p>Pass: {data.qcFailRate?.passed || 0}</p>
              <p>Fail: {data.qcFailRate?.failed || 0}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm overflow-x-auto">
        <h2 className="font-semibold mb-3">Technician load</h2>
        <table className="min-w-full text-sm">
          <thead className="text-xs text-slate-500 uppercase"><tr>
            <th className="text-left py-2">Technician</th><th className="text-left py-2">Active tickets</th>
          </tr></thead>
          <tbody>
            {(data.technicianLoad || []).map((t) => (
              <tr key={t.user_id} className="border-t">
                <td className="py-2">{t.name}</td>
                <td className="py-2">{t.active_tickets}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="font-semibold mb-2">Parts alerts ({data.partsAlerts?.length || 0})</h2>
          <ul className="text-sm space-y-2 max-h-48 overflow-y-auto">
            {(data.partsAlerts || []).map((p) => (
              <li key={p.request_id}>
                <Link to={`/floor-pipeline/tickets/${p.ticket_id}`} className="text-blue-600 hover:underline">
                  {p.ttspl_id || `#${p.ticket_id}`}
                </Link>
                {' — '}{p.part_name}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="font-semibold mb-2">Recent completions today</h2>
          <ul className="text-sm space-y-2">
            {(data.recentCompletions || []).map((t) => (
              <li key={t.ticket_id}>
                <Link to={`/floor-pipeline/tickets/${t.ticket_id}`} className="font-mono text-blue-700">
                  {t.ttspl_id}
                </Link>
                <span className="text-slate-500 ml-2 text-xs">
                  {t.completed_at ? new Date(t.completed_at).toLocaleTimeString() : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
