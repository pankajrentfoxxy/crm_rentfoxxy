import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Receipt, IndianRupee, BadgeMinus, Download, FileSpreadsheet, Shield, Laptop, CalendarDays, History } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import InvoiceStatusBadge from '../components/InvoiceStatusBadge';
import InvoiceCoveragePanel from '../components/InvoiceCoveragePanel';
import SearchableSelect from '../../operation-management/components/SearchableSelect';
import SearchableMultiSelect from '../../operation-management/components/SearchableMultiSelect';
import { PageHeader, StatCard, Button, ResponsiveTable, SearchField, ListPagination } from '../../../components/ui/primitives';
import { downloadInvoicePdf, downloadInvoicesZip, exportInvoiceSerialsExcel, generateInvoicesBulk, listInvoices, listInvoiceCoverage, markInvoicePaid } from '../customerBillingApi';
import api from '../../../utils/api';

const TABS = ['all', 'draft', 'sent', 'paid', 'overdue'];
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PAGE_SIZES = [25, 50, 100];
const YEARS = Array.from({ length: 6 }, (_, i) => 2024 + i);

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function fmtMoney(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function countLabel(n, singular) {
  const value = Number(n || 0);
  return `${value.toLocaleString('en-IN')} ${singular}${value === 1 ? '' : 's'}`;
}

function filterSplitRows(list, q) {
  const query = q.trim().toLowerCase();
  if (!query) return list;
  return list.filter((row) => (
    String(row.customer_name || '').toLowerCase().includes(query)
    || String(row.invoice_number || '').toLowerCase().includes(query)
    || (row.ttspls || []).some((id) => String(id || '').toLowerCase().includes(query))
  ));
}

function SplitDetailsPanel({
  title,
  subtitle,
  description,
  borderClass,
  titleClass,
  footerClass,
  rows,
  empty,
  search,
  onSearch,
  amountLabel,
}) {
  return (
    <div className={`mb-4 rounded-2xl border bg-white shadow-sm overflow-hidden ${borderClass}`}>
      <div className="px-4 pt-4 pb-3 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${titleClass}`}>{title}</p>
          <h3 className="text-lg font-bold text-slate-900">{subtitle}</h3>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        <SearchField
          value={search}
          onChange={onSearch}
          placeholder="Search customer, invoice, TTSPL…"
        />
      </div>
      <div className="overflow-x-auto border-t border-slate-100 max-h-96 overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="text-left font-medium px-3 py-2">Customer</th>
              <th className="text-left font-medium px-3 py-2">Invoice</th>
              <th className="text-right font-medium px-3 py-2">Laptops</th>
              <th className="text-left font-medium px-3 py-2">TTSPL</th>
              <th className="text-right font-medium px-3 py-2">{amountLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-400">{empty}</td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.invoice_id} className="border-t border-slate-50 hover:bg-slate-50/80">
                <td className="px-3 py-2.5">
                  <Link to={`/lead-crm/customers/${row.customer_id}`} className="font-medium text-blue-600 hover:underline">
                    {row.customer_name}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/customer-billing/invoices/${row.invoice_id}`} className="text-blue-600 hover:underline font-medium">
                      {row.invoice_number}
                    </Link>
                    <InvoiceStatusBadge status={row.status} />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {MONTHS[row.invoice_month] || ''} {row.invoice_year || ''}
                  </p>
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <span className="inline-flex items-center justify-end gap-1 text-slate-800">
                    <Laptop className="w-3.5 h-3.5 text-slate-400" />
                    {row.laptop_count}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-600">
                  {(row.ttspls || []).join(', ') || '—'}
                </td>
                <td className="px-3 py-2.5 text-right font-medium text-slate-800 whitespace-nowrap">
                  {fmtMoney(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 ? (
            <tfoot className={`text-sm font-semibold text-slate-800 ${footerClass}`}>
              <tr>
                <td className="px-3 py-2.5" colSpan={2}>Total</td>
                <td className="px-3 py-2.5 text-right">{rows.reduce((sum, row) => sum + Number(row.laptop_count || 0), 0)}</td>
                <td />
                <td className="px-3 py-2.5 text-right">{fmtMoney(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [customers, setCustomers] = useState([]);
  const [billableCustomers, setBillableCustomers] = useState([]);
  const [coverageTick, setCoverageTick] = useState(0);
  const [zipOpen, setZipOpen] = useState(false);
  const [zipLoading, setZipLoading] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);
  const [zipForm, setZipForm] = useState({
    month: String(new Date().getMonth() + 1),
    year: String(new Date().getFullYear()),
  });
  const [genOpen, setGenOpen] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genForm, setGenForm] = useState({
    customer_ids: [],
    all_billable: false,
    month: String(new Date().getMonth() + 1),
    year: String(new Date().getFullYear()),
  });
  const [showSecurityDetails, setShowSecurityDetails] = useState(false);
  const [securitySearch, setSecuritySearch] = useState('');
  const [showCatchupDetails, setShowCatchupDetails] = useState(false);
  const [catchupSearch, setCatchupSearch] = useState('');

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

  useEffect(() => { setPage(1); }, [tab, customerId, month, year, searchDebounced, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: pageSize };
      if (tab !== 'all') params.status = tab;
      if (customerId) params.customer_id = customerId;
      if (month) params.month = month;
      if (year) params.year = year;
      if (searchDebounced) params.search = searchDebounced;
      const res = await listInvoices(params);
      setRows(res.data?.invoices || []);
      setSummary(res.data?.summary || {});
      setTotal(Number(res.data?.total || 0));
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [tab, customerId, month, year, searchDebounced, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => ({
    invoiceCount: summary.total_count || 0,
    subtotal: summary.subtotal_total || 0,
    creditNotes: summary.credit_note_total || 0,
    creditNoteInvoices: summary.credit_note_invoice_count || 0,
    creditNotePending: summary.credit_note_pending_total || 0,
    creditNotePendingCount: summary.credit_note_pending_count || 0,
    security: summary.security_total || 0,
    securityCustomers: summary.security_customer_count || 0,
    securityLaptops: summary.security_laptop_count || 0,
    securityInvoices: summary.security_invoice_count || 0,
    securityDetails: summary.security_details || [],
    thisMonthRental: summary.this_month_rental_total || 0,
    thisMonthLaptops: summary.this_month_laptop_count || 0,
    thisMonthInvoices: summary.this_month_invoice_count || 0,
    catchup: summary.catchup_total || 0,
    catchupCustomers: summary.catchup_customer_count || 0,
    catchupLaptops: summary.catchup_laptop_count || 0,
    catchupInvoices: summary.catchup_invoice_count || 0,
    catchupLines: summary.catchup_line_count || 0,
    catchupDetails: summary.catchup_details || [],
    billedSubtotal: summary.billed_subtotal || 0,
    draft: { count: summary.draft_count || 0, total: summary.draft_total || 0 },
    sent: { count: summary.sent_count || 0, total: summary.sent_total || 0 },
    paid: { count: summary.paid_count || 0, total: summary.paid_total || 0 },
    overdue: { count: summary.overdue_count || 0, total: summary.overdue_total || 0 },
    outstanding: summary.outstanding_total || 0,
  }), [summary]);

  const securityRows = useMemo(
    () => filterSplitRows(stats.securityDetails || [], securitySearch),
    [stats.securityDetails, securitySearch]
  );

  const catchupRows = useMemo(
    () => filterSplitRows(stats.catchupDetails || [], catchupSearch),
    [stats.catchupDetails, catchupSearch]
  );

  const creditHint = useMemo(() => {
    const applied = `${Number(stats.creditNoteInvoices || 0).toLocaleString('en-IN')} invoice${stats.creditNoteInvoices === 1 ? '' : 's'} with credit`;
    if (!Number(stats.creditNotePendingCount || 0)) return applied;
    return `${applied} · ${fmtMoney(stats.creditNotePending)} pending (${stats.creditNotePendingCount})`;
  }, [stats.creditNoteInvoices, stats.creditNotePending, stats.creditNotePendingCount]);

  const allCustomersSelected = genCustomerOptions.length > 0
    && genForm.customer_ids.length === genCustomerOptions.length;

  const openGenerateModal = () => {
    setGenForm({
      customer_ids: [],
      all_billable: false,
      month: String(new Date().getMonth() + 1),
      year: String(new Date().getFullYear()),
    });
    setGenOpen(true);
  };

  const openGenerateForCustomers = (ids) => {
    setGenForm({
      customer_ids: ids || [],
      all_billable: false,
      month: String(month || new Date().getMonth() + 1),
      year: String(year || new Date().getFullYear()),
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
      if (s.credit_notes_created) parts.push(`${s.credit_notes_created} credit notes created`);
      if (s.credit_notes_applied) parts.push(`${s.credit_notes_applied} credit notes applied`);
      const securityLines = (res.data?.results || []).reduce((n, r) => n + Number(r.security_lines || 0), 0);
      if (securityLines) parts.push(`${securityLines} security lines`);
      if (s.skipped) parts.push(`${s.skipped} skipped`);
      if (s.errors) parts.push(`${s.errors} failed`);
      toast.success(parts.length ? parts.join(', ') : 'No invoices generated');
      setGenOpen(false);
      setCoverageTick((n) => n + 1);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Generate failed');
    } finally {
      setGenLoading(false);
    }
  };

  const handleDownload = async (id, num) => {
    try {
      const res = await downloadInvoicePdf(id, { format: 'laptop_details' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${num}-document.pdf`;
      a.click();
    } catch {
      toast.error('PDF download failed');
    }
  };

  const openZipModal = () => {
    setZipForm({
      month: String(month || new Date().getMonth() + 1),
      year: String(year || new Date().getFullYear()),
    });
    setZipOpen(true);
  };

  const handleZipDownload = async () => {
    if (!zipForm.month || !zipForm.year) {
      toast.error('Select month and year');
      return;
    }
    setZipLoading(true);
    try {
      const res = await downloadInvoicesZip({
        month: Number(zipForm.month),
        year: Number(zipForm.year),
        format: 'laptop_details',
      });
      const blob = new Blob([res.data], { type: 'application/zip' });
      if (blob.type.includes('json') || (res.data?.type && String(res.data.type).includes('json'))) {
        const text = await blob.text();
        const json = JSON.parse(text);
        throw new Error(json.message || 'Download failed');
      }
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
      let message = err.message || 'ZIP download failed';
      const data = err.response?.data;
      if (data instanceof Blob) {
        try {
          const json = JSON.parse(await data.text());
          message = json.message || message;
        } catch {
          /* keep default */
        }
      } else if (data?.message) {
        message = data.message;
      }
      toast.error(message);
    } finally {
      setZipLoading(false);
    }
  };

  const handleExcelExport = async () => {
    setExcelLoading(true);
    try {
      const params = {};
      if (tab !== 'all') params.status = tab;
      if (customerId) params.customer_id = customerId;
      if (month) params.month = month;
      if (year) params.year = year;
      if (searchDebounced) params.search = searchDebounced;
      const res = await exportInvoiceSerialsExcel(params);
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      if (blob.type.includes('json') || (res.data?.type && String(res.data.type).includes('json'))) {
        const text = await blob.text();
        const json = JSON.parse(text);
        throw new Error(json.message || 'Export failed');
      }
      const match = String(res.headers['content-disposition'] || '').match(/filename="?([^"]+)"?/);
      const monthLabel = month ? (MONTHS[Number(month)] || month) : 'all';
      const yearLabel = year || 'years';
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = match?.[1] || `invoice_billing_serials_${monthLabel}_${yearLabel}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Excel downloaded');
    } catch (err) {
      let message = err.message || 'Excel export failed';
      const data = err.response?.data;
      if (data instanceof Blob) {
        try {
          const json = JSON.parse(await data.text());
          message = json.message || message;
        } catch {
          /* keep default */
        }
      } else if (data?.message) {
        message = data.message;
      }
      toast.error(message);
    } finally {
      setExcelLoading(false);
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
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={FileSpreadsheet} onClick={handleExcelExport} loading={excelLoading}>
              Export Excel
            </Button>
            <Button variant="secondary" icon={Download} onClick={openZipModal}>Download</Button>
            <PermissionGate section="customer_billing" action="create">
              <Button icon={Plus} onClick={openGenerateModal}>Generate Invoice</Button>
            </PermissionGate>
          </div>
        )}
      />

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-3">
        <StatCard
          label="This Month Rent"
          value={fmtMoney(stats.thisMonthRental)}
          hint={`${countLabel(stats.thisMonthLaptops, 'laptop')} billed this month`}
          icon={CalendarDays}
          tone="blue"
        />
        <StatCard
          label="Catch-up"
          value={fmtMoney(stats.catchup)}
          hint={`${countLabel(stats.catchupCustomers, 'customer')} · ${countLabel(stats.catchupLaptops, 'laptop')} · ${countLabel(stats.catchupLines, 'line')}`}
          icon={History}
          tone="purple"
          active={showCatchupDetails}
          onClick={() => setShowCatchupDetails((open) => !open)}
        />
        <StatCard
          label="Security Charged"
          value={fmtMoney(stats.security)}
          hint={`${countLabel(stats.securityCustomers, 'customer')} · ${countLabel(stats.securityLaptops, 'laptop')}`}
          icon={Shield}
          tone="teal"
          active={showSecurityDetails}
          onClick={() => setShowSecurityDetails((open) => !open)}
        />
        <StatCard
          label="Subtotal"
          value={fmtMoney(stats.billedSubtotal)}
          hint="This month + catch-up + security"
          icon={IndianRupee}
          tone="green"
        />
        <StatCard
          label="Credit Note Total"
          value={fmtMoney(stats.creditNotes)}
          hint={creditHint}
          icon={BadgeMinus}
          tone="amber"
        />
      </div>

      {showCatchupDetails ? (
        <SplitDetailsPanel
          title="Previous-month catch-up"
          subtitle={`${countLabel(stats.catchupCustomers, 'customer')} · ${countLabel(stats.catchupLaptops, 'laptop')}`}
          description="Rent billed now for the previous calendar month. Click a customer or invoice to open the record."
          borderClass="border-violet-100"
          titleClass="text-violet-700"
          footerClass="bg-violet-50/70"
          rows={catchupRows}
          empty={stats.catchupInvoices ? 'No catch-up rows match this search.' : 'No previous-month catch-up on invoices for these filters.'}
          search={catchupSearch}
          onSearch={(e) => setCatchupSearch(e.target.value)}
          amountLabel="Catch-up"
        />
      ) : null}

      {showSecurityDetails ? (
        <SplitDetailsPanel
          title="Security charged this period"
          subtitle={`${countLabel(stats.securityCustomers, 'customer')} · ${countLabel(stats.securityLaptops, 'laptop')}`}
          description="One-month security billed on these invoices. Click a customer or invoice to open the record."
          borderClass="border-teal-100"
          titleClass="text-teal-700"
          footerClass="bg-teal-50/70"
          rows={securityRows}
          empty={stats.securityInvoices ? 'No security rows match this search.' : 'No security charged on invoices for these filters.'}
          search={securitySearch}
          onSearch={(e) => setSecuritySearch(e.target.value)}
          amountLabel="Security"
        />
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <StatCard label="Draft" value={stats.draft.count} hint={fmt(stats.draft.total)} tone="gray" active={tab === 'draft'} onClick={() => setTab('draft')} />
        <StatCard label="Sent" value={stats.sent.count} hint={fmt(stats.sent.total)} tone="blue" active={tab === 'sent'} onClick={() => setTab('sent')} />
        <StatCard label="Paid" value={stats.paid.count} hint={fmt(stats.paid.total)} tone="green" active={tab === 'paid'} onClick={() => setTab('paid')} />
        <StatCard label="Overdue" value={stats.overdue.count} hint={fmt(stats.overdue.total)} tone="red" active={tab === 'overdue'} onClick={() => setTab('overdue')} />
        <StatCard label="Outstanding" value={fmt(stats.outstanding)} tone="amber" active={tab === 'all'} onClick={() => setTab('all')} />
      </div>

      <InvoiceCoveragePanel
        month={month}
        year={year || (month ? String(new Date().getFullYear()) : '')}
        refreshKey={coverageTick}
        onGeneratePending={openGenerateForCustomers}
      />

      <div className="flex flex-wrap gap-3 mb-3 items-end">
        <SearchField
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search invoice #, customer, IRN…"
        />
        <div className="min-w-[220px] w-56">
          <SearchableSelect
            id="invoice-filter-customer"
            value={customerId}
            onChange={setCustomerId}
            options={customerOptions}
            placeholder="All customers"
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
            setMonth('');
            setYear('');
            setTab('all');
            setPage(1);
          }}
          className="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-sm min-h-[44px] hover:bg-slate-50"
        >
          Clear
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>{t}</button>
        ))}
      </div>

      <ResponsiveTable
        columns={[
          { key: 'invoice_number', header: 'Invoice #', render: (r) => (
            <Link to={`/customer-billing/invoices/${r.invoice_id}`} className="text-blue-600 hover:underline font-medium">{r.invoice_number}</Link>
          ) },
          { key: 'month', header: 'Month', render: (r) => `${MONTHS[r.invoice_month] || ''} ${r.invoice_year || ''}` },
          { key: 'customer_name', header: 'Customer' },
          { key: 'laptop_count', header: 'Laptops', align: 'right', render: (r) => r.laptop_count || 0 },
          { key: 'subtotal', header: 'Subtotal', align: 'right', render: (r) => fmt(r.subtotal) },
          { key: 'security_amount', header: 'Security', align: 'right', render: (r) => (
            Number(r.security_amount || r.security_deposit || 0) > 0
              ? (
                <span className="text-teal-700">
                  {fmt(r.security_amount || r.security_deposit)}
                  {r.security_laptop_count ? <span className="block text-[11px] font-normal text-slate-400">{r.security_laptop_count} laptop{r.security_laptop_count === 1 ? '' : 's'}</span> : null}
                </span>
              )
              : <span className="text-slate-300">—</span>
          ) },
          { key: 'gst_amount', header: 'GST', align: 'right', render: (r) => fmt(r.gst_amount) },
          { key: 'credit_note_adjustment', header: 'Credit Adj', align: 'right', render: (r) => fmt(r.credit_note_adjustment) },
          { key: 'grand_total', header: 'Total', align: 'right', render: (r) => <span className="font-medium">{fmt(r.grand_total)}</span> },
          { key: 'status', header: 'Status', render: (r) => <InvoiceStatusBadge status={r.status} /> },
          { key: 'irn', header: 'IRN', render: (r) => (r.irn ? <span className="text-green-700 text-xs font-medium">✓ IRN</span> : <span className="text-gray-400">—</span>) },
          { key: 'actions', header: 'Actions', render: (r) => (
            <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
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
          ) },
        ]}
        rows={rows}
        keyField="invoice_id"
        loading={loading}
        empty={<p className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">No invoices match these filters.</p>}
        renderCard={(r) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Link to={`/customer-billing/invoices/${r.invoice_id}`} className="text-blue-600 font-semibold">{r.invoice_number}</Link>
              <InvoiceStatusBadge status={r.status} />
            </div>
            <p className="font-medium text-slate-800">{r.customer_name}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>{MONTHS[r.invoice_month]} {r.invoice_year}</span>
              <span>{r.laptop_count || 0} laptops</span>
              {Number(r.security_amount || r.security_deposit || 0) > 0 && (
                <span className="text-teal-700 font-medium">
                  Security {fmt(r.security_amount || r.security_deposit)}
                  {r.security_laptop_count ? ` · ${r.security_laptop_count} laptop${r.security_laptop_count === 1 ? '' : 's'}` : ''}
                </span>
              )}
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
        )}
      />

      <ListPagination
        page={page}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        total={total}
        pageSize={pageSize}
        onPageChange={setPage}
      />

      {zipOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4">
          <button type="button" className="fixed inset-0 bg-black/40" onClick={() => !zipLoading && setZipOpen(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full my-6 p-6 space-y-4">
            <h3 className="font-semibold text-lg">Download invoices</h3>
            <p className="text-sm text-gray-500">
              Download every invoice for the selected month as a ZIP. Each PDF is named with the customer name. A full month can take a few minutes.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Month
                <select
                  value={zipForm.month}
                  onChange={(e) => setZipForm((f) => ({ ...f, month: e.target.value }))}
                  className="border rounded-lg px-3 py-2 text-sm min-h-[44px]"
                  disabled={zipLoading}
                >
                  {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Year
                <select
                  value={zipForm.year}
                  onChange={(e) => setZipForm((f) => ({ ...f, year: e.target.value }))}
                  className="border rounded-lg px-3 py-2 text-sm min-h-[44px]"
                  disabled={zipLoading}
                >
                  {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={() => setZipOpen(false)} className="px-4 py-2 text-sm border rounded-lg" disabled={zipLoading}>Cancel</button>
              <button
                type="button"
                onClick={handleZipDownload}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-60"
                disabled={zipLoading}
              >
                {zipLoading ? 'Preparing ZIP…' : 'Download ZIP'}
              </button>
            </div>
          </div>
        </div>
      )}

      {genOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4">
          <button type="button" className="fixed inset-0 bg-black/40" onClick={() => !genLoading && setGenOpen(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full my-6 p-6 space-y-4 max-h-[calc(100vh-3rem)] overflow-y-auto">
            <h3 className="font-semibold text-lg">Generate Invoices</h3>
            <p className="text-sm text-gray-500">
              Only customers with rental laptops for this month are listed.
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
                  Rented or returned units with a rent start date in this month
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
                        : genCustomerOptions.map((c) => c.value),
                    }))}
                    disabled={genLoading || !genCustomerOptions.length}
                  />
                  <span className="font-medium text-gray-800">
                    Select all with laptops ({genCustomerOptions.length})
                  </span>
                </label>
                <SearchableMultiSelect
                  id="invoice-gen-customers"
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
    </div>
  );
}
