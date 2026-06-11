import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../utils/api';

function formatType(t) {
  return String(t || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function PurchaseOrderDetailPage() {
  const { poId } = useParams();
  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get(`/vendor-portal/purchase-orders/${poId}`)
      .then(({ data }) => {
        if (data.success) setPo(data.data);
        else toast.error(data.message || 'Not found');
      })
      .catch(() => toast.error('Failed to load PO'))
      .finally(() => setLoading(false));
  }, [poId]);

  if (loading) return <p className="text-slate-500 animate-pulse">Loading purchase order…</p>;
  if (!po) return <p className="text-slate-500">Purchase order not found.</p>;

  const lines = po.line_items || [];
  const serials = po.serial_numbers || [];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/purchase-orders" className="text-sm text-brand-dark hover:underline">
            ← Back to list
          </Link>
          <h1 className="text-xl font-bold text-slate-900 mt-2">{po.purchase_order_number}</h1>
          <p className="text-sm text-slate-500">
            {formatType(po.purchase_order_type)} · {po.purchase_order_date}
          </p>
        </div>
        <button
          type="button"
          className="px-4 py-2 rounded-lg border border-brand text-brand-dark text-sm font-semibold"
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
