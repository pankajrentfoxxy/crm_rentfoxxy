import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Receipt, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import InvoiceStatusBadge from '../components/InvoiceStatusBadge';
import SearchableSelect from '../../operation-management/components/SearchableSelect';
import SearchableMultiSelect from '../../operation-management/components/SearchableMultiSelect';
import { PageHeader, StatCard, Button } from '../../../components/ui/primitives';
import { downloadInvoicePdf, generateInvoicesBulk, listInvoices, markInvoicePaid } from '../customerBillingApi';
import api from '../../../utils/api';

const TABS = ['all', 'draft', 'sent', 'paid', 'overdue'];
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export default function InvoiceListPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [customerId, setCustomerId] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [customers, setCustomers] = useState([]);
  const [genOpen, setGenOpen] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 100 };
      if (tab !== 'all') params.status = tab;
      if (customerId) params.customer_id = customerId;
      if (month) params.month = month;
      if (year) params.year = year;
      if (searchDebounced) params.search = searchDebounced;
      const res = await listInvoices(params);
      setRows(res.data?.invoices || []);
      setSummary(res.data?.summary || {});
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [tab, customerId, month, year, searchDebounced]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => ({
    draft: { count: summary.draft_count || 0, total: summary.draft_total || 0 },
    sent: { count: summary.sent_count || 0, total: summary.sent_total || 0 },
    paid: { count: summary.paid_count || 0, total: summary.paid_total || 0 },
    overdue: { count: summary.overdue_count || 0, total: summary.overdue_total || 0 },
    outstanding: summary.outstanding_total || 0,
  }), [summary]);

  const allCustomersSelected = customerOptions.length > 0
    && genForm.customer_ids.length === customerOptions.length;

  const openGenerateModal = () => {
    setGenForm({
      customer_ids: [],
      all_billable: false,
      month: String(new Date().getMonth() + 1),
      year: String(new Date().getFullYear()),
    });
    setGenOpen(true);
  };

  const handleGenerate = async () => {
    if (!genForm.all_billable && genForm.customer_ids.length === 0) {
      toast.error('Select at least one customer, or choose “All billable customers”');
      return;
    }
    setGenLoading(true);
    try {
      const res = await generateInvoicesBulk({
        month: Number(genForm.month),
        year: Number(genForm.year),
        all: genForm.all_billable,
        customer_ids: genForm.all_billable
          ? undefined
          : genForm.customer_ids.map((id) => Number(id)),
      });
      const s = res.data?.summary || {};
      const parts = [];
      if (s.created) parts.push(`${s.created} created`);
      if (s.appended) parts.push(`${s.appended} updated`);
      if (s.skipped) parts.push(`${s.skipped} skipped`);
      if (s.errors) parts.push(`${s.errors} failed`);
      toast.success(parts.length ? parts.join(', ') : 'No invoices generated');
      setGenOpen(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Generate failed');
    } finally {
      setGenLoading(false);
    }
  };

  const handleDownload = async (id, num) => {
    try {
      const res = await downloadInvoicePdf(id);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${num}.pdf`;
      a.click();
    } catch {
      toast.error('PDF download failed');
    }
  };

  const handleMarkPaid = async (id) => {
    const ref = window.prompt('Payment reference (optional):');
    try {
      await markInvoicePaid(id, { payment_reference: ref || '' });
      toast.success('Marked paid');
      load();
    } catch {
      toast.error('Failed');
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <PageHeader
        title="Customer Invoices"
        subtitle="INV-* series"
        icon={Receipt}
        actions={(
          <PermissionGate section="customer_billing" action="create">
            <Button icon={Plus} onClick={openGenerateModal}>Generate Invoice</Button>
          </PermissionGate>
        )}
      />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <StatCard label="Draft" value={stats.draft.count} hint={fmt(stats.draft.total)} tone="gray" />
        <StatCard label="Sent" value={stats.sent.count} hint={fmt(stats.sent.total)} tone="blue" />
        <StatCard label="Paid" value={stats.paid.count} hint={fmt(stats.paid.total)} tone="green" />
        <StatCard label="Overdue" value={stats.overdue.count} hint={fmt(stats.overdue.total)} tone="red" />
        <StatCard label="Outstanding" value={fmt(stats.outstanding)} tone="amber" />
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="search"
            placeholder="Search invoice #, customer, IRN…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <div className="min-w-[220px] w-56">
          <SearchableSelect
            id="invoice-filter-customer"
            value={customerId}
            onChange={setCustomerId}
            options={customerOptions}
            placeholder="All customers"
          />
        </div>
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm">
          <option value="">All months</option>
          {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm w-28" placeholder="All years" />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>{t}</button>
        ))}
      </div>

      {/* Mobile cards */}
      <div className="grid gap-3 sm:hidden">
        {loading ? (
          <p className="text-center text-sm text-gray-500 py-8">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-8">
            No invoices{year ? ` for ${year}` : ''}.
            {year ? ' Clear the year filter to see all periods.' : ' Run billing activation on the server, then backfill with --commit.'}
          </p>
        ) : rows.map((r) => (
          <div key={r.invoice_id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Link to={`/customer-billing/invoices/${r.invoice_id}`} className="text-blue-600 font-semibold">{r.invoice_number}</Link>
              <InvoiceStatusBadge status={r.status} />
            </div>
            <p className="font-medium text-slate-800">{r.customer_name}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>{MONTHS[r.invoice_month]} {r.invoice_year}</span>
              <span>{r.laptop_count || 0} laptops</span>
              {r.irn && <span className="text-green-700 font-medium">✓ IRN</span>}
            </div>
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <span className="text-base font-bold text-slate-900">{fmt(r.grand_total)}</span>
              <div className="flex flex-wrap items-center gap-3">
                <Link to={`/customer-billing/invoices/${r.invoice_id}`} className="text-sm text-blue-600 font-semibold">View</Link>
                {r.status === 'sent' && (
                  <PermissionGate section="customer_billing" action="edit">
                    <button type="button" onClick={() => handleMarkPaid(r.invoice_id)} className="text-sm text-green-600 font-semibold">Paid</button>
                  </PermissionGate>
                )}
                <button type="button" onClick={() => handleDownload(r.invoice_id, r.invoice_number)} className="text-sm text-gray-600 font-semibold">PDF</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3">Invoice #</th>
              <th className="px-4 py-3">Month</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Laptops</th>
              <th className="px-4 py-3">Subtotal</th>
              <th className="px-4 py-3">GST</th>
              <th className="px-4 py-3">Credit Adj</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">IRN</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-500">
                No invoices{year ? ` for ${year}` : ''}.
                {year ? ' Clear the year filter to see all periods.' : ' If you ran activation scripts, ensure you used --commit on the production server.'}
              </td></tr>
            ) : rows.map((r) => (
              <tr key={r.invoice_id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">
                  <Link to={`/customer-billing/invoices/${r.invoice_id}`} className="text-blue-600 hover:underline">{r.invoice_number}</Link>
                </td>
                <td className="px-4 py-3">{MONTHS[r.invoice_month]} {r.invoice_year}</td>
                <td className="px-4 py-3">{r.customer_name}</td>
                <td className="px-4 py-3">{r.laptop_count || 0}</td>
                <td className="px-4 py-3">{fmt(r.subtotal)}</td>
                <td className="px-4 py-3">{fmt(r.gst_amount)}</td>
                <td className="px-4 py-3">{fmt(r.credit_note_adjustment)}</td>
                <td className="px-4 py-3 font-medium">{fmt(r.grand_total)}</td>
                <td className="px-4 py-3"><InvoiceStatusBadge status={r.status} /></td>
                <td className="px-4 py-3">{r.irn ? <span className="text-green-700 text-xs font-medium">✓ IRN</span> : <span className="text-gray-400">—</span>}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <Link to={`/customer-billing/invoices/${r.invoice_id}`} className="text-xs text-blue-600 hover:underline">View</Link>
                    {(r.status === 'draft' || r.status === 'sent') && (
                      <PermissionGate section="customer_billing" action="edit">
                        <Link to={`/customer-billing/invoices/${r.invoice_id}`} className="text-xs text-blue-600 hover:underline">Send</Link>
                      </PermissionGate>
                    )}
                    {r.status === 'sent' && (
                      <PermissionGate section="customer_billing" action="edit">
                        <button type="button" onClick={() => handleMarkPaid(r.invoice_id)} className="text-xs text-green-600 hover:underline">Paid</button>
                      </PermissionGate>
                    )}
                    <button type="button" onClick={() => handleDownload(r.invoice_id, r.invoice_number)} className="text-xs text-gray-600 hover:underline">PDF</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {genOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => !genLoading && setGenOpen(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="font-semibold text-lg">Generate Invoices</h3>
            <p className="text-sm text-gray-500">
              Select one or more customers, or run for all customers with active rental laptops.
            </p>
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
                <span className="font-medium text-gray-800">All billable customers</span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  Customers with rented/returned laptops and a rent start date
                </span>
              </span>
            </label>
            {!genForm.all_billable && (
              <>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allCustomersSelected}
                    onChange={() => setGenForm((f) => ({
                      ...f,
                      customer_ids: allCustomersSelected
                        ? []
                        : customerOptions.map((c) => c.value),
                    }))}
                    disabled={genLoading || !customerOptions.length}
                  />
                  <span className="font-medium text-gray-800">
                    Select all customers ({customerOptions.length})
                  </span>
                </label>
                <SearchableMultiSelect
                  id="invoice-gen-customers"
                  label="Customers"
                  required
                  value={genForm.customer_ids}
                  onChange={(ids) => setGenForm((f) => ({ ...f, customer_ids: ids }))}
                  options={customerOptions}
                  placeholder="Select customers"
                  countNoun="customer"
                  emptyMessage="No customers found."
                  disabled={genLoading}
                />
              </>
            )}
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
    </div>
  );
}
