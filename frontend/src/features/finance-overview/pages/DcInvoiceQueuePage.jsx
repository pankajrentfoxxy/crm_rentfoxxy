import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getDcInvoiceQueue } from '../financeOverviewApi';
import { uploadSaleDcCompliance } from '../../sales-pipeline/salesPipelineApi';
import { deliveryChallanDetailPath } from '../../sales-pipeline/salesPipelineUtils';
import { salesOrderDetailPath } from '../../sales-pipeline/salesOrderScope';
import { getBackendOrigin } from '../../../utils/api';

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
  const [loading, setLoading] = useState(true);
  const [uploadRow, setUploadRow] = useState(null);
  const [einvoiceNumber, setEinvoiceNumber] = useState('');
  const [ewayNumber, setEwayNumber] = useState('');
  const [einvoiceFile, setEinvoiceFile] = useState(null);
  const [ewayFile, setEwayFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDcInvoiceQueue();
      setRows(res.data?.queue || []);
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
            ) : rows.map((r) => (
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
