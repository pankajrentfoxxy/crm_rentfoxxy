import React, { useEffect, useState } from 'react';
import { X, Clock } from 'lucide-react';
import api from '../utils/api';

// Reusable laptop (TTSPL) lifecycle timeline: received -> QC -> rented ->
// returned -> QC re-entry ... Reads the existing /tickets/ttspl/:id/history API
// (ttspl_audit_log + config history + cost summary).
export default function TtsplHistoryModal({ ttsplId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await api.get(`/tickets/ttspl/${encodeURIComponent(ttsplId)}/history`);
        if (alive) setData(res.data?.data || res.data || {});
      } catch (e) {
        if (alive) setError(e.response?.data?.message || 'Failed to load history');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [ttsplId]);

  const audit = data?.auditLog || [];
  const cost = data?.costSummary || null;
  const fmtDt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold flex items-center gap-2"><Clock className="w-4 h-4" /> Laptop History · {ttsplId}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : audit.length === 0 ? (
            <p className="text-sm text-gray-500">No history events recorded for this unit.</p>
          ) : (
            <ol className="relative border-l border-gray-200 ml-2 space-y-4">
              {audit.map((ev, i) => (
                <li key={i} className="ml-4">
                  <div className="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full bg-blue-500" />
                  <div className="text-xs text-gray-400">{fmtDt(ev.created_at)}</div>
                  <div className="text-sm font-medium capitalize">{String(ev.event_type || '').replace(/_/g, ' ')}</div>
                  {ev.description && <div className="text-sm text-gray-600">{ev.description}</div>}
                  {ev.actor_name_resolved && <div className="text-xs text-gray-400">by {ev.actor_name_resolved}</div>}
                </li>
              ))}
            </ol>
          )}
        </div>
        {cost && (
          <div className="px-5 py-3 border-t text-xs text-gray-600 flex gap-4">
            <span>Base cost: ₹{Number(cost.base_cost || 0).toLocaleString('en-IN')}</span>
            <span>Parts cost: ₹{Number(cost.parts_cost || 0).toLocaleString('en-IN')}</span>
            <span className="font-medium">Total: ₹{Number(cost.total_cost || 0).toLocaleString('en-IN')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
