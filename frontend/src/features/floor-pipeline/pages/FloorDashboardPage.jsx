import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, Package, Search, TrendingUp, Factory } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader, StatCard, ListPagination } from '../../../components/ui/primitives';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import usePermission from '../../../hooks/usePermission';
import { fetchFloorDashboard, getFloorManagerQueue, getTeamMembers } from '../floorPipelineApi';
import { configSummary, priorityBadge, resolveTicketTtspl } from '../floorPipelineUi';
import useAutoRefresh from '../hooks/useAutoRefresh';
import AssignmentModal from '../components/AssignmentModal';

const QUEUE_PAGE_SIZE = 10;

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
  const { canEdit } = usePermission();
  const canManageQueue = canEdit('floor_pipeline') || canEdit('floor_tickets');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState([]);
  const [assignTicket, setAssignTicket] = useState(null);
  const [teamWorkload, setTeamWorkload] = useState({ hw: [], qc1: [], qc2: [] });
  const [queueSearch, setQueueSearch] = useState('');
  const debouncedQueueSearch = useDebouncedValue(queueSearch.trim(), 320);
  const [queuePage, setQueuePage] = useState(1);
  const [queuePagination, setQueuePagination] = useState({ page: 1, totalPages: 1, total: 0, limit: QUEUE_PAGE_SIZE });

  const loadQueue = useCallback(() => {
    if (!canManageQueue) return;
    getFloorManagerQueue({
      search: debouncedQueueSearch || undefined,
      page: queuePage,
      limit: QUEUE_PAGE_SIZE,
    })
      .then(({ data: res }) => {
        if (res.success) {
          setQueue(res.tickets || []);
          if (res.pagination) setQueuePagination(res.pagination);
        }
      })
      .catch(() => setQueue([]));
  }, [canManageQueue, debouncedQueueSearch, queuePage]);

  const loadDashboard = useCallback(() => {
    fetchFloorDashboard()
      .then(({ data: res }) => {
        if (res.success) setData(res);
        else toast.error(res.message || 'Failed');
      })
      .catch((e) => toast.error(e.response?.data?.message || 'Dashboard failed'))
      .finally(() => setLoading(false));

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
  }, []);

  const refresh = useCallback(() => {
    loadDashboard();
    loadQueue();
  }, [loadDashboard, loadQueue]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);
  useEffect(() => { loadQueue(); }, [loadQueue]);
  useEffect(() => { setQueuePage(1); }, [debouncedQueueSearch]);
  useAutoRefresh(refresh);

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
      <PageHeader title="Floor Dashboard" subtitle="Pipeline overview" icon={Factory} />

      {canManageQueue ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-2">Needs Assignment</h2>
          <div className="relative max-w-md mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              className="w-full rounded-lg border bg-white pl-9 pr-3 py-2 text-sm"
              placeholder="TTSPL ID, serial, model…"
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
            />
          </div>
          {queue.length === 0 && !debouncedQueueSearch ? (
            <div className="flex items-center gap-2 text-green-700 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-4 h-4" /> All tickets assigned
            </div>
          ) : queue.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">No tickets match your search</p>
          ) : (
            <>
              <p className="text-sm text-amber-800 mb-3">
                {queuePagination.total || queue.length} ticket(s) waiting in Floor Manager
              </p>
              {/* Mobile cards */}
              <div className="grid gap-2 sm:hidden">
                {queue.map((t) => {
                  const pri = priorityBadge(t.priority);
                  return (
                    <div key={t.ticket_id} className="rounded-xl border bg-white p-3 shadow-sm space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-blue-700">{resolveTicketTtspl(t) || '—'}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pri.className}`}>{pri.label}</span>
                      </div>
                      <p className="text-xs text-slate-600">{configSummary(t)}</p>
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                        <span className="text-xs text-slate-400">{t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}</span>
                        <button type="button" onClick={() => setAssignTicket(t)} className="text-sm font-semibold text-blue-600">Assign Now</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="hidden sm:block rounded-xl border bg-white overflow-x-auto">
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
                          <td className="px-3 py-2 font-mono font-semibold text-blue-700">{resolveTicketTtspl(t) || '—'}</td>
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
              <ListPagination
                page={queuePage}
                totalPages={queuePagination.totalPages || 1}
                total={queuePagination.total || 0}
                pageSize={QUEUE_PAGE_SIZE}
                onPageChange={setQueuePage}
              />
            </>
          )}
        </section>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Active Tickets" value={activeTotal} icon={TrendingUp} tone="blue" />
        <StatCard label="In QC" value={inQc} icon={Package} tone="purple" />
        <StatCard label="Highlighted" value={highlighted} icon={AlertTriangle} tone="amber" />
        <StatCard label="Sales Order Priority" value={salesPri} icon={AlertTriangle} tone="red" />
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
                  {resolveTicketTtspl(p) || `#${p.ticket_id}`}
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
                  {resolveTicketTtspl(t) || '—'}
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
        onAssigned={refresh}
      />
    </div>
  );
}
