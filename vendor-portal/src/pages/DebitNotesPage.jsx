import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import api from '../utils/api';

function inr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function statusBadge(status) {
  const map = {
    pending: 'bg-amber-100 text-amber-700',
    approved: 'bg-blue-100 text-blue-700',
    adjusted: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
  };
  return map[status] || 'bg-slate-100 text-slate-600';
}

export default function DebitNotesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/vendor-portal/debit-notes')
      .then(({ data }) => {
        if (data.success) setRows(data.data || []);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Debit Notes</h1>
        <p className="text-sm text-slate-500 mt-1">Adjustments applied to your bills</p>
      </div>
      <div className="bg-white rounded-xl border overflow-hidden shadow-sm">
        {loading ? (
          <p className="p-8 text-center text-slate-500 animate-pulse">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-slate-500">No debit notes raised against you.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                {['DN #', 'Date', 'Related PO', 'Reason', 'Amount', 'Status', 'Bill Applied In'].map((h) => (
                  <th key={h} className="p-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.debit_note_id} className="border-t hover:bg-slate-50/80">
                  <td className="p-3 font-medium">{r.debit_note_number}</td>
                  <td className="p-3 text-xs">{r.created_at ? format(new Date(r.created_at), 'dd MMM yyyy') : '—'}</td>
                  <td className="p-3 font-mono text-xs">{r.po_number || r.po_id || '—'}</td>
                  <td className="p-3">{r.reason}</td>
                  <td className="p-3 tabular-nums">{inr(r.amount)}</td>
                  <td className="p-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${statusBadge(r.status)}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="p-3 text-xs">{r.applied_bill_number || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
