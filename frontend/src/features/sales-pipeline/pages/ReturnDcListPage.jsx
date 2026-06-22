import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { FileText, KeyRound } from 'lucide-react';
import ReturnDcDetailModal from '../components/ReturnDcDetailModal';
import { listReturnDCs } from '../salesPipelineApi';
import { formatDate } from '../salesPipelineUtils';
import { getBackendOrigin } from '../../../utils/api';

function pdfUrl(p) {
  if (!p) return null;
  if (p.startsWith('http')) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/${p.replace(/^\/?/, '')}`;
}

export default function ReturnDcListPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailRdc, setDetailRdc] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listReturnDCs();
      setRows(res.data?.return_dcs || res.data?.rows || []);
    } catch {
      toast.error('Failed to load return DCs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Return DC</h1>
      <p className="text-sm text-gray-500 mb-6">Return pickup challans (RDC series)</p>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase text-left">
            <tr>
              <th className="px-4 py-3">RDC #</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Units</th>
              <th className="px-4 py-3">Original DC</th>
              <th className="px-4 py-3">SO #</th>
              <th className="px-4 py-3">OTP</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Signed PDF</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">No return DCs</td></tr>
            ) : rows.map((row) => {
              const rdc = row.return_dc_number || row.rdc_number;
              return (
                <tr key={rdc || row.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDetailRdc(rdc)}>
                  <td className="px-4 py-3 font-mono">{rdc}</td>
                  <td className="px-4 py-3">{formatDate(row.created_at)}</td>
                  <td className="px-4 py-3">{row.customer_name}</td>
                  <td className="px-4 py-3">{row.unit_count || row.quantity || 1}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.original_dc_number || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.sales_order_number || '—'}</td>
                  <td className="px-4 py-3">
                    {row.customer_otp_verified_at ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">✓ Verified</span>
                    ) : row.customer_otp_code ? (
                      <span className="font-mono text-blue-700 inline-flex items-center gap-1"><KeyRound className="w-3.5 h-3.5" />{row.customer_otp_code}</span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{row.reason || row.return_reason || '—'}</td>
                  <td className="px-4 py-3">{row.status || '—'}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {pdfUrl(row.pdf_path) ? (
                      <a href={pdfUrl(row.pdf_path)} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-600 inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> View</a>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detailRdc && (
        <ReturnDcDetailModal
          rdcNumber={detailRdc}
          onClose={() => setDetailRdc(null)}
          onUpdated={load}
        />
      )}
    </div>
  );
}
