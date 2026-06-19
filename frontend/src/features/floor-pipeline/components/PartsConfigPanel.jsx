import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search, PackagePlus, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import { addPartWithConfig, searchParts } from '../floorPipelineApi';
import { createPartRequest, attachPartToRequest, cancelPartRequest } from '../partRequestsApi';

const CONFIG_FIELDS = ['RAM', 'Storage', 'Processor', 'GPU', 'Screen', 'OS', 'Other'];
const STATUS_ORDER = ['pending', 'escalated', 'ordered', 'received', 'approved', 'attached'];
const statusOrder = (s) => {
  const i = STATUS_ORDER.indexOf(s);
  return i === -1 ? 0 : i;
};

function StatusBadge({ status }) {
  const map = {
    pending: 'bg-amber-100 text-amber-800',
    escalated: 'bg-purple-100 text-purple-800',
    ordered: 'bg-blue-100 text-blue-800',
    received: 'bg-cyan-100 text-cyan-800',
    approved: 'bg-emerald-100 text-emerald-800',
    attached: 'bg-green-600 text-white',
    rejected: 'bg-red-100 text-red-700',
    cancelled: 'bg-slate-200 text-slate-600',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${map[status] || 'bg-slate-100 text-slate-700'}`}>
      {status}
    </span>
  );
}

// ── Attach + return-old modal ────────────────────────────────────────────────
function AttachPartModal({ request, onAttached, onClose }) {
  const [oldPartReturned, setOldPartReturned] = useState(true);
  const [oldPartCondition, setOldPartCondition] = useState('defective');
  const [oldPartNotes, setOldPartNotes] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl w-full max-w-sm p-5 shadow-xl">
        <h3 className="font-semibold mb-1">Attach Part: {request.part_name}</h3>
        {request.prt_id && (
          <p className="font-mono text-xs text-blue-700 mb-3">PRT-ID: {request.prt_id}</p>
        )}

        {request.request_type === 'upgrade' && (
          <div className="bg-blue-50 rounded-lg p-3 mb-3 text-sm">
            <p className="font-medium text-blue-900">Config will be updated:</p>
            <p className="text-blue-700 capitalize">
              {request.config_field}: {request.old_value || '—'} → {request.new_value}
            </p>
          </div>
        )}

        <div className="space-y-3 mb-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={oldPartReturned} onChange={(e) => setOldPartReturned(e.target.checked)} />
            <span>I am returning the {request.request_type === 'replacement' ? 'defective part' : 'old part'} to warehouse</span>
          </label>

          {oldPartReturned && (
            <>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Old part condition</label>
                <select value={oldPartCondition} onChange={(e) => setOldPartCondition(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="defective">Defective (cannot reuse)</option>
                  <option value="worn">Worn (may still work)</option>
                  <option value="good">Good (reusable)</option>
                </select>
              </div>
              <textarea value={oldPartNotes} onChange={(e) => setOldPartNotes(e.target.value)} rows={2}
                placeholder="Notes about the old part (optional)"
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </>
          )}
        </div>

        {!oldPartReturned && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-2 mb-3 text-xs text-amber-800">
            You must return the old/defective part to warehouse. Ticket will not be unblocked until this is done.
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm">Cancel</button>
          <button type="button" disabled={saving || !oldPartReturned}
            onClick={async () => {
              setSaving(true);
              try {
                await attachPartToRequest(request.request_id, {
                  old_part_returned: oldPartReturned,
                  old_part_condition: oldPartCondition,
                  old_part_notes: oldPartNotes,
                });
                toast.success('Part attached! Ticket unblocked.');
                onAttached();
                onClose();
              } catch (e) {
                toast.error(e.response?.data?.message || 'Failed');
              } finally { setSaving(false); }
            }}
            className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {saving ? 'Attaching…' : 'Confirm Attachment'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PartsConfigPanel({ ticket, parts = [], configHistory = [], partRequests = [], onUpdated }) {
  const [mode, setMode] = useState('request'); // 'request' | 'direct'

  // Shared part search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);

  // Request-flow state
  const [requestType, setRequestType] = useState('replacement');
  const [quantity, setQuantity] = useState(1);
  const [description, setDescription] = useState('');
  const [blocksStage, setBlocksStage] = useState(true);
  const [configField, setConfigField] = useState('');
  const [oldValue, setOldValue] = useState('');
  const [newValue, setNewValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attachModal, setAttachModal] = useState(null);

  // Direct-attach state
  const [dQuantity, setDQuantity] = useState(1);
  const [dIsUpgrade, setDIsUpgrade] = useState(false);
  const [dConfigField, setDConfigField] = useState('RAM');
  const [dOldValue, setDOldValue] = useState('');
  const [dNewValue, setDNewValue] = useState('');
  const [dNotes, setDNotes] = useState('');

  const currentConfig = useMemo(() => ({
    processor: ticket?.processor || '—',
    ram: ticket?.ram || '—',
    storage: ticket?.storage || '—',
    gpu: ticket?.gpu || '—',
    os: ticket?.os || '—',
  }), [ticket]);

  const search = useCallback(async (q) => {
    if (q.length < 1) { setResults([]); return; }
    setSearching(true);
    try {
      const { data } = await searchParts(q);
      setResults(data.parts || []);
    } catch { setResults([]); } finally { setSearching(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(query), 300);
    return () => clearTimeout(t);
  }, [query, search]);

  // Auto-fill old value from ticket config when picking an upgrade field (request flow)
  useEffect(() => {
    if (requestType !== 'upgrade' || !configField) return;
    const auto = { ram: ticket?.ram, storage: ticket?.storage, display: ticket?.screen_size, processor: ticket?.processor, gpu: ticket?.gpu }[configField] || '';
    setOldValue(auto);
  }, [requestType, configField, ticket]);

  useEffect(() => {
    if (!dIsUpgrade || !dConfigField) return;
    const map = { RAM: 'ram', Storage: 'storage', Processor: 'processor', GPU: 'gpu', OS: 'os' };
    const key = map[dConfigField];
    if (key && ticket?.[key]) setDOldValue(ticket[key]);
  }, [dIsUpgrade, dConfigField, ticket]);

  const partsTotal = useMemo(
    () => parts.reduce((s, p) => s + (parseFloat(p.total_part_cost) || 0), 0),
    [parts]
  );

  const activeRequests = useMemo(
    () => (partRequests || []).filter((r) => !['cancelled'].includes(r.status)),
    [partRequests]
  );

  const resetSelection = () => { setSelected(null); setQuery(''); setResults([]); };

  const handleSubmitRequest = async () => {
    if (!selected) { toast.error('Select a part from the catalog'); return; }
    if (requestType === 'upgrade' && (!configField || !newValue.trim())) {
      toast.error('Upgrade needs a config field and new value');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await createPartRequest({
        ticket_id: ticket.ticket_id,
        request_type: requestType,
        part_id: selected.part_id,
        quantity,
        description: description.trim() || undefined,
        blocks_stage: blocksStage,
        config_field: requestType === 'upgrade' ? configField : undefined,
        old_value: requestType === 'upgrade' ? oldValue : undefined,
        new_value: requestType === 'upgrade' ? newValue : undefined,
      });
      toast.success(data.message || 'Request submitted');
      resetSelection();
      setDescription(''); setNewValue(''); setOldValue(''); setConfigField(''); setQuantity(1);
      onUpdated?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to submit request');
    } finally { setSubmitting(false); }
  };

  const handleDirectAttach = async () => {
    if (!selected) { toast.error('Select a part'); return; }
    const max = selected.quantity || 0;
    if (dQuantity < 1 || dQuantity > max) { toast.error(`Quantity must be 1–${max}`); return; }
    if (dIsUpgrade && !dNewValue.trim()) { toast.error('New value required for upgrades'); return; }
    setSubmitting(true);
    try {
      const { data } = await addPartWithConfig(ticket.ticket_id, {
        part_id: selected.part_id,
        quantity: dQuantity,
        notes: dNotes.trim() || undefined,
        is_upgrade: dIsUpgrade,
        config_field: dIsUpgrade ? dConfigField : undefined,
        old_value: dIsUpgrade ? dOldValue : undefined,
        new_value: dIsUpgrade ? dNewValue : undefined,
      });
      if (data.success) {
        toast.success(data.message || 'Part attached');
        resetSelection(); setDQuantity(1); setDIsUpgrade(false); setDNotes('');
        onUpdated?.();
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to attach part');
    } finally { setSubmitting(false); }
  };

  const handleCancel = async (req) => {
    if (!window.confirm(`Cancel request ${req.request_number}?`)) return;
    try {
      await cancelPartRequest(req.request_id);
      toast.success('Request cancelled');
      onUpdated?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to cancel');
    }
  };

  const stockBadge = (qty) => (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
      qty > 5 ? 'bg-green-100 text-green-700' : qty > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
    }`}>
      {qty > 0 ? `In Stock: ${qty}` : 'Out of Stock — goes to Procurement'}
    </span>
  );

  return (
    <div className="space-y-6">
      {/* Active part requests */}
      {activeRequests.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-gray-500">Active Part Requests</h4>
          {activeRequests.map((req) => (
            <div key={req.request_id} className="border rounded-lg p-3 bg-white">
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-mono text-xs text-blue-700">{req.request_number}</span>
                  <p className="font-medium text-sm mt-0.5">{req.part_name}</p>
                  {req.request_type === 'upgrade' && (
                    <p className="text-xs text-blue-600 capitalize">
                      ⬆ {req.config_field}: {req.old_value || '—'} → {req.new_value}
                    </p>
                  )}
                  {req.prt_id && <p className="font-mono text-[11px] text-emerald-700 mt-0.5">{req.prt_id}{req.location_code ? ` · ${req.location_code}` : ''}</p>}
                </div>
                <StatusBadge status={req.status} />
              </div>

              {/* Timeline */}
              <div className="flex items-center gap-1 mt-2">
                {['pending', 'approved', 'attached'].map((s, i) => (
                  <React.Fragment key={s}>
                    <div className={`w-2 h-2 rounded-full ${
                      req.status === s ? 'bg-blue-600' : statusOrder(req.status) > statusOrder(s) ? 'bg-green-500' : 'bg-gray-200'
                    }`} />
                    {i < 2 && <div className="flex-1 h-px bg-gray-200" />}
                  </React.Fragment>
                ))}
              </div>

              {req.status === 'rejected' && req.rejection_reason && (
                <p className="text-xs text-red-600 mt-2">Rejected: {req.rejection_reason}</p>
              )}

              {req.status === 'approved' && (
                <div className="mt-2 pt-2 border-t">
                  <p className="text-xs text-green-700 mb-2">
                    ✓ Approved by warehouse. PRT-ID: {req.prt_id || 'assigned'}
                  </p>
                  <button type="button" onClick={() => setAttachModal(req)}
                    className="w-full py-2 bg-green-600 text-white rounded-lg text-sm font-semibold">
                    Attach Part + Return Old Part
                  </button>
                </div>
              )}

              {req.blocks_stage && !['attached', 'cancelled', 'rejected'].includes(req.status) && (
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-amber-700">⛔ Ticket blocked until part is attached</span>
                  <button type="button" onClick={() => handleCancel(req)} className="text-slate-500 underline">Cancel</button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Mode tabs */}
      <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
        <div className="flex gap-2">
          <button type="button" onClick={() => { setMode('request'); resetSelection(); }}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 ${
              mode === 'request' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
            <PackagePlus className="w-4 h-4" /> Request Part
          </button>
          <button type="button" onClick={() => { setMode('direct'); resetSelection(); }}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 ${
              mode === 'direct' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
            <Wrench className="w-4 h-4" /> Direct Attach
          </button>
        </div>
        <p className="text-xs text-slate-400">
          {mode === 'request'
            ? 'Raise a part request — warehouse approval (or procurement) required before attaching.'
            : 'For consumables / minor items: attach immediately without approval.'}
        </p>

        {/* Request type (request mode) */}
        {mode === 'request' && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: 'replacement', label: 'Replace Defective', desc: 'Swap broken part' },
              { value: 'upgrade', label: 'Upgrade', desc: 'Improve specification' },
              { value: 'consumable', label: 'Consumable', desc: 'Paste, screws, etc.' },
            ].map((opt) => (
              <button key={opt.value} type="button" onClick={() => setRequestType(opt.value)}
                className={`p-2 border rounded-lg text-left text-xs ${
                  requestType === opt.value ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-gray-200 hover:border-gray-300'}`}>
                <p className="font-semibold">{opt.label}</p>
                <p className="text-gray-500 mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>
        )}

        {/* Part search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm" placeholder="Search parts catalog…"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {searching && <div className="flex justify-center py-3"><Loader2 className="w-5 h-5 animate-spin text-blue-600" /></div>}
        {results.length > 0 && !selected && (
          <ul className="border rounded-lg divide-y max-h-40 overflow-y-auto text-sm">
            {results.map((p) => (
              <li key={p.part_id}>
                <button type="button" className="w-full text-left px-3 py-2 hover:bg-slate-50"
                  onClick={() => { setSelected(p); setQuery(p.part_name); setResults([]); }}>
                  <span className="font-medium">{p.part_name}</span>
                  <span className="text-xs text-slate-500 ml-2">{p.category || p.part_type} · Available: {p.quantity} · ₹{p.cost || 0}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected && (
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-medium">{selected.part_name}</p>
              {stockBadge(selected.quantity || 0)}
            </div>

            {mode === 'request' ? (
              <>
                {requestType === 'upgrade' && (
                  <div className="space-y-2 bg-white rounded-lg p-3 border">
                    <label className="text-xs font-semibold text-blue-900">Config Change</label>
                    <select value={configField} onChange={(e) => setConfigField(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="">What are you upgrading?</option>
                      <option value="ram">RAM</option>
                      <option value="storage">Storage / SSD</option>
                      <option value="display">Display</option>
                      <option value="battery">Battery</option>
                      <option value="keyboard">Keyboard</option>
                      <option value="gpu">GPU</option>
                      <option value="other">Other</option>
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-gray-500">Current (old)</label>
                        <input value={oldValue} onChange={(e) => setOldValue(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. 8 GB" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">After upgrade (new)*</label>
                        <input value={newValue} onChange={(e) => setNewValue(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. 16 GB" />
                      </div>
                    </div>
                  </div>
                )}
                <label className="block text-xs">
                  Quantity
                  <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1.5" />
                </label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                  placeholder="Why is this part needed? Describe the issue…" className="w-full border rounded-lg px-3 py-2 text-sm" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={blocksStage} onChange={(e) => setBlocksStage(e.target.checked)} />
                  <span>Block ticket from moving to next stage until part is attached</span>
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={resetSelection} className="px-3 py-1.5 rounded border text-xs">Clear</button>
                  <button type="button" disabled={submitting} onClick={handleSubmitRequest}
                    className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">
                    {submitting ? 'Submitting…' : (selected.quantity > 0 ? 'Submit for Warehouse Approval' : 'Submit for Procurement')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="block text-xs">
                    Quantity*
                    <input type="number" min={1} max={selected.quantity} value={dQuantity} onChange={(e) => setDQuantity(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1.5" />
                  </label>
                  <label className="flex items-center gap-2 text-xs pt-5">
                    <input type="checkbox" checked={dIsUpgrade} onChange={(e) => setDIsUpgrade(e.target.checked)} /> Is this an upgrade?
                  </label>
                </div>
                {dIsUpgrade && (
                  <div className="grid sm:grid-cols-2 gap-3">
                    <label className="block text-xs">Config field*
                      <select value={dConfigField} onChange={(e) => setDConfigField(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5">
                        {CONFIG_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </label>
                    <label className="block text-xs">Old value
                      <input value={dOldValue} onChange={(e) => setDOldValue(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5" />
                    </label>
                    <label className="block text-xs sm:col-span-2">New value*
                      <input value={dNewValue} onChange={(e) => setDNewValue(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5" />
                    </label>
                  </div>
                )}
                <label className="block text-xs">Notes
                  <textarea value={dNotes} onChange={(e) => setDNotes(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 min-h-[60px]" />
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={resetSelection} className="px-3 py-1.5 rounded border text-xs">Clear</button>
                  <button type="button" disabled={submitting} onClick={handleDirectAttach}
                    className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">
                    {submitting ? 'Attaching…' : 'Attach Part'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* Config history */}
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
                      h.change_type === 'upgrade' ? 'bg-green-100 text-green-800' : h.change_type === 'replacement' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100'}`}>{h.change_type}</span>
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

      {/* Parts used */}
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
                <td className="px-3 py-2 text-center">{p.is_upgrade ? <span className="text-green-700 text-xs font-semibold">✓ Upgrade</span> : '—'}</td>
              </tr>
            ))}
            {!parts.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No parts attached yet</td></tr>}
          </tbody>
          {parts.length > 0 && (
            <tfoot className="bg-slate-50 font-semibold text-sm">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right">Total parts cost</td>
                <td className="px-3 py-2 text-right">₹{partsTotal.toFixed(0)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </section>

      {attachModal && (
        <AttachPartModal request={attachModal} onAttached={onUpdated} onClose={() => setAttachModal(null)} />
      )}
    </div>
  );
}
