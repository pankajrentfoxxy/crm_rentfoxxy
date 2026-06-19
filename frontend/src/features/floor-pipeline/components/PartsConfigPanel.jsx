import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { addPartWithConfig, searchParts } from '../floorPipelineApi';

const CONFIG_FIELDS = ['RAM', 'Storage', 'Processor', 'GPU', 'Screen', 'OS', 'Other'];

export default function PartsConfigPanel({ ticket, parts = [], configHistory = [], onUpdated }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [isUpgrade, setIsUpgrade] = useState(false);
  const [configField, setConfigField] = useState('RAM');
  const [oldValue, setOldValue] = useState('');
  const [newValue, setNewValue] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const currentConfig = useMemo(() => ({
    processor: ticket?.processor || '—',
    ram: ticket?.ram || '—',
    storage: ticket?.storage || '—',
    gpu: ticket?.gpu || '—',
    os: ticket?.os || '—'
  }), [ticket]);

  const search = useCallback(async (q) => {
    if (q.length < 1) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const { data } = await searchParts(q);
      setResults(data.parts || []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(query), 300);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => {
    if (!isUpgrade || !configField) return;
    const map = { RAM: 'ram', Storage: 'storage', Processor: 'processor', GPU: 'gpu', OS: 'os' };
    const key = map[configField];
    if (key && ticket?.[key]) setOldValue(ticket[key]);
  }, [isUpgrade, configField, ticket]);

  const partsTotal = useMemo(
    () => parts.reduce((s, p) => s + (parseFloat(p.total_part_cost) || 0), 0),
    [parts]
  );

  const handleAttach = async () => {
    if (!selected) {
      toast.error('Select a part');
      return;
    }
    const max = selected.quantity || 0;
    if (quantity < 1 || quantity > max) {
      toast.error(`Quantity must be 1–${max}`);
      return;
    }
    if (isUpgrade && !newValue.trim()) {
      toast.error('New value required for upgrades');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await addPartWithConfig(ticket.ticket_id, {
        part_id: selected.part_id,
        quantity,
        notes: notes.trim() || undefined,
        is_upgrade: isUpgrade,
        config_field: isUpgrade ? configField : undefined,
        old_value: isUpgrade ? oldValue : undefined,
        new_value: isUpgrade ? newValue : undefined
      });
      if (data.success) {
        toast.success(data.message || 'Part attached');
        setSelected(null);
        setQuery('');
        setQuantity(1);
        setIsUpgrade(false);
        setNotes('');
        onUpdated?.();
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to attach part');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
        <h3 className="font-semibold text-slate-900">Add Part Used</h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm"
            placeholder="Search parts inventory…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {searching ? (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-blue-600" /></div>
        ) : null}
        {results.length > 0 && !selected ? (
          <ul className="border rounded-lg divide-y max-h-40 overflow-y-auto text-sm">
            {results.map((p) => (
              <li key={p.part_id}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-slate-50"
                  onClick={() => { setSelected(p); setQuery(p.part_name); setResults([]); }}
                >
                  <span className="font-medium">{p.part_name}</span>
                  <span className="text-xs text-slate-500 ml-2">
                    {p.category || p.part_type} · Available: {p.quantity} · ₹{p.cost || 0}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {selected ? (
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm space-y-3">
            <p className="font-medium">{selected.part_name} <span className="text-slate-500 font-normal">({selected.quantity} in stock)</span></p>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block text-xs">
                Quantity*
                <input
                  type="number"
                  min={1}
                  max={selected.quantity}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="mt-1 w-full rounded border px-2 py-1.5"
                />
              </label>
              <label className="flex items-center gap-2 text-xs pt-5">
                <input type="checkbox" checked={isUpgrade} onChange={(e) => setIsUpgrade(e.target.checked)} />
                Is this an upgrade?
              </label>
            </div>
            {isUpgrade ? (
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block text-xs">
                  Config field*
                  <select value={configField} onChange={(e) => setConfigField(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5">
                    {CONFIG_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
                <label className="block text-xs">
                  Old value
                  <input value={oldValue} onChange={(e) => setOldValue(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5" />
                </label>
                <label className="block text-xs sm:col-span-2">
                  New value*
                  <input value={newValue} onChange={(e) => setNewValue(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5" />
                </label>
              </div>
            ) : null}
            <label className="block text-xs">
              Notes
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 min-h-[60px]" />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSelected(null)} className="px-3 py-1.5 rounded border text-xs">Clear</button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleAttach}
                className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-50"
              >
                {submitting ? 'Attaching…' : 'Attach Part'}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border overflow-hidden">
        <h3 className="font-semibold text-slate-900 px-4 py-3 bg-slate-50 border-b text-sm">Config History</h3>
        {configHistory.length ? (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Field</th>
                <th className="px-3 py-2 text-left">Before → After</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {configHistory.map((h) => (
                <tr key={h.history_id} className="border-t">
                  <td className="px-3 py-2 text-xs">{new Date(h.created_at).toLocaleDateString()}</td>
                  <td className="px-3 py-2 capitalize">{h.field_name}</td>
                  <td className="px-3 py-2">{h.old_value || '—'} → <strong>{h.new_value}</strong></td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      h.change_type === 'upgrade' ? 'bg-green-100 text-green-800' :
                      h.change_type === 'replacement' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100'
                    }`}>{h.change_type}</span>
                  </td>
                  <td className="px-3 py-2 text-right">₹{parseFloat(h.part_cost || 0).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-500 p-4">No config changes recorded</p>
        )}
        <div className="border-t bg-slate-50 px-4 py-3 text-xs grid sm:grid-cols-2 gap-2">
          <p><span className="text-slate-500">Processor:</span> {currentConfig.processor}</p>
          <p><span className="text-slate-500">RAM:</span> {currentConfig.ram}</p>
          <p><span className="text-slate-500">Storage:</span> {currentConfig.storage}</p>
          <p><span className="text-slate-500">GPU:</span> {currentConfig.gpu}</p>
          <p><span className="text-slate-500">OS:</span> {currentConfig.os}</p>
        </div>
      </section>

      <section className="rounded-xl border overflow-hidden">
        <h3 className="font-semibold text-slate-900 px-4 py-3 bg-slate-50 border-b text-sm">Parts Used on This Ticket</h3>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs">
            <tr>
              <th className="px-3 py-2 text-left">Part</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2 text-right">Unit</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Upgrade</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.id || p.part_id} className="border-t">
                <td className="px-3 py-2">{p.part_name}</td>
                <td className="px-3 py-2 text-center">{p.quantity_used}</td>
                <td className="px-3 py-2 text-right">₹{parseFloat(p.unit_cost || 0).toFixed(0)}</td>
                <td className="px-3 py-2 text-right font-medium">₹{parseFloat(p.total_part_cost || 0).toFixed(0)}</td>
                <td className="px-3 py-2 text-center">
                  {p.is_upgrade ? <span className="text-green-700 text-xs font-semibold">✓ Upgrade</span> : '—'}
                </td>
              </tr>
            ))}
            {!parts.length ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No parts attached yet</td></tr>
            ) : null}
          </tbody>
          {parts.length > 0 ? (
            <tfoot className="bg-slate-50 font-semibold text-sm">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right">Total parts cost</td>
                <td className="px-3 py-2 text-right">₹{partsTotal.toFixed(0)}</td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </section>
    </div>
  );
}
