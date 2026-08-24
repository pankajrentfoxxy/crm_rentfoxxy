import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { Button } from '../../../components/ui/primitives';
import { getQuotation, updateQuotationStatus, regenerateQuotationPdf, sendQuotationEmail } from '../salesPipelineApi';
import { getBackendOrigin } from '../../../utils/api';
import { formatCurrency, formatDate, formatDateTime, lineTotal, QUOTE_STATUS_STYLES, quoteStatusLabel, TYPE_STYLES, typeLabel } from '../salesPipelineUtils';

function pdfUrl(p) {
  if (!p) return null;
  if (p.startsWith('http')) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/${p.replace(/^\//, '')}`;
}

function ConfigCard({ line }) {
  const title = [line.brand, line.model_name || line.model].filter(Boolean).join(' - ');
  const specs = [line.processor, line.generation, line.ram, line.storage, line.gpu].filter(Boolean).join(' | ');
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm min-w-[220px]">
      <h5 className="font-semibold text-gray-900 leading-snug">
        {title || '—'}
        {line.screen_size ? <span className="font-normal text-gray-600"> | {line.screen_size}</span> : null}
      </h5>
      {specs ? <p className="mt-1 text-xs text-gray-600">{specs}</p> : null}
    </div>
  );
}

function lockMonths(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return `${n} Month${n === 1 ? '' : 's'}`;
}

export default function QuotationDetailPage() {
  const { quotationNumber } = useParams();
  const navigate = useNavigate();
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [ccEmail, setCcEmail] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    getQuotation(quotationNumber).then((res) => {
      const next = res.data?.lines || [];
      setLines(next);
      if (next[0]?.customer_email) setSendEmail(next[0].customer_email);
    }).catch(() => toast.error('Not found')).finally(() => setLoading(false));
  }, [quotationNumber]);

  const head = lines[0] || {};
  const subTotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const shipping = Number(head.shiping_charges) || 0;
  const security = Number(head.security_amount) || 0;
  const grandTotal = subTotal + shipping + security;
  const isSale = ['sale', 'sales'].includes(String(head.quotation_type || '').toLowerCase());

  const changeStatus = async (status) => {
    try {
      await updateQuotationStatus(quotationNumber, { status });
      toast.success(`Marked ${status}`);
      const res = await getQuotation(quotationNumber);
      setLines(res.data?.lines || []);
    } catch {
      toast.error('Status update failed');
    }
  };

  if (loading) return <p className="p-4 text-gray-500">Loading…</p>;

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <Link to="/sales-pipeline/quotations" className="text-sm text-blue-600">← Back</Link>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold font-mono">{quotationNumber}</h1>
          <p className="text-gray-600">{head.company_name || head.customer_name} · {formatDate(head.created_at)}</p>
          {(head.contact_name || head.customer_mobile) && (
            <p className="text-sm text-gray-500">{[head.contact_name, head.customer_mobile].filter(Boolean).join(' · ')}</p>
          )}
          <div className="flex gap-2 mt-2">
            <span className={`px-2 py-0.5 rounded-full text-xs ${TYPE_STYLES[head.quotation_type]}`}>{typeLabel(head.quotation_type)}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs ${QUOTE_STATUS_STYLES[head.status]}`}>{quoteStatusLabel(head.status)}</span>
            {head.accepted_at && (
              <span className="text-xs text-teal-700">Accepted {formatDateTime(head.accepted_at)}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={async () => {
            try {
              let url = pdfUrl(head.pdf_path);
              if (!url) { const r = await regenerateQuotationPdf(quotationNumber); url = pdfUrl(r.data?.pdf_path); }
              if (url) window.open(url, '_blank'); else toast.error('PDF not available');
            } catch { toast.error('Could not open PDF'); }
          }}>Download PDF</Button>
          <PermissionGate section="sales_quotations" action="edit">
            {['pending', 'draft', 'sent', 'accepted'].includes(head.status) && (
              <Button onClick={() => setSendOpen(true)}>Send quotation</Button>
            )}
            {['approved', 'accepted'].includes(head.status) && (
              <Button onClick={() => navigate('/sales-pipeline/sales-orders', { state: { fromQuote: quotationNumber } })}>Create SO</Button>
            )}
            {['pending', 'draft', 'sent', 'accepted'].includes(head.status) && (
              <>
                {head.status !== 'accepted' && (
                  <Button variant="secondary" className="text-emerald-700" onClick={() => changeStatus('approved')}>Approve</Button>
                )}
                <Button variant="secondary" className="text-red-700" onClick={() => changeStatus('rejected')}>Reject</Button>
              </>
            )}
          </PermissionGate>
        </div>
      </div>

      <div className="mt-6 bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Brand</th>
              <th className="px-4 py-3 text-left">Config</th>
              {!isSale && <th className="px-4 py-3 text-center">Lock-in</th>}
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Rate</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="px-4 py-3">{l.brand}</td>
                <td className="px-4 py-3"><ConfigCard line={l} /></td>
                {!isSale && <td className="px-4 py-3 text-center text-gray-600">{lockMonths(l.locking_period)}</td>}
                <td className="px-4 py-3 text-right">{l.quantity}</td>
                <td className="px-4 py-3 text-right">{formatCurrency(l.rate)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(lineTotal(l))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t bg-gray-50 px-4 py-3 flex justify-end">
          <dl className="w-full max-w-xs text-sm space-y-1.5">
            <div className="flex justify-between text-gray-600">
              <dt>Sub Total</dt>
              <dd className="font-medium text-gray-900">{formatCurrency(subTotal)}</dd>
            </div>
            <div className="flex justify-between text-gray-600">
              <dt>Shipping Charges</dt>
              <dd className="font-medium text-gray-900">{formatCurrency(shipping)}</dd>
            </div>
            <div className="flex justify-between text-gray-600">
              <dt>Security Amount</dt>
              <dd className="font-medium text-gray-900">{formatCurrency(security)}</dd>
            </div>
            <div className="flex justify-between border-t pt-1.5 text-base font-semibold text-gray-900">
              <dt>Total</dt>
              <dd>{formatCurrency(grandTotal)}</dd>
            </div>
          </dl>
        </div>
      </div>

      {sendOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setSendOpen(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-semibold text-gray-900">Send quotation</h3>
            <p className="text-sm text-gray-600">
              Email goes from <strong>sales@rentfoxxy.com</strong> with an Accept button.
              GST is not required.
            </p>
            <div>
              <label className="text-xs font-medium text-gray-600">To email *</label>
              <input className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">CC (optional)</label>
              <input className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={ccEmail} onChange={(e) => setCcEmail(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSendOpen(false)}>Cancel</Button>
              <Button
                disabled={sending}
                onClick={async () => {
                  if (!sendEmail.trim()) {
                    toast.error('Customer email is required');
                    return;
                  }
                  setSending(true);
                  try {
                    const res = await sendQuotationEmail(quotationNumber, { email: sendEmail, cc: ccEmail });
                    toast.success(res.data?.message || 'Quotation sent');
                    setSendOpen(false);
                    const fresh = await getQuotation(quotationNumber);
                    setLines(fresh.data?.lines || []);
                  } catch (err) {
                    toast.error(err.response?.data?.message || 'Send failed');
                  } finally {
                    setSending(false);
                  }
                }}
              >
                {sending ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
