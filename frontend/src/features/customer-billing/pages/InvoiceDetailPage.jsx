import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import InvoiceStatusBadge from '../components/InvoiceStatusBadge';
import SendInvoiceModal from '../components/SendInvoiceModal';
import MarkZohoInvoiceModal from '../components/MarkZohoInvoiceModal';
import { Button } from '../../../components/ui/primitives';
import { downloadInvoicePdf, getInvoice, markInvoicePaid } from '../customerBillingApi';

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatInvoiceDate(d) {
  if (!d) return '—';
  const s = String(d);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) {
    const [y, mo, day] = m[1].split('-').map(Number);
    return new Date(y, mo - 1, day).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return s;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isCatchupLine(line) {
  return line?.is_catchup === true || line?.is_catchup === 'true';
}

function isSecurityLine(line) {
  return line?.line_type === 'security' || line?.is_security === true;
}

function lineReturned(line) {
  return Boolean(line?.return_date || line?.returned === true || line?.returned === 'true');
}

function lineReturnDate(line) {
  if (line?.return_date) return formatInvoiceDate(line.return_date);
  if (lineReturned(line) && (line.rent_end || line.warehouse_return_date)) {
    return formatInvoiceDate(line.warehouse_return_date || line.rent_end);
  }
  return '—';
}

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [creditNotes, setCreditNotes] = useState([]);
  const [sendOpen, setSendOpen] = useState(false);
  const [zohoOpen, setZohoOpen] = useState(false);
  const [zohoCandidates, setZohoCandidates] = useState([]);

  const load = useCallback(async () => {
    try {
      const res = await getInvoice(id);
      setInvoice(res.data?.invoice);
      setCreditNotes((res.data?.credit_notes || []).filter((cn) => {
        const status = String(cn.status || '').toLowerCase();
        return status === 'approved' || status === 'applied';
      }));
      setZohoCandidates(res.data?.zoho_candidates || []);
    } catch {
      toast.error('Invoice not found');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const lineItems = useMemo(() => {
    if (!invoice) return [];
    const raw = typeof invoice.line_items === 'string'
      ? JSON.parse(invoice.line_items)
      : (invoice.line_items || []);
    return Array.isArray(raw) ? raw : [];
  }, [invoice]);

  const appliedNotes = useMemo(
    () => creditNotes.filter((cn) => String(cn.status || '').toLowerCase() === 'applied'),
    [creditNotes]
  );

  if (!invoice) return <div className="p-6 text-gray-500">Loading…</div>;

  const handlePdf = async () => {
    try {
      const res = await downloadInvoicePdf(id, { format: 'laptop_details' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoice.invoice_number}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
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

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <Link to="/customer-billing/invoices" className="text-sm text-blue-600 hover:underline">← Customer Invoices</Link>
      <div className="flex flex-wrap items-start justify-between gap-4 mt-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{invoice.invoice_number}</h1>
          <p className="text-sm text-gray-500">
            {invoice.customer_name} · {formatInvoiceDate(invoice.from_date)} – {formatInvoiceDate(invoice.to_date)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <InvoiceStatusBadge status={invoice.status} />
            {invoice.billing_source === 'zoho' && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-800">
                Generated on Zoho{invoice.external_reference ? ` · ${invoice.external_reference}` : ''}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handlePdf}>Download PDF</Button>
          <PermissionGate section="customer_billing" action="edit">
            <Button onClick={() => setSendOpen(true)}>Send to Customer</Button>
          </PermissionGate>
          <PermissionGate section="customer_billing" action="edit">
            <Button variant="secondary" onClick={() => setZohoOpen(true)}>Generated on Zoho</Button>
          </PermissionGate>
          {invoice.status === 'sent' && (
            <PermissionGate section="customer_billing" action="edit">
              <Button variant="secondary" onClick={handleMarkPaid}>Mark Paid</Button>
            </PermissionGate>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:hidden mb-4">
        {lineItems.map((line, idx) => (
          <div key={`${line.ttspl_id || 'line'}-${idx}`} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-900">{line.ttspl_id || '—'}</span>
              <span className="font-semibold text-slate-900">{fmt(line.amount)}</span>
            </div>
            {line.serial_number && <p className="text-xs text-slate-500">SN: {line.serial_number}</p>}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>Recv {formatInvoiceDate(line.rent_start || line.delivery_date || line.received_date)}</span>
              <span>Ret {lineReturnDate(line)}</span>
              <span>{line.days_in_month} days</span>
              <span>{fmt(line.monthly_rate)}/mo</span>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block bg-white border rounded-xl overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">TTSPL ID</th>
              <th className="px-4 py-3 text-left">Serial</th>
              <th className="px-4 py-3 text-left">Received</th>
              <th className="px-4 py-3 text-left">Return</th>
              <th className="px-4 py-3 text-right">Days</th>
              <th className="px-4 py-3 text-right">Rate</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lineItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">No line items</td>
              </tr>
            ) : lineItems.map((line, idx) => (
              <tr key={`${line.ttspl_id || 'line'}-${idx}`}>
                <td className="px-4 py-3">
                  {line.ttspl_id || '—'}
                  {isSecurityLine(line) && (
                    <span className="ml-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-teal-100 text-teal-800">security</span>
                  )}
                  {isCatchupLine(line) && (
                    <span className="ml-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">catch-up</span>
                  )}
                </td>
                <td className="px-4 py-3">{line.serial_number || '—'}</td>
                <td className="px-4 py-3">{formatInvoiceDate(line.rent_start || line.delivery_date || line.received_date)}</td>
                <td className="px-4 py-3">{lineReturnDate(line)}</td>
                <td className="px-4 py-3 text-right">{line.days_in_month}</td>
                <td className="px-4 py-3 text-right">{fmt(line.monthly_rate)}</td>
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
            <span>Credit Notes{appliedNotes.length ? ` (${appliedNotes.map((c) => c.credit_note_number).join(', ')})` : ''}</span>
            <span>-{fmt(invoice.credit_note_adjustment)}</span>
          </div>
        )}
        {parseFloat(invoice.security_deposit) > 0 && (
          <div className="flex justify-between">
            <span>Security deposit</span>
            <span>{fmt(invoice.security_deposit)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold border-t pt-2"><span>Total Payable</span><span>{fmt(invoice.grand_total)}</span></div>
        {invoice.paid_at && (
          <p className="text-green-700 text-xs pt-2">Paid {invoice.paid_at?.slice(0, 10)} · Ref: {invoice.payment_reference || '—'}</p>
        )}
      </div>

      {sendOpen && (
        <SendInvoiceModal invoice={invoice} onClose={() => setSendOpen(false)} onSent={load} />
      )}
      {zohoOpen && (
        <MarkZohoInvoiceModal
          invoice={invoice}
          candidates={zohoCandidates}
          onClose={() => setZohoOpen(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}
