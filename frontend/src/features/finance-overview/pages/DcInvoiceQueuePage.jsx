import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getDcInvoiceQueue } from '../financeOverviewApi';
import { uploadSaleDcCompliance, uploadDemoEway } from '../../sales-pipeline/salesPipelineApi';
import { deliveryChallanDetailPath } from '../../sales-pipeline/salesPipelineUtils';
import { salesOrderDetailPath } from '../../sales-pipeline/salesOrderScope';
import { getBackendOrigin } from '../../../utils/api';
import { DateRangeFilter, SearchField } from '../../../components/ui/primitives';

const TYPE_FILTERS = [
  { value: '', label: 'All types' },
  { value: 'sale', label: 'Sale' },
  { value: 'first_order', label: 'First order' },
];

const STATUS_FILTERS = [
  { value: '', label: 'All status' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'dispatch_ready', label: 'Dispatch ready' },
  { value: 'in_transit', label: 'In transit' },
  { value: 'reached', label: 'Reached' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
];

const EWAY_FILTERS = [
  { value: '', label: 'All e-way' },
  { value: 'required', label: 'E-way required' },
  { value: 'not_required', label: 'No e-way' },
];

const MAIL_FILTERS = [
  { value: '', label: 'All mail' },
  { value: 'sent', label: 'Mail sent' },
  { value: 'pending', label: 'Not sent' },
];

function isSaleRow(row) {
  const qt = String(row.quotation_type || '').toLowerCase();
  return qt === 'sale' || qt === 'sales' || row.entity_code === 'gorefurbo';
}

function matchesSearch(row, q) {
  if (!q) return true;
  const hay = [
    row.dc_number,
    row.sales_order_number,
    row.customer_name,
    row.quotation_type,
    row.status,
    row.einvoice_number,
    row.irn,
    row.eway_bill_number,
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

function filterSaleRows(rows, { search, type, status, eway, mail, dateFrom, dateTo }) {
  const q = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (!matchesSearch(row, q)) return false;
    if (type === 'sale' && !isSaleRow(row)) return false;
    if (type === 'first_order' && isSaleRow(row)) return false;
    if (status && String(row.status || '').toLowerCase() !== status) return false;
    if (eway === 'required' && !row.requires_eway_bill) return false;
    if (eway === 'not_required' && row.requires_eway_bill) return false;
    if (mail === 'sent' && !row.accounts_notified_at) return false;
    if (mail === 'pending' && row.accounts_notified_at) return false;
    if (dateFrom || dateTo) {
      const created = row.created_at ? new Date(row.created_at) : null;
      if (!created || Number.isNaN(created.getTime())) return false;
      if (dateFrom) {
        const from = new Date(`${dateFrom}T00:00:00`);
        if (created < from) return false;
      }
      if (dateTo) {
        const to = new Date(`${dateTo}T23:59:59.999`);
        if (created > to) return false;
      }
    }
    return true;
  });
}

function filterDemoRows(rows, { search, mail, dateFrom, dateTo }) {
  const q = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (q) {
      const hay = [
        row.dc_number,
        row.sales_order_number,
        row.customer_name,
        row.laptops,
        row.eway_bill_number,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (mail === 'sent' && !row.accounts_notified_at) return false;
    if (mail === 'pending' && row.accounts_notified_at) return false;
    if (dateFrom || dateTo) {
      const created = row.created_at ? new Date(row.created_at) : null;
      if (!created || Number.isNaN(created.getTime())) return false;
      if (dateFrom) {
        const from = new Date(`${dateFrom}T00:00:00`);
        if (created < from) return false;
      }
      if (dateTo) {
        const to = new Date(`${dateTo}T23:59:59.999`);
        if (created > to) return false;
      }
    }
    return true;
  });
}

function formatMoney(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function formatDcDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function docUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${getBackendOrigin().replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function soPath(row) {
  const qt = String(row.quotation_type || '').toLowerCase();
  const scope = qt === 'sale' || qt === 'sales' || row.entity_code === 'gorefurbo' ? 'sale' : 'rental';
  return salesOrderDetailPath(row.sales_order_number, scope);
}

export default function DcInvoiceQueuePage() {
  const [rows, setRows] = useState([]);
  const [demoRows, setDemoRows] = useState([]);
  const [ewayThreshold, setEwayThreshold] = useState(50000);
  const [loading, setLoading] = useState(true);
  const [uploadRow, setUploadRow] = useState(null);
  const [demoUploadRow, setDemoUploadRow] = useState(null);
  const [einvoiceNumber, setEinvoiceNumber] = useState('');
  const [ewayNumber, setEwayNumber] = useState('');
  const [ewayDate, setEwayDate] = useState('');
  const [einvoiceFile, setEinvoiceFile] = useState(null);
  const [ewayFile, setEwayFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [ewayFilter, setEwayFilter] = useState('');
  const [mailFilter, setMailFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [demoSearchInput, setDemoSearchInput] = useState('');
  const [demoMailFilter, setDemoMailFilter] = useState('');
  const [demoDateFrom, setDemoDateFrom] = useState('');
  const [demoDateTo, setDemoDateTo] = useState('');

  const filteredRows = useMemo(
    () => filterSaleRows(rows, {
      search: searchInput,
      type: typeFilter,
      status: statusFilter,
      eway: ewayFilter,
      mail: mailFilter,
      dateFrom,
      dateTo,
    }),
    [rows, searchInput, typeFilter, statusFilter, ewayFilter, mailFilter, dateFrom, dateTo]
  );

  const filteredDemoRows = useMemo(
    () => filterDemoRows(demoRows, {
      search: demoSearchInput,
      mail: demoMailFilter,
      dateFrom: demoDateFrom,
      dateTo: demoDateTo,
    }),
    [demoRows, demoSearchInput, demoMailFilter, demoDateFrom, demoDateTo]
  );

  const hasActiveFilters = Boolean(
    searchInput || typeFilter || statusFilter || ewayFilter || mailFilter || dateFrom || dateTo
  );

  const clearFilters = () => {
    setSearchInput('');
    setTypeFilter('');
    setStatusFilter('');
    setEwayFilter('');
    setMailFilter('');
    setDateFrom('');
    setDateTo('');
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDcInvoiceQueue();
      setRows(res.data?.queue || []);
      setDemoRows(res.data?.demo_eway || []);
      if (res.data?.eway_threshold) setEwayThreshold(Number(res.data.eway_threshold));
    } catch {
      toast.error('Failed to load DC invoice queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openUpload = (row) => {
    setUploadRow(row);
    setEinvoiceNumber(row.einvoice_number || row.irn || '');
    setEwayNumber(row.eway_bill_number || '');
    setEinvoiceFile(null);
    setEwayFile(null);
  };

  const openDemoUpload = (row) => {
    setDemoUploadRow(row);
    setEwayNumber(row.eway_bill_number || '');
    setEwayDate(row.eway_bill_date ? String(row.eway_bill_date).slice(0, 10) : '');
    setEwayFile(null);
  };

  const submitDemoUpload = async () => {
    if (!demoUploadRow) return;
    if (!ewayNumber.trim() && !demoUploadRow.eway_bill_number) {
      toast.error('E-Way Bill number is required');
      return;
    }
    if (!ewayFile && !demoUploadRow.eway_bill_pdf_path) {
      toast.error('E-Way Bill document is required');
      return;
    }
    const fd = new FormData();
    if (ewayNumber.trim()) fd.append('eway_bill_number', ewayNumber.trim());
    if (ewayDate) fd.append('eway_bill_date', ewayDate);
    if (ewayFile) fd.append('eway_bill_pdf', ewayFile);
    setSaving(true);
    try {
      const res = await uploadDemoEway(demoUploadRow.dc_number, fd);
      toast.success(res.data?.message || 'E-Way Bill Uploaded');
      setDemoUploadRow(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  const submitUpload = async () => {
    if (!uploadRow) return;
    if (!einvoiceNumber.trim()) {
      toast.error('Invoice number is required');
      return;
    }
    if (!einvoiceFile && !uploadRow.einvoice_pdf_path) {
      toast.error('E-Invoice PDF or image is required');
      return;
    }
    if (uploadRow.requires_eway_bill) {
      if (!ewayNumber.trim() && !uploadRow.eway_bill_number) {
        toast.error('E-Way Bill number is required — value exceeds ₹50,000');
        return;
      }
      if (!ewayFile && !uploadRow.eway_bill_pdf_path) {
        toast.error('E-Way Bill PDF or image is required');
        return;
      }
    }
    const fd = new FormData();
    fd.append('einvoice_number', einvoiceNumber.trim());
    if (uploadRow.requires_eway_bill && ewayNumber.trim()) fd.append('eway_bill_number', ewayNumber.trim());
    if (einvoiceFile) fd.append('einvoice_pdf', einvoiceFile);
    if (uploadRow.requires_eway_bill && ewayFile) fd.append('eway_bill_pdf', ewayFile);
    setSaving(true);
    try {
      const res = await uploadSaleDcCompliance(uploadRow.dc_number, fd);
      toast.success(res.data?.message || 'Invoice uploaded');
      setUploadRow(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">DC Invoice</h1>
        <p className="text-sm text-gray-500 mt-1">
          Sale DCs and new-customer first orders waiting for Zoho e-invoice
          {rows.some((r) => r.requires_eway_bill) ? ' / e-way bill' : ''} upload.
          After upload, the DC PDF unlocks for warehouse.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Type</span>
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value || 'all-type'}
            type="button"
            onClick={() => setTypeFilter(f.value)}
            className={`px-3 min-h-[36px] rounded-full text-xs font-medium ${
              typeFilter === f.value ? 'bg-slate-800 text-white' : 'bg-gray-100 text-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Status</span>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value || 'all-status'}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`px-3 min-h-[36px] rounded-full text-xs font-medium ${
              statusFilter === f.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">E-Way</span>
        {EWAY_FILTERS.map((f) => (
          <button
            key={f.value || 'all-eway'}
            type="button"
            onClick={() => setEwayFilter(f.value)}
            className={`px-3 min-h-[36px] rounded-full text-xs font-medium ${
              ewayFilter === f.value ? 'bg-amber-700 text-white' : 'bg-gray-100 text-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide ml-2">Mail</span>
        {MAIL_FILTERS.map((f) => (
          <button
            key={f.value || 'all-mail'}
            type="button"
            onClick={() => setMailFilter(f.value)}
            className={`px-3 min-h-[36px] rounded-full text-xs font-medium ${
              mailFilter === f.value ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <SearchField
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search DC #, SO #, customer, invoice #…"
        />
        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          onRangeChange={({ dateFrom: from, dateTo: to }) => {
            setDateFrom(from || '');
            setDateTo(to || '');
          }}
          fromLabel="Created from"
          toLabel="Created to"
        />
        {hasActiveFilters && (
          <button type="button" onClick={clearFilters} className="text-sm text-blue-600 hover:underline pb-2">
            Clear filters
          </button>
        )}
      </div>

      <p className="text-xs text-gray-500 mb-2">
        Showing {filteredRows.length} of {rows.length} pending sale DC invoices
      </p>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">DC</th>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Sales Order</th>
              <th className="px-4 py-3 text-left">Customer</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Qty</th>
              <th className="px-4 py-3 text-left">Amount (ex. GST)</th>
              <th className="px-4 py-3 text-left">E-Way</th>
              <th className="px-4 py-3 text-left">Mail</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">No pending DC invoices</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">No DC invoices match your filters</td></tr>
            ) : filteredRows.map((r) => (
              <tr key={r.dc_number}>
                <td className="px-4 py-3 font-mono">
                  <Link to={deliveryChallanDetailPath(r.dc_number)} className="text-blue-600 hover:underline">
                    {r.dc_number}
                  </Link>
                    <p className="text-xs text-gray-400 capitalize">{r.status}</p>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-gray-700">{formatDcDate(r.created_at)}</td>
                <td className="px-4 py-3">
                  {r.sales_order_number ? (
                    <Link to={soPath(r)} className="text-blue-600 hover:underline">
                      {r.sales_order_number}
                    </Link>
                  ) : '—'}
                </td>
                <td className="px-4 py-3">{r.customer_name || '—'}</td>
                <td className="px-4 py-3 capitalize">{r.quotation_type || '—'}</td>
                <td className="px-4 py-3">{r.quantity != null ? Number(r.quantity) : '—'}</td>
                <td className="px-4 py-3">{formatMoney(r.amount)}</td>
                <td className="px-4 py-3">
                  {r.requires_eway_bill
                    ? <span className="text-amber-700 font-medium">Required</span>
                    : <span className="text-gray-400">No</span>}
                </td>
                <td className="px-4 py-3">
                  {r.accounts_notified_at
                    ? <span className="text-emerald-700">Sent</span>
                    : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Link to={deliveryChallanDetailPath(r.dc_number)} className="text-xs text-blue-600 hover:underline">View DC</Link>
                    {r.sales_order_number && (
                      <Link to={soPath(r)} className="text-xs text-blue-600 hover:underline">View SO</Link>
                    )}
                    <button type="button" onClick={() => openUpload(r)} className="text-xs text-teal-700 hover:underline font-semibold">
                      Upload invoice
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 mb-3">
        <h2 className="text-lg font-semibold">New Customer Demo — E-Way Bill</h2>
        <p className="text-sm text-gray-500 mt-1">
          Demo DCs for a first-time customer when consignment value is above ₹{Number(ewayThreshold).toLocaleString('en-IN')}.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Mail</span>
        {MAIL_FILTERS.map((f) => (
          <button
            key={`demo-${f.value || 'all-mail'}`}
            type="button"
            onClick={() => setDemoMailFilter(f.value)}
            className={`px-3 min-h-[36px] rounded-full text-xs font-medium ${
              demoMailFilter === f.value ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <SearchField
          value={demoSearchInput}
          onChange={(e) => setDemoSearchInput(e.target.value)}
          placeholder="Search demo DC #, SO #, customer, laptop…"
        />
        <DateRangeFilter
          dateFrom={demoDateFrom}
          dateTo={demoDateTo}
          onDateFromChange={setDemoDateFrom}
          onDateToChange={setDemoDateTo}
          onRangeChange={({ dateFrom: from, dateTo: to }) => {
            setDemoDateFrom(from || '');
            setDemoDateTo(to || '');
          }}
          fromLabel="Created from"
          toLabel="Created to"
        />
        {(demoSearchInput || demoMailFilter || demoDateFrom || demoDateTo) && (
          <button
            type="button"
            onClick={() => {
              setDemoSearchInput('');
              setDemoMailFilter('');
              setDemoDateFrom('');
              setDemoDateTo('');
            }}
            className="text-sm text-blue-600 hover:underline pb-2"
          >
            Clear filters
          </button>
        )}
      </div>

      <p className="text-xs text-gray-500 mb-2">
        Showing {filteredDemoRows.length} of {demoRows.length} demo E-Way Bill rows
      </p>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">DC Number</th>
              <th className="px-4 py-3 text-left">Customer</th>
              <th className="px-4 py-3 text-left">SO Number</th>
              <th className="px-4 py-3 text-left">Laptop</th>
              <th className="px-4 py-3 text-left">Value</th>
              <th className="px-4 py-3 text-left">E-Way Bill Status</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : demoRows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No new-customer demo E-Way Bills</td></tr>
            ) : filteredDemoRows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No demo rows match your filters</td></tr>
            ) : filteredDemoRows.map((r) => (
              <tr key={`demo-${r.dc_number}`}>
                <td className="px-4 py-3 font-mono">
                  <Link to={deliveryChallanDetailPath(r.dc_number)} className="text-blue-600 hover:underline">
                    {r.dc_number}
                  </Link>
                </td>
                <td className="px-4 py-3">{r.customer_name || '—'}</td>
                <td className="px-4 py-3">
                  {r.sales_order_number ? (
                    <Link to={soPath(r)} className="text-blue-600 hover:underline">{r.sales_order_number}</Link>
                  ) : '—'}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{r.laptops || '—'}</td>
                <td className="px-4 py-3">{formatMoney(r.amount)}</td>
                <td className="px-4 py-3">
                  {r.eway_status === 'uploaded'
                    ? <span className="text-emerald-700 font-medium">Uploaded</span>
                    : <span className="text-amber-700 font-medium">Pending</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Link to={deliveryChallanDetailPath(r.dc_number)} className="text-xs text-blue-600 hover:underline">View DC</Link>
                    <button type="button" onClick={() => openDemoUpload(r)} className="text-xs text-teal-700 hover:underline font-semibold">
                      Upload E-Way Bill
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {demoUploadRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setDemoUploadRow(null)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="font-semibold text-gray-900">Upload E-Way Bill — {demoUploadRow.dc_number}</h3>
            <p className="text-sm text-gray-600">
              {demoUploadRow.customer_name} · {demoUploadRow.sales_order_number || 'No SO'} · {formatMoney(demoUploadRow.amount)}
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">E-Way Bill number *</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={ewayNumber}
                onChange={(e) => setEwayNumber(e.target.value)}
                placeholder="E-Way Bill number"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">E-Way Bill date</label>
              <input
                type="date"
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={ewayDate}
                onChange={(e) => setEwayDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">E-Way Bill document *</label>
              <input type="file" accept=".pdf,image/*" className="w-full text-sm" onChange={(e) => setEwayFile(e.target.files?.[0] || null)} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setDemoUploadRow(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button type="button" disabled={saving} onClick={submitDemoUpload} className="px-4 py-2 bg-teal-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : 'Save E-Way Bill'}
              </button>
            </div>
          </div>
        </div>
      )}

      {uploadRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setUploadRow(null)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="font-semibold text-gray-900">Upload invoice — {uploadRow.dc_number}</h3>
            <p className="text-sm text-gray-600">
              {uploadRow.customer_name} · {uploadRow.sales_order_number || 'No SO'} · {formatMoney(uploadRow.amount)}
            </p>
            {uploadRow.requires_eway_bill && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Amount is above ₹50,000 — e-way bill is mandatory. Upload number and file.
              </p>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Invoice number *</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={einvoiceNumber}
                onChange={(e) => setEinvoiceNumber(e.target.value)}
                placeholder="Zoho / e-invoice number"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">E-Invoice PDF or image *</label>
              <input type="file" accept=".pdf,image/*" className="w-full text-sm" onChange={(e) => setEinvoiceFile(e.target.files?.[0] || null)} />
              {uploadRow.einvoice_pdf_path && (
                <a href={docUrl(uploadRow.einvoice_pdf_path)} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline mt-1 inline-block">Current file</a>
              )}
            </div>
            {uploadRow.requires_eway_bill && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">E-Way Bill number *</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={ewayNumber}
                    onChange={(e) => setEwayNumber(e.target.value)}
                    placeholder="E-Way Bill number"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">E-Way Bill PDF or image *</label>
                  <input type="file" accept=".pdf,image/*" className="w-full text-sm" onChange={(e) => setEwayFile(e.target.files?.[0] || null)} />
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setUploadRow(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button type="button" disabled={saving} onClick={submitUpload} className="px-4 py-2 bg-teal-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : 'Save to DC'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
