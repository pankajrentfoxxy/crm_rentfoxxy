import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { fetchTtsplHistory } from '../floorPipelineApi';
import { EVENT_ICONS } from '../floorPipelineUi';

export default function TtsplHistoryDrawer({ ttsplId, open, onClose }) {
  const [loading, setLoading] = useState(false);
  const [auditLog, setAuditLog] = useState([]);
  const [configHistory, setConfigHistory] = useState([]);

  useEffect(() => {
    if (!open || !ttsplId) return;
    let cancelled = false;
    setLoading(true);
    fetchTtsplHistory(ttsplId)
      .then(({ data }) => {
        if (cancelled) return;
        if (data.success) {
          setAuditLog(data.auditLog || []);
          setConfigHistory(data.configHistory || []);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, ttsplId]);

  if (!open) return null;

  const partsCost = configHistory.reduce((s, r) => s + (parseFloat(r.part_cost) || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <aside className="relative w-full max-w-[540px] bg-white shadow-xl flex flex-col max-h-full">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="font-semibold text-slate-900">TTSPL History</h2>
            <p className="font-mono text-sm text-blue-700">{ttsplId}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <>
              <section>
                <h3 className="text-xs font-semibold uppercase text-slate-500 mb-3">Lifecycle timeline</h3>
                <ul className="space-y-4 border-l-2 border-slate-200 ml-2 pl-4">
                  {auditLog.map((ev) => (
                    <li key={ev.log_id} className="relative">
                      <span className="absolute -left-[1.35rem] top-0 text-sm">
                        {EVENT_ICONS[ev.event_type] || EVENT_ICONS.default}
                      </span>
                      <p className="text-xs text-slate-500">
                        {new Date(ev.created_at).toLocaleString()}
                        {ev.actor_name_resolved || ev.actor_name ? ` · ${ev.actor_name_resolved || ev.actor_name}` : ''}
                      </p>
                      <p className="text-sm text-slate-800 mt-0.5">{ev.description}</p>
                      {ev.metadata && Object.keys(ev.metadata).length ? (
                        <details className="mt-1 text-xs text-slate-600">
                          <summary className="cursor-pointer text-blue-600">Details</summary>
                          <pre className="mt-1 whitespace-pre-wrap bg-slate-50 p-2 rounded">
                            {JSON.stringify(ev.metadata, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </li>
                  ))}
                  {!auditLog.length ? <li className="text-sm text-slate-500">No audit events yet.</li> : null}
                </ul>
              </section>
              {configHistory.length ? (
                <section>
                  <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Config changes</h3>
                  <div className="rounded-xl border overflow-hidden text-sm">
                    <table className="min-w-full">
                      <thead className="bg-slate-50 text-xs">
                        <tr>
                          <th className="px-2 py-2 text-left">Field</th>
                          <th className="px-2 py-2 text-left">Before → After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {configHistory.map((h) => (
                          <tr key={h.history_id} className="border-t">
                            <td className="px-2 py-2 capitalize">{h.field_name}</td>
                            <td className="px-2 py-2">
                              {h.old_value || '—'} → <strong>{h.new_value}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
              <section className="rounded-xl border border-gray-100 bg-slate-50 p-4 text-sm">
                <h3 className="font-semibold text-slate-800 mb-2">Cost summary</h3>
                <p>Parts cost (logged): ₹{partsCost.toFixed(2)}</p>
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
