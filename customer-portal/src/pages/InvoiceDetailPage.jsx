import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { downloadInvoicePdf } from '../utils/api';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function inr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

export default function InvoiceDetailPage() {
  const { invoiceId } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/invoices/${invoiceId}`).then(({ data }) => setInvoice(data.invoice)).finally(() => setLoading(false));
  }, [invoiceId]);

  if (loading) return <p className="text-slate-500">Loading…</p>;
  if (!invoice) return <p className="text-red-600">Invoice not found</p>;

  const lines = Array.isArray(invoice.line_items)
    ? invoice.line_items
    : typeof invoice.line_items === 'string'
      ? JSON.parse(invoice.line_items || '[]')
      : [];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link to="/invoices" className="text-sm text-brand">← Back to invoices</Link>
      <div className="bg-white border rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">{invoice.invoice_number}</h1>
            <p className="text-sm text-slate-500">{MONTHS[invoice.invoice_month]} {invoice.invoice_year} · {invoice.from_date} – {invoice.to_date}</p>
          </div>
          <span className="px-2 py-1 rounded-full text-xs bg-slate-100 capitalize h-fit">{invoice.status}</span>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 text-sm border-y py-4">
          <div>
            <p className="font-semibold">From</p>
            <p>Rentfoxxy Technologies Pvt Ltd</p>
            <p className="text-slate-500 text-xs">GSTIN on file</p>
          </div>
          <div>
            <p className="font-semibold">To</p>
            <p>{invoice.customer_name || 'Customer'}</p>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 text-left">
            <tr>
              {['TTSPL ID', 'Brand', 'Config', 'Days', 'Daily Rate', 'Amount'].map((h) => <th key={h} className="pb-2">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="border-t">
                <td className="py-2 font-mono text-xs">{line.ttspl_id || '—'}</td>
                <td className="py-2">{line.brand || '—'}</td>
                <td className="py-2 text-xs">{line.config || [line.processor, line.ram, line.storage].filter(Boolean).join(' ')}</td>
                <td className="py-2">{line.days || line.billable_days || '—'}</td>
                <td className="py-2">{inr(line.daily_rate || line.rate)}</td>
                <td className="py-2">{inr(line.amount || line.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="text-sm space-y-1 border-t pt-4">
          <p className="flex justify-between"><span>Subtotal</span><span>{inr(invoice.subtotal)}</span></p>
          <p className="flex justify-between"><span>GST 18%</span><span>{inr(invoice.gst_amount)}</span></p>
          <p className="flex justify-between font-bold text-base"><span>Total</span><span>{inr(invoice.grand_total)}</span></p>
        </div>

        {invoice.irn && (
          <div className="bg-slate-50 rounded-lg p-4 text-sm">
            <p className="font-semibold">E-Invoice</p>
            <p className="text-xs break-all mt-1">IRN: {invoice.irn}</p>
            {invoice.qr_code_url && <img src={invoice.qr_code_url} alt="QR" className="mt-2 h-24" />}
          </div>
        )}

        {invoice.pdf_path && (
          <button
            type="button"
            onClick={() => downloadInvoicePdf(invoice.invoice_id, `${invoice.invoice_number}.pdf`)}
            className="block w-full text-center py-3 bg-brand text-white rounded-lg font-semibold"
          >
            Download PDF
          </button>
        )}
      </div>
    </div>
  );
}
