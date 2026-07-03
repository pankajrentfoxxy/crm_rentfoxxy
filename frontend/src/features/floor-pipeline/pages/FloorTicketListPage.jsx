import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutGrid, List, Loader2, Search, Factory } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PageHeader, ListPagination, DateRangeFilter } from '../../../components/ui/primitives';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import { useAuth } from '../../../context/AuthContext';
import usePermission from '../../../hooks/usePermission';
import { fetchFloorTickets } from '../floorPipelineApi';
import useAutoRefresh from '../hooks/useAutoRefresh';
import TicketCard from '../components/TicketCard';
import AssignmentModal from '../components/AssignmentModal';
import {
  canAssignFloorTickets,
  isFloorAssignedDataOnly,
} from '../floorPipelineAccess';
import {
  STAGE_GROUPS,
  STAGE_COLUMN_STYLE,
  configSummary,
  isFloorManagerRole,
  isQcRole,
  isDispatchQcRole,
  priorityBadge,
  stageCategory,
  stageCategoryBadge,
  ticketAgeDays,
  resolveTicketTtspl,
  ticketStatusLabel,
  ticketStatusBadgeClass,
} from '../floorPipelineUi';

const VIEW_KEY = 'floor_pipeline_view';
const PAGE_SIZE = 25;

export default function FloorTicketListPage() {
  const navigate = useNavigate();
  const { user, isAssignedDataOnly } = useAuth();
  const { canEdit } = usePermission();
  const canAssign = canAssignFloorTickets(canEdit, isAssignedDataOnly);
  const allDataScope = !isFloorAssignedDataOnly(isAssignedDataOnly);
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'kanban');
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 320);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const stageFilter = searchParams.get('stage') || '';
  const [priorityFilter, setPriorityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [assignTicket, setAssignTicket] = useState(null);

  const fm = isFloorManagerRole(user?.role);

  const updateStageFilter = useCallback((value) => {
    setPage(1);
    const next = new URLSearchParams(searchParams);
    if (value) next.set('stage', value);
    else next.delete('stage');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const subtitle = useMemo(() => {
    if (stageFilter === 'QC1,QC2') return 'QC Queue';
    if (stageFilter === 'Chip Level Repair') return 'Chip Level Repair';
    if (stageFilter === 'Body & Paint') return 'Body & Paint';
    if (stageFilter) return stageFilter;
    if (allDataScope && (canAssign || fm)) return 'All tickets';
    if (isDispatchQcRole(user?.role)) return 'Dispatch QC queue';
    if (isQcRole(user?.role)) return 'QC queue';
    return 'My tickets';
  }, [stageFilter, user?.role, fm, canAssign, allDataScope]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { view: 'in_progress' };
      if (debouncedSearch) params.search = debouncedSearch;
      if (priorityFilter) params.priority = priorityFilter;
      if (typeFilter) params.ticket_type = typeFilter;
      if (stageFilter) params.stage_names = stageFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      params.page = page;
      params.limit = PAGE_SIZE;
      const { data } = await fetchFloorTickets(params);
      if (data.success) {
        setTickets(data.tickets || []);
        if (data.pagination) {
          setPagination(data.pagination);
        } else {
          setPagination({ page: 1, totalPages: 1, total: data.tickets?.length || 0, limit: PAGE_SIZE });
        }
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, priorityFilter, typeFilter, stageFilter, page, dateFrom, dateTo]);

  useEffect(() => { setPage(1); }, [debouncedSearch, priorityFilter, typeFilter, stageFilter, view, dateFrom, dateTo]);

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
    if (canAssign && ticket.stage_name === 'Floor Manager') {
      setAssignTicket(ticket);
    } else {
      navigate(`/floor-pipeline/tickets/${ticket.ticket_id}`);
    }
  };

  const renderAssignAction = (ticket) => {
    if (!canAssign) return null;
    if (ticket.stage_name === 'Floor Manager') {
      return (
        <button
          type="button"
          onClick={() => setAssignTicket(ticket)}
          className="text-xs text-blue-600 font-semibold hover:underline"
        >
          Assign
        </button>
      );
    }
    if (ticket.stage_name === 'Inventory') return '—';
    return (
      <button
        type="button"
        onClick={() => setAssignTicket(ticket)}
        className="text-xs text-slate-600 font-semibold hover:underline"
      >
        Reassign
      </button>
    );
  };

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Floor Pipeline"
        subtitle={subtitle}
        icon={Factory}
        actions={(
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => { setPage(1); setViewMode('kanban'); }}
              className={`px-3 min-h-[40px] text-sm flex items-center gap-1 ${view === 'kanban' ? 'bg-blue-600 text-white' : 'bg-white'}`}
            >
              <LayoutGrid className="w-4 h-4" /> Kanban
            </button>
            <button
              type="button"
              onClick={() => { setPage(1); setViewMode('table'); }}
              className={`px-3 min-h-[40px] text-sm flex items-center gap-1 ${view === 'table' ? 'bg-blue-600 text-white' : 'bg-white'}`}
            >
              <List className="w-4 h-4" /> Table
            </button>
          </div>
        )}
      />

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
        <select className="rounded-lg border px-3 py-2 text-sm" value={stageFilter} onChange={(e) => updateStageFilter(e.target.value)}>
          <option value="">All stages</option>
          <option value="QC1,QC2">QC Queue (QC1 + QC2)</option>
          {STAGE_GROUPS.flatMap((g) => g.stages).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="rounded-lg border px-3 py-2 text-sm" value={priorityFilter} onChange={(e) => { setPage(1); setPriorityFilter(e.target.value); }}>
          <option value="">All priorities</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="sales_order">Sales Order</option>
        </select>
        <select className="rounded-lg border px-3 py-2 text-sm" value={typeFilter} onChange={(e) => { setPage(1); setTypeFilter(e.target.value); }}>
          <option value="">All types</option>
          <option value="grn_qc">GRN QC</option>
          <option value="sales_order_qc">Sales Order QC</option>
          <option value="support">Support</option>
          <option value="general">General</option>
        </select>
        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          fromLabel="Created from"
          toLabel="Created to"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
      ) : view === 'kanban' ? (
        <>
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
                        <div key={t.ticket_id}>
                          <TicketCard
                            ticket={t}
                            pendingParts={t.part_requests_pending}
                            onCardClick={canAssign && stage === 'Floor Manager' ? handleFloorManagerClick : undefined}
                          />
                          {canAssign && stage !== 'Floor Manager' && stage !== 'Inventory' ? (
                            <div className="mt-1 flex justify-end px-1">
                              <button
                                type="button"
                                onClick={() => setAssignTicket(t)}
                                className="text-[11px] text-slate-600 font-semibold hover:underline"
                              >
                                Reassign
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <ListPagination
          page={page}
          totalPages={pagination.totalPages || 1}
          total={pagination.total || 0}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
        </>
      ) : (
        <>
        {/* Mobile: cards */}
        <div className="grid gap-3 sm:hidden">
          {tickets.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-8">No tickets</p>
          ) : tickets.map((t) => (
            <div key={t.ticket_id} className="relative">
              <TicketCard
                ticket={t}
                pendingParts={t.part_requests_pending}
                onCardClick={canAssign && t.stage_name === 'Floor Manager' ? handleFloorManagerClick : undefined}
              />
              {canAssign && t.stage_name !== 'Inventory' ? (
                <div className="mt-1 flex justify-end px-1">
                  {renderAssignAction(t)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="hidden sm:block rounded-xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
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
                {canAssign ? <th className="px-3 py-3 text-left">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {tickets.length === 0 ? (
                <tr>
                  <td colSpan={canAssign ? 10 : 9} className="px-3 py-8 text-center text-slate-500">No tickets</td>
                </tr>
              ) : tickets.map((t, i) => {
                const pri = priorityBadge(t.priority);
                const cat = stageCategory(t.stage_name);
                const rowNum = (page - 1) * PAGE_SIZE + i + 1;
                const ttspl = resolveTicketTtspl(t);
                return (
                  <tr key={t.ticket_id} className="border-t hover:bg-slate-50">
                    <td className="px-3 py-3">{rowNum}</td>
                    <td className="px-3 py-3">
                      <Link to={`/floor-pipeline/tickets/${t.ticket_id}`} className="font-mono font-semibold text-blue-700">
                        {ttspl || '—'}
                      </Link>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">#{t.ticket_id}</p>
                      {['diagnosis_failed', 'out_for_repair'].includes(t.status) ? (
                        <span className={`inline-block mt-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${ticketStatusBadgeClass(t.status)}`}>
                          {ticketStatusLabel(t.status)}
                        </span>
                      ) : null}
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
                    {canAssign ? (
                      <td className="px-3 py-3">{renderAssignAction(t)}</td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ListPagination
          page={page}
          totalPages={pagination.totalPages || 1}
          total={pagination.total || 0}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
        </>
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
