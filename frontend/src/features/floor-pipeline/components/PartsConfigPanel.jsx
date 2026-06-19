import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Ban } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  addPartWithConfig,
  searchParts,
  createPartRequest,
  attachPartToRequest,
  cancelPartRequest,
} from '../floorPipelineApi';

const CONFIG_FIELDS = ['RAM', 'Storage', 'Processor', 'GPU', 'Screen', 'OS', 'Other'];

const REQUEST_TYPES = [
  { value: 'replacement', label: 'Replace Defective', desc: 'Swap a broken part' },
  { value: 'upgrade', label: 'Upgrade', desc: 'Improve specification' },
  { value: 'consumable', label: 'Consumable', desc: 'Paste, screws, etc.' },
];

const UPGRADE_FIELDS = [
  { value: 'ram', label: 'RAM' },
  { value: 'storage', label: 'Storage / SSD' },
  { value: 'display', label: 'Display' },
  { value: 'battery', label: 'Battery' },
  { value: 'keyboard', label: 'Keyboard' },
  { value: 'gpu', label: 'GPU' },
  { value: 'other', label: 'Other' },
];

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  escalated: 'bg-purple-100 text-purple-800',
  ordered: 'bg-blue-100 text-blue-800',
  received: 'bg-teal-100 text-teal-800',
  attached: 'bg-emerald-600 text-white',
  rejected: 'bg-red-100 text-red-800',
  cancelled: 'bg-slate-200 text-slate-600',
};

const STATUS_ORDER = ['pending', 'approved', 'attached'];
function statusRank(status) {
  if (status === 'escalated' || status === 'ordered' || status === 'received') return 0; // still pre-approval
  return STATUS_ORDER.indexOf(status);
}

function StatusBadge({ status }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES[status] || 'bg-slate-100 text-slate-700'}`}>
      {status}
    </span>
  );
}

function AttachPartModal({ request, onAttached, onClose }) {
  const [oldPartReturned, setOldPartReturned] = useState(true);
  const [oldPartCondition, setOldPartCondition] = useState('defective');
  const [oldPartNotes, setOldPartNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await attachPartToRequest(request.request_id, {
        old_part_returned: oldPartReturned,
        old_part_condition: oldPartCondition,
        old_part_notes: oldPartNotes,
      });
      toast.success('Part attached. Ticket unblocked.');
      onAttached();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to attach part');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl w-full max-w-sm p-5 shadow-xl">
        <h3 className="font-semibold mb-1">Attach Part: {request.part_name}</h3>
        {request.prt_id ? (
          <p className="font-mono text-xs text-blue-700 mb-3">PRT-ID: {request.prt_id}</p>
        ) : null}

        {request.request_type === 'upgrade' ? (
          <div className="bg-blue-50 rounded-lg p-3 mb-3 text-sm">
            <p className="font-medium text-blue-900">Config will be updated:</p>
            <p className="text-blue-700 capitalize">
              {request.config_field}: {request.old_value || '—'} → {request.new_value}
            </p>
          </div>
        ) : null}

        <div className="space-y-3 mb-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={oldPartReturned} onChange={(e) => setOldPartReturned(e.target.checked)} />
            <span>I am returning the {request.request_type === 'replacement' ? 'defective part' : 'old part'} to warehouse</span>
          </label>

          {oldPartReturned ? (
            <>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Old part condition</label>
                <select value={oldPartCondition} onChange={(e) => setOldPartCondition(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="defective">Defective (cannot reuse)</option>
                  <option value="worn">Worn (may still work)</option>
                  <option value="good">Good (reusable — back to stock)</option>
                </select>
              </div>
              <textarea value={oldPartNotes} onChange={(e) => setOldPartNotes(e.target.value)} rows={2} placeholder="Notes about the old part (optional)" className="w-full border rounded-lg px-3 py-2 text-sm" />
            </>
          ) : (
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-2 text-xs text-amber-800">
              You must return the old/defective part to warehouse to keep the audit trail complete.
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm">Cancel</button>
          <button type="button" disabled={saving || !oldPartReturned} onClick={submit} className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {saving ? 'Attaching…' : 'Confirm Attachment'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PartsConfigPanel({ ticket, parts = [], configHistory = [], partRequests = [], isAssignee = false, onUpdated }) {
  const [mode, setMode] = useState('request'); // 'request' | 'attach'

  // shared part search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);

  // request form
  const [requestType, setRequestType] = useState('replacement');
  const [reqDescription, setReqDescription] = useState('');
  const [blocksStage, setBlocksStage] = useState(true);
  const [reqConfigField, setReqConfigField] = useState('ram');
  const [reqOldValue, setReqOldValue] = useState('');
  const [reqNewValue, setReqNewValue] = useState('');
  const [submittingReq, setSubmittingReq] = useState(false);

  // direct attach form
  const [quantity, setQuantity] = useState(1);
  const [isUpgrade, setIsUpgrade] = useState(false);
  const [configField, setConfigField] = useState('RAM');
  const [oldValue, setOldValue] = useState('');
  const [newValue, setNewValue] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [attachTarget, setAttachTarget] = useState(null);

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

  // auto-fill old value from ticket config (request upgrade)
  useEffect(() => {
    if (requestType !== 'upgrade') return;
    const map = { ram: 'ram', storage: 'storage', processor: 'processor', gpu: 'gpu', display: 'screen_size' };
    const key = map[reqConfigField];
    if (key && ticket?.[key]) setReqOldValue(ticket[key]);
  }, [requestType, reqConfigField, ticket]);

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

  const activeRequests = useMemo(
    () => (partRequests || []).filter((r) => !['cancelled'].includes(r.status)),
    [partRequests]
  );

  const resetSharedSearch = () => { setSelected(null); setQuery(''); setResults([]); };

  const handleSubmitRequest = async () => {
    if (!selected) { toast.error('Select a part from the catalog'); return; }
    if (requestType === 'upgrade' && !reqNewValue.trim()) { toast.error('New value is required for upgrades'); return; }
    setSubmittingReq(true);
    try {
      const { data } = await createPartRequest({
        ticket_id: ticket.ticket_id,
        request_type: requestType,
        part_id: selected.part_id,
        quantity: 1,
        description: reqDescription.trim() || undefined,
        blocks_stage: blocksStage,
        config_field: requestType === 'upgrade' ? reqConfigField : undefined,
        old_value: requestType === 'upgrade' ? reqOldValue : undefined,
        new_value: requestType === 'upgrade' ? reqNewValue : undefined,
      });
      if (data.success) {
        toast.success(data.in_stock ? `${data.request_number} sent for warehouse approval` : `${data.request_number} escalated to procurement`);
        resetSharedSearch();
        setReqDescription('');
        setReqNewValue('');
        onUpdated?.();
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to raise part request');
    } finally {
      setSubmittingReq(false);
    }
  };

  const handleCancelRequest = async (requestId) => {
    if (!window.confirm('Cancel this part request?')) return;
    try {
      await cancelPartRequest(requestId);
      toast.success('Request cancelled');
      onUpdated?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to cancel');
    }
  };

  const handleDirectAttach = async () => {
    if (!selected) { toast.error('Select a part'); return; }
    const max = selected.quantity || 0;
    if (quantity < 1 || quantity > max) { toast.error(`Quantity must be 1–${max}`); return; }
    if (isUpgrade && !newValue.trim()) { toast.error('New value required for upgrades'); return; }
    setSubmitting(true);
    try {
      const { data } = await addPartWithConfig(ticket.ticket_id, {
        part_id: selected.part_id,
        quantity,
        notes: notes.trim() || undefined,
        is_upgrade: isUpgrade,
        config_field: isUpgrade ? configField : undefined,
        old_value: isUpgrade ? oldValue : undefined,
        new_value: isUpgrade ? newValue : undefined,
      });
      if (data.success) {
        toast.success(data.message || 'Part attached');
        resetSharedSearch();
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

  const stockBadge = (p) => {
    const q = p?.quantity || 0;
    const cls = q > 5 ? 'bg-green-100 text-green-700' : q > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
        {q > 0 ? `In stock: ${q}` : 'Out of stock — goes to Procurement'}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Mode tabs */}
      <div className="flex gap-2">
        {[{ id: 'request', label: 'Request Part' }, { id: 'attach', label: 'Direct Attach' }].map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => { setMode(m.id); resetSharedSearch(); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${mode === m.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Shared part search */}
      <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
        <h3 className="font-semibold text-slate-900">
          {mode === 'request' ? 'Raise a Part Request' : 'Add Part Used (direct)'}
        </h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm"
            placeholder="Search parts catalog…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {searching ? <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-blue-600" /></div> : null}
        {results.length > 0 && !selected ? (
          <ul className="border rounded-lg divide-y max-h-40 overflow-y-auto text-sm">
            {results.map((p) => (
              <li key={p.part_id}>
                <button type="button" className="w-full text-left px-3 py-2 hover:bg-slate-50" onClick={() => { setSelected(p); setQuery(p.part_name); setResults([]); }}>
                  <span className="font-medium">{p.part_name}</span>
                  <span className="text-xs text-slate-500 ml-2">{p.category || p.part_type} · Available: {p.quantity} · ₹{p.cost || 0}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {selected ? (
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-medium">{selected.part_name}</p>
              {stockBadge(selected)}
            </div>

            {mode === 'request' ? (
              <>
                <div>
                  <label className="text-xs font-semibold text-slate-600">Request type</label>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    {REQUEST_TYPES.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setRequestType(opt.value)}
                        className={`p-2 border rounded-lg text-left text-xs ${requestType === opt.value ? 'border-blue-500 bg-white text-blue-900' : 'border-gray-200 bg-white/60 hover:border-gray-300'}`}
                      >
                        <p className="font-semibold">{opt.label}</p>
                        <p className="text-gray-500 mt-0.5">{opt.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {requestType === 'upgrade' ? (
                  <div className="space-y-2 bg-white rounded-lg p-3 border">
                    <label className="text-xs font-semibold text-blue-900">Config change</label>
                    <select value={reqConfigField} onChange={(e) => setReqConfigField(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                      {UPGRADE_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-gray-500">Current (old)</label>
                        <input value={reqOldValue} onChange={(e) => setReqOldValue(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. 8 GB" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">After upgrade (new)*</label>
                        <input value={reqNewValue} onChange={(e) => setReqNewValue(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. 16 GB" />
                      </div>
                    </div>
                  </div>
                ) : null}

                <textarea value={reqDescription} onChange={(e) => setReqDescription(e.target.value)} rows={2} placeholder="Why is this part needed? Describe the issue…" className="w-full border rounded-lg px-3 py-2 text-sm" />

                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={blocksStage} onChange={(e) => setBlocksStage(e.target.checked)} />
                  <span>Block ticket from moving to next stage until part is attached</span>
                </label>

                <div className="flex gap-2">
                  <button type="button" onClick={resetSharedSearch} className="px-3 py-1.5 rounded border text-xs">Clear</button>
                  <button type="button" disabled={submittingReq} onClick={handleSubmitRequest} className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-50">
                    {submittingReq ? 'Submitting…' : (selected.quantity > 0 ? 'Submit for Warehouse Approval' : 'Submit for Procurement')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="block text-xs">
                    Quantity*
                    <input type="number" min={1} max={selected.quantity} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1.5" />
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
                  <button type="button" onClick={resetSharedSearch} className="px-3 py-1.5 rounded border text-xs">Clear</button>
                  <button type="button" disabled={submitting} onClick={handleDirectAttach} className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-50">
                    {submitting ? 'Attaching…' : 'Attach Part'}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </section>

      {/* Active part requests */}
      {activeRequests.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase text-slate-500">Active Part Requests</h3>
          {activeRequests.map((req) => (
            <div key={req.request_id} className="border rounded-lg p-3 bg-white">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-xs text-blue-700">{req.request_number}</span>
                  <p className="font-medium text-sm mt-0.5">{req.part_name}</p>
                  {req.request_type === 'upgrade' ? (
                    <p className="text-xs text-blue-600 capitalize">⬆ {req.config_field}: {req.old_value || '—'} → {req.new_value}</p>
                  ) : (
                    <p className="text-xs text-slate-500 capitalize">{req.request_type}</p>
                  )}
                </div>
                <StatusBadge status={req.status} />
              </div>

              {!['rejected'].includes(req.status) ? (
                <div className="flex items-center gap-1 mt-2">
                  {STATUS_ORDER.map((s, i) => (
                    <React.Fragment key={s}>
                      <div className={`w-2 h-2 rounded-full ${req.status === s ? 'bg-blue-600' : statusRank(req.status) > i ? 'bg-green-500' : 'bg-gray-200'}`} />
                      {i < STATUS_ORDER.length - 1 ? <div className="flex-1 h-px bg-gray-200" /> : null}
                    </React.Fragment>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-red-600 mt-2">Rejected: {req.rejection_reason || '—'}</p>
              )}

              {req.status === 'approved' ? (
                <div className="mt-2 pt-2 border-t">
                  <p className="text-xs text-green-700 mb-2">Approved by warehouse{req.prt_id ? ` · PRT-ID: ${req.prt_id}` : ''}{req.instance_location ? ` · ${req.instance_location}` : ''}</p>
                  <button type="button" onClick={() => setAttachTarget(req)} className="w-full py-2 bg-green-600 text-white rounded-lg text-sm font-semibold">
                    Attach Part + Return Old Part
                  </button>
                </div>
              ) : null}

              {req.blocks_stage && !['attached', 'cancelled', 'rejected'].includes(req.status) ? (
                <div className="mt-2 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs text-amber-700"><Ban className="w-3.5 h-3.5" /> Ticket blocked until attached</span>
                  {['pending', 'escalated'].includes(req.status) ? (
                    <button type="button" onClick={() => handleCancelRequest(req.request_id)} className="text-xs text-slate-500 hover:text-red-600 underline">Cancel</button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

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
                    <span className={`rounded-full px-2 py-0.5 text-xs ${h.change_type === 'upgrade' ? 'bg-green-100 text-green-800' : h.change_type === 'replacement' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100'}`}>{h.change_type}</span>
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
            {!parts.length ? <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No parts attached yet</td></tr> : null}
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

      {attachTarget ? (
        <AttachPartModal request={attachTarget} onAttached={() => onUpdated?.()} onClose={() => setAttachTarget(null)} />
      ) : null}
    </div>
  );
}
