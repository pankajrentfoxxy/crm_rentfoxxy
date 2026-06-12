import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

const FILTERS = [
  { key: 'pending', label: 'Pending decision' },
  { key: 'overdue', label: 'Overdue (7d+)' },
  { key: 'decided', label: 'Decided' },
  { key: '', label: 'All' },
];

function KeepModal({ demo, onClose, onDone }) {
  const [rentStart, setRentStart] = useState(new Date().toISOString().slice(0, 10));
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/demo/agreements/${demo.demo_id}/decide`, {
        decision: 'keep', rent_start_date: rentStart, monthly_rate: rate || undefined,
      });
      toast.success('Demo converted to rental');
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
        <h3 className="text-lg font-semibold">Keep — convert to rental</h3>
        <p className="text-sm text-gray-500">{demo.ttspl_id} · {demo.company_name || demo.customer_name}</p>
        <label className="block text-sm">
          <span className="text-gray-500 text-xs">Billing start date</span>
          <input type="date" value={rentStart} onChange={(e) => setRentStart(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm">
          <span className="text-gray-500 text-xs">Monthly rate (optional)</span>
          <input type="number" value={rate} onChange={(e) => setRate(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. 1500" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button type="button" onClick={submit} disabled={busy}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg disabled:opacity-50">Convert</button>
        </div>
      </div>
    </div>
  );
}

export default function DemoAgreementsPage() {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [keepFor, setKeepFor] = useState(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/demo/agreements', { params: filter ? { status: filter } : {} });
      setRows(res.data?.data || []);
    } catch {
      toast.error('Failed to load demo agreements');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleReturn = async (demo) => {
    if (!window.confirm(`Raise a pickup request for ${demo.ttspl_id}?`)) return;
    try {
      await api.post(`/demo/agreements/${demo.demo_id}/decide`, { decision: 'return' });
      toast.success('Pickup ticket raised');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Demo Agreements</h1>
      <p className="text-gray-500 text-sm mb-4">
        Demos are free for 7 days. After the decision date, confirm whether the customer keeps the unit
        (converts to rental) or arrange a return pickup.
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-sm rounded-lg ${filter === f.key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 text-left">
            <tr>
              {['TTSPL', 'Customer', 'Delivered', 'Decision Due', 'Status', 'Actions'].map((h) => <th key={h} className="p-3">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-6 text-center text-gray-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-gray-400">No demo agreements</td></tr>
            ) : rows.map((d) => (
              <tr key={d.demo_id} className={`border-t border-gray-100 ${d.is_overdue ? 'bg-amber-50' : ''}`}>
                <td className="p-3 font-mono text-xs">{d.ttspl_id || '—'}</td>
                <td className="p-3">{d.company_name || d.customer_name || `#${d.customer_id}`}</td>
                <td className="p-3 text-xs">{d.delivered_at ? new Date(d.delivered_at).toLocaleDateString('en-IN') : '—'}</td>
                <td className="p-3 text-xs">
                  {d.decision_due_at ? new Date(d.decision_due_at).toLocaleDateString('en-IN') : '—'}
                  {d.is_overdue && <span className="ml-1 text-amber-600 font-medium">overdue</span>}
                </td>
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    d.decision === 'keep' ? 'bg-green-100 text-green-700'
                    : d.decision === 'return' ? 'bg-red-100 text-red-700'
                    : 'bg-gray-100 text-gray-600'}`}>{d.decision}</span>
                </td>
                <td className="p-3">
                  {d.decision === 'pending' ? (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setKeepFor(d)}
                        className="px-3 py-1 text-xs bg-green-600 text-white rounded-lg">Keep</button>
                      <button type="button" onClick={() => handleReturn(d)}
                        className="px-3 py-1 text-xs border border-red-200 text-red-600 rounded-lg">Return</button>
                    </div>
                  ) : <span className="text-xs text-gray-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {keepFor && <KeepModal demo={keepFor} onClose={() => setKeepFor(null)} onDone={() => { setKeepFor(null); load(); }} />}
    </div>
  );
}
