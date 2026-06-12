import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import api from '../utils/api';

function statusClass(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'delivered') return 'bg-green-100 text-green-700';
  if (v.includes('transit')) return 'bg-amber-100 text-amber-700';
  if (v === 'rejected') return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-600';
}

export default function DeliveriesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/deliveries').then(({ data }) => setRows(data.deliveries || [])).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Delivery Status</h1>
      <div className="bg-white rounded-xl border overflow-x-auto">
        {loading ? <p className="p-8 text-center text-slate-500">Loading…</p> : rows.length === 0 ? (
          <p className="p-8 text-center text-slate-500">No deliveries on record</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 text-left">
              <tr>
                {['DC #', 'SO #', 'Dispatch', 'Mode', 'Status', 'Tracking'].map((h) => <th key={h} className="p-3">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.dc_number} className="border-t">
                  <td className="p-3 font-mono text-xs">{r.dc_number}</td>
                  <td className="p-3 font-mono text-xs">{r.so_number || '—'}</td>
                  <td className="p-3">{r.dispatch_date ? format(new Date(r.dispatch_date), 'dd MMM yyyy') : '—'}</td>
                  <td className="p-3 capitalize">{r.dispatch_mode || '—'}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${statusClass(r.status)}`}>{r.status}</span>
                  </td>
                  <td className="p-3 text-xs text-slate-600">
                    {r.status === 'in_transit' && (r.courier_name || r.awb_number)
                      ? `${r.courier_name || ''} ${r.awb_number || ''}`.trim()
                      : r.delivered_at
                        ? `Delivered ${format(new Date(r.delivered_at), 'dd MMM yyyy')}`
                        : '—'}
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
