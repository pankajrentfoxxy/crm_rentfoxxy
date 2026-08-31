import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Clock, FileMinus, Hash, CheckCircle2, CheckCircle, Ban } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import CreditNoteForm from '../components/CreditNoteForm';
import TtsplHistoryModal from '../../../components/TtsplHistoryModal';
import { PageHeader, Button, StatCard, ResponsiveTable, SearchField, ListPagination } from '../../../components/ui/primitives';
import SearchableSelect from '../../operation-management/components/SearchableSelect';
import SearchableMultiSelect from '../../operation-management/components/SearchableMultiSelect';
import { approveCreditNote, approveCreditNotesBulk, listCreditNotes } from '../customerBillingApi';
import api from '../../../utils/api';

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-800',
  draft: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  applied: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

function creditNoteStatusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'pending') return 'Draft';
  if (s === 'approved') return 'Approved';
  if (s === 'applied') return 'Applied';
  if (s === 'cancelled') return 'Cancelled';
  return status || '—';
}

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function ttsplList(ids) {
  if (!ids) return [];
  if (Array.isArray(ids)) return ids;
  try { const p = JSON.parse(ids); return Array.isArray(p) ? p : []; } catch { return []; }
}

function CreditNoteLinks({ row, className = 'text-xs space-y-1' }) {
  const dc = row.return_dc_number || null;
  const supportId = row.support_ticket_id || (row.source === 'return_pickup' ? row.return_ticket_id : null);
  if (!dc && !supportId) return null;
  return (
    <div className={className}>
      {dc && (
        <Link
          to={`/sales-pipeline/return-dc?search=${encodeURIComponent(dc)}`}
          className="block text-blue-600 hover:underline"
        >
          {dc}
        </Link>
      )}
      {supportId && (
        <Link to={`/support/tickets/${supportId}`} className="block text-blue-600 hover:underline">
          Support ticket #{supportId}
        </Link>
      )}
    </div>
  );
}

const PAGE_SIZES = [25, 50, 100];

export default function CreditNotesPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [customers, setCustomers] = useState([]);
  const [laptops, setLaptops] = useState([]);
  const [ttsplIds, setTtsplIds] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [approving, setApproving] = useState(false);
  const [historyTtspl, setHistoryTtspl] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim()), 320);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    api.get('/customer-management/customers/ids')
      .then((r) => setCustomers(r.data?.customers || []))
      .catch(() => setCustomers([]));
  }, []);

  const customerOptions = useMemo(
    () => customers.map((c) => ({
      value: String(c.customer_id),
      label: c.company_name || c.name || c.customer_name || `Customer #${c.customer_id}`,
    })),
    [customers]
  );

  useEffect(() => { setPage(1); }, [statusFilter, customerId, searchDebounced, pageSize, ttsplIds]);

  useEffect(() => { setSelected(new Set()); }, [statusFilter, customerId, searchDebounced, page, pageSize, ttsplIds]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: pageSize };
      if (statusFilter) params.status = statusFilter;
      if (customerId) params.customer_id = customerId;
      if (searchDebounced) params.search = searchDebounced;
      if (ttsplIds.length) params.ttspl = ttsplIds.join(',');
      const res = await listCreditNotes(params);
      const nextRows = res.data?.credit_notes || [];
      setRows(nextRows);
      setSummary(res.data?.summary || {});
      setLaptops(res.data?.laptops || []);
      setTotal(Number(res.data?.total || 0));
      if (ttsplIds.length) {
        setSelected(new Set(
          nextRows
            .filter((r) => String(r.status || '').toLowerCase() === 'pending')
            .map((r) => r.credit_note_id)
        ));
      }
    } catch {
      toast.error('Failed to load credit notes');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, customerId, searchDebounced, page, pageSize, ttsplIds]);

  const kpis = useMemo(() => ({
    all: { count: summary.total_count || 0, amount: summary.total_amount || 0 },
    pending: { count: summary.pending_count || 0, amount: summary.pending_amount || 0 },
    approved: { count: summary.approved_count || 0, amount: summary.approved_amount || 0 },
    applied: { count: summary.applied_count || 0, amount: summary.applied_amount || 0 },
    cancelled: { count: summary.cancelled_count || 0, amount: summary.cancelled_amount || 0 },
  }), [summary]);

  useEffect(() => { load(); }, [load]);

  const laptopOptions = useMemo(
    () => (laptops || []).map((code) => ({ value: String(code), label: String(code) })),
    [laptops]
  );

  const pendingRows = useMemo(
    () => rows.filter((r) => String(r.status || '').toLowerCase() === 'pending'),
    [rows]
  );

  const allPendingSelected = pendingRows.length > 0
    && pendingRows.every((r) => selected.has(r.credit_note_id));

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.credit_note_id)),
    [rows, selected]
  );

  const selectedAmount = useMemo(
    () => selectedRows.reduce((sum, r) => sum + Number(r.amount || 0), 0),
    [selectedRows]
  );

  const toggleOne = (row) => {
    if (String(row.status || '').toLowerCase() !== 'pending') return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row.credit_note_id)) next.delete(row.credit_note_id);
      else next.add(row.credit_note_id);
      return next;
    });
  };

  const toggleAllPending = () => {
    if (allPendingSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(pendingRows.map((r) => r.credit_note_id)));
  };

  const handleApprove = async (id) => {
    try {
      const res = await approveCreditNote(id);
      toast.success(res.data?.applied
        ? 'Approved and applied to the invoice'
        : 'Approved — will apply when the invoice is ready');
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      load();
    } catch {
      toast.error('Approve failed');
    }
  };

  const handleBulkApprove = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setApproving(true);
    try {
      const res = await approveCreditNotesBulk(ids);
      const summaryRes = res.data?.summary || {};
      const approved = Number(summaryRes.approved || 0);
      const applied = Number(summaryRes.applied || 0);
      const failed = Number(summaryRes.failed || 0);
      if (failed && !approved) {
        toast.error('Approve failed for the selected credit notes');
      } else if (failed) {
        toast.error(`${approved} approved, ${failed} failed`);
      } else if (applied) {
        toast.success(`${approved} approved and applied to invoices`);
      } else {
        toast.success(`${approved} approved — will apply when invoices are ready`);
      }
      setSelected(new Set());
      load();
    } catch {
      toast.error('Approve failed');
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <PageHeader
        title="Credit Notes"
        subtitle="CN-* series"
        icon={FileMinus}
        actions={(
          <PermissionGate section="credit_notes" action="create">
            <Button icon={Plus} onClick={() => setFormOpen(true)}>Create Credit Note</Button>
          </PermissionGate>
        )}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <StatCard
          label="Total"
          value={kpis.all.count}
          hint={fmt(kpis.all.amount)}
          icon={Hash}
          tone="gray"
          active={!statusFilter}
          onClick={() => setStatusFilter('')}
        />
        <StatCard
          label="Draft"
          value={kpis.pending.count}
          hint={fmt(kpis.pending.amount)}
          icon={Clock}
          tone="amber"
          active={statusFilter === 'pending'}
          onClick={() => setStatusFilter('pending')}
        />
        <StatCard
          label="Approved"
          value={kpis.approved.count}
          hint={fmt(kpis.approved.amount)}
          icon={CheckCircle2}
          tone="blue"
          active={statusFilter === 'approved'}
          onClick={() => setStatusFilter('approved')}
        />
        <StatCard
          label="Applied"
          value={kpis.applied.count}
          hint={fmt(kpis.applied.amount)}
          icon={CheckCircle}
          tone="green"
          active={statusFilter === 'applied'}
          onClick={() => setStatusFilter('applied')}
        />
        <StatCard
          label="Cancelled"
          value={kpis.cancelled.count}
          hint={fmt(kpis.cancelled.amount)}
          icon={Ban}
          tone="red"
          active={statusFilter === 'cancelled'}
          onClick={() => setStatusFilter('cancelled')}
        />
      </div>

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <SearchField
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search CN #, customer, laptop, invoice…"
        />
        <div className="min-w-[220px] w-56">
          <SearchableSelect
            id="credit-note-filter-customer"
            label="Customer"
            value={customerId}
            onChange={(value) => {
              setCustomerId(value);
              setTtsplIds([]);
            }}
            options={customerOptions}
            placeholder="All customers"
          />
        </div>
        <div className="min-w-[240px] w-64">
          <SearchableMultiSelect
            id="credit-note-filter-laptop"
            label="Laptop"
            value={ttsplIds}
            onChange={setTtsplIds}
            options={laptopOptions}
            placeholder={customerId ? 'Mark specific laptop' : 'All laptops'}
            countNoun="laptop"
            emptyMessage={customerId ? 'No laptops on credit notes for this customer.' : 'No laptops match these filters.'}
          />
        </div>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[44px] min-w-[140px]"
          >
            <option value="">All statuses</option>
            <option value="pending">Draft</option>
            <option value="approved">Approved</option>
            <option value="applied">Applied</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Rows
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[44px] w-24">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setSearchInput('');
            setCustomerId('');
            setTtsplIds([]);
            setStatusFilter('');
            setSelected(new Set());
            setPage(1);
          }}
          className="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-sm min-h-[44px] hover:bg-slate-50"
        >
          Clear
        </button>
      </div>

      <p className="text-xs text-slate-500 mb-3">
        Filter by customer and laptop, then tick draft credit notes to approve.
      </p>

      <ResponsiveTable
        columns={[
          {
            key: 'select',
            header: (
              <input
                type="checkbox"
                aria-label="Select all draft credit notes on this page"
                checked={allPendingSelected}
                disabled={!pendingRows.length}
                onChange={toggleAllPending}
              />
            ),
            render: (r) => {
              const isPending = String(r.status || '').toLowerCase() === 'pending';
              return (
                <input
                  type="checkbox"
                  aria-label={`Select ${r.credit_note_number}`}
                  checked={selected.has(r.credit_note_id)}
                  disabled={!isPending}
                  onChange={() => toggleOne(r)}
                  onClick={(e) => e.stopPropagation()}
                />
              );
            },
          },
          { key: 'credit_note_number', header: 'CN #', render: (r) => <span className="font-medium">{r.credit_note_number}</span> },
          { key: 'customer_name', header: 'Customer' },
          { key: 'reason', header: 'Justification', render: (r) => {
            const ttspls = ttsplList(r.ttspl_ids);
            return (
              <div>
                <div className="font-medium">{r.reason}</div>
                {ttspls.length > 0 && <div className="text-xs text-gray-600 mt-0.5">Laptop: {ttspls.join(', ')}</div>}
                {(r.from_date || r.to_date) && (
                  <div className="text-xs text-gray-500">
                    {String(r.from_date || '').slice(0, 10)} → {String(r.to_date || '').slice(0, 10)}
                    {r.quantity ? ` · ${r.quantity} day(s)` : ''}{r.unit_rate ? ` × ${fmt(r.unit_rate)}/day` : ''}
                  </div>
                )}
                {r.invoice_number && <div className="text-xs text-gray-400">Applied in {r.invoice_number}</div>}
              </div>
            );
          } },
          { key: 'amount', header: 'Amount', align: 'right', render: (r) => <span className="font-medium">{fmt(r.amount)}</span> },
          { key: 'status', header: 'Status', render: (r) => (
            <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATUS_STYLES[r.status] || ''}`}>{creditNoteStatusLabel(r.status)}</span>
          ) },
          { key: 'links', header: 'Links', render: (r) => {
            const ttspls = ttsplList(r.ttspl_ids);
            return (
              <div className="text-xs space-y-1" onClick={(e) => e.stopPropagation()}>
                {ttspls[0] && (
                  <button type="button" onClick={() => setHistoryTtspl(ttspls[0])} className="flex items-center gap-1 text-blue-600 hover:underline">
                    <Clock className="w-3 h-3" /> Laptop history
                  </button>
                )}
                <CreditNoteLinks row={r} />
              </div>
            );
          } },
          { key: 'actions', header: 'Actions', render: (r) => (
            <div onClick={(e) => e.stopPropagation()}>
              {r.status === 'pending' && (
                <PermissionGate section="credit_notes" action="edit">
                  <button type="button" onClick={() => handleApprove(r.credit_note_id)} className="text-xs text-blue-600 hover:underline">Approve</button>
                </PermissionGate>
              )}
            </div>
          ) },
        ]}
        rows={rows}
        keyField="credit_note_id"
        loading={loading}
        empty={<p className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">No credit notes match these filters.</p>}
        renderCard={(r) => {
          const ttspls = ttsplList(r.ttspl_ids);
          const isPending = String(r.status || '').toLowerCase() === 'pending';
          return (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    aria-label={`Select ${r.credit_note_number}`}
                    checked={selected.has(r.credit_note_id)}
                    disabled={!isPending}
                    onChange={() => toggleOne(r)}
                  />
                  <span className="font-semibold text-slate-900">{r.credit_note_number}</span>
                </label>
                <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATUS_STYLES[r.status] || ''}`}>{creditNoteStatusLabel(r.status)}</span>
              </div>
              <p className="font-medium text-slate-800">{r.customer_name}</p>
              <p className="text-sm text-slate-600">{r.reason}</p>
              {ttspls.length > 0 && <p className="text-xs text-slate-500">Laptop: {ttspls.join(', ')}</p>}
              <CreditNoteLinks row={r} className="text-xs space-y-0.5" />
              {r.invoice_number && <p className="text-xs text-slate-400">Applied in {r.invoice_number}</p>}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <span className="text-base font-bold text-slate-900">{fmt(r.amount)}</span>
                <div className="flex flex-wrap items-center gap-3">
                  {ttspls[0] && (
                    <button type="button" onClick={() => setHistoryTtspl(ttspls[0])} className="flex items-center gap-1 text-blue-600 text-sm font-semibold">
                      <Clock className="w-3.5 h-3.5" /> History
                    </button>
                  )}
                  {r.status === 'pending' && (
                    <PermissionGate section="credit_notes" action="edit">
                      <button type="button" onClick={() => handleApprove(r.credit_note_id)} className="text-sm text-blue-600 font-semibold">Approve</button>
                    </PermissionGate>
                  )}
                </div>
              </div>
            </div>
          );
        }}
      />

      <ListPagination
        page={page}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        total={total}
        pageSize={pageSize}
        onPageChange={setPage}
      />

      {selected.size > 0 && (
        <div className="sticky bottom-4 z-20 mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-900 text-white rounded-2xl px-4 py-3 shadow-lg">
          <div className="text-sm">
            <span className="font-semibold">{selected.size} draft CN{selected.size === 1 ? '' : 's'} selected</span>
            <span className="text-slate-300"> · {fmt(selectedAmount)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="px-3 py-2 rounded-lg text-sm text-slate-200 hover:bg-slate-800 min-h-[40px]"
            >
              Clear selection
            </button>
            <PermissionGate section="credit_notes" action="edit">
              <Button
                variant="success"
                size="sm"
                loading={approving}
                onClick={handleBulkApprove}
              >
                Approve selected
              </Button>
            </PermissionGate>
          </div>
        </div>
      )}

      <CreditNoteForm open={formOpen} onClose={() => setFormOpen(false)} onCreated={load} />
      {historyTtspl && <TtsplHistoryModal ttsplId={historyTtspl} onClose={() => setHistoryTtspl(null)} />}
    </div>
  );
}
