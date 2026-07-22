import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import api from '../utils/api';

const STATUS = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  applied: 'bg-green-100 text-green-700',
  cancelled: 'bg-slate-100 text-slate-600',
};

function inr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function ttsplList(ids) {
  if (!ids) return [];
  if (Array.isArray(ids)) return ids;
  try { const p = JSON.parse(ids); return Array.isArray(p) ? p : []; } catch { return []; }
}
const d = (x) => (x ? format(new Date(x), 'dd MMM yyyy') : '—');

export default function CreditNotesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/credit-notes')
      .then(({ data }) => setRows(data.credit_notes || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Credit Notes</h1>
        <p className="text-sm text-slate-500">Refunds for returned laptops (applied to your next invoice)</p>
      </div>

      {loading ? (
        <p className="text-slate-500 animate-pulse">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500 bg-white border rounded-xl p-8 text-center">No credit notes yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const ttspls = ttsplList(r.ttspl_ids);
            return (
              <div key={r.credit_note_id} className="bg-white border rounded-xl p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold">{r.credit_note_number}</p>
                    <p className="text-sm text-slate-600">{r.reason}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{inr(r.amount)}</p>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs capitalize ${STATUS[r.status] || ''}`}>{r.status}</span>
                  </div>
                </div>
                <div className="mt-3 text-sm text-slate-600 space-y-0.5 border-t pt-3">
                  {ttspls.length > 0 && <p>Laptop: <span className="font-mono">{ttspls.join(', ')}</span></p>}
                  {(r.from_date || r.to_date) && (
                    <p>
                      Unused period: {d(r.from_date)} → {d(r.to_date)}
                      {r.quantity ? ` · ${r.quantity} day(s)` : ''}{r.unit_rate ? ` × ${inr(r.unit_rate)}/day` : ''}
                    </p>
                  )}
                  {r.description && <p className="text-slate-500">{r.description}</p>}
                  {r.applied_in_invoice_id && <p className="text-xs text-green-700">Applied to a subsequent invoice.</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
