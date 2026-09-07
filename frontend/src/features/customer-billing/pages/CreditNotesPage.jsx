import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Clock, FileMinus, Hash, CheckCircle2, CheckCircle, Ban, Download } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import CreditNoteForm from '../components/CreditNoteForm';
import { PageHeader, Button, StatCard, ResponsiveTable, SearchField, ListPagination } from '../../../components/ui/primitives';
import SearchableSelect from '../../operation-management/components/SearchableSelect';
import SearchableMultiSelect from '../../operation-management/components/SearchableMultiSelect';
import {
  approveCreditNote,
  approveCreditNotesBulk,
  creditNotePdfErrorMessage,
  downloadCreditNotePdf,
  generateCreditNotesBulk,
  listCreditNotes,
  listInvoiceCoverage,
} from '../customerBillingApi';
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

function creditNoteLaptops(row) {
  const stored = Array.isArray(row?.line_items) ? row.line_items : (() => {
    try {
      const parsed = JSON.parse(row?.line_items || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  if (stored.length) {
    return stored.map((line) => ({
      ttspl_id: line.ttspl_id || null,
      amount: Number(line.amount || 0),
      quantity: Number(line.quantity || line.days_in_month || 0),
      from_date: line.from_date || line.rent_start || null,
      to_date: line.to_date || line.rent_end || null,
      return_dc_number: line.return_dc_number || null,
    }));
  }
  return ttsplList(row?.ttspl_ids).map((code) => ({
    ttspl_id: code,
    amount: Number(row?.amount || 0),
    quantity: Number(row?.quantity || 0),
    from_date: row?.from_date || null,
    to_date: row?.to_date || null,
    return_dc_number: row?.return_dc_number || null,
  }));
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
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YEARS = Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - 2 + i));

function monthLabel(month, year) {
  const name = MONTHS[Number(month)] || '';
  return `${name} ${year || ''}`.trim() || '—';
}

export default function CreditNotesPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
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
  const [genOpen, setGenOpen] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [billableCustomers, setBillableCustomers] = useState([]);
  const [genForm, setGenForm] = useState({
    customer_ids: [],
    all_billable: false,
    month: String(new Date().getMonth() + 1),
    year: String(new Date().getFullYear()),
  });

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

  const genCustomerOptions = useMemo(
    () => billableCustomers.map((c) => ({
      value: String(c.customer_id),
      label: c.customer_name || `Customer #${c.customer_id}`,
    })),
    [billableCustomers]
  );

  const allGenCustomersSelected = genCustomerOptions.length > 0
    && genForm.customer_ids.length === genCustomerOptions.length;

  useEffect(() => { setPage(1); }, [statusFilter, customerId, searchDebounced, pageSize, ttsplIds, month, year]);

  useEffect(() => { setSelected(new Set()); }, [statusFilter, customerId, searchDebounced, page, pageSize, ttsplIds, month, year]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: pageSize };
      if (statusFilter) params.status = statusFilter;
      if (customerId) params.customer_id = customerId;
      if (searchDebounced) params.search = searchDebounced;
      if (ttsplIds.length) params.ttspl = ttsplIds.join(',');
      if (month) params.month = month;
      if (year) params.year = year;
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
  }, [statusFilter, customerId, searchDebounced, page, pageSize, ttsplIds, month, year]);

  const kpis = useMemo(() => ({
    all: { count: summary.total_count || 0, amount: summary.total_amount || 0 },
    pending: { count: summary.pending_count || 0, amount: summary.pending_amount || 0 },
    approved: { count: summary.approved_count || 0, amount: summary.approved_amount || 0 },
    applied: { count: summary.applied_count || 0, amount: summary.applied_amount || 0 },
    cancelled: { count: summary.cancelled_count || 0, amount: summary.cancelled_amount || 0 },
  }), [summary]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!genOpen) return undefined;
    let cancelled = false;
    listInvoiceCoverage({ month: genForm.month, year: genForm.year })
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.customers || [];
        setBillableCustomers(list);
        const allowed = new Set(list.map((c) => String(c.customer_id)));
        setGenForm((f) => ({
          ...f,
          customer_ids: (f.customer_ids || []).filter((id) => allowed.has(String(id))),
        }));
      })
      .catch(() => {
        if (!cancelled) setBillableCustomers([]);
      });
    return () => { cancelled = true; };
  }, [genOpen, genForm.month, genForm.year]);

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

  const openGenerateModal = () => {
    setGenForm({
      customer_ids: [],
      all_billable: false,
      month: String(month || new Date().getMonth() + 1),
      year: String(year || new Date().getFullYear()),
    });
    setGenOpen(true);
  };

  const handleGenerate = async () => {
    if (!genForm.all_billable && genForm.customer_ids.length === 0) {
      toast.error('Select at least one customer, or choose “All customers with laptops”');
      return;
    }
    setGenLoading(true);
    try {
      const res = await generateCreditNotesBulk({
        month: Number(genForm.month),
        year: Number(genForm.year),
        all: genForm.all_billable,
        customer_ids: genForm.all_billable
          ? undefined
          : genForm.customer_ids.map((id) => Number(id)),
      });
      const s = res.data?.summary || {};
      const parts = [];
      if (s.created) parts.push(`${s.created} credit note${s.created === 1 ? '' : 's'} created`);
      if (s.skipped) parts.push(`${s.skipped} customer${s.skipped === 1 ? '' : 's'} with no new returns`);
      if (s.errors) parts.push(`${s.errors} failed`);
      toast.success(parts.length ? parts.join(', ') : 'No new credit notes to generate');
      setGenOpen(false);
      setStatusFilter('pending');
      setMonth(String(genForm.month));
      setYear(String(genForm.year));
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Generate failed');
    } finally {
      setGenLoading(false);
    }
  };

  const handleDownloadPdf = async (id, num) => {
    try {
      const res = await downloadCreditNotePdf(id, { format: 'laptop_details' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${num}-document.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(await creditNotePdfErrorMessage(err));
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <PageHeader
        title="Credit Notes"
        subtitle="CN-* series"
        icon={FileMinus}
        actions={(
          <div className="flex flex-wrap gap-2">
            <PermissionGate section="credit_notes" action="create">
              <Button icon={Plus} onClick={openGenerateModal}>Generate Credit Notes</Button>
            </PermissionGate>
            <PermissionGate section="credit_notes" action="create">
              <Button variant="secondary" icon={Plus} onClick={() => setFormOpen(true)}>Manual credit note</Button>
            </PermissionGate>
          </div>
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
          Month
          <select
            value={month}
            onChange={(e) => {
              const next = e.target.value;
              setMonth(next);
              if (next && !year) setYear(String(new Date().getFullYear()));
            }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[44px] min-w-[120px]"
          >
            <option value="">All months</option>
            {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Year
          <select value={year} onChange={(e) => setYear(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[44px] min-w-[110px]">
            <option value="">All years</option>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
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
            setMonth('');
            setYear('');
            setSelected(new Set());
            setPage(1);
          }}
          className="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-sm min-h-[44px] hover:bg-slate-50"
        >
          Clear
        </button>
      </div>

      <p className="text-xs text-slate-500 mb-3">
        Click a credit note to open its invoice-format laptop page. Only approved credit notes appear on invoices.
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
          {
            key: 'credit_note_number',
            header: 'CN #',
            render: (r) => (
              <Link to={`/customer-billing/credit-notes/${r.credit_note_id}`} className="text-blue-600 hover:underline font-medium">
                {r.credit_note_number}
              </Link>
            ),
          },
          { key: 'customer_name', header: 'Customer' },
          {
            key: 'billing_month',
            header: 'Month',
            render: (r) => monthLabel(r.billing_month, r.billing_year),
          },
          {
            key: 'laptops',
            header: 'Laptops',
            align: 'right',
            render: (r) => creditNoteLaptops(r).length || 0,
          },
          {
            key: 'reason',
            header: 'Justification',
            render: (r) => (
              <div>
                <div className="font-medium">{r.reason}</div>
                {(r.from_date || r.to_date) && (
                  <div className="text-xs text-gray-500">
                    {String(r.from_date || '').slice(0, 10)} → {String(r.to_date || '').slice(0, 10)}
                    {r.quantity ? ` · ${r.quantity} day(s)` : ''}
                  </div>
                )}
                {r.invoice_number && <div className="text-xs text-gray-400">Applied in {r.invoice_number}</div>}
              </div>
            ),
          },
          { key: 'amount', header: 'Amount', align: 'right', render: (r) => <span className="font-medium">{fmt(r.amount)}</span> },
          { key: 'status', header: 'Status', render: (r) => (
            <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATUS_STYLES[r.status] || ''}`}>{creditNoteStatusLabel(r.status)}</span>
          ) },
          { key: 'links', header: 'Links', render: (r) => (
            <div className="text-xs space-y-1" onClick={(e) => e.stopPropagation()}>
              <CreditNoteLinks row={r} />
            </div>
          ) },
          { key: 'actions', header: 'Actions', render: (r) => (
            <div className="flex flex-col items-start gap-1" onClick={(e) => e.stopPropagation()}>
              <Link to={`/customer-billing/credit-notes/${r.credit_note_id}`} className="text-xs text-blue-600 hover:underline">
                View
              </Link>
              <button
                type="button"
                onClick={() => handleDownloadPdf(r.credit_note_id, r.credit_note_number)}
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
              >
                <Download className="w-3 h-3" /> PDF
              </button>
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
        onRowClick={(r) => navigate(`/customer-billing/credit-notes/${r.credit_note_id}`)}
        empty={<p className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">No credit notes match these filters.</p>}
        renderCard={(r) => {
          const laptopCount = creditNoteLaptops(r).length;
          const isPending = String(r.status || '').toLowerCase() === 'pending';
          return (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 min-w-0" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${r.credit_note_number}`}
                    checked={selected.has(r.credit_note_id)}
                    disabled={!isPending}
                    onChange={() => toggleOne(r)}
                  />
                  <Link to={`/customer-billing/credit-notes/${r.credit_note_id}`} className="font-semibold text-blue-600 hover:underline">
                    {r.credit_note_number}
                  </Link>
                </label>
                <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATUS_STYLES[r.status] || ''}`}>{creditNoteStatusLabel(r.status)}</span>
              </div>
              <p className="font-medium text-slate-800">{r.customer_name}</p>
              <p className="text-xs text-slate-500">{monthLabel(r.billing_month, r.billing_year)}</p>
              <p className="text-sm text-slate-600">{r.reason}</p>
              {laptopCount > 0 && (
                <p className="text-xs text-slate-500">{laptopCount} laptop{laptopCount === 1 ? '' : 's'}</p>
              )}
              {r.invoice_number && <p className="text-xs text-slate-400">Applied in {r.invoice_number}</p>}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <span className="text-base font-bold text-slate-900">{fmt(r.amount)}</span>
                <div className="flex flex-wrap items-center gap-3" onClick={(e) => e.stopPropagation()}>
                  <Link to={`/customer-billing/credit-notes/${r.credit_note_id}`} className="text-sm text-blue-600 font-semibold">View</Link>
                  <button type="button" onClick={() => handleDownloadPdf(r.credit_note_id, r.credit_note_number)} className="flex items-center gap-1 text-blue-600 text-sm font-semibold">
                    <Download className="w-3.5 h-3.5" /> PDF
                  </button>
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

      {genOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4">
          <button type="button" className="fixed inset-0 bg-black/40" onClick={() => !genLoading && setGenOpen(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full my-6 p-6 space-y-4 max-h-[calc(100vh-3rem)] overflow-y-auto">
            <h3 className="font-semibold text-lg">Generate Credit Notes</h3>
            <p className="text-sm text-gray-500">
              Creates one draft credit note per customer for unused prepaid days after warehouse returns. Approve in bulk. Only approved notes appear on invoices.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={genForm.month}
                onChange={(e) => setGenForm((f) => ({ ...f, month: e.target.value }))}
                className="border rounded-lg px-3 py-2 text-sm"
                disabled={genLoading}
              >
                {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <input
                type="number"
                value={genForm.year}
                onChange={(e) => setGenForm((f) => ({ ...f, year: e.target.value }))}
                className="border rounded-lg px-3 py-2 text-sm"
                disabled={genLoading}
              />
            </div>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={genForm.all_billable}
                onChange={(e) => setGenForm((f) => ({
                  ...f,
                  all_billable: e.target.checked,
                  customer_ids: e.target.checked ? [] : f.customer_ids,
                }))}
                disabled={genLoading}
              />
              <span>
                <span className="font-medium text-gray-800">
                  All customers with laptops ({genCustomerOptions.length})
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  Same customer set as invoice generation for this month
                </span>
              </span>
            </label>
            {!genForm.all_billable && (
              <>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allGenCustomersSelected}
                    onChange={() => setGenForm((f) => ({
                      ...f,
                      customer_ids: allGenCustomersSelected
                        ? []
                        : genCustomerOptions.map((c) => c.value),
                    }))}
                    disabled={genLoading || !genCustomerOptions.length}
                  />
                  <span className="font-medium text-gray-800">
                    Select all with laptops ({genCustomerOptions.length})
                  </span>
                </label>
                <SearchableMultiSelect
                  id="credit-note-gen-customers"
                  label="Customers"
                  required
                  value={genForm.customer_ids}
                  onChange={(ids) => setGenForm((f) => ({ ...f, customer_ids: ids }))}
                  options={genCustomerOptions}
                  placeholder="Select customers with laptops"
                  countNoun="customer"
                  emptyMessage="No customers with rental laptops for this month."
                  disabled={genLoading}
                />
              </>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={() => setGenOpen(false)} className="px-4 py-2 text-sm border rounded-lg" disabled={genLoading}>Cancel</button>
              <button
                type="button"
                onClick={handleGenerate}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-60"
                disabled={genLoading}
              >
                {genLoading
                  ? 'Generating…'
                  : genForm.all_billable
                    ? 'Generate for all billable'
                    : `Generate (${genForm.customer_ids.length || 0})`}
              </button>
            </div>
          </div>
        </div>
      )}

      <CreditNoteForm open={formOpen} onClose={() => setFormOpen(false)} onCreated={load} />
    </div>
  );
}
