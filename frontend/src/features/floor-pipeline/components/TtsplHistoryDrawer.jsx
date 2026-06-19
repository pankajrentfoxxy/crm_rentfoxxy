import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { fetchTtsplHistory, fetchPartCostSummary } from '../floorPipelineApi';
import { EVENT_ICONS } from '../floorPipelineUi';

export default function TtsplHistoryDrawer({ ttsplId, open, onClose }) {
  const [loading, setLoading] = useState(false);
  const [auditLog, setAuditLog] = useState([]);
  const [configHistory, setConfigHistory] = useState([]);
  const [costSummary, setCostSummary] = useState(null);
  const [partsBreakdown, setPartsBreakdown] = useState([]);

  useEffect(() => {
    if (!open || !ttsplId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchTtsplHistory(ttsplId),
      fetchPartCostSummary(ttsplId).catch(() => ({ data: {} })),
    ])
      .then(([histRes, costRes]) => {
        if (cancelled) return;
        if (histRes.data.success) {
          setAuditLog(histRes.data.auditLog || []);
          setConfigHistory(histRes.data.configHistory || []);
          setCostSummary(histRes.data.costSummary || null);
        }
        if (costRes.data?.success) {
          setPartsBreakdown(costRes.data.parts_breakdown || []);
          setCostSummary((prev) => ({
            parts_cost: costRes.data.parts_cost ?? prev?.parts_cost ?? 0,
            base_cost: costRes.data.base_cost ?? prev?.base_cost ?? 0,
            total_cost: costRes.data.total_expense ?? prev?.total_cost ?? 0,
          }));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, ttsplId]);

  if (!open) return null;

  const partsCost = costSummary?.parts_cost ?? configHistory.reduce((s, r) => s + (parseFloat(r.part_cost) || 0), 0);
  const baseCost = costSummary?.base_cost ?? 0;
  const totalCost = costSummary?.total_cost ?? (partsCost + baseCost);

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
              <section>
                <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Parts & Upgrades</h3>
                {configHistory.length ? (
                  <div className="rounded-xl border overflow-hidden text-sm mb-3">
                    <table className="min-w-full">
                      <thead className="bg-slate-50 text-xs">
                        <tr>
                          <th className="px-2 py-2 text-left">Date</th>
                          <th className="px-2 py-2 text-left">Type</th>
                          <th className="px-2 py-2 text-left">Field</th>
                          <th className="px-2 py-2 text-left">Before → After</th>
                          <th className="px-2 py-2 text-right">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {configHistory.map((h) => (
                          <tr key={h.history_id} className="border-t">
                            <td className="px-2 py-2 text-xs">{new Date(h.created_at).toLocaleDateString()}</td>
                            <td className="px-2 py-2 capitalize text-xs">{h.change_type}</td>
                            <td className="px-2 py-2 capitalize">{h.field_name}</td>
                            <td className="px-2 py-2">{h.old_value || '—'} → {h.new_value}</td>
                            <td className="px-2 py-2 text-right">₹{parseFloat(h.part_cost || 0).toFixed(0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 mb-3">No parts upgrades recorded</p>
                )}
              </section>
              <section className="rounded-xl border border-gray-100 bg-slate-50 p-4 text-sm space-y-2">
                <h3 className="font-semibold text-slate-800">Laptop Expense Summary</h3>
                <p>Base cost (PO rate): ₹{baseCost.toFixed(2)}</p>
                {partsBreakdown.length ? (
                  <div className="rounded-lg border bg-white overflow-hidden">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-2 py-1.5 text-left">PRT-ID</th>
                          <th className="px-2 py-1.5 text-left">Part</th>
                          <th className="px-2 py-1.5 text-left">Type</th>
                          <th className="px-2 py-1.5 text-left">Date</th>
                          <th className="px-2 py-1.5 text-right">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {partsBreakdown.map((b) => (
                          <tr key={b.prt_id} className="border-t">
                            <td className="px-2 py-1.5 font-mono text-blue-700">{b.prt_id}</td>
                            <td className="px-2 py-1.5">{b.part_name}</td>
                            <td className="px-2 py-1.5 capitalize">{b.type || '—'}</td>
                            <td className="px-2 py-1.5">{b.installed_at ? new Date(b.installed_at).toLocaleDateString() : '—'}</td>
                            <td className="px-2 py-1.5 text-right">₹{parseFloat(b.unit_cost || 0).toFixed(0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                <p>Parts cost: ₹{partsCost.toFixed(2)}</p>
                <p className="font-semibold pt-1 border-t">Total cost of ownership: ₹{totalCost.toFixed(2)}</p>
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
