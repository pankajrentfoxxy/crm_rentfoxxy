import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, LayoutGrid, List, Plus, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../../context/AuthContext';
import PermissionGate from '../../../components/PermissionGate';
import { LEAD_SOURCES, LEAD_STATUSES, STAGES_BY_STATUS, STATUS_COLORS, INQUIRY_TYPES } from '../leadConstants';
import {
  assignLeads, exportLeadsCsv, getLeads, getUsers, importLeadsCsv, updateLeadStatus,
} from '../leadCrmApi';
import {
  formatConfig, formatFollowUpDateTime, formatInquiry, followUpTone, relativeTime,
} from '../leadCrmUtils';
import LeadCard from '../components/LeadCard';
import LeadFormDrawer from '../components/LeadFormDrawer';
import QuickStatusUpdate from '../components/QuickStatusUpdate';

const PAGE_SIZE = 25;
const VIEW_KEY = 'lead_crm_view_mode';

export default function LeadListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'kanban');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: 'createdAt', dir: 'desc' });
  const [dragLead, setDragLead] = useState(null);
  const [filters, setFilters] = useState({
    search: '', statuses: [], assigned_to: '', source: '', inquiry_type: '',
    date_from: '', date_to: '', follow_up: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.search) params.search = filters.search;
      if (filters.statuses.length) params.status = filters.statuses.join(',');
      if (filters.source) params.source = filters.source;
      if (filters.inquiry_type) params.inquiry_type = filters.inquiry_type;
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      if (filters.follow_up) params.follow_up = filters.follow_up;
      if (user?.role === 'sales') params.assigned_to = 'me';
      else if (filters.assigned_to) params.assigned_to = filters.assigned_to;
      const res = await getLeads(params);
      setLeads(res.data?.leads || []);
    } catch {
      toast.error('Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, [filters, user?.role]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (user?.role !== 'sales') {
      getUsers().then((r) => setUsers(r.data?.users || r.data || [])).catch(() => {});
    }
  }, [user?.role]);

  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return {
      total: leads.length,
      active: leads.filter((l) => !['Gone', 'Rejected'].includes(l.status)).length,
      followToday: leads.filter((l) => l.followUpDate && followUpTone(l.followUpDate) === 'today').length,
      converted: leads.filter((l) => ['Deal', 'Demo'].includes(l.status)).length,
    };
  }, [leads]);

  const sortedLeads = useMemo(() => {
    const copy = [...leads];
    copy.sort((a, b) => {
      let av; let bv;
      if (sort.key === 'company') { av = a.companyName || ''; bv = b.companyName || ''; }
      else if (sort.key === 'followUpDate') { av = a.followUpDate || ''; bv = b.followUpDate || ''; }
      else if (sort.key === 'lastActivityAt') { av = a.lastActivityAt || a.updatedAt; bv = b.lastActivityAt || b.updatedAt; }
      else { av = a.createdAt; bv = b.createdAt; }
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [leads, sort]);

  const paged = sortedLeads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(sortedLeads.length / PAGE_SIZE));

  const leadsByStatus = useMemo(() => {
    const map = {};
    LEAD_STATUSES.forEach((s) => { map[s] = []; });
    leads.forEach((l) => { if (map[l.status]) map[l.status].push(l); });
    return map;
  }, [leads]);

  const handleDrop = async (status) => {
    if (!dragLead || dragLead.status === status) return;
    try {
      const payload = { status, notes: `Moved via kanban to ${status}` };
      const stages = STAGES_BY_STATUS[status] || [];
      if (stages.length === 1) payload.lead_stage = stages[0];
      if (status === 'Deal' || status === 'Demo') {
        const gst = dragLead.gstNumber || dragLead.research?.gst;
        if (gst) payload.gst_number = gst;
      }
      await updateLeadStatus(dragLead.leadId, payload);
      toast.success('Status updated');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Update failed');
    }
    setDragLead(null);
  };

  const handleExport = async () => {
    try {
      const res = await exportLeadsCsv({});
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = 'leads.csv'; a.click();
    } catch { toast.error('Export failed'); }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await importLeadsCsv(fd);
      toast.success(res.data?.message || 'Import complete');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Import failed');
    }
    e.target.value = '';
  };

  const toggleSort = (key) => {
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  };

  const columnHeaderClass = (status) => {
    if (['Deal', 'Demo', 'Repeat'].includes(status)) return 'bg-green-50 text-green-800 border-green-100';
    if (['Gone', 'Rejected'].includes(status)) return 'bg-rose-50 text-rose-800 border-rose-100';
    return 'bg-gray-50 text-gray-800 border-gray-100';
  };

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-gray-500 text-sm">Manage your sales pipeline</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setDrawerOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Add Lead
          </button>
          <PermissionGate section="leads" action="create">
            <label className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-sm rounded-lg cursor-pointer hover:bg-gray-50">
              <Upload className="w-4 h-4" /> Import CSV
              <input type="file" accept=".csv" className="hidden" onChange={handleImport} />
            </label>
          </PermissionGate>
          <button type="button" onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          ['Total Leads', stats.total], ['Active', stats.active],
          ['Follow-up Today', stats.followToday], ['Converted', stats.converted],
        ].map(([label, val]) => (
          <div key={label} className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{val}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button type="button" onClick={() => { setView('kanban'); localStorage.setItem(VIEW_KEY, 'kanban'); }}
          className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg ${view === 'kanban' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>
          <LayoutGrid className="w-4 h-4" /> Kanban
        </button>
        <button type="button" onClick={() => { setView('table'); localStorage.setItem(VIEW_KEY, 'table'); }}
          className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg ${view === 'table' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>
          <List className="w-4 h-4" /> Table
        </button>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          <input placeholder="Search..." value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <select value={filters.statuses[0] || ''} onChange={(e) => setFilters((f) => ({ ...f, statuses: e.target.value ? [e.target.value] : [] }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          {user?.role !== 'sales' && (
            <select value={filters.assigned_to} onChange={(e) => setFilters((f) => ({ ...f, assigned_to: e.target.value }))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">All assignees</option>
              {users.map((u) => <option key={u.user_id || u.userId} value={u.user_id || u.userId}>{u.name}</option>)}
            </select>
          )}
          <select value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="">All sources</option>
            {LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={filters.inquiry_type} onChange={(e) => setFilters((f) => ({ ...f, inquiry_type: e.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="">All inquiry types</option>
            {INQUIRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filters.follow_up} onChange={(e) => setFilters((f) => ({ ...f, follow_up: e.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="">Follow-up filter</option>
            <option value="today">Today</option>
            <option value="this_week">This Week</option>
            <option value="overdue">Overdue</option>
          </select>
        </div>
        <button type="button" onClick={() => setFilters({ search: '', statuses: [], assigned_to: '', source: '', inquiry_type: '', date_from: '', date_to: '', follow_up: '' })}
          className="text-sm text-blue-600 mt-2 hover:underline">Clear filters</button>
      </div>

      {loading ? (
        <p className="text-center text-gray-400 py-12">Loading...</p>
      ) : view === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {LEAD_STATUSES.map((status) => {
            const col = leadsByStatus[status] || [];
            const qty = col.reduce((s, l) => s + (Number(l.quantityRequired) || 0), 0);
            return (
              <div key={status} className="min-w-[260px] w-[260px] shrink-0 flex flex-col"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(status)}>
                <div className={`rounded-t-xl border px-3 py-2 text-sm font-semibold flex justify-between ${columnHeaderClass(status)}`}>
                  <span>{status}</span>
                  <span className="text-xs font-normal">{col.length}{qty ? ` · Qty ${qty}` : ''}</span>
                </div>
                <div className="flex-1 overflow-y-auto max-h-[calc(100vh-220px)] space-y-2 p-2 bg-gray-50/80 border border-t-0 border-gray-100 rounded-b-xl">
                  {col.map((lead) => (
                    <LeadCard key={lead.leadId} lead={lead} onRefresh={load}
                      onDragStart={(_e, l) => setDragLead(l)} onDragEnd={() => setDragLead(null)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="p-3 w-8"><input type="checkbox" onChange={(e) => {
                    if (e.target.checked) setSelected(new Set(paged.map((l) => l.leadId)));
                    else setSelected(new Set());
                  }} /></th>
                  {[
                    ['#', null], ['Company', 'company'], ['Contact', null], ['Phone', null], ['City', null],
                    ['Config', null], ['Qty', null], ['Inquiry', null], ['Status', null], ['Stage', null],
                    ['Assigned', null], ['Follow-up', 'followUpDate'], ['Last Activity', 'lastActivityAt'], ['Actions', null],
                  ].map(([label, sortKey]) => (
                    <th key={label} className="p-3 whitespace-nowrap">
                      {sortKey ? (
                        <button type="button" onClick={() => toggleSort(sortKey)} className="hover:text-gray-800">{label}</button>
                      ) : label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((lead, i) => {
                  const fu = followUpTone(lead.followUpDate);
                  return (
                    <tr key={lead.leadId} className="border-t border-gray-100 hover:bg-gray-50/50">
                      <td className="p-3">
                        <input type="checkbox" checked={selected.has(lead.leadId)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(lead.leadId); else next.delete(lead.leadId);
                            setSelected(next);
                          }} />
                      </td>
                      <td className="p-3 text-gray-400">{(page - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="p-3 font-medium">{lead.companyName || '—'}</td>
                      <td className="p-3">{lead.name}</td>
                      <td className="p-3">{lead.phone}</td>
                      <td className="p-3">{lead.city || '—'}</td>
                      <td className="p-3 text-xs">{formatConfig(lead)}</td>
                      <td className="p-3">{lead.quantityRequired || '—'}</td>
                      <td className="p-3">{formatInquiry(lead.inquiryType)}</td>
                      <td className="p-3">
                        <QuickStatusUpdate lead={lead} onUpdated={load} />
                      </td>
                      <td className="p-3 text-xs text-gray-500">{lead.leadStage || '—'}</td>
                      <td className="p-3 text-xs">{lead.assignedUser?.name || '—'}</td>
                      <td className={`p-3 text-xs ${fu === 'overdue' ? 'text-red-600 font-medium' : fu === 'today' ? 'text-amber-600' : 'text-green-600'}`}>
                        {formatFollowUpDateTime(lead.followUpDate, lead.followUpTime)}
                      </td>
                      <td className="p-3 text-xs text-gray-500">{relativeTime(lead.lastActivityAt || lead.updatedAt)}</td>
                      <td className="p-3">
                        <button type="button" onClick={() => navigate(`/lead-crm/leads/${lead.leadId}`)}
                          className="text-blue-600 text-xs hover:underline">View</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center mt-4 text-sm">
            <span className="text-gray-500">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 border rounded-lg disabled:opacity-40">Prev</button>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 border rounded-lg disabled:opacity-40">Next</button>
            </div>
          </div>
          {selected.size > 0 && (
            <PermissionGate section="leads" action="create">
              <div className="mt-4 p-3 rounded-xl border border-blue-100 bg-blue-50 flex flex-wrap gap-2 items-center">
                <span className="text-sm">{selected.size} selected</span>
                <select className="text-sm border rounded-lg px-2 py-1" onChange={async (e) => {
                  const uid = e.target.value;
                  if (!uid) return;
                  await assignLeads({ lead_ids: [...selected], sales_user_id: parseInt(uid, 10) });
                  toast.success('Assigned'); load(); setSelected(new Set());
                }}>
                  <option value="">Assign to...</option>
                  {users.map((u) => <option key={u.user_id || u.userId} value={u.user_id || u.userId}>{u.name}</option>)}
                </select>
              </div>
            </PermissionGate>
          )}
        </>
      )}

      <LeadFormDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSaved={load} />
    </div>
  );
}
