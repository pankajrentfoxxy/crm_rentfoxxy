import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import api from '../utils/api';

export default function ReturnsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    api
      .get('/vendor-portal/returns')
      .then(({ data }) => {
        if (data.success) setRows(data.data || []);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Returns</h1>
        <p className="text-sm text-slate-500 mt-1">Laptops and spare parts returned to you for repair or replacement</p>
      </div>
      {/* Mobile cards */}
      <div className="grid gap-3 md:hidden">
        {loading ? (
          <p className="p-8 text-center text-slate-500 animate-pulse">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="bg-white border rounded-xl p-8 text-center text-slate-500">No returns yet.</p>
        ) : rows.map((r, idx) => {
          const ids = Array.isArray(r.ttspl_ids) ? r.ttspl_ids.filter(Boolean) : [];
          return (
            <div key={`${r.rdc_number}-${idx}`} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-brand-dark">{r.rdc_number}</span>
                <span className="text-xs text-slate-600 capitalize">{r.status || '—'}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <span>{r.return_date ? new Date(r.return_date).toLocaleDateString() : '—'}</span>
                <span>{r.laptop_count ?? ids.length ?? 0} {r.return_type === 'part' ? 'part(s)' : 'laptop(s)'}</span>
                {r.ticket_id && <span className="font-mono">Ticket #{r.ticket_id}</span>}
                {r.debit_note_number && <span className="font-mono">DN {r.debit_note_number}</span>}
              </div>
              {r.reason && <p className="text-sm text-slate-700">{r.reason}</p>}
              {ids.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                  {ids.map((id) => (
                    <span key={String(id)} className="inline-flex px-2 py-0.5 rounded-md bg-slate-50 border font-mono text-xs text-slate-800">{id}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="hidden md:block bg-white rounded-xl border overflow-hidden shadow-sm">
        {loading ? (
          <p className="p-8 text-center text-slate-500 animate-pulse">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-slate-500">No returns yet.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 w-8" />
                <th className="p-3">RDC number</th>
                <th className="p-3">Date</th>
                <th className="p-3">Laptops</th>
                <th className="p-3">Reason</th>
                <th className="p-3">Ticket</th>
                <th className="p-3">Debit Note</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const key = `${r.rdc_number}-${idx}`;
                const isOpen = expanded === key;
                const ids = Array.isArray(r.ttspl_ids) ? r.ttspl_ids.filter(Boolean) : [];
                return (
                  <React.Fragment key={key}>
                    <tr className="border-t hover:bg-slate-50/80">
                      <td className="p-3">
                        {ids.length > 0 ? (
                          <button
                            type="button"
                            className="text-slate-500"
                            onClick={() => setExpanded(isOpen ? null : key)}
                            aria-label={isOpen ? 'Collapse' : 'Expand'}
                          >
                            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                        ) : null}
                      </td>
                      <td className="p-3 font-semibold text-brand-dark">{r.rdc_number}</td>
                      <td className="p-3">
                        {r.return_date ? new Date(r.return_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="p-3 tabular-nums">{r.laptop_count ?? ids.length ?? 0}</td>
                      <td className="p-3 text-slate-600 max-w-xs truncate" title={r.reason}>
                        {r.reason || '—'}
                      </td>
                      <td className="p-3 font-mono text-xs">{r.ticket_id ? `#${r.ticket_id}` : '—'}</td>
                      <td className="p-3 font-mono text-xs">{r.debit_note_number || '—'}</td>
                      <td className="p-3 capitalize">{r.status || '—'}</td>
                    </tr>
                    {isOpen && ids.length > 0 ? (
                      <tr className="bg-slate-50/60">
                        <td colSpan={8} className="px-6 py-3">
                          <p className="text-xs font-semibold text-slate-500 uppercase mb-2">TTSPL IDs</p>
                          <div className="flex flex-wrap gap-2">
                            {ids.map((id) => (
                              <span
                                key={String(id)}
                                className="inline-flex px-2 py-1 rounded-md bg-white border font-mono text-xs text-slate-800"
                              >
                                {id}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
