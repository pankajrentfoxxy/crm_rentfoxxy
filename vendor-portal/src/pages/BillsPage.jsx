import React, { useEffect, useState } from 'react';
import api from '../utils/api';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function statusBadge(status) {
  const s = String(status || '').toLowerCase();
  const map = {
    generated: 'bg-slate-100 text-slate-700',
    approved: 'bg-blue-100 text-blue-700',
    paid: 'bg-green-100 text-green-700',
    disputed: 'bg-red-100 text-red-700'
  };
  return map[s] || 'bg-slate-100 text-slate-600';
}

export default function BillsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/vendor-portal/bills')
      .then(({ data }) => {
        if (data.success) setRows(data.data || []);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">My bills</h1>
        <p className="text-sm text-slate-500 mt-1">Monthly vendor billing statements</p>
      </div>
      <div className="bg-white rounded-xl border overflow-hidden shadow-sm">
        {loading ? (
          <p className="p-8 text-center text-slate-500 animate-pulse">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-slate-500">
            No bills yet. Bills are generated on the last day of each month.
          </p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3">Month</th>
                <th className="p-3">Period</th>
                <th className="p-3">Units</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Debit adj.</th>
                <th className="p-3">Payable</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bill_id} className="border-t hover:bg-slate-50/80">
                  <td className="p-3 font-medium">
                    {MONTHS[r.bill_month] || r.bill_month} {r.bill_year}
                  </td>
                  <td className="p-3 text-slate-600 text-xs">{r.period || `${r.from_date} – ${r.to_date}`}</td>
                  <td className="p-3 tabular-nums">{r.units ?? 0}</td>
                  <td className="p-3 tabular-nums">₹{Number(r.subtotal || 0).toLocaleString('en-IN')}</td>
                  <td className="p-3 tabular-nums text-red-600">
                    {Number(r.debit_note_adjustment || 0) > 0
                      ? `-₹${Number(r.debit_note_adjustment).toLocaleString('en-IN')}`
                      : '—'}
                  </td>
                  <td className="p-3 tabular-nums font-semibold">
                    ₹{Number(r.total_payable || 0).toLocaleString('en-IN')}
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${statusBadge(r.status)}`}>
                      {r.status}
                    </span>
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
