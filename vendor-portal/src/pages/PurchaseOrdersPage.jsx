import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';

function formatType(t) {
  return String(t || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusBadge(status) {
  const s = String(status || '').toLowerCase();
  const map = {
    approved: 'bg-green-100 text-green-700',
    sent: 'bg-blue-100 text-blue-700',
    processing: 'bg-amber-100 text-amber-700',
    completed: 'bg-slate-100 text-slate-700'
  };
  return map[s] || 'bg-slate-100 text-slate-600';
}

export default function PurchaseOrdersPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/vendor-portal/purchase-orders', { params: { limit: 50 } })
      .then(({ data }) => {
        if (data.success) setRows(data.data || []);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Purchase orders</h1>
        <p className="text-sm text-slate-500 mt-1">Read-only view of orders sent to you by Rentfoxxy</p>
      </div>
      <div className="bg-white rounded-xl border overflow-hidden shadow-sm">
        {loading ? (
          <p className="p-8 text-center text-slate-500 animate-pulse">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-slate-500">No purchase orders yet.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3">PO #</th>
                <th className="p-3">Date</th>
                <th className="p-3">Type</th>
                <th className="p-3">Total</th>
                <th className="p-3">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.po_id} className="border-t hover:bg-slate-50/80">
                  <td className="p-3 font-semibold text-brand-dark">{r.purchase_order_number}</td>
                  <td className="p-3">{r.purchase_order_date}</td>
                  <td className="p-3">{formatType(r.purchase_order_type)}</td>
                  <td className="p-3 tabular-nums">₹{Number(r.total_amount || 0).toLocaleString('en-IN')}</td>
                  <td className="p-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge(r.status)}`}>
                      {formatType(r.status)}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <Link to={`/purchase-orders/${r.po_id}`} className="text-brand-dark font-semibold hover:underline">
                      View
                    </Link>
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
