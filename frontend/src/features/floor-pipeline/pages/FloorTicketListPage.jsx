import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutGrid, List, Loader2, Search } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../../../context/AuthContext';
import { fetchFloorTickets } from '../floorPipelineApi';
import useAutoRefresh from '../hooks/useAutoRefresh';
import TicketCard from '../components/TicketCard';
import AssignmentModal from '../components/AssignmentModal';
import {
  STAGE_GROUPS,
  STAGE_COLUMN_STYLE,
  configSummary,
  isFloorManagerRole,
  isQcRole,
  priorityBadge,
  stageCategory,
  stageCategoryBadge,
  ticketAgeDays
} from '../floorPipelineUi';

const VIEW_KEY = 'floor_pipeline_view';

export default function FloorTicketListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'kanban');
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState(searchParams.get('stage') || '');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [assignTicket, setAssignTicket] = useState(null);

  const fm = isFloorManagerRole(user?.role);

  const subtitle = useMemo(() => {
    if (fm) return 'All tickets';
    if (isQcRole(user?.role)) return 'QC queue';
    return 'My tickets';
  }, [user?.role, fm]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { view: 'in_progress' };
      if (search.trim()) params.search = search.trim();
      if (priorityFilter) params.priority = priorityFilter;
      if (typeFilter) params.ticket_type = typeFilter;
      if (stageFilter) params.stage_names = stageFilter;
      const { data } = await fetchFloorTickets(params);
      if (data.success) setTickets(data.tickets || []);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [search, priorityFilter, typeFilter, stageFilter]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const setViewMode = (v) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  const byStage = useMemo(() => {
    const map = {};
    STAGE_GROUPS.forEach((g) => g.stages.forEach((s) => { map[s] = []; }));
    tickets.forEach((t) => {
      const key = t.stage_name === 'Inventory' ? 'Inventory' : t.stage_name;
      if (map[key]) map[key].push(t);
      else map[key] = [t];
    });
    return map;
  }, [tickets]);

  const handleFloorManagerClick = (ticket) => {
    if (fm && ticket.stage_name === 'Floor Manager') {
      setAssignTicket(ticket);
    } else {
      navigate(`/floor-pipeline/tickets/${ticket.ticket_id}`);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Floor Pipeline</h1>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setViewMode('kanban')}
            className={`px-3 py-2 text-sm flex items-center gap-1 ${view === 'kanban' ? 'bg-blue-600 text-white' : 'bg-white'}`}
          >
            <LayoutGrid className="w-4 h-4" /> Kanban
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`px-3 py-2 text-sm flex items-center gap-1 ${view === 'table' ? 'bg-blue-600 text-white' : 'bg-white'}`}
          >
            <List className="w-4 h-4" /> Table
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm"
            placeholder="TTSPL ID, serial, model…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="rounded-lg border px-3 py-2 text-sm" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="">All stages</option>
          {STAGE_GROUPS.flatMap((g) => g.stages).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="rounded-lg border px-3 py-2 text-sm" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="">All priorities</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="sales_order">Sales Order</option>
        </select>
        <select className="rounded-lg border px-3 py-2 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="grn_qc">GRN QC</option>
          <option value="sales_order_qc">Sales Order QC</option>
          <option value="support">Support</option>
          <option value="general">General</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
      ) : view === 'kanban' ? (
        <div className="flex gap-4 overflow-x-auto pb-2 min-h-[420px]">
          {STAGE_GROUPS.map((group) => (
            <div key={group.label} className="flex gap-3 shrink-0">
              <div className="flex flex-col gap-3">
                <div className={`text-[10px] font-bold uppercase tracking-wider ${group.color} px-1 py-2 writing-mode-vertical`} style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                  {group.label}
                </div>
              </div>
              {group.stages.map((stage) => {
                const col = byStage[stage] || [];
                const style = STAGE_COLUMN_STYLE[stage] || STAGE_COLUMN_STYLE.default;
                return (
                  <div key={stage} className={`min-w-[260px] w-[260px] shrink-0 rounded-xl border-2 ${style} p-2 flex flex-col`}>
                    <div className="flex items-center justify-between px-1 py-2 mb-2">
                      <h3 className="text-xs font-bold text-slate-800">{stage}</h3>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold">{col.length}</span>
                    </div>
                    <div className="space-y-2 flex-1">
                      {col.map((t) => (
                        <TicketCard
                          key={t.ticket_id}
                          ticket={t}
                          pendingParts={t.part_requests_pending}
                          onCardClick={fm && stage === 'Floor Manager' ? handleFloorManagerClick : undefined}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-3 text-left">#</th>
                <th className="px-3 py-3 text-left">TTSPL</th>
                <th className="px-3 py-3 text-left">Config</th>
                <th className="px-3 py-3 text-left">Stage</th>
                <th className="px-3 py-3 text-left">Category</th>
                <th className="px-3 py-3 text-left">Priority</th>
                <th className="px-3 py-3 text-left">Assigned</th>
                <th className="px-3 py-3 text-left">QC Fails</th>
                <th className="px-3 py-3 text-left">Age</th>
                {fm ? <th className="px-3 py-3 text-left">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {tickets.map((t, i) => {
                const pri = priorityBadge(t.priority);
                const cat = stageCategory(t.stage_name);
                return (
                  <tr key={t.ticket_id} className="border-t hover:bg-slate-50">
                    <td className="px-3 py-3">{i + 1}</td>
                    <td className="px-3 py-3">
                      <Link to={`/floor-pipeline/tickets/${t.ticket_id}`} className="font-mono font-semibold text-blue-700">
                        {t.ttspl_id || '—'}
                      </Link>
                      {t.highlighted ? <span className="ml-1" title={t.highlighted_reason}>⚠</span> : null}
                    </td>
                    <td className="px-3 py-3 text-xs">{configSummary(t)}</td>
                    <td className="px-3 py-3">{t.stage_name}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${stageCategoryBadge(t.stage_name)}`}>{cat}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${pri.className}`}>{pri.label}</span>
                    </td>
                    <td className="px-3 py-3">{t.assigned_user_name || '—'}</td>
                    <td className="px-3 py-3">{t.qc_fail_count || 0}</td>
                    <td className="px-3 py-3">{ticketAgeDays(t.created_at)}</td>
                    {fm && t.stage_name === 'Floor Manager' ? (
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => setAssignTicket(t)}
                          className="text-xs text-blue-600 font-semibold hover:underline"
                        >
                          Assign
                        </button>
                      </td>
                    ) : fm ? <td className="px-3 py-3">—</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AssignmentModal
        ticket={assignTicket}
        open={!!assignTicket}
        onClose={() => setAssignTicket(null)}
        onAssigned={load}
      />
    </div>
  );
}
