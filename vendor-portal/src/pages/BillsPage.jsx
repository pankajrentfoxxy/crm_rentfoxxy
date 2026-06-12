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

function inr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

export default function BillsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    api
      .get('/vendor-portal/bills')
      .then(({ data }) => {
        if (data.success) setRows(data.data || []);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    api
      .get(`/vendor-portal/bills/${selectedId}`)
      .then(({ data }) => {
        if (data.success) setDetail(data.data);
      })
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

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
                <tr
                  key={r.bill_id}
                  className={`border-t hover:bg-slate-50/80 cursor-pointer ${selectedId === r.bill_id ? 'bg-emerald-50/50' : ''}`}
                  onClick={() => setSelectedId(selectedId === r.bill_id ? null : r.bill_id)}
                >
                  <td className="p-3 font-medium">
                    {MONTHS[r.bill_month] || r.bill_month} {r.bill_year}
                  </td>
                  <td className="p-3 text-slate-600 text-xs">{r.period || `${r.from_date} – ${r.to_date}`}</td>
                  <td className="p-3 tabular-nums">{r.units ?? 0}</td>
                  <td className="p-3 tabular-nums">{inr(r.subtotal)}</td>
                  <td className="p-3 tabular-nums text-red-600">
                    {Number(r.debit_note_adjustment || 0) > 0
                      ? `-₹${Number(r.debit_note_adjustment).toLocaleString('en-IN')}`
                      : '—'}
                  </td>
                  <td className="p-3 tabular-nums font-semibold">{inr(r.total_payable)}</td>
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

      {selectedId && (
        <div className="bg-white rounded-xl border p-6 shadow-sm space-y-4">
          {detailLoading ? (
            <p className="text-slate-500 animate-pulse">Loading bill details…</p>
          ) : detail ? (
            <>
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <h2 className="font-bold text-lg">{detail.bill_number}</h2>
                  <p className="text-sm text-slate-500">{MONTHS[detail.bill_month]} {detail.bill_year} · {detail.period}</p>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs capitalize h-fit ${statusBadge(detail.status)}`}>{detail.status}</span>
              </div>
              <table className="min-w-full text-sm">
                <thead className="text-xs text-slate-500 text-left">
                  <tr>
                    {['TTSPL ID', 'Brand', 'Config', 'Received', 'Return', 'Days', 'Rate', 'Amount'].map((h) => (
                      <th key={h} className="pb-2 pr-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(detail.line_items || []).map((line, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-2 font-mono text-xs">{line.ttspl_id || '—'}</td>
                      <td className="py-2">{line.brand || '—'}</td>
                      <td className="py-2 text-xs">{line.config || '—'}</td>
                      <td className="py-2 text-xs">{line.received_date || '—'}</td>
                      <td className="py-2 text-xs">{line.return_date || '—'}</td>
                      <td className="py-2">{line.days || '—'}</td>
                      <td className="py-2">{inr(line.rate || line.daily_rate)}</td>
                      <td className="py-2">{inr(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-sm space-y-1 border-t pt-4 max-w-xs ml-auto">
                <p className="flex justify-between"><span>Subtotal</span><span>{inr(detail.subtotal)}</span></p>
                <p className="flex justify-between"><span>GST</span><span>{inr(detail.gst_amount)}</span></p>
                <p className="flex justify-between text-red-600"><span>Debit Note Adjustment</span><span>-{inr(detail.debit_note_adjustment)}</span></p>
                <p className="flex justify-between font-bold"><span>Total Payable</span><span>{inr(detail.total_payable)}</span></p>
              </div>
              {detail.status === 'paid' && (
                <p className="text-sm text-green-700">
                  Paid on {detail.payment_date || '—'} {detail.payment_reference ? `(Ref: ${detail.payment_reference})` : ''}
                </p>
              )}
            </>
          ) : (
            <p className="text-red-600">Could not load bill details</p>
          )}
        </div>
      )}
    </div>
  );
}
