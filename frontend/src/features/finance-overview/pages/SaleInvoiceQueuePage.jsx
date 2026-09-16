import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FileText, Loader2, Upload, Download, CheckCircle2 } from 'lucide-react';
import {
  fetchSaleInvoiceQueue,
  uploadSaleInvoice,
  downloadSaleInvoicePdf,
} from '../../../utils/saleInPlaceApi';
import { salesOrderDetailPath } from '../../sales-pipeline/salesOrderScope';
import { SearchField } from '../../../components/ui/primitives';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN') : '—');

/**
 * Sale-in-place orders produce no delivery challan, so they never reach the DC
 * e-invoice queue. Accounts raise the invoice in Zoho and attach it here.
 */
export default function SaleInvoiceQueuePage() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);   // sales_order_number
  const [invoiceNo, setInvoiceNo] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchSaleInvoiceQueue(status);
      setRows(res.data || []);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load the sale invoice queue');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.sales_order_number, r.customer_name, r.sale_invoice_number]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [rows, search]);

  const startEdit = (row) => {
    setEditing(row.sales_order_number);
    setInvoiceNo(row.sale_invoice_number || '');
    setFile(null);
  };

  const submit = async (soNumber) => {
    if (!invoiceNo.trim()) return toast.error('Enter the Zoho invoice number');
    setSaving(true);
    try {
      await uploadSaleInvoice(soNumber, { invoiceNumber: invoiceNo.trim(), file });
      toast.success('Invoice attached to the sales order');
      setEditing(null);
      setFile(null);
      await load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not attach the invoice');
    } finally {
      setSaving(false);
    }
  };

  const download = async (soNumber) => {
    try {
      const blob = await downloadSaleInvoicePdf(soNumber);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${soNumber.replace(/\//g, '_')}-invoice.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e.response?.data?.message || 'No invoice PDF attached');
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Sale invoice queue</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Laptops sold to the customer where they already are (lost, damaged or bought out).
          These orders have no delivery challan, so the Zoho invoice is attached against the sales order.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
          {['pending', 'attached'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`px-3 py-2 text-sm capitalize ${
                status === s ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <SearchField
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search SO number, customer, invoice no…"
          className="max-w-md flex-1 min-w-[220px]"
        />
      </div>

      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        {loading ? (
          <div className="p-8 flex items-center justify-center text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            {status === 'pending'
              ? 'Nothing waiting for an invoice.'
              : 'No invoices attached yet.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Sales order</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Reason</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Value</th>
                <th className="px-3 py-2 text-left">Created</th>
                <th className="px-3 py-2 text-left">Invoice</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={r.sales_order_number} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link to={salesOrderDetailPath(r.sales_order_number)} className="text-blue-700 hover:underline">
                      {r.sales_order_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.customer_name || `#${r.customer_id}`}</td>
                  <td className="px-3 py-2 capitalize text-slate-600">{r.reasons || '—'}</td>
                  <td className="px-3 py-2 text-right">{r.qty}</td>
                  <td className="px-3 py-2 text-right">{money(r.order_value)}</td>
                  <td className="px-3 py-2 text-slate-600">{fmtDate(r.created_at)}</td>
                  <td className="px-3 py-2">
                    {editing === r.sales_order_number ? (
                      <div className="flex flex-col gap-1.5 min-w-[220px]">
                        <input
                          value={invoiceNo}
                          onChange={(e) => setInvoiceNo(e.target.value)}
                          placeholder="Zoho invoice number"
                          className="rounded border border-slate-200 px-2 py-1 text-xs"
                        />
                        <input
                          type="file"
                          accept="application/pdf,image/*"
                          onChange={(e) => setFile(e.target.files?.[0] || null)}
                          className="text-xs"
                        />
                      </div>
                    ) : r.sale_invoice_number ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-700">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="font-mono text-xs">{r.sale_invoice_number}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-amber-700">Not attached</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {editing === r.sales_order_number ? (
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          onClick={() => submit(r.sales_order_number)}
                          disabled={saving}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-slate-900 text-white disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="px-2 py-1 text-xs rounded border border-slate-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="inline-flex gap-1">
                        {r.has_pdf && (
                          <button
                            type="button"
                            onClick={() => download(r.sales_order_number)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-slate-200 hover:bg-slate-50"
                          >
                            <Download className="w-3 h-3" /> PDF
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-slate-200 hover:bg-slate-50"
                        >
                          <FileText className="w-3 h-3" />
                          {r.sale_invoice_number ? 'Update' : 'Attach'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
