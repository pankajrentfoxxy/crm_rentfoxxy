import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import InvoiceStatusBadge from '../components/InvoiceStatusBadge';
import SendInvoiceModal from '../components/SendInvoiceModal';
import {
  downloadInvoicePdf, generateEInvoice, generateEWayBill,
  getInvoice, markInvoicePaid, sendEInvoiceEmail,
} from '../customerBillingApi';

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [creditNotes, setCreditNotes] = useState([]);
  const [sendOpen, setSendOpen] = useState(false);
  const [ewbOpen, setEwbOpen] = useState(false);
  const [ewbForm, setEwbForm] = useState({ transporter_name: '', vehicle_number: '', distance_km: '', mode_of_transport: 'road' });
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getInvoice(id);
      setInvoice(res.data?.invoice);
      setCreditNotes(res.data?.credit_notes || []);
    } catch {
      toast.error('Invoice not found');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!invoice) {
    return <div className="p-6 text-gray-500">Loading…</div>;
  }

  const lineItems = typeof invoice.line_items === 'string'
    ? JSON.parse(invoice.line_items)
    : (invoice.line_items || []);

  const handleDownload = async () => {
    try {
      const res = await downloadInvoicePdf(id);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoice.invoice_number}.pdf`;
      a.click();
    } catch {
      toast.error('PDF download failed');
    }
  };

  const handleMarkPaid = async () => {
    const ref = window.prompt('Payment reference:');
    try {
      await markInvoicePaid(id, { payment_reference: ref || '' });
      toast.success('Marked paid');
      load();
    } catch {
      toast.error('Failed');
    }
  };

  const handleGenerateEwb = async () => {
    const dc = lineItems[0]?.dc_number;
    if (!dc) {
      toast.error('No DC linked to this invoice');
      return;
    }
    try {
      const res = await generateEWayBill(dc, ewbForm);
      toast.success(`EWB: ${res.data.ewbNumber}`);
      setEwbOpen(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'EWB failed');
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="mb-4">
        <Link to="/customer-billing/invoices" className="text-sm text-blue-600 hover:underline">← Invoices</Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{invoice.invoice_number}</h1>
          <p className="text-sm text-gray-500">{invoice.customer_name} · {invoice.from_date} – {invoice.to_date}</p>
          <div className="mt-2"><InvoiceStatusBadge status={invoice.status} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <PermissionGate section="customer_billing" action="edit">
            <button type="button" onClick={() => setSendOpen(true)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg">Send to Customer</button>
          </PermissionGate>
          <button type="button" onClick={handleDownload} className="px-4 py-2 text-sm border rounded-lg">Download PDF</button>
          <PermissionGate section="customer_billing" action="edit">
            <button type="button" onClick={handleMarkPaid} className="px-4 py-2 text-sm border rounded-lg">Mark as Paid</button>
          </PermissionGate>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">TTSPL ID</th>
                  <th className="px-4 py-3 text-left">Brand</th>
                  <th className="px-4 py-3 text-left">Model</th>
                  <th className="px-4 py-3 text-left">Dispatch</th>
                  <th className="px-4 py-3 text-right">Days</th>
                  <th className="px-4 py-3 text-right">Daily Rate</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lineItems.map((line, idx) => (
                  <tr key={idx}>
                    <td className="px-4 py-3">{line.ttspl_id || '—'}</td>
                    <td className="px-4 py-3">{line.brand}</td>
                    <td className="px-4 py-3">{line.model}</td>
                    <td className="px-4 py-3">{line.dispatch_date}</td>
                    <td className="px-4 py-3 text-right">{line.days_in_month}</td>
                    <td className="px-4 py-3 text-right">{fmt(line.daily_rate)}</td>
                    <td className="px-4 py-3 text-right">{fmt(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-white border rounded-xl p-5 text-sm space-y-1 max-w-sm ml-auto">
            <div className="flex justify-between"><span>Subtotal</span><span>{fmt(invoice.subtotal)}</span></div>
            <div className="flex justify-between"><span>GST {invoice.gst_percent}%</span><span>{fmt(invoice.gst_amount)}</span></div>
            {parseFloat(invoice.credit_note_adjustment) > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Credit Notes{creditNotes.length ? ` (${creditNotes.map((c) => c.credit_note_number).join(', ')})` : ''}</span>
                <span>-{fmt(invoice.credit_note_adjustment)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-base border-t pt-2"><span>Grand Total</span><span>{fmt(invoice.grand_total)}</span></div>
            {invoice.paid_at && (
              <p className="text-green-700 text-xs pt-2">Paid {invoice.paid_at?.slice(0, 10)} · Ref: {invoice.payment_reference || '—'}</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white border rounded-xl p-5 text-sm">
            <h3 className="font-semibold mb-3">Customer</h3>
            <p className="font-medium">{invoice.customer_name}</p>
            <p className="text-gray-500">{invoice.gst_number || 'No GST'}</p>
            <p className="text-gray-500 mt-2">{typeof invoice.billing_address === 'object' ? JSON.stringify(invoice.billing_address) : (invoice.billing_address || '—')}</p>
          </div>
          <div className="bg-white border rounded-xl p-5 text-sm">
            <h3 className="font-semibold mb-3">E-Invoice</h3>
            <p>IRN: <span className="font-medium">{invoice.irn || 'Not generated'}</span></p>
            {invoice.qr_code_url && <img src={invoice.qr_code_url} alt="QR" className="mt-2 h-24 w-24 border rounded" />}
          </div>
          <div className="bg-white border rounded-xl p-5 text-sm">
            <h3 className="font-semibold mb-3">E-Way Bill</h3>
            <p>EWB#: {invoice.eway_bill_number || 'Not generated'}</p>
            {invoice.eway_bill_valid_till && <p className="text-gray-500">Valid till: {invoice.eway_bill_valid_till?.slice(0, 16)}</p>}
            <button type="button" onClick={() => setEwbOpen(true)} className="mt-3 px-3 py-1.5 text-xs border rounded-lg">Generate E-Way Bill</button>
          </div>
        </div>
      </div>

      {sendOpen && (
        <SendInvoiceModal invoice={invoice} onClose={() => setSendOpen(false)} onSent={load} />
      )}

      {ewbOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setEwbOpen(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-3 text-sm">
            <h3 className="font-semibold">Generate E-Way Bill</h3>
            <input placeholder="Transporter Name" value={ewbForm.transporter_name} onChange={(e) => setEwbForm((f) => ({ ...f, transporter_name: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
            <input placeholder="Vehicle Number" value={ewbForm.vehicle_number} onChange={(e) => setEwbForm((f) => ({ ...f, vehicle_number: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
            <input placeholder="Distance (km)" type="number" value={ewbForm.distance_km} onChange={(e) => setEwbForm((f) => ({ ...f, distance_km: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
            <select value={ewbForm.mode_of_transport} onChange={(e) => setEwbForm((f) => ({ ...f, mode_of_transport: e.target.value }))} className="w-full border rounded-lg px-3 py-2">
              <option value="road">Road</option>
              <option value="air">Air</option>
              <option value="rail">Rail</option>
              <option value="ship">Ship</option>
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setEwbOpen(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
              <button type="button" onClick={handleGenerateEwb} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Generate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
