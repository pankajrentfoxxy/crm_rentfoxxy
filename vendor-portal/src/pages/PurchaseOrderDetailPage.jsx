import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../utils/api';

function formatType(t) {
  return String(t || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'approved' || s === 'vendor_accepted') return 'bg-green-100 text-green-700';
  if (s === 'processing') return 'bg-amber-100 text-amber-700';
  if (s === 'completed') return 'bg-slate-100 text-slate-700';
  if (s === 'vendor_rejected') return 'bg-red-100 text-red-700';
  return 'bg-blue-100 text-blue-700';
}

export default function PurchaseOrderDetailPage() {
  const { poId } = useParams();
  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceFile, setInvoiceFile] = useState(null);

  const loadPo = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/vendor-portal/purchase-orders/${poId}`);
      if (data.success) setPo(data.data);
      else toast.error(data.message || 'Not found');
    } catch {
      toast.error('Failed to load PO');
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => {
    loadPo();
  }, [loadPo]);

  async function handleAccept() {
    setBusy(true);
    try {
      const { data } = await api.post(`/vendor-portal/purchase-orders/${poId}/accept`);
      if (!data.success) throw new Error(data.message);
      toast.success('Purchase order accepted');
      await loadPo();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Accept failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    const reason = rejectReason.trim();
    if (reason.length < 10) {
      toast.error('Rejection reason must be at least 10 characters');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post(`/vendor-portal/purchase-orders/${poId}/reject`, { reason });
      if (!data.success) throw new Error(data.message);
      toast.success('Purchase order rejected');
      setShowRejectForm(false);
      setRejectReason('');
      await loadPo();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Reject failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleInvoiceUpload(e) {
    e.preventDefault();
    if (!invoiceNumber.trim()) {
      toast.error('Invoice number is required');
      return;
    }
    if (!invoiceFile) {
      toast.error('Select an invoice file');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('invoice_number', invoiceNumber.trim());
      fd.append('file', invoiceFile);
      const { data } = await api.post(`/vendor-portal/purchase-orders/${poId}/upload-invoice`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (!data.success) throw new Error(data.message);
      toast.success('Invoice uploaded successfully');
      setInvoiceFile(null);
      await loadPo();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-slate-500 animate-pulse">Loading purchase order…</p>;
  if (!po) return <p className="text-slate-500">Purchase order not found.</p>;

  const lines = po.line_items || [];
  const serials = po.serial_numbers || [];
  const st = String(po.status || '').toLowerCase();
  const showAcceptReject = st === 'approved';
  const showInvoiceUpload = ['approved', 'vendor_accepted', 'processing', 'completed', 'sent'].includes(st);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/purchase-orders" className="text-sm text-brand-dark hover:underline">
            ← Back to list
          </Link>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <h1 className="text-xl font-bold text-slate-900">{po.purchase_order_number}</h1>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusBadgeClass(po.status)}`}>
              {formatType(po.status)}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            {formatType(po.purchase_order_type)} · {po.purchase_order_date}
          </p>
        </div>
        <button
          type="button"
          className="px-4 py-2 rounded-lg border border-brand text-brand-dark text-sm font-semibold"
          disabled={busy}
          onClick={async () => {
            try {
              const res = await api.get(`/vendor-portal/purchase-orders/${poId}/pdf`, { responseType: 'blob' });
              const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = `${po.purchase_order_number}.pdf`;
              a.click();
              window.URL.revokeObjectURL(url);
            } catch {
              toast.error('Could not download PDF');
            }
          }}
        >
          Download PDF
        </button>
      </div>

      {showAcceptReject ? (
        <div className="bg-white rounded-xl border p-5 shadow-sm space-y-3">
          <p className="text-sm text-slate-600">Please confirm receipt of this purchase order.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleAccept}
              className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowRejectForm((v) => !v)}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              Reject
            </button>
          </div>
          {showRejectForm ? (
            <div className="pt-2 space-y-2">
              <textarea
                className="w-full border rounded-lg px-3 py-2 text-sm min-h-[80px]"
                placeholder="Rejection reason (min 10 characters)"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <button
                type="button"
                disabled={busy || rejectReason.trim().length < 10}
                onClick={handleReject}
                className="px-4 py-2 rounded-lg bg-red-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                Submit rejection
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {showInvoiceUpload ? (
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-3">Upload your invoice</h2>
          {po.vendor_invoice_number ? (
            <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-sm">
              <p className="font-medium text-emerald-800">Uploaded: {po.vendor_invoice_number}</p>
              <p className="text-emerald-700 text-xs mt-1">
                {po.vendor_invoice_uploaded_at
                  ? new Date(po.vendor_invoice_uploaded_at).toLocaleString()
                  : '—'}
              </p>
              {po.vendor_invoice_file ? (
                <p className="text-xs text-emerald-600 mt-1 font-mono break-all">{po.vendor_invoice_file}</p>
              ) : null}
            </div>
          ) : null}
          <form onSubmit={handleInvoiceUpload} className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Invoice number *</label>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">File (PDF or image, max 8MB) *</label>
              <input
                type="file"
                accept=".pdf,image/*"
                className="mt-1 block w-full text-sm"
                onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)}
                required={!po.vendor_invoice_file}
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold disabled:opacity-50"
            >
              Upload invoice
            </button>
          </form>
        </div>
      ) : null}

      <div className="bg-white rounded-xl border p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900 mb-3">Line items</h2>
        <div className="space-y-2">
          {lines.map((line, i) => (
            <div key={i} className="text-sm border-b border-slate-50 pb-2">
              <p className="font-medium">
                {[line.brand, line.model, line.processor, line.ram, line.storage].filter(Boolean).join(' · ')}
              </p>
              <p className="text-slate-500 text-xs mt-0.5">
                Qty {line.quantity} · Rate ₹{line.rate}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4 font-semibold text-slate-900">
          Total: ₹{Number(po.total_amount || 0).toLocaleString('en-IN')}
        </p>
      </div>

      {serials.length > 0 ? (
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-3">Received units (TTSPL)</h2>
          <table className="min-w-full text-sm">
            <thead className="text-xs uppercase text-slate-500 text-left">
              <tr>
                <th className="pb-2">TTSPL ID</th>
                <th className="pb-2">Serial</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {serials.map((s) => (
                <tr key={s.serial_id} className="border-t">
                  <td className="py-2 font-mono font-semibold">{s.inventory_asset_code}</td>
                  <td className="py-2">{s.serial_number}</td>
                  <td className="py-2">{formatType(s.qc_status || 'pending')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
