import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Search, Download, Plus, MessageSquare } from 'lucide-react';
import api from '../../utils/api';
import { canCloseSupportTicket, isSupportLead } from '../../utils/supportAccess';
import { useAuth } from '../../context/AuthContext';
import { assigneeOptionLabel, displayStatus, formatRelative, formatTicketId, podUrl, ticketCanChangeAssignee, ticketHasUnassignedAssigneeSlots, ticketPickupKind, ticketSubTypeLabel } from './utils';
import TtsplHistoryDrawer from '../../features/floor-pipeline/components/TtsplHistoryDrawer';
import ReturnDcNumberLink from './components/ReturnDcNumberLink';
import { ListPagination } from '../../components/ui/primitives';

function ticketRdcNumber(ticket) {
  if (ticket?.return_dc_number) return ticket.return_dc_number;
  const fromItem = (ticket?.items || []).find((it) => it.return_dc_number);
  return fromItem?.return_dc_number || null;
}

const PAGE_SIZE = 25;

const PRIMARY_TYPE_CHIPS = [
  { key: '', label: 'All', countKey: 'all' },
  { key: 'complaint', label: 'Complaint', countKey: 'complaint' },
  { key: 'pickup', label: 'Pickup', countKey: 'pickup' },
  { key: 'replacement', label: 'Replacement', countKey: 'replacement' },
];

const LIFECYCLE_TABS = [
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
];

const OPEN_STATUS_TABS = [
  { key: 'all', label: 'All', view: 'active' },
  { key: 'open', label: 'Not started', view: 'active', status: 'open' },
  { key: 'progress', label: 'In Progress', view: 'active', status: 'in_progress' },
  { key: 'overdue', label: 'Overdue', view: 'overdue' },
  { key: 'pickup', label: 'Pending Pickup', view: 'pickups' },
];

const VALID_OPEN_TAB_KEYS = new Set(OPEN_STATUS_TABS.map((t) => t.key));

function readFiltersFromParams(searchParams) {
  const rawLifecycle = searchParams.get('status');
  const legacyClosedTab = searchParams.get('tab') === 'closed';
  const lifecycle = rawLifecycle === 'closed' || (!rawLifecycle && legacyClosedTab) ? 'closed' : 'open';
  const rawTab = searchParams.get('tab') || 'all';
  return {
    lifecycle,
    statusTab: lifecycle === 'closed'
      ? 'closed'
      : (VALID_OPEN_TAB_KEYS.has(rawTab) ? rawTab : 'all'),
    debounced: searchParams.get('search') || '',
    typeFilter: searchParams.get('type') || '',
    pickupKindFilter: searchParams.get('pickup_type') || '',
    priorityFilter: searchParams.get('priority') || '',
    assignFilter: searchParams.get('assignee') || '',
    dateFrom: searchParams.get('date_from') || '',
    dateTo: searchParams.get('date_to') || '',
    page: Math.max(1, parseInt(searchParams.get('page') || '1', 10)),
  };
}

const TYPE_BADGE = {
  complaint: 'bg-blue-100 text-blue-800',
  replacement: 'bg-purple-100 text-purple-800',
  pickup: 'bg-amber-100 text-amber-800',
  loan: 'bg-teal-100 text-teal-800',
};

const PICKUP_KIND_BADGE = {
  repair: 'bg-orange-100 text-orange-800',
  return: 'bg-emerald-100 text-emerald-800',
  mixed: 'bg-slate-100 text-slate-700',
};

function primaryType(ticket) {
  const types = (ticket.items || []).map((i) => i.item_type);
  return types[0] || ticket.ticket_category || 'complaint';
}

function primaryCategory(ticket) {
  const item = (ticket.items || [])[0];
  return item?.issue_category_label || item?.issue_category_name || '—';
}

function issuePreviewText(ticket) {
  const item = (ticket.items || []).find((i) => i.remarks || i.issue_category_label || i.issue_category_name)
    || (ticket.items || [])[0];
  const category = item?.issue_category_label || item?.issue_category_name || null;
  const remarks = (item?.remarks || ticket.top_level_remarks || '').trim();
  if (!category && !remarks) return 'No issue details recorded.';
  if (category && remarks) return `${category}\n\n${remarks}`;
  return category || remarks;
}

function assignedLabel(ticket) {
  const names = [...new Set((ticket.items || []).map((i) => i.assigned_to_name).filter(Boolean))];
  if (!names.length) return 'Unassigned';
  return names.join(', ');
}

function isUnassigned(ticket) {
  return ticketHasUnassignedAssigneeSlots(ticket);
}

function AssigneeSelect({ ticket, technicians, onAssign }) {
  const unassigned = isUnassigned(ticket);
  return (
    <select
      className="text-xs border rounded px-1 py-0.5 max-w-[140px]"
      defaultValue=""
      onChange={(e) => { if (e.target.value) onAssign(ticket.id, e.target.value); e.target.value = ''; }}
    >
      <option value="">{unassigned ? 'Assign' : 'Reassign'}</option>
      {technicians.map((tech) => (
        <option key={tech.user_id} value={tech.user_id}>{assigneeOptionLabel(tech)}</option>
      ))}
    </select>
  );
}

function IssueCommentPreview({ ticket }) {
  const text = issuePreviewText(ticket);
  return (
    <span className="support-issue-preview relative inline-flex">
      <button
        type="button"
        className="inline-flex items-center justify-center min-h-[32px] min-w-[32px] rounded-lg text-slate-500 hover:text-[#534AB7] hover:bg-slate-100"
        aria-label="View issue comment"
        title="Issue / comment"
      >
        <MessageSquare className="w-4 h-4" />
      </button>
      <span className="support-issue-popover" role="tooltip">
        <span className="block text-[10px] uppercase tracking-wide text-slate-400 mb-1">Reported issue</span>
        <span className="whitespace-pre-wrap break-words">{text}</span>
      </span>
    </span>
  );
}

function SubTypeBadge({ ticket }) {
  const label = ticket.pickup_kind_label || ticketSubTypeLabel(ticket);
  if (!label) return <span className="text-slate-400">—</span>;
  const kind = ticket.pickup_kind || ticketPickupKind(ticket);
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${PICKUP_KIND_BADGE[kind] || 'bg-slate-100 text-slate-700'}`}>
      {label.replace(' Pickup', '')}
    </span>
  );
}

function TypeBadges({ ticket }) {
  const pType = primaryType(ticket);
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${TYPE_BADGE[pType] || 'bg-slate-100'}`}>
      {pType}
    </span>
  );
}

export default function SupportTicketList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canCreate = isSupportLead(user);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState({});
  const [technicians, setTechnicians] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [bulkTech, setBulkTech] = useState('');
  const [historyTtspl, setHistoryTtspl] = useState(null);

  const {
    lifecycle, statusTab, debounced, typeFilter, pickupKindFilter, priorityFilter,
    assignFilter, dateFrom, dateTo, page,
  } = useMemo(() => readFiltersFromParams(searchParams), [searchParams]);

  const [search, setSearch] = useState(debounced);
  const [typeCounts, setTypeCounts] = useState({
    all: 0, complaint: 0, pickup: 0, repair_pickup: 0, return_pickup: 0, replacement: 0
  });
  const [total, setTotal] = useState(0);

  const listQueryString = searchParams.toString();
  const ticketLinkProps = (id) => ({
    to: `/support/tickets/${id}`,
    state: { ticketsListSearch: listQueryString },
  });

  const patchParams = useCallback((patch) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([key, value]) => {
        if (value === '' || value == null || value === undefined || (key === 'page' && Number(value) <= 1)) {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      });
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    setSearch(debounced);
  }, [debounced]);

  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = search.trim();
      if (trimmed !== debounced) {
        patchParams({ search: trimmed, page: null });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search, debounced, patchParams]);

  useEffect(() => {
    setSelected(new Set());
  }, [lifecycle, statusTab, debounced, typeFilter, pickupKindFilter, priorityFilter, assignFilter, dateFrom, dateTo, page]);

  const activeTab = lifecycle === 'closed'
    ? { key: 'closed', view: 'closed' }
    : (OPEN_STATUS_TABS.find((t) => t.key === statusTab) || OPEN_STATUS_TABS[0]);

  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (debounced) params.set('search', debounced);
    params.set('view', activeTab.view);
    if (lifecycle === 'open') {
      if (activeTab.status === 'in_progress') params.set('status_tab', 'in_progress');
      else if (statusTab === 'open') params.set('status_tab', 'open');
    }
    if (priorityFilter) params.set('priority', priorityFilter);
    if (assignFilter) params.set('assignee', assignFilter);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    return params;
  }, [debounced, activeTab.view, activeTab.status, lifecycle, statusTab, priorityFilter, assignFilter, dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildFilterParams();
      if (typeFilter && ['complaint', 'pickup', 'replacement'].includes(typeFilter)) {
        params.set('type', typeFilter);
      }
      if (pickupKindFilter && ['repair', 'return'].includes(pickupKindFilter)) {
        params.set('pickup_type', pickupKindFilter);
      }
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String((page - 1) * PAGE_SIZE));
      const countParams = buildFilterParams();
      const [{ data }, countsRes] = await Promise.all([
        api.get(`/support/tickets?${params}`),
        api.get(`/support/tickets/counts?${countParams}`)
      ]);
      setTickets(data.tickets || []);
      setTotal(data.total ?? 0);
      setTypeCounts(countsRes.data.counts || {
        all: 0, complaint: 0, pickup: 0, repair_pickup: 0, return_pickup: 0, replacement: 0
      });
    } catch {
      setTickets([]);
      setTotal(0);
      setTypeCounts({ all: 0, complaint: 0, pickup: 0, repair_pickup: 0, return_pickup: 0, replacement: 0 });
    } finally {
      setLoading(false);
    }
  }, [buildFilterParams, typeFilter, pickupKindFilter, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/support/badges').then((r) => setBadges(r.data.badges || {})).catch(() => setBadges({}));
    if (isSupportLead(user)) {
      api.get('/support/technicians').then((r) => setTechnicians(r.data.technicians || [])).catch(() => setTechnicians([]));
    }
  }, [user]);

  const filtered = useMemo(() => {
    let list = tickets;
    if (typeFilter === 'loan') {
      list = list.filter((t) => (t.items || []).some((i) => i.item_type === 'loan'));
    }
    return [...list].sort((a, b) => Number(b.id) - Number(a.id));
  }, [tickets, typeFilter]);

  const handleAssign = async (ticketId, assignedTo) => {
    await api.post(`/support/tickets/${ticketId}/assign-all`, { assigned_to: Number(assignedTo) });
    load();
  };

  const handleClose = async (ticketId) => {
    if (!window.confirm('Close this ticket?')) return;
    await api.post(`/support/tickets/${ticketId}/close`, { force: true });
    load();
  };

  const handleBulkAssign = async () => {
    if (!bulkTech || !selected.size) return;
    await Promise.all([...selected].map((id) => api.post(`/support/tickets/${id}/assign-all`, { assigned_to: Number(bulkTech) })));
    setSelected(new Set());
    setBulkTech('');
    load();
  };

  const exportCsv = async () => {
    const params = buildFilterParams();
    if (typeFilter && ['complaint', 'pickup', 'replacement'].includes(typeFilter)) {
      params.set('type', typeFilter);
    }
    if (pickupKindFilter && ['repair', 'return'].includes(pickupKindFilter)) {
      params.set('pickup_type', pickupKindFilter);
    }
    const res = await api.get(`/support/tickets/export?${params}`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'support-tickets.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((t) => t.id)));
  };

  const clearFilters = () => {
    setSearch('');
    setSearchParams(
      lifecycle === 'closed' ? { status: 'closed' } : { status: 'open' },
      { replace: true }
    );
    setSelected(new Set());
  };

  const handleTypeChipClick = (chip) => {
    patchParams({
      type: chip.key || null,
      pickup_type: chip.key === 'pickup' ? pickupKindFilter || null : null,
      page: null,
    });
  };

  const isTypeChipActive = (chip) => {
    if (chip.key === 'pickup') return typeFilter === 'pickup';
    return typeFilter === chip.key && !pickupKindFilter;
  };

  const handleTypeSelect = (value) => {
    if (value === 'repair_pickup') {
      patchParams({ type: 'pickup', pickup_type: 'repair', page: null });
      return;
    }
    if (value === 'return_pickup') {
      patchParams({ type: 'pickup', pickup_type: 'return', page: null });
      return;
    }
    patchParams({ type: value || null, pickup_type: null, page: null });
  };

  const typeSelectValue = pickupKindFilter === 'repair'
    ? 'repair_pickup'
    : pickupKindFilter === 'return'
      ? 'return_pickup'
      : typeFilter;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handlePageChange = (nextPage) => {
    patchParams({ page: nextPage });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const setLifecycle = (key) => {
    if (key === 'closed') {
      patchParams({ status: 'closed', tab: null, page: null });
    } else {
      patchParams({ status: 'open', tab: null, page: null });
    }
  };

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 gap-1">
          {LIFECYCLE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setLifecycle(tab.key)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                lifecycle === tab.key
                  ? 'bg-[#534AB7] text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {tab.label}
              {tab.key === 'open' && badges.open_tickets > 0 && (
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  lifecycle === 'open' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'
                }`}>
                  {badges.open_tickets}
                </span>
              )}
            </button>
          ))}
        </div>
        {canCreate && (
          <button
            type="button"
            className="support-btn-primary inline-flex items-center gap-2 shrink-0"
            onClick={() => navigate('/support/tickets/new')}
          >
            <Plus className="w-4 h-4" /> New ticket
          </button>
        )}
      </div>

      {lifecycle === 'open' && (
        <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-1">
          {OPEN_STATUS_TABS.map((tab) => {
            const count = tab.key === 'overdue' ? badges.overdue_tickets
              : tab.key === 'open' ? badges.open_tickets
                : tab.key === 'all' ? badges.open_tickets : null;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => patchParams({ tab: tab.key === 'all' ? null : tab.key, page: null })}
                className={`px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
                  statusTab === tab.key
                    ? 'border-[#534AB7] text-[#534AB7]'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
                {count != null && count > 0 && (
                  <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${tab.key === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-slate-100'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {PRIMARY_TYPE_CHIPS.map((chip) => (
          <button
            key={chip.key || 'all'}
            type="button"
            className={`support-filter-chip ${chip.key || 'all'}${isTypeChipActive(chip) ? ' active' : ''}`}
            onClick={() => handleTypeChipClick(chip)}
          >
            {chip.label} ({typeCounts[chip.countKey] ?? 0})
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative sm:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, ticket #, serial, RDC…"
              className="w-full pl-10 pr-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <select value={typeSelectValue} onChange={(e) => handleTypeSelect(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All types</option>
            <option value="complaint">Complaint ({typeCounts.complaint ?? 0})</option>
            <option value="replacement">Replacement ({typeCounts.replacement ?? 0})</option>
            <option value="pickup">Pickup ({typeCounts.pickup ?? 0})</option>
            <option value="repair_pickup">Repair Pickup ({typeCounts.repair_pickup ?? 0})</option>
            <option value="return_pickup">Return Pickup ({typeCounts.return_pickup ?? 0})</option>
            <option value="loan">Loan</option>
          </select>
          <select value={priorityFilter} onChange={(e) => patchParams({ priority: e.target.value || null, page: null })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All priorities</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
          </select>
          <select value={assignFilter} onChange={(e) => patchParams({ assignee: e.target.value || null, page: null })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All assignees</option>
            <option value="unassigned">Unassigned</option>
            <option value="me">Me</option>
            {technicians.map((tech) => (
              <option key={tech.user_id} value={String(tech.user_id)}>{assigneeOptionLabel(tech)}</option>
            ))}
          </select>
          <input type="date" value={dateFrom} onChange={(e) => patchParams({ date_from: e.target.value || null, page: null })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input type="date" value={dateTo} onChange={(e) => patchParams({ date_to: e.target.value || null, page: null })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button type="button" onClick={clearFilters} className="text-blue-600 hover:underline">Clear filters</button>
          {isSupportLead(user) && (
            <button type="button" onClick={exportCsv} className="support-btn-outline inline-flex items-center gap-1 ml-auto">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          )}
        </div>
      </div>

      {selected.size > 0 && isSupportLead(user) && (
        <div className="flex flex-wrap items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm">
          <span>{selected.size} selected</span>
          <select value={bulkTech} onChange={(e) => setBulkTech(e.target.value)} className="border rounded px-2 py-1">
            <option value="">Assign to…</option>
            {technicians.map((tech) => (
              <option key={tech.user_id} value={tech.user_id}>{assigneeOptionLabel(tech)}</option>
            ))}
          </select>
          <button type="button" onClick={handleBulkAssign} disabled={!bulkTech} className="support-btn-primary text-sm py-1 px-3">
            Assign selected
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-[#534AB7]" />
        </div>
      ) : !filtered.length ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <p className="font-medium text-slate-700">No tickets match your filters</p>
        </div>
      ) : (
        <>
        <div className="grid gap-3 sm:hidden">
          {filtered.map((ticket) => {
            const st = displayStatus(ticket);
            const overdue = ticket.is_overdue || (ticket.hours_since_last_update >= 48);
            const podItem = (ticket.items || []).find((it) => it.proof_of_completion_path || it.pod_image_path);
            const url = podItem && podUrl(podItem.proof_of_completion_path || podItem.pod_image_path);
            const rdcNumber = ticketRdcNumber(ticket);
            return (
              <div key={ticket.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-slate-400">{formatTicketId(ticket.id)}</p>
                    <p className="font-semibold text-slate-900 truncate">{ticket.customer_name || '—'}</p>
                  </div>
                  <span className={`support-status-badge shrink-0 ${st.className}`}>{st.label}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <TypeBadges ticket={ticket} />
                  <SubTypeBadge ticket={ticket} />
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 capitalize">{ticket.priority || 'normal'}</span>
                  {ticket.ttspl_id && (
                    <button type="button" onClick={() => setHistoryTtspl(ticket.ttspl_id)} className="text-xs font-mono text-blue-600">
                      {ticket.ttspl_id}
                    </button>
                  )}
                  {rdcNumber && (
                    <ReturnDcNumberLink rdcNumber={rdcNumber} className="text-xs font-mono text-teal-700" />
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 mt-2 text-xs">
                  <span className="text-slate-500 truncate">{primaryCategory(ticket)}</span>
                  <span className={overdue ? 'text-red-600 font-medium' : 'text-slate-400'}>{formatRelative(ticket.created_at)}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">{assignedLabel(ticket)}</p>
                <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-slate-100">
                  <IssueCommentPreview ticket={ticket} />
                  <Link {...ticketLinkProps(ticket.id)} className="text-sm font-semibold text-blue-600 min-h-[36px] inline-flex items-center">View</Link>
                  {url && <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-emerald-600 min-h-[36px] inline-flex items-center">POD</a>}
                  {isSupportLead(user) && ticketCanChangeAssignee(ticket) && (
                    <span className="ml-auto">
                      <AssigneeSelect ticket={ticket} technicians={technicians} onAssign={handleAssign} />
                    </span>
                  )}
                  {canCloseSupportTicket(user) && ticket.status !== 'closed' && (
                    <button type="button" onClick={() => handleClose(ticket.id)} className="text-sm text-red-600 min-h-[36px] inline-flex items-center">Close</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="hidden sm:block support-table-scroll bg-white rounded-xl border border-slate-200">
          <table className="support-tickets-table text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-600 uppercase">
                {isSupportLead(user) && (
                  <th className="p-3 w-8">
                    <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} />
                  </th>
                )}
                <th className="p-3">#</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Type</th>
                <th className="p-3">Sub-type</th>
                <th className="p-3">Status</th>
                <th className="p-3">Priority</th>
                <th className="p-3">TTSPL ID</th>
                <th className="p-3">RDC</th>
                <th className="p-3">Issue</th>
                <th className="p-3">Created</th>
                <th className="p-3">Age</th>
                <th className="p-3">Assigned</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ticket) => {
                const st = displayStatus(ticket);
                const overdue = ticket.is_overdue || (ticket.hours_since_last_update >= 48);
                const rdcNumber = ticketRdcNumber(ticket);
                return (
                  <tr key={ticket.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                    {isSupportLead(user) && (
                      <td className="p-3">
                        <input type="checkbox" checked={selected.has(ticket.id)} onChange={() => toggleSelect(ticket.id)} />
                      </td>
                    )}
                    <td className="p-3 font-mono text-xs">{formatTicketId(ticket.id)}</td>
                    <td className="p-3 font-medium">{ticket.customer_name || '—'}</td>
                    <td className="p-3">
                      <TypeBadges ticket={ticket} />
                    </td>
                    <td className="p-3">
                      <SubTypeBadge ticket={ticket} />
                    </td>
                    <td className="p-3">
                      <span className={`support-status-badge ${st.className}`}>{st.label}</span>
                    </td>
                    <td className="p-3 capitalize">{ticket.priority || 'normal'}</td>
                    <td className="p-3">
                      {ticket.ttspl_id ? (
                        <button
                          type="button"
                          onClick={() => setHistoryTtspl(ticket.ttspl_id)}
                          className="font-mono text-blue-600 hover:underline text-xs"
                        >
                          {ticket.ttspl_id}
                        </button>
                      ) : '—'}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {rdcNumber ? (
                        <ReturnDcNumberLink rdcNumber={rdcNumber} className="text-teal-700" />
                      ) : '—'}
                    </td>
                    <td className="p-3 text-slate-600 max-w-[140px] truncate">{primaryCategory(ticket)}</td>
                    <td className="p-3 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(ticket.created_at).toLocaleDateString()}
                    </td>
                    <td className={`p-3 text-xs whitespace-nowrap ${overdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                      {formatRelative(ticket.created_at)}
                    </td>
                    <td className="p-3 text-xs">{assignedLabel(ticket)}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <IssueCommentPreview ticket={ticket} />
                        <Link {...ticketLinkProps(ticket.id)} className="text-blue-600 hover:underline text-xs">View</Link>
                        {(() => {
                          const podItem = (ticket.items || []).find((it) => it.proof_of_completion_path || it.pod_image_path);
                          const url = podItem && podUrl(podItem.proof_of_completion_path || podItem.pod_image_path);
                          return url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline text-xs">POD</a>
                          ) : null;
                        })()}
                        {isSupportLead(user) && ticketCanChangeAssignee(ticket) && (
                          <AssigneeSelect ticket={ticket} technicians={technicians} onAssign={handleAssign} />
                        )}
                        {canCloseSupportTicket(user) && ticket.status !== 'closed' && (
                          <button type="button" onClick={() => handleClose(ticket.id)} className="text-xs text-red-600 hover:underline">
                            Close
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ListPagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={handlePageChange}
        />
        </>
      )}

      <TtsplHistoryDrawer
        ttsplId={historyTtspl}
        open={!!historyTtspl}
        onClose={() => setHistoryTtspl(null)}
      />
    </div>
  );
}
