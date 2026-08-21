import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ListChecks, Plus, Search, Bookmark } from 'lucide-react';
import {
  Button, DataTable, EmptyState, ListPagination, Modal, Mono, PageHeader,
  PriorityChip, SlaChip, StatusPill, ClassificationChain, prioritySpine,
} from '../../../components/ui/supportPrimitives';
import PermissionGate from '../../../components/PermissionGate';
import { usePermission } from '../../../hooks/usePermission';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { useDebouncedUrlSearch } from '../../../hooks/useDebouncedUrlSearch';
import { listTickets, listViews, getTicketCounts, bulkAssign, createView, fetchQueueMeta } from '../supportV2Api';

const PAGE_SIZE = 25;

const DEFAULTS = {
  page: 1, view: 'all_open', search: '',
  class: '', priority: '', type_id: '', subtype_id: '', issue_id: '',
  status: '', pending_reason: '', sla: '', group_id: '', assigned_to: '', channel: '',
  date_from: '', date_to: '', sort: 'priority_sla', photos_deferred: '',
};

const CLASS_OPTS = [
  { value: 'INCIDENT', label: 'Incident' },
  { value: 'REQUEST', label: 'Request' },
];
const PRIORITY_OPTS = [
  { value: '1', label: 'P1 Critical' },
  { value: '2', label: 'P2 High' },
  { value: '3', label: 'P3 Moderate' },
  { value: '4', label: 'P4 Low' },
];
const STATUS_OPTS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'NEW', label: 'New' },
  { value: 'TRIAGED', label: 'Triaged' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];
const SLA_OPTS = [
  { value: 'BREACHED', label: 'Breached' },
  { value: 'AT_RISK', label: 'At risk' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'OK', label: 'On track' },
];
const CHANNEL_OPTS = [
  { value: 'PHONE', label: 'Phone' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'PORTAL', label: 'Portal' },
  { value: 'INTERNAL', label: 'Internal' },
  { value: 'CHAT', label: 'Chat' },
];
const SORT_OPTS = [
  { value: 'priority_sla', label: 'Priority + SLA' },
  { value: 'sla', label: 'SLA due' },
  { value: 'newest', label: 'Newest' },
  { value: 'age', label: 'Oldest' },
];

export default function TicketQueuePage() {
  const nav = useNavigate();
  usePermission();
  const { filters, setFilters, resetFilters } = useUrlFilters(DEFAULTS);
  const { searchInput, setSearchInput, debouncedSearch } = useDebouncedUrlSearch(filters, setFilters);

  const [rows, setRows] = useState([]);
  const [views, setViews] = useState([]);
  const [counts, setCounts] = useState({});
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [catalog, setCatalog] = useState([]);
  const [groups, setGroups] = useState([]);
  const [owners, setOwners] = useState([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignUser, setAssignUser] = useState('');

  useEffect(() => {
    Promise.all([listViews(), getTicketCounts(), fetchQueueMeta()])
      .then(([v, c, m]) => {
        setViews(v.data?.rows || []);
        setCounts(c.data?.counts || {});
        setCatalog(m.data?.catalog || []);
        setGroups(m.data?.groups || []);
        setOwners(m.data?.owners || []);
      })
      .catch(() => toast.error('Failed to load saved views'));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listTickets({
        ...filters,
        search: debouncedSearch.trim() || undefined,
        limit: PAGE_SIZE,
      });
      setRows(res.data?.rows || []);
      setPagination(res.data?.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
      setSelected([]);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [filters, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  const typeOpts = useMemo(
    () => catalog.filter((n) => n.level === 1).map((n) => ({ value: String(n.catalog_id), label: n.name })),
    [catalog]
  );
  const subtypeOpts = useMemo(
    () => catalog
      .filter((n) => n.level === 2 && String(n.parent_id) === String(filters.type_id))
      .map((n) => ({ value: String(n.catalog_id), label: n.name })),
    [catalog, filters.type_id]
  );
  const issueOpts = useMemo(
    () => catalog
      .filter((n) => n.level === 3 && String(n.parent_id) === String(filters.subtype_id))
      .map((n) => ({ value: String(n.catalog_id), label: n.name })),
    [catalog, filters.subtype_id]
  );
  const groupOpts = useMemo(
    () => groups.map((g) => ({ value: String(g.group_id), label: g.name })),
    [groups]
  );
  const ownerOpts = useMemo(
    () => [
      { value: 'ME', label: 'Me' },
      { value: 'NONE', label: 'Unassigned' },
      ...owners.map((o) => ({ value: String(o.user_id), label: o.name })),
    ],
    [owners]
  );

  const allChecked = rows.length > 0 && selected.length === rows.length;
  const toggleAll = () => setSelected(allChecked ? [] : rows.map((r) => r.ticket_id));
  const toggleOne = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const columns = useMemo(() => [
    {
      key: 'sel', header: (
        <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" />
      ), className: 'w-8',
      render: (r) => (
        <input
          type="checkbox"
          checked={selected.includes(r.ticket_id)}
          onChange={(e) => { e.stopPropagation(); toggleOne(r.ticket_id); }}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${r.ticket_number}`}
        />
      ),
    },
    {
      key: 'ticket', header: 'Ticket', className: 'w-[104px]',
      render: (r) => (
        <div>
          <PriorityChip priority={r.priority} />
          <div className="mt-[3px]"><Mono bold className="text-[11px]">{r.ticket_number}</Mono></div>
        </div>
      ),
    },
    {
      key: 'customer', header: 'Customer & site', className: 'w-[170px]',
      render: (r) => (
        <div>
          <div className="font-semibold text-sup-ink">{r.customer_name}</div>
          <div className="text-[10px] text-sup-muted">{r.site_label}</div>
          {r.support_tier === 'PLATINUM' && (
            <span className="inline-flex items-center h-[19px] px-1.5 rounded-full text-[10.5px]
                             font-semibold bg-sup-accentSoft text-sup-accent mt-0.5">Platinum</span>
          )}
        </div>
      ),
    },
    {
      key: 'classification', header: 'Classification',
      render: (r) => (
        <div>
          <ClassificationChain {...(r.primary_classification || {})} />
          {r.asset_count > 1 && (
            <div className="text-[10px] text-sup-muted mt-0.5">
              +{r.asset_count - 1} more machine{r.asset_count > 2 ? 's' : ''}
              {r.mixed_issues ? ' · mixed issues' : ''}
            </div>
          )}
          <div className="flex gap-1 flex-wrap mt-0.5">
            {r.flags?.safety && <Flag tone="hot">Safety — forced P1</Flag>}
            {r.flags?.repeat && <Flag tone="hot">Repeat</Flag>}
            {r.flags?.chargeable_pending && <Flag tone="warm">Chargeable · awaiting approval</Flag>}
            {r.flags?.kb_suggested && <Flag tone="acc">KB suggested</Flag>}
          </div>
        </div>
      ),
    },
    {
      key: 'assets', header: 'Assets', className: 'w-[118px]',
      render: (r) => r.primary_ttspl_id
        ? (<div><Mono className="text-[11px]">{r.primary_ttspl_id}</Mono>
             {r.asset_count > 1 && <div className="text-[10px] text-sup-muted">+{r.asset_count - 1} assets</div>}</div>)
        : <span className="text-[11px] text-sup-faint">No asset</span>,
    },
    { key: 'status', header: 'Status', className: 'w-[110px]',
      render: (r) => <StatusPill kind="ticket" status={r.status} pendingReason={r.pending_reason} /> },
    {
      key: 'sla', header: 'Resolution SLA', className: 'w-[96px]',
      render: (r) => <SlaChip dueAt={r.sla_resolution_due_at} startedAt={r.sla_started_at} paused={r.sla_paused} />,
    },
    { key: 'owner', header: 'Owner', className: 'w-[96px]',
      render: (r) => r.assigned_to_name
        ? <span className="text-[11px]">{r.assigned_to_name}</span>
        : <span className="text-[11px] text-sup-faint">Unassigned</span> },
    {
      key: 'wo', header: 'Work orders', className: 'w-[82px]',
      render: (r) => r.open_wo_count > 0
        ? (<span className="inline-flex items-center h-[18px] px-1.5 rounded text-[10px] font-semibold
                            font-mono uppercase whitespace-nowrap bg-sup-accentSoft text-sup-accent">
             {r.open_wo_count} open</span>)
        : <span className="text-[11px] text-sup-faint">—</span>,
    },
  ], [selected, rows, allChecked]);

  const renderCard = (r) => (
    <div className={`bg-white border border-sup-line rounded-lg p-3 ${prioritySpine(r.priority)}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <PriorityChip priority={r.priority} />
        <Mono bold className="text-[11px]">{r.ticket_number}</Mono>
        <div className="ml-auto"><SlaChip dueAt={r.sla_resolution_due_at} paused={r.sla_paused} /></div>
      </div>
      <div className="font-semibold mt-1.5">{r.customer_name}</div>
      <div className="text-[10px] text-sup-muted">{r.site_label}</div>
      <div className="mt-1"><ClassificationChain {...(r.primary_classification || {})} /></div>
      <div className="flex items-center gap-2 mt-2">
        <StatusPill kind="ticket" status={r.status} pendingReason={r.pending_reason} />
        <span className="text-[11px] text-sup-muted ml-auto">{r.assigned_to_name || 'Unassigned'}</span>
      </div>
    </div>
  );

  const saveCurrentView = async () => {
    if (!saveName.trim()) { toast.error('Name this view'); return; }
    const bag = {};
    Object.keys(DEFAULTS).forEach((k) => {
      if (k === 'page' || k === 'search') return;
      if (filters[k] && filters[k] !== DEFAULTS[k]) bag[k] = filters[k];
    });
    if (debouncedSearch.trim()) bag.search = debouncedSearch.trim();
    try {
      await createView({ name: saveName.trim(), filters: bag });
      toast.success('View saved');
      setSaveOpen(false);
      setSaveName('');
      const v = await listViews();
      setViews(v.data?.rows || []);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not save view');
    }
  };

  const assignSelected = async () => {
    if (!assignUser) { toast.error('Pick an owner'); return; }
    try {
      await bulkAssign({ ticket_ids: selected, user_id: Number(assignUser) });
      toast.success(`Assigned ${selected.length} ticket(s)`);
      setAssignOpen(false);
      load();
      getTicketCounts().then((c) => setCounts(c.data?.counts || {}));
    } catch (e) {
      toast.error(e.response?.data?.message || 'Assign failed');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="Ticket queue"
          subtitle="One list. Everything else is a saved view of it."
        />
        <div className="flex gap-2">
          <Button variant="secondary" icon={Bookmark} onClick={() => setSaveOpen(true)}>
            Save this view
          </Button>
          <PermissionGate section="support_tickets" action="create">
            <Button variant="primary" icon={Plus} onClick={() => nav('/support/tickets/new')}>
              New ticket
            </Button>
          </PermissionGate>
        </div>
      </div>

      <div className="mt-4 bg-white border border-sup-line rounded-[10px] shadow-sup">
        <div className="flex items-center gap-2 flex-wrap px-4 pt-3">
          <span className="text-[9.5px] uppercase tracking-[0.11em] text-sup-faint font-semibold mr-1">
            Saved views
          </span>
          {views.map((v) => (
            <button
              key={v.slug}
              type="button"
              onClick={() => setFilters({ ...DEFAULTS, view: v.slug })}
              className={`h-7 px-2.5 rounded-full text-[11.5px] inline-flex items-center gap-1.5 border
                ${filters.view === v.slug
                  ? 'bg-sup-accent border-sup-accent text-white'
                  : 'bg-white border-sup-line text-sup-ink2 hover:bg-sup-canvas2'}`}
            >
              {v.name}
              {counts[v.slug] != null && (
                <span className="font-mono text-[10.5px] opacity-75">{counts[v.slug]}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex gap-2 flex-wrap items-center px-4 py-3 border-b border-sup-lineSoft">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sup-faint pointer-events-none" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Ticket, TTSPL, serial, customer, phone"
              className="w-[260px] h-7 border border-sup-line rounded-md pl-9 pr-3 text-[11.5px]"
            />
          </div>
          <button
            type="button"
            onClick={() => setFilters({ photos_deferred: filters.photos_deferred ? '' : 'true', page: 1 })}
            className={`h-7 px-2.5 rounded-full text-[11.5px] border ${filters.photos_deferred ? 'bg-pri2-bg border-pri2 text-pri2' : 'border-sup-line'}`}
          >
            Photos pending
          </button>
          <Sel value={filters.class}       onChange={(v) => setFilters({ class: v, page: 1 })}       label="Class"     options={CLASS_OPTS} />
          <Sel value={filters.priority}    onChange={(v) => setFilters({ priority: v, page: 1 })}    label="Priority"  options={PRIORITY_OPTS} />
          <Sel value={filters.type_id}     onChange={(v) => setFilters({ type_id: v, subtype_id: '', issue_id: '', page: 1 })} label="Type" options={typeOpts} />
          <Sel value={filters.subtype_id}  onChange={(v) => setFilters({ subtype_id: v, issue_id: '', page: 1 })} label="Subtype" options={subtypeOpts} disabled={!filters.type_id} />
          <Sel value={filters.issue_id}    onChange={(v) => setFilters({ issue_id: v, page: 1 })}    label="Issue type" options={issueOpts} disabled={!filters.subtype_id} />
          <Sel value={filters.status}      onChange={(v) => setFilters({ status: v, page: 1 })}      label="Status"    options={STATUS_OPTS} />
          <Sel value={filters.sla}         onChange={(v) => setFilters({ sla: v, page: 1 })}         label="SLA"       options={SLA_OPTS} />
          <Sel value={filters.group_id}    onChange={(v) => setFilters({ group_id: v, page: 1 })}    label="Group"     options={groupOpts} />
          <Sel value={filters.assigned_to} onChange={(v) => setFilters({ assigned_to: v, page: 1 })} label="Owner"     options={ownerOpts} />
          <Sel value={filters.channel}     onChange={(v) => setFilters({ channel: v, page: 1 })}     label="Channel"   options={CHANNEL_OPTS} />
          <button type="button" onClick={resetFilters}
                  className="h-7 px-2 text-[11.5px] text-sup-accent hover:underline">Clear</button>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-sup-muted">Sort</span>
            <Sel value={filters.sort} onChange={(v) => setFilters({ sort: v, page: 1 })} options={SORT_OPTS} bare />
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          keyField="ticket_id"
          loading={loading}
          renderCard={renderCard}
          rowClassName={(r) => prioritySpine(r.priority)}
          onRowClick={(r) => nav(`/support/tickets/${r.ticket_id}`)}
          empty={<EmptyState icon={ListChecks} title="No tickets match these filters"
                             hint="Clear a filter or pick another saved view" />}
        />

        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-sup-lineSoft flex-wrap">
          <span className="text-[11px] text-sup-muted">
            {selected.length > 0 ? `${selected.length} selected · ` : ''}
            showing {rows.length} of {pagination.total}
          </span>
          <div className="flex items-center gap-2">
            {selected.length > 0 && (
              <>
                <PermissionGate section="support_dispatch" action="edit">
                  <Button size="sm" variant="secondary" onClick={() => setAssignOpen(true)}>Assign selected</Button>
                </PermissionGate>
                <PermissionGate section="support_triage" action="edit">
                  <Button size="sm" variant="secondary" onClick={() => toast('Priority change lands in Phase 4')}>Change priority</Button>
                </PermissionGate>
                <PermissionGate section="support_work_orders" action="create">
                  <Button size="sm" variant="secondary" onClick={() => toast('Work orders land in Phase 5')}>Create work order</Button>
                </PermissionGate>
              </>
            )}
            <ListPagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              pageSize={pagination.limit}
              onPageChange={(n) => setFilters({ page: n })}
            />
          </div>
        </div>
      </div>

      <Modal open={saveOpen} title="Save this view" onClose={() => setSaveOpen(false)} size="sm"
        footer={<Button variant="primary" onClick={saveCurrentView}>Save</Button>}>
        <input
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="e.g. My P1 NCR"
          className="w-full h-9 border border-sup-line rounded-md px-3 text-[12.5px]"
        />
      </Modal>

      <Modal open={assignOpen} title="Assign selected" onClose={() => setAssignOpen(false)} size="sm"
        footer={<Button variant="primary" onClick={assignSelected}>Assign</Button>}>
        <select
          value={assignUser}
          onChange={(e) => setAssignUser(e.target.value)}
          className="w-full h-9 border border-sup-line rounded-md px-2 text-[12.5px]"
        >
          <option value="">Owner</option>
          {owners.map((o) => <option key={o.user_id} value={o.user_id}>{o.name}</option>)}
        </select>
      </Modal>
    </div>
  );
}

function Flag({ tone, children }) {
  const t = { hot: 'bg-pri1-bg text-pri1', warm: 'bg-pri2-bg text-pri2', acc: 'bg-sup-accentSoft text-sup-accent' }[tone];
  return <span className={`inline-flex items-center h-[19px] px-1.5 rounded-full text-[10.5px] font-semibold ${t}`}>{children}</span>;
}

function Sel({ value, onChange, label, options, disabled, bare }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 border border-sup-line rounded-md bg-white pl-2.5 pr-6 text-[11.5px]
                 text-sup-ink2 disabled:opacity-50 appearance-none
                 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%228%22 height=%225%22><path d=%22M0 0l4 5 4-5z%22 fill=%22%236B7382%22/></svg>')]
                 bg-no-repeat bg-[right_8px_center]"
    >
      {!bare && <option value="">{label} · all</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
