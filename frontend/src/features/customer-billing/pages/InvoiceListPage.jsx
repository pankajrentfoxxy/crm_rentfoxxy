import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Receipt, Search, X, Download, FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import InvoiceStatusBadge from '../components/InvoiceStatusBadge';
import { PageHeader, StatCard, Button } from '../../../components/ui/primitives';
import MultiSelectFilter from '../../lead-crm/components/MultiSelectFilter';
import {
  downloadInvoicePdf,
  downloadInvoicesZip,
  exportInvoiceSerialsExcel,
  generateInvoice,
  generateInvoicesBulk,
  listInvoiceCoverage,
  listInvoices,
  markInvoicePaid,
} from '../customerBillingApi';
import api from '../../../utils/api';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_OPTIONS = MONTHS.slice(1).map((label, i) => ({ value: String(i + 1), label }));
const PAGE_SIZE = 25;

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function customerLabel(c) {
  return c?.company_name || c?.customer_name || c?.name || `Customer #${c?.customer_id}`;
}

export default function InvoiceListPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [months, setMonths] = useState([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [customers, setCustomers] = useState([]);
  const [billableCustomers, setBillableCustomers] = useState([]);
  const [genOpen, setGenOpen] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genForm, setGenForm] = useState({
    customer_id: '',
    all_billable: false,
    month: String(new Date().getMonth() + 1),
    year: String(new Date().getFullYear()),
  });
  const [payOpen, setPayOpen] = useState(null);
  const [payRef, setPayRef] = useState('');
  const [payLoading, setPayLoading] = useState(false);
  const [zipOpen, setZipOpen] = useState(false);
  const [zipLoading, setZipLoading] = useState(false);
  const [zipForm, setZipForm] = useState({
    month: String(new Date().getMonth() + 1),
    year: String(new Date().getFullYear()),
  });
  const [excelLoading, setExcelLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim()), 320);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    api.get('/customer-management/customers/ids')
      .then((r) => setCustomers(r.data?.customers || []))
      .catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    if (!genOpen) return undefined;
    let cancelled = false;
    listInvoiceCoverage({ month: genForm.month, year: genForm.year })
      .then((res) => {
        if (!cancelled) setBillableCustomers(res.data?.customers || []);
      })
      .catch(() => {
        if (!cancelled) setBillableCustomers([]);
      });
    return () => { cancelled = true; };
  }, [genOpen, genForm.month, genForm.year]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE, search: searchDebounced || undefined };
      if (status) params.status = status;
      if (customerId) params.customer_id = customerId;
      if (months.length === 1) params.month = months[0];
      if (months.length > 1 && months.length < MONTH_OPTIONS.length) params.months = months.join(',');
      const res = await listInvoices(params);
      setRows(res.data?.invoices || []);
      setSummary(res.data?.summary || {});
      setTotal(Number(res.data?.total || 0));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [status, customerId, months, page, searchDebounced]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const stats = useMemo(() => ({
    draft: { count: summary.draft_count || 0, total: summary.draft_total || 0 },
    sent: { count: summary.sent_count || 0, total: summary.sent_total || 0 },
    paid: { count: summary.paid_count || 0, total: summary.paid_total || 0 },
    outstanding: summary.outstanding_total || 0,
  }), [summary]);

  const closeGenerate = () => {
    if (genLoading) return;
    setGenOpen(false);
  };

  const handleGenerate = async () => {
    if (!genForm.all_billable && !genForm.customer_id) {
      toast.error('Select a customer');
      return;
    }
    setGenLoading(true);
    try {
      if (genForm.all_billable) {
        const res = await generateInvoicesBulk({
          month: Number(genForm.month),
          year: Number(genForm.year),
          all: true,
        });
        const s = res.data?.summary || {};
        const parts = [];
        if (s.created) parts.push(`${s.created} created`);
        if (s.appended) parts.push(`${s.appended} updated`);
        if (s.skipped) parts.push(`${s.skipped} skipped`);
        if (s.errors) parts.push(`${s.errors} failed`);
        toast.success(parts.length ? parts.join(', ') : 'No invoices generated');
      } else {
        const res = await generateInvoice({
          customer_id: Number(genForm.customer_id),
          month: Number(genForm.month),
          year: Number(genForm.year),
        });
        if (res.data?.skipped) {
          toast.error(res.data?.message || res.data?.reason || 'Nothing to bill for this month');
          return;
        }
        toast.success(res.data?.invoice?.invoice_number
          ? `Invoice ${res.data.invoice.invoice_number} generated`
          : 'Invoice generated');
      }
      setGenOpen(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Generate failed');
    } finally {
      setGenLoading(false);
    }
  };

  const handlePdf = async (id, num) => {
    try {
      const res = await downloadInvoicePdf(id, { format: 'laptop_details' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${num}-document.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('PDF download failed');
    }
  };

  const handlePaid = async () => {
    if (!payOpen) return;
    setPayLoading(true);
    try {
      await markInvoicePaid(payOpen, { payment_reference: payRef.trim() });
      toast.success('Marked paid');
      setPayOpen(null);
      setPayRef('');
      load();
    } catch {
      toast.error('Failed');
    } finally {
      setPayLoading(false);
    }
  };

  const handleZipDownload = async () => {
    setZipLoading(true);
    try {
      const res = await downloadInvoicesZip({
        month: Number(zipForm.month),
        year: Number(zipForm.year),
        format: 'laptop_details',
      });
      const blob = new Blob([res.data], { type: 'application/zip' });
      const monthLabel = MONTHS[Number(zipForm.month)] || zipForm.month;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Laptop-Rental-Documents-${monthLabel}-${zipForm.year}.zip`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('ZIP downloaded');
      setZipOpen(false);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'ZIP download failed');
    } finally {
      setZipLoading(false);
    }
  };

  const handleExcelExport = async () => {
    setExcelLoading(true);
    try {
      const params = {};
      if (status) params.status = status;
      if (customerId) params.customer_id = customerId;
      if (months.length === 1) params.month = months[0];
      if (searchDebounced) params.search = searchDebounced;
      const res = await exportInvoiceSerialsExcel(params);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'invoice_billing_serials.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Excel downloaded');
    } catch {
      toast.error('Excel export failed');
    } finally {
      setExcelLoading(false);
    }
  };

  useEffect(() => {
    if (!genOpen && !payOpen && !zipOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      closeGenerate();
      if (!payLoading) setPayOpen(null);
      if (!zipLoading) setZipOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [genOpen, payOpen, zipOpen, genLoading, payLoading, zipLoading]);

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <PageHeader
        title="Customer Invoices"
        subtitle="INV-* series"
        icon={Receipt}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={FileSpreadsheet} onClick={handleExcelExport} loading={excelLoading}>
              Export Excel
            </Button>
            <Button variant="secondary" icon={Download} onClick={() => setZipOpen(true)}>Download ZIP</Button>
            <PermissionGate section="customer_billing" action="create">
              <Button icon={Plus} onClick={() => {
                setGenForm({
                  customer_id: '',
                  all_billable: false,
                  month: String(new Date().getMonth() + 1),
                  year: String(new Date().getFullYear()),
                });
                setGenOpen(true);
              }}>Generate Invoice</Button>
            </PermissionGate>
          </div>
        )}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard
          label="Draft"
          value={stats.draft.count}
          hint={fmt(stats.draft.total)}
          tone="gray"
          onClick={() => { setStatus((s) => (s === 'draft' ? '' : 'draft')); setPage(1); }}
          active={status === 'draft'}
        />
        <StatCard
          label="Sent"
          value={stats.sent.count}
          hint={fmt(stats.sent.total)}
          tone="blue"
          onClick={() => { setStatus((s) => (s === 'sent' ? '' : 'sent')); setPage(1); }}
          active={status === 'sent'}
        />
        <StatCard
          label="Paid"
          value={stats.paid.count}
          hint={fmt(stats.paid.total)}
          tone="green"
          onClick={() => { setStatus((s) => (s === 'paid' ? '' : 'paid')); setPage(1); }}
          active={status === 'paid'}
        />
        <StatCard label="Outstanding" value={fmt(stats.outstanding)} tone="amber" />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="search"
            placeholder="Search invoice #, customer, notes…"
            value={searchInput}
            onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
            className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setPage(1); }} className="border rounded-lg px-2 py-1.5 text-sm min-w-[10rem]">
          <option value="">All customers</option>
          {customers.map((c) => (
            <option key={c.customer_id} value={c.customer_id}>{customerLabel(c)}</option>
          ))}
        </select>
        <MultiSelectFilter
          options={MONTH_OPTIONS}
          value={months}
          onChange={(next) => { setMonths(next); setPage(1); }}
          allLabel="All months"
          className="min-w-[10rem]"
        />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="border rounded-lg px-2 py-1.5 text-sm">
          <option value="">All statuses</option>
          {['draft', 'sent', 'paid', 'overdue'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="grid gap-3 sm:hidden">
        {loading ? (
          <p className="text-center text-sm text-gray-500 py-8">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-8">No invoices</p>
        ) : rows.map((r) => (
          <div key={r.invoice_id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Link to={`/customer-billing/invoices/${r.invoice_id}`} className="text-blue-600 font-semibold">{r.invoice_number}</Link>
              <InvoiceStatusBadge status={r.status} />
            </div>
            <p className="font-medium text-slate-800">{r.customer_name}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>{MONTHS[r.invoice_month]} {r.invoice_year}</span>
              <span>{r.laptop_count || 0} units</span>
            </div>
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <span className="text-base font-bold text-slate-900">{fmt(r.grand_total)}</span>
              <div className="flex flex-wrap items-center gap-3">
                <Link to={`/customer-billing/invoices/${r.invoice_id}`} className="text-sm text-blue-600 font-semibold">View</Link>
                <button type="button" onClick={() => handlePdf(r.invoice_id, r.invoice_number)} className="text-sm text-gray-600 font-semibold">PDF</button>
                {r.status === 'sent' && (
                  <PermissionGate section="customer_billing" action="edit">
                    <button type="button" onClick={() => { setPayOpen(r.invoice_id); setPayRef(''); }} className="text-sm text-green-600 font-semibold">Paid</button>
                  </PermissionGate>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Invoice #</th>
              <th className="px-4 py-3 text-left">Month</th>
              <th className="px-4 py-3 text-left">Customer</th>
              <th className="px-4 py-3 text-left">Units</th>
              <th className="px-4 py-3 text-left">Subtotal</th>
              <th className="px-4 py-3 text-left">Credit Adj</th>
              <th className="px-4 py-3 text-left">Total Payable</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">No invoices</td></tr>
            ) : rows.map((r) => (
              <tr key={r.invoice_id}>
                <td className="px-4 py-3 font-medium">
                  <Link to={`/customer-billing/invoices/${r.invoice_id}`} className="text-blue-600 hover:underline">{r.invoice_number}</Link>
                </td>
                <td className="px-4 py-3">{MONTHS[r.invoice_month]} {r.invoice_year}</td>
                <td className="px-4 py-3">{r.customer_name}</td>
                <td className="px-4 py-3">{r.laptop_count || 0}</td>
                <td className="px-4 py-3">{fmt(r.subtotal)}</td>
                <td className="px-4 py-3">{fmt(r.credit_note_adjustment)}</td>
                <td className="px-4 py-3 font-medium">{fmt(r.grand_total)}</td>
                <td className="px-4 py-3"><InvoiceStatusBadge status={r.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <Link to={`/customer-billing/invoices/${r.invoice_id}`} className="text-xs text-blue-600">View</Link>
                    <button type="button" onClick={() => handlePdf(r.invoice_id, r.invoice_number)} className="text-xs text-gray-600">PDF</button>
                    {r.status === 'sent' && (
                      <PermissionGate section="customer_billing" action="edit">
                        <button type="button" onClick={() => { setPayOpen(r.invoice_id); setPayRef(''); }} className="text-xs text-green-600">Paid</button>
                      </PermissionGate>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
          <p className="text-sm text-gray-500">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <span className="text-sm text-gray-600 py-2">Page {page} of {totalPages}</span>
            <Button variant="secondary" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {genOpen && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button type="button" className="absolute inset-0 bg-slate-900/50" onClick={closeGenerate} aria-label="Close" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="gen-invoice-title"
            className="relative z-10 w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex-none h-auto max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
              <div>
                <h2 id="gen-invoice-title" className="text-lg font-semibold text-slate-900">Generate invoice</h2>
                <p className="text-sm text-slate-500 mt-0.5">Bill one customer for a calendar month.</p>
              </div>
              <button type="button" onClick={closeGenerate} className="shrink-0 p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={genForm.all_billable}
                  onChange={(e) => setGenForm((f) => ({ ...f, all_billable: e.target.checked, customer_id: e.target.checked ? '' : f.customer_id }))}
                  disabled={genLoading}
                />
                <span>
                  <span className="font-medium text-slate-800">All billable customers ({billableCustomers.length})</span>
                  <span className="block text-xs text-slate-500 mt-0.5">Same as generating every rental customer for this month.</span>
                </span>
              </label>
              <label className="block text-sm">
                <span className="block text-slate-600 font-medium mb-1">Customer</span>
                <select
                  value={genForm.customer_id}
                  onChange={(e) => setGenForm((f) => ({ ...f, customer_id: e.target.value, all_billable: false }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm min-h-[44px]"
                  disabled={genLoading || genForm.all_billable}
                >
                  <option value="">{billableCustomers.length ? 'Select customer…' : 'No rental customers found'}</option>
                  {billableCustomers.map((c) => (
                    <option key={c.customer_id} value={c.customer_id}>{customerLabel(c)}</option>
                  ))}
                </select>
                <span className="block text-xs text-slate-500 mt-1">Rental customers with laptops for this month only.</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="block text-slate-600 font-medium mb-1">Month</span>
                  <select
                    value={genForm.month}
                    onChange={(e) => setGenForm((f) => ({ ...f, month: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm min-h-[44px]"
                    disabled={genLoading}
                  >
                    {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="block text-slate-600 font-medium mb-1">Year</span>
                  <input
                    type="number"
                    value={genForm.year}
                    onChange={(e) => setGenForm((f) => ({ ...f, year: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm min-h-[44px]"
                    disabled={genLoading}
                  />
                </label>
              </div>
            </div>
            <div className="flex gap-2 justify-end px-5 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
              <button type="button" onClick={closeGenerate} disabled={genLoading} className="px-4 py-2.5 text-sm border border-slate-300 bg-white rounded-lg min-h-[44px]">Cancel</button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={genLoading || (!genForm.all_billable && !genForm.customer_id)}
                className="px-4 py-2.5 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50 min-h-[44px]"
              >
                {genLoading ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {payOpen && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button type="button" className="absolute inset-0 bg-slate-900/50" onClick={() => !payLoading && setPayOpen(null)} aria-label="Close" />
          <div role="dialog" aria-modal="true" className="relative z-10 w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl">
            <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Mark invoice paid</h2>
                <p className="text-sm text-slate-500 mt-0.5">Optional payment reference (UTR, cheque no.).</p>
              </div>
              <button type="button" onClick={() => !payLoading && setPayOpen(null)} className="shrink-0 p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4">
              <label className="block text-sm">
                <span className="block text-slate-600 font-medium mb-1">Payment reference</span>
                <input
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="e.g. UTR / NEFT / cheque"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm min-h-[44px]"
                  disabled={payLoading}
                />
              </label>
            </div>
            <div className="flex gap-2 justify-end px-5 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
              <button type="button" onClick={() => setPayOpen(null)} disabled={payLoading} className="px-4 py-2.5 text-sm border border-slate-300 bg-white rounded-lg min-h-[44px]">Cancel</button>
              <button type="button" onClick={handlePaid} disabled={payLoading} className="px-4 py-2.5 text-sm bg-emerald-600 text-white rounded-lg disabled:opacity-50 min-h-[44px]">
                {payLoading ? 'Saving…' : 'Mark paid'}
              </button>
            </div>
          </div>
        </div>
      )}

      {zipOpen && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button type="button" className="absolute inset-0 bg-slate-900/50" onClick={() => !zipLoading && setZipOpen(false)} aria-label="Close" />
          <div className="relative z-10 w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl">
            <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Download invoices</h2>
                <p className="text-sm text-slate-500 mt-0.5">ZIP of laptop rental PDFs for one month.</p>
              </div>
              <button type="button" onClick={() => !zipLoading && setZipOpen(false)} className="shrink-0 p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="block text-slate-600 font-medium mb-1">Month</span>
                <select value={zipForm.month} onChange={(e) => setZipForm((f) => ({ ...f, month: e.target.value }))} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm min-h-[44px]" disabled={zipLoading}>
                  {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </label>
              <label className="block text-sm">
                <span className="block text-slate-600 font-medium mb-1">Year</span>
                <input type="number" value={zipForm.year} onChange={(e) => setZipForm((f) => ({ ...f, year: e.target.value }))} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm min-h-[44px]" disabled={zipLoading} />
              </label>
            </div>
            <div className="flex gap-2 justify-end px-5 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
              <button type="button" onClick={() => setZipOpen(false)} disabled={zipLoading} className="px-4 py-2.5 text-sm border border-slate-300 bg-white rounded-lg min-h-[44px]">Cancel</button>
              <button type="button" onClick={handleZipDownload} disabled={zipLoading} className="px-4 py-2.5 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50 min-h-[44px]">
                {zipLoading ? 'Preparing ZIP…' : 'Download ZIP'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
