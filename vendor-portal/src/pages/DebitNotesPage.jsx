import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
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
        else toast.error(data.message || 'Failed to load debit notes');
      })
      .catch((err) => {
        const msg = err.response?.data?.message
          || (err.message === 'Network Error'
            ? 'Cannot reach the API server. Ensure the backend is running on port 5001.'
            : err.message);
        toast.error(msg);
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Debit Notes</h1>
        <p className="text-sm text-slate-500 mt-1">Adjustments applied to your bills</p>
      </div>
      {/* Mobile cards */}
      <div className="grid gap-3 md:hidden">
        {loading ? (
          <p className="p-8 text-center text-slate-500 animate-pulse">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="bg-white border rounded-xl p-8 text-center text-slate-500">No debit notes raised against you.</p>
        ) : rows.map((r) => (
          <div key={r.debit_note_id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">{r.debit_note_number}</span>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${statusBadge(r.status)}`}>{r.status}</span>
            </div>
            <p className="text-sm text-slate-700">{r.reason}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>{r.created_at ? format(new Date(r.created_at), 'dd MMM yyyy') : '—'}</span>
              {(r.po_number || r.po_id) && <span className="font-mono">PO {r.po_number || r.po_id}</span>}
              {r.return_ticket_id && <span className="font-mono">Ticket #{r.return_ticket_id}</span>}
            </div>
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <span className="text-base font-bold text-slate-900">{inr(r.amount)}</span>
              {r.applied_bill_number && <span className="text-xs text-slate-500">Applied in {r.applied_bill_number}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block bg-white rounded-xl border overflow-hidden shadow-sm">
        {loading ? (
          <p className="p-8 text-center text-slate-500 animate-pulse">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-slate-500">No debit notes raised against you.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                {['DN #', 'Date', 'Related PO', 'Reason', 'Return Ticket', 'Amount', 'Status', 'Bill Applied In'].map((h) => (
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
                  <td className="p-3 font-mono text-xs">{r.return_ticket_id ? `#${r.return_ticket_id}` : '—'}</td>
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
