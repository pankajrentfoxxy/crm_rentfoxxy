import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Search, Plus, Download } from 'lucide-react';
import api from '../../utils/api';
import { isSupportLead } from '../../utils/supportAccess';
import { useAuth } from '../../context/AuthContext';
import { displayStatus, formatRelative, formatTicketId } from './utils';
import TtsplHistoryDrawer from '../../features/floor-pipeline/components/TtsplHistoryDrawer';

const STATUS_TABS = [
  { key: 'all', label: 'All', view: 'all' },
  { key: 'open', label: 'Open', view: 'active' },
  { key: 'progress', label: 'In Progress', view: 'active', status: 'in_progress' },
  { key: 'overdue', label: 'Overdue', view: 'overdue' },
  { key: 'pickup', label: 'Pending Pickup', view: 'pickups' },
  { key: 'closed', label: 'Closed', view: 'closed' },
];

const TYPE_BADGE = {
  complaint: 'bg-blue-100 text-blue-800',
  replacement: 'bg-purple-100 text-purple-800',
  pickup: 'bg-amber-100 text-amber-800',
  loan: 'bg-teal-100 text-teal-800',
};

function primaryType(ticket) {
  const types = (ticket.items || []).map((i) => i.item_type);
  return types[0] || ticket.ticket_category || 'complaint';
}

function primaryCategory(ticket) {
  const item = (ticket.items || [])[0];
  return item?.issue_category_label || item?.issue_category_name || '—';
}

function assignedLabel(ticket) {
  const names = [...new Set((ticket.items || []).map((i) => i.assigned_to_name).filter(Boolean))];
  if (!names.length) return 'Unassigned';
  return names.join(', ');
}

function isUnassigned(ticket) {
  return (ticket.unassigned_item_count || 0) > 0;
}

export default function SupportTicketList() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState({});
  const [technicians, setTechnicians] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [bulkTech, setBulkTech] = useState('');
  const [historyTtspl, setHistoryTtspl] = useState(null);

  const [statusTab, setStatusTab] = useState('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [assignFilter, setAssignFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const activeTab = STATUS_TABS.find((t) => t.key === statusTab) || STATUS_TABS[0];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debounced) params.set('search', debounced);
      if (typeFilter && ['complaint', 'pickup', 'replacement'].includes(typeFilter)) {
        params.set('type', typeFilter);
      }
      params.set('view', activeTab.view);
      params.set('limit', '100');
      const { data } = await api.get(`/support/tickets?${params}`);
      setTickets(data.tickets || []);
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [debounced, typeFilter, activeTab.view]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/support/badges').then((r) => setBadges(r.data.badges || {})).catch(() => setBadges({}));
    if (isSupportLead(user)) {
      api.get('/support/technicians').then((r) => setTechnicians(r.data.technicians || [])).catch(() => setTechnicians([]));
    }
  }, [user]);

  const filtered = useMemo(() => {
    let list = tickets;
    if (activeTab.status) {
      list = list.filter((t) => t.status === activeTab.status);
    } else if (statusTab === 'open') {
      list = list.filter((t) => t.status !== 'closed' && t.status !== 'in_progress');
    }
    if (typeFilter === 'loan') {
      list = list.filter((t) => (t.items || []).some((i) => i.item_type === 'loan'));
    }
    if (priorityFilter === 'high') {
      list = list.filter((t) => t.priority === 'high' || t.priority === 'urgent');
    } else if (priorityFilter === 'normal') {
      list = list.filter((t) => !t.priority || t.priority === 'normal');
    }
    if (assignFilter === 'unassigned') {
      list = list.filter(isUnassigned);
    } else if (assignFilter === 'me') {
      list = list.filter((t) => (t.items || []).some((i) => i.assigned_to === user?.user_id));
    } else if (assignFilter && assignFilter !== 'all') {
      list = list.filter((t) => (t.items || []).some((i) => String(i.assigned_to) === assignFilter));
    }
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      list = list.filter((t) => new Date(t.created_at).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86400000;
      list = list.filter((t) => new Date(t.created_at).getTime() < to);
    }
    return list;
  }, [tickets, activeTab, statusTab, typeFilter, priorityFilter, assignFilter, dateFrom, dateTo, user?.user_id]);

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
    const params = new URLSearchParams();
    if (debounced) params.set('search', debounced);
    if (typeFilter) params.set('type', typeFilter);
    params.set('view', activeTab.view);
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
    setTypeFilter('');
    setPriorityFilter('');
    setAssignFilter('');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">All tickets</h1>
        {isSupportLead(user) && (
          <Link to="/support/tickets/new" className="support-btn-primary inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> New ticket
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-1">
        {STATUS_TABS.map((tab) => {
          const count = tab.key === 'overdue' ? badges.overdue_tickets
            : tab.key === 'open' ? badges.open_tickets
              : tab.key === 'all' ? badges.open_tickets : null;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusTab(tab.key)}
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

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative sm:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, ticket #, serial…"
              className="w-full pl-10 pr-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All types</option>
            <option value="complaint">Complaint</option>
            <option value="replacement">Replacement</option>
            <option value="pickup">Pickup</option>
            <option value="loan">Loan</option>
          </select>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All priorities</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
          </select>
          <select value={assignFilter} onChange={(e) => setAssignFilter(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All assignees</option>
            <option value="unassigned">Unassigned</option>
            <option value="me">Me</option>
            {technicians.map((tech) => (
              <option key={tech.user_id} value={String(tech.user_id)}>{tech.name}</option>
            ))}
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
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
              <option key={tech.user_id} value={tech.user_id}>{tech.name}</option>
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
        <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
          <table className="w-full text-sm">
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
                <th className="p-3">Status</th>
                <th className="p-3">Priority</th>
                <th className="p-3">TTSPL ID</th>
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
                const pType = primaryType(ticket);
                const overdue = ticket.is_overdue || (ticket.hours_since_last_update >= 48);
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
                      <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${TYPE_BADGE[pType] || 'bg-slate-100'}`}>
                        {pType}
                      </span>
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
                    <td className="p-3 text-slate-600 max-w-[140px] truncate">{primaryCategory(ticket)}</td>
                    <td className="p-3 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(ticket.created_at).toLocaleDateString()}
                    </td>
                    <td className={`p-3 text-xs whitespace-nowrap ${overdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                      {formatRelative(ticket.created_at)}
                    </td>
                    <td className="p-3 text-xs">{assignedLabel(ticket)}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        <Link to={`/support/tickets/${ticket.id}`} className="text-blue-600 hover:underline text-xs">View</Link>
                        {isSupportLead(user) && isUnassigned(ticket) && (
                          <select
                            className="text-xs border rounded px-1 py-0.5 max-w-[100px]"
                            defaultValue=""
                            onChange={(e) => { if (e.target.value) handleAssign(ticket.id, e.target.value); e.target.value = ''; }}
                          >
                            <option value="">Assign</option>
                            {technicians.map((tech) => (
                              <option key={tech.user_id} value={tech.user_id}>{tech.name}</option>
                            ))}
                          </select>
                        )}
                        {isSupportLead(user) && ticket.status !== 'closed' && (
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
      )}

      <TtsplHistoryDrawer
        ttsplId={historyTtspl}
        open={!!historyTtspl}
        onClose={() => setHistoryTtspl(null)}
      />
    </div>
  );
}
