import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import DeliveryChallanDetailModal from '../../operation-management/components/DeliveryChallanDetailModal';
import { listReturnDCs } from '../salesPipelineApi';
import { formatDate } from '../salesPipelineUtils';

export default function ReturnDcListPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    listReturnDCs()
      .then((res) => setRows(res.data?.return_dcs || res.data?.rows || []))
      .catch(() => toast.error('Failed to load return DCs'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Return DC</h1>
      <p className="text-sm text-gray-500 mb-6">RDC series</p>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase text-left">
            <tr>
              <th className="px-4 py-3">RDC #</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Original DC</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No return DCs</td></tr>
            ) : rows.map((row) => (
              <tr key={row.return_dc_number || row.rdc_number || row.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDetail(row)}>
                <td className="px-4 py-3 font-mono">{row.return_dc_number || row.rdc_number}</td>
                <td className="px-4 py-3">{formatDate(row.created_at)}</td>
                <td className="px-4 py-3">{row.customer_name}</td>
                <td className="px-4 py-3 font-mono text-xs">{row.original_dc_number || row.dc_number}</td>
                <td className="px-4 py-3">{row.reason || row.return_reason || '—'}</td>
                <td className="px-4 py-3">{row.status || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <DeliveryChallanDetailModal
          onClose={() => setDetail(null)}
          dcNumber={detail.return_dc_number || detail.rdc_number || detail.original_dc_number || detail.dc_number}
        />
      )}
    </div>
  );
}
