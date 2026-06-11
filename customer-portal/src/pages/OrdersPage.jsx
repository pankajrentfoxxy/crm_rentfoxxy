import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import api from '../utils/api';

function inr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function statusClass(s) {
  const v = String(s || '').toLowerCase();
  if (v.includes('complete')) return 'bg-green-100 text-green-700';
  if (v.includes('process')) return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/orders').then(({ data }) => setOrders(data.orders || [])).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">My Orders</h1>
      <div className="bg-white rounded-xl border overflow-hidden">
        {loading ? (
          <p className="p-8 text-center text-slate-500">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="p-8 text-center text-slate-500">No orders found</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                {['SO #', 'Date', 'Type', 'Laptops', 'Amount', 'Status'].map((h) => <th key={h} className="p-3">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <React.Fragment key={o.sales_order_number}>
                  <tr
                    className="border-t hover:bg-slate-50 cursor-pointer"
                    onClick={() => setExpanded(expanded === o.sales_order_number ? null : o.sales_order_number)}
                  >
                    <td className="p-3 font-mono text-xs">{o.sales_order_number}</td>
                    <td className="p-3">{o.date ? format(new Date(o.date), 'dd MMM yyyy') : '—'}</td>
                    <td className="p-3 capitalize">{o.type || '—'}</td>
                    <td className="p-3">{o.laptops}</td>
                    <td className="p-3">{inr(o.total_value)}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${statusClass(o.status)}`}>{o.status || 'pending'}</span>
                    </td>
                  </tr>
                  {expanded === o.sales_order_number && (
                    <tr className="bg-slate-50/50">
                      <td colSpan={6} className="p-3 text-xs text-slate-600">
                        Order {o.sales_order_number} · {o.laptops} line(s) · Total {inr(o.total_value)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
