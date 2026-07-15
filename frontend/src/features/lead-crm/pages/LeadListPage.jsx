import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, LayoutGrid, List, Plus, Upload, Users, ChevronDown, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader, StatCard, DateRangeFilter } from '../../../components/ui/primitives';
import { useAuth } from '../../../context/AuthContext';
import PermissionGate from '../../../components/PermissionGate';
import { LEAD_SOURCES, LEAD_STATUSES, STAGES_BY_STATUS, STATUS_COLORS, INQUIRY_TYPES, EXCLUDED_LEAD_ASSIGNEES } from '../leadConstants';
import {
  assignLeads, exportLeadsCsv, getAssignableUsers, getLeads, getLeadRecentActivity, importLeadsCsv, updateLeadStatus,
} from '../leadCrmApi';
import {
  followUpTone, formatLeadDate, filterAssignableUsers,
} from '../leadCrmUtils';
import LeadCard from '../components/LeadCard';
import LeadFormDrawer from '../components/LeadFormDrawer';
import LeadCompactCell from '../components/LeadCompactCell';
import LeadConfigCell from '../components/LeadConfigCell';
import LeadListExpandPanel from '../components/LeadListExpandPanel';
import QuickStatusUpdate from '../components/QuickStatusUpdate';
import LeadFollowUpCell from '../components/LeadFollowUpCell';
import MultiSelectFilter from '../components/MultiSelectFilter';

const PAGE_SIZE = 25;
const VIEW_KEY = 'lead_crm_view_mode';
const TABLE_COLS = 11;

export default function LeadListPage() {
  const { user, isAssignedDataOnly, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'kanban');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [dragLead, setDragLead] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [activityCache, setActivityCache] = useState({});
  const [activityLoading, setActivityLoading] = useState(null);
  const [filters, setFilters] = useState({
    search: '', statuses: [], assignees: [], sources: [], inquiry_types: [],
    date_from: '', date_to: '', follow_up: '',
  });

  const assignableUsers = useMemo(
    () => filterAssignableUsers(users, EXCLUDED_LEAD_ASSIGNEES),
    [users],
  );

  const assigneeOptions = useMemo(
    () => [
      { value: 'unassigned', label: 'Unassigned' },
      ...assignableUsers.map((u) => ({
        value: String(u.user_id || u.userId),
        label: u.name,
      })),
    ],
    [assignableUsers],
  );

  const inquiryTypeOptions = useMemo(
    () => INQUIRY_TYPES.map((type) => ({
      value: type,
      label: type.charAt(0).toUpperCase() + type.slice(1),
    })),
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.search) params.search = filters.search;
      if (filters.statuses.length) params.status = filters.statuses.join(',');
      if (filters.sources.length) params.source = filters.sources.join(',');
      if (filters.inquiry_types.length) params.inquiry_type = filters.inquiry_types.join(',');
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      if (filters.follow_up) params.follow_up = filters.follow_up;
      if (isAssignedDataOnly('leads')) params.assigned_to = 'me';
      else if (filters.assignees.length) params.assigned_to = filters.assignees.join(',');
      const res = await getLeads(params);
      setLeads(res.data?.leads || []);
    } catch {
      toast.error('Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, [filters, isAssignedDataOnly]);

  useEffect(() => { load(); }, [load]);

  const refreshList = useCallback(async () => {
    const openId = expandedId;
    setActivityCache({});
    await load();
    if (openId) {
      setActivityLoading(openId);
      try {
        const res = await getLeadRecentActivity(openId, 5);
        setActivityCache({ [openId]: res.data?.activities || [] });
      } catch {
        toast.error('Failed to refresh activities');
      } finally {
        setActivityLoading(null);
      }
    }
  }, [load, expandedId]);

  const loadActivitiesFor = useCallback(async (leadId, { force = false } = {}) => {
    if (!force && activityCache[leadId]) return;
    setActivityLoading(leadId);
    try {
      const res = await getLeadRecentActivity(leadId, 5);
      setActivityCache((prev) => ({ ...prev, [leadId]: res.data?.activities || [] }));
    } catch {
      toast.error('Failed to load activities');
      setActivityCache((prev) => ({ ...prev, [leadId]: [] }));
    } finally {
      setActivityLoading(null);
    }
  }, [activityCache]);

  const toggleExpand = useCallback(async (leadId, e) => {
    e?.stopPropagation();
    if (expandedId === leadId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(leadId);
    await loadActivitiesFor(leadId);
  }, [expandedId, loadActivitiesFor]);

  useEffect(() => {
    if (!hasPermission('leads', 'edit')) return;
    getAssignableUsers()
      .then((r) => setUsers(r.data?.users || []))
      .catch(() => toast.error('Failed to load sales users for assignment'));
  }, [hasPermission]);

  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return {
      total: leads.length,
      active: leads.filter((l) => !['Gone', 'Rejected'].includes(l.status)).length,
      followToday: leads.filter((l) => l.followUpDate && followUpTone(l.followUpDate) === 'today').length,
      converted: leads.filter((l) => ['Deal', 'Demo'].includes(l.status)).length,
      totalItems: leads.reduce((sum, l) => sum + (Number(l.quantityRequired) || 0), 0),
    };
  }, [leads]);

  useEffect(() => { setPage(1); }, [filters]);

  const sortedLeads = useMemo(() => {
    return [...leads].sort((a, b) => {
      const av = a.createdAt;
      const bv = b.createdAt;
      if (av < bv) return 1;
      if (av > bv) return -1;
      return 0;
    });
  }, [leads]);

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
      const params = {};
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      if (filters.search) params.search = filters.search;
      if (filters.statuses.length) params.status = filters.statuses.join(',');
      if (filters.sources.length) params.source = filters.sources.join(',');
      const res = await exportLeadsCsv(params);
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

  const columnHeaderClass = (status) => {
    if (['Deal', 'Demo', 'Repeat'].includes(status)) return 'bg-green-50 text-green-800 border-green-100';
    if (['Gone', 'Rejected'].includes(status)) return 'bg-rose-50 text-rose-800 border-rose-100';
    return 'bg-gray-50 text-gray-800 border-gray-100';
  };

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Leads"
        subtitle="Manage your sales pipeline"
        icon={Users}
        actions={(
          <>
            <button type="button" onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-2 px-4 min-h-[44px] bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700">
              <Plus className="w-4 h-4" /> Add Lead
            </button>
            <PermissionGate section="leads" action="create">
              <label className="flex items-center gap-2 px-4 min-h-[44px] border border-gray-200 text-sm font-semibold rounded-xl cursor-pointer hover:bg-gray-50">
                <Upload className="w-4 h-4" /> Import CSV
                <input type="file" accept=".csv" className="hidden" onChange={handleImport} />
              </label>
            </PermissionGate>
            <button type="button" onClick={handleExport}
              className="flex items-center gap-2 px-4 min-h-[44px] border border-gray-200 text-sm font-semibold rounded-xl hover:bg-gray-50">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </>
        )}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <StatCard label="Total Leads" value={stats.total} tone="gray" />
        <StatCard label="Active" value={stats.active} tone="blue" />
        <StatCard label="Follow-up Today" value={stats.followToday} tone="amber" />
        <StatCard label="Converted" value={stats.converted} tone="green" />
        <StatCard label="Total Items (Qty)" value={stats.totalItems} tone="gray" />
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
          <MultiSelectFilter
            options={LEAD_STATUSES}
            value={filters.statuses}
            onChange={(statuses) => setFilters((f) => ({ ...f, statuses }))}
            allLabel="All statuses"
          />
          {user?.role !== 'sales' && (
            <MultiSelectFilter
              options={assigneeOptions}
              value={filters.assignees}
              onChange={(assignees) => setFilters((f) => ({ ...f, assignees }))}
              allLabel="All assignees"
            />
          )}
          <MultiSelectFilter
            options={LEAD_SOURCES}
            value={filters.sources}
            onChange={(sources) => setFilters((f) => ({ ...f, sources }))}
            allLabel="All sources"
          />
          <MultiSelectFilter
            options={inquiryTypeOptions}
            value={filters.inquiry_types}
            onChange={(inquiry_types) => setFilters((f) => ({ ...f, inquiry_types }))}
            allLabel="All inquiry types"
          />
          <select value={filters.follow_up} onChange={(e) => setFilters((f) => ({ ...f, follow_up: e.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="">Follow-up filter</option>
            <option value="today">Today</option>
            <option value="this_week">This Week</option>
            <option value="overdue">Overdue</option>
          </select>
        </div>
        <div className="mt-3">
          <DateRangeFilter
            dateFrom={filters.date_from}
            dateTo={filters.date_to}
            onDateFromChange={(value) => setFilters((f) => ({ ...f, date_from: value }))}
            onDateToChange={(value) => setFilters((f) => ({ ...f, date_to: value }))}
            fromLabel="Created from"
            toLabel="Created to"
          />
        </div>
        <button type="button" onClick={() => setFilters({ search: '', statuses: [], assignees: [], sources: [], inquiry_types: [], date_from: '', date_to: '', follow_up: '' })}
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
                    <LeadCard key={lead.leadId} lead={lead} onRefresh={refreshList}
                      onDragStart={(_e, l) => setDragLead(l)} onDragEnd={() => setDragLead(null)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="grid gap-3 sm:hidden">
            {paged.length === 0 ? (
              <p className="text-center text-sm text-gray-500 py-8">No leads</p>
            ) : paged.map((lead) => (
              <LeadCard key={lead.leadId} lead={lead} onRefresh={refreshList} />
            ))}
          </div>
          <div className="hidden sm:block rounded-xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="p-2.5 w-8">
                    <input type="checkbox" aria-label="Select all on page" onChange={(e) => {
                      if (e.target.checked) setSelected(new Set(paged.map((l) => l.leadId)));
                      else setSelected(new Set());
                    }} />
                  </th>
                  <th className="p-2.5 w-8" aria-label="Expand" />
                  <th className="p-2.5 whitespace-nowrap">ID</th>
                  <th className="p-2.5 whitespace-nowrap">Date</th>
                  <th className="p-2.5 whitespace-nowrap min-w-[200px]">Lead</th>
                  <th className="p-2.5 whitespace-nowrap min-w-[220px]">Config</th>
                  <th className="p-2.5 whitespace-nowrap">Source</th>
                  <th className="p-2.5 whitespace-nowrap">Status</th>
                  <th className="p-2.5 whitespace-nowrap">Assignee</th>
                  <th className="p-2.5 whitespace-nowrap">Follow-up</th>
                  <th className="p-2.5 whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={TABLE_COLS} className="p-8 text-center text-gray-500">No leads</td>
                  </tr>
                ) : paged.map((lead) => {
                  const isExpanded = expandedId === lead.leadId;
                  const ExpandIcon = isExpanded ? ChevronDown : ChevronRight;
                  return (
                    <React.Fragment key={lead.leadId}>
                      <tr
                        className={`border-t border-gray-100 hover:bg-gray-50/60 cursor-pointer ${isExpanded ? 'bg-blue-50/30' : ''}`}
                        onClick={(e) => toggleExpand(lead.leadId, e)}
                        aria-expanded={isExpanded}
                      >
                        <td className="p-2.5 align-top" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(lead.leadId)}
                            onChange={(e) => {
                              const next = new Set(selected);
                              if (e.target.checked) next.add(lead.leadId);
                              else next.delete(lead.leadId);
                              setSelected(next);
                            }} />
                        </td>
                        <td className="p-2.5 align-top">
                          <span
                            aria-hidden="true"
                            className="inline-flex p-1 rounded-md text-gray-500"
                          >
                            <ExpandIcon className="w-4 h-4" />
                          </span>
                        </td>
                        <td className="p-2.5 align-top font-mono text-xs text-gray-500 whitespace-nowrap">
                          #{lead.leadId}
                        </td>
                        <td className="p-2.5 align-top text-xs text-gray-600 whitespace-nowrap">
                          {formatLeadDate(lead.createdAt)}
                        </td>
                        <td className="p-2.5 align-top">
                          <LeadCompactCell lead={lead} />
                        </td>
                        <td className="p-2.5 align-top">
                          <LeadConfigCell lead={lead} />
                        </td>
                        <td className="p-2.5 align-top text-xs text-gray-600">{lead.source || '—'}</td>
                        <td className="p-2.5 align-top" onClick={(e) => e.stopPropagation()}>
                          <QuickStatusUpdate lead={lead} onUpdated={refreshList} />
                          {lead.leadStage ? (
                            <p className="text-[11px] text-gray-500 mt-1 max-w-[140px] truncate">{lead.leadStage}</p>
                          ) : null}
                        </td>
                        <td className="p-2.5 align-top text-xs text-gray-700">{lead.assignedUser?.name || '—'}</td>
                        <td className="p-2.5 align-top" onClick={(e) => e.stopPropagation()}>
                          <LeadFollowUpCell lead={lead} onUpdated={refreshList} />
                        </td>
                        <td className="p-2.5 align-top" onClick={(e) => e.stopPropagation()}>
                          <button type="button" onClick={() => navigate(`/lead-crm/leads/${lead.leadId}`)}
                            className="text-blue-600 text-xs font-medium hover:underline whitespace-nowrap">
                            View
                          </button>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="border-t border-blue-100 bg-slate-50/80">
                          <td colSpan={TABLE_COLS} className="p-0">
                            <div className="px-4 py-3 border-l-4 border-l-blue-500">
                              <LeadListExpandPanel
                                leadId={lead.leadId}
                                user={user}
                                loading={activityLoading === lead.leadId}
                                activities={activityCache[lead.leadId] || []}
                                onRemarkSaved={() => loadActivitiesFor(lead.leadId, { force: true })}
                              />
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
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
            <PermissionGate section="leads" action="edit">
              <div className="mt-4 p-3 rounded-xl border border-blue-100 bg-blue-50 flex flex-wrap gap-2 items-center">
                <span className="text-sm">{selected.size} selected</span>
                <select className="text-sm border rounded-lg px-2 py-1" onChange={async (e) => {
                  const uid = e.target.value;
                  if (!uid) return;
                  try {
                    await assignLeads({ lead_ids: [...selected], sales_user_id: parseInt(uid, 10) });
                    toast.success('Assigned');
                    refreshList();
                    setSelected(new Set());
                  } catch (err) {
                    toast.error(err.response?.data?.message || 'Assignment failed');
                  }
                  e.target.value = '';
                }}>
                  <option value="">Assign to...</option>
                  {assignableUsers.map((u) => <option key={u.user_id || u.userId} value={u.user_id || u.userId}>{u.name}</option>)}
                </select>
              </div>
            </PermissionGate>
          )}
        </>
      )}

      <LeadFormDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSaved={refreshList} />
    </div>
  );
}
