import React, { useCallback, useEffect, useState } from 'react';
import { X, Loader2, Ban, Trash2, RefreshCw, KeyRound, ScrollText } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  listGrnAccessNumbers,
  fetchGrnAccessAttempts,
  expireGrnAccessNumber,
  deleteGrnAccessNumber,
} from '../vendorManagementApi';

const STATUS_STYLES = {
  pending: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  used: 'bg-slate-200 text-slate-700 border-slate-300',
  expired: 'bg-amber-100 text-amber-800 border-amber-200',
};

const RESULT_STYLES = {
  ok: 'text-emerald-700',
  invalid: 'text-rose-700',
  used: 'text-slate-600',
  expired: 'text-amber-700',
};

function fmt(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export default function AccessNumbersAdmin({ onClose }) {
  const [tab, setTab] = useState('numbers');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [numRes, attRes] = await Promise.all([
        listGrnAccessNumbers(),
        fetchGrnAccessAttempts({ limit: 100 }).catch(() => ({ data: { data: [] } })),
      ]);
      setRows(numRes.data?.data || []);
      setAttempts(attRes.data?.data || []);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not load access numbers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function expire(id) {
    setBusyId(id);
    try {
      await expireGrnAccessNumber(id);
      toast.success('Access number expired');
      await load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not expire');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this access number? This cannot be undone.')) return;
    setBusyId(id);
    try {
      await deleteGrnAccessNumber(id);
      toast.success('Access number deleted');
      await load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not delete');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-teal-600" />
            <h2 className="text-base font-semibold text-slate-900">GRN Access Numbers</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={load}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex gap-1 px-5 pt-3">
          {[
            { id: 'numbers', label: 'Access Numbers', icon: KeyRound },
            { id: 'audit', label: 'Audit Log', icon: ScrollText },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 ${
                tab === t.id
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-10 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading…
            </div>
          ) : tab === 'numbers' ? (
            rows.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-10">No access numbers generated yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Number</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                      <th className="px-3 py-2 text-left font-semibold">PO</th>
                      <th className="px-3 py-2 text-left font-semibold">Created</th>
                      <th className="px-3 py-2 text-left font-semibold">Used</th>
                      <th className="px-3 py-2 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2 font-bold tabular-nums text-slate-900">{r.access_number}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_STYLES[r.status] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{r.purchase_order_number || (r.po_id ? `PO-${r.po_id}` : '—')}</td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap text-xs">{fmt(r.created_at)}</td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap text-xs">{fmt(r.used_at)}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              disabled={busyId === r.id || r.status !== 'pending'}
                              onClick={() => expire(r.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-amber-200 text-amber-700 text-xs font-medium hover:bg-amber-50 disabled:opacity-40"
                              title="Expire"
                            >
                              <Ban className="w-3.5 h-3.5" /> Expire
                            </button>
                            <button
                              type="button"
                              disabled={busyId === r.id}
                              onClick={() => remove(r.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-rose-200 text-rose-700 text-xs font-medium hover:bg-rose-50 disabled:opacity-40"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : attempts.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-10">No access attempts recorded.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Time</th>
                    <th className="px-3 py-2 text-left font-semibold">Number</th>
                    <th className="px-3 py-2 text-left font-semibold">Result</th>
                    <th className="px-3 py-2 text-left font-semibold">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attempts.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50/60">
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap text-xs">{fmt(a.created_at)}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-slate-900">{a.access_number ?? '—'}</td>
                      <td className={`px-3 py-2 font-semibold capitalize ${RESULT_STYLES[a.result] || 'text-slate-600'}`}>
                        {a.result || (a.success ? 'ok' : 'failed')}
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-xs">{a.ip || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
