import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { getQuotation, updateQuotationStatus, regenerateQuotationPdf } from '../salesPipelineApi';
import { getBackendOrigin } from '../../../utils/api';
import { formatConfig, formatCurrency, formatDate, lineTotal, QUOTE_STATUS_STYLES, TYPE_STYLES, typeLabel } from '../salesPipelineUtils';

function pdfUrl(p) {
  if (!p) return null;
  if (p.startsWith('http')) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/${p.replace(/^\//, '')}`;
}

export default function QuotationDetailPage() {
  const { quotationNumber } = useParams();
  const navigate = useNavigate();
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getQuotation(quotationNumber).then((res) => {
      setLines(res.data?.lines || []);
    }).catch(() => toast.error('Not found')).finally(() => setLoading(false));
  }, [quotationNumber]);

  const head = lines[0] || {};
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);

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
          <p className="text-gray-600">{head.customer_name} · {formatDate(head.created_at)}</p>
          <div className="flex gap-2 mt-2">
            <span className={`px-2 py-0.5 rounded-full text-xs ${TYPE_STYLES[head.quotation_type]}`}>{typeLabel(head.quotation_type)}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs ${QUOTE_STATUS_STYLES[head.status]}`}>{head.status}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={async () => {
            try {
              let url = pdfUrl(head.pdf_path);
              if (!url) { const r = await regenerateQuotationPdf(quotationNumber); url = pdfUrl(r.data?.pdf_path); }
              if (url) window.open(url, '_blank'); else toast.error('PDF not available');
            } catch { toast.error('Could not open PDF'); }
          }} className="px-4 py-2 border rounded-lg text-sm">Download PDF</button>
          <PermissionGate section="sales_quotations" action="edit">
            {head.status === 'approved' && (
              <button type="button" onClick={() => navigate('/sales-pipeline/sales-orders', { state: { fromQuote: quotationNumber } })} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Create SO</button>
            )}
            {['pending', 'draft', 'sent'].includes(head.status) && (
              <>
                <button type="button" onClick={() => changeStatus('approved')} className="px-3 py-2 text-sm border rounded-lg text-emerald-700">Approve</button>
                <button type="button" onClick={() => changeStatus('rejected')} className="px-3 py-2 text-sm border rounded-lg text-red-700">Reject</button>
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
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Rate</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="px-4 py-3">{l.brand}</td>
                <td className="px-4 py-3 text-gray-600">{formatConfig(l)}</td>
                <td className="px-4 py-3 text-right">{l.quantity}</td>
                <td className="px-4 py-3 text-right">{formatCurrency(l.rate)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(lineTotal(l))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-semibold">
              <td colSpan={4} className="px-4 py-3 text-right">Total</td>
              <td className="px-4 py-3 text-right">{formatCurrency(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
