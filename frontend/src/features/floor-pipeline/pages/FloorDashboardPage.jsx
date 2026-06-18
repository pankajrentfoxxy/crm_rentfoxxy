import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, Package, TrendingUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../../context/AuthContext';
import { fetchFloorDashboard, getFloorManagerQueue, getTeamMembers } from '../floorPipelineApi';
import { configSummary, isFloorManagerRole, priorityBadge } from '../floorPipelineUi';
import useAutoRefresh from '../hooks/useAutoRefresh';
import AssignmentModal from '../components/AssignmentModal';

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
  const { user } = useAuth();
  const fm = isFloorManagerRole(user?.role);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState([]);
  const [assignTicket, setAssignTicket] = useState(null);
  const [teamWorkload, setTeamWorkload] = useState({ hw: [], qc1: [], qc2: [] });

  const loadQueue = useCallback(() => {
    if (!fm) return;
    getFloorManagerQueue()
      .then(({ data: res }) => { if (res.success) setQueue(res.tickets || []); })
      .catch(() => setQueue([]));
  }, [fm]);

  const loadDashboard = useCallback(() => {
    fetchFloorDashboard()
      .then(({ data: res }) => {
        if (res.success) setData(res);
        else toast.error(res.message || 'Failed');
      })
      .catch((e) => toast.error(e.response?.data?.message || 'Dashboard failed'))
      .finally(() => setLoading(false));
    loadQueue();

    Promise.all([
      getTeamMembers('Hardware & Software'),
      getTeamMembers('QC1 Team'),
      getTeamMembers('QC2 Team'),
    ])
      .then(([hw, qc1, qc2]) => {
        setTeamWorkload({
          hw: hw.data?.members || [],
          qc1: qc1.data?.members || [],
          qc2: qc2.data?.members || [],
        });
      })
      .catch(() => setTeamWorkload({ hw: [], qc1: [], qc2: [] }));
  }, [loadQueue]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);
  useAutoRefresh(loadDashboard);

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

      {fm ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-2">Needs Assignment</h2>
          {queue.length === 0 ? (
            <div className="flex items-center gap-2 text-green-700 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-4 h-4" /> All tickets assigned
            </div>
          ) : (
            <>
              <p className="text-sm text-amber-800 mb-3">{queue.length} ticket(s) waiting in Floor Manager</p>
              <div className="rounded-xl border bg-white overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">TTSPL</th>
                      <th className="px-3 py-2 text-left">Config</th>
                      <th className="px-3 py-2 text-left">Priority</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-left">Created</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {queue.map((t) => {
                      const pri = priorityBadge(t.priority);
                      return (
                        <tr key={t.ticket_id} className="border-t">
                          <td className="px-3 py-2 font-mono font-semibold text-blue-700">{t.ttspl_id || '—'}</td>
                          <td className="px-3 py-2 text-xs">{configSummary(t)}</td>
                          <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pri.className}`}>{pri.label}</span></td>
                          <td className="px-3 py-2 text-xs">{t.ticket_type || 'grn_qc'}</td>
                          <td className="px-3 py-2 text-xs">{t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}</td>
                          <td className="px-3 py-2">
                            <button type="button" onClick={() => setAssignTicket(t)} className="text-xs font-semibold text-blue-600 hover:underline">
                              Assign Now
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ) : null}

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

      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <h2 className="font-semibold mb-4">Team workload</h2>
        <div className="grid lg:grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
              Hardware &amp; Software Team
            </h3>
            <ul className="space-y-2 text-sm">
              {teamWorkload.hw.length === 0 ? (
                <li className="text-slate-400 text-xs">No members</li>
              ) : (
                teamWorkload.hw.map((m) => (
                  <li key={m.user_id} className="flex justify-between gap-2 border-b border-slate-50 pb-2">
                    <span className="font-medium text-slate-800">{m.name}</span>
                    <span className="text-slate-500">{m.active_tickets || 0} active</span>
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">QC1 Team</h3>
              <ul className="space-y-2 text-sm">
                {teamWorkload.qc1.length === 0 ? (
                  <li className="text-slate-400 text-xs">No members</li>
                ) : (
                  teamWorkload.qc1.map((m) => (
                    <li key={m.user_id} className="flex justify-between gap-2 border-b border-slate-50 pb-2">
                      <span className="font-medium text-slate-800">{m.name}</span>
                      <span className="text-slate-500">{m.active_tickets || 0} active</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">QC2 Team</h3>
              <ul className="space-y-2 text-sm">
                {teamWorkload.qc2.length === 0 ? (
                  <li className="text-slate-400 text-xs">No members</li>
                ) : (
                  teamWorkload.qc2.map((m) => (
                    <li key={m.user_id} className="flex justify-between gap-2 border-b border-slate-50 pb-2">
                      <span className="font-medium text-slate-800">{m.name}</span>
                      <span className="text-slate-500">{m.active_tickets || 0} active</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </div>
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

      <AssignmentModal
        ticket={assignTicket}
        open={!!assignTicket}
        onClose={() => setAssignTicket(null)}
        onAssigned={loadQueue}
      />
    </div>
  );
}
