import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { addTicketPart, requestTicketPart, searchParts } from '../floorPipelineApi';

const CATEGORIES = ['Display', 'Battery', 'Keyboard', 'RAM', 'Storage', 'Network', 'Motherboard', 'Thermal', 'Other'];

export default function PartsRequestModal({ open, onClose, ticketId, mode = 'available', onSuccess }) {
  const [tab, setTab] = useState(mode);
  const [query, setQuery] = useState('');
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedPart, setSelectedPart] = useState(null);
  const [qty, setQty] = useState(1);
  const [requestForm, setRequestForm] = useState({ part_name: '', part_category: 'Other', quantity: 1, notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab(mode);
    setQuery('');
    setParts([]);
    setSelectedPart(null);
  }, [open, mode]);

  useEffect(() => {
    if (!open || tab !== 'available' || query.length < 2) {
      setParts([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await searchParts(query);
        const list = data.parts || data.data || [];
        const q = query.toLowerCase();
        setParts(
          list.filter((p) =>
            !q || String(p.part_name || '').toLowerCase().includes(q) || String(p.part_type || '').toLowerCase().includes(q)
          )
        );
      } catch {
        setParts([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [open, tab, query]);

  if (!open) return null;

  const attachPart = async () => {
    if (!selectedPart) {
      toast.error('Select a part');
      return;
    }
    setSaving(true);
    try {
      const { data } = await addTicketPart(ticketId, {
        part_id: selectedPart.part_id,
        quantity_used: qty
      });
      if (data.success) {
        toast.success('Part attached');
        onSuccess?.();
        onClose();
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const raiseRequest = async () => {
    if (!requestForm.part_name.trim()) {
      toast.error('Part name required');
      return;
    }
    setSaving(true);
    try {
      const desc = [
        requestForm.part_category,
        `Qty: ${requestForm.quantity}`,
        requestForm.notes
      ].filter(Boolean).join(' — ');
      const { data } = await requestTicketPart(ticketId, {
        part_name: requestForm.part_name.trim(),
        description: desc
      });
      if (data.success) {
        toast.success('Procurement request raised — Parts team notified');
        onSuccess?.();
        onClose();
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-xl rounded-xl border border-gray-100 bg-white shadow-xl p-5">
        <div className="flex justify-between mb-4">
          <h3 className="font-semibold">Request / attach part</h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setTab('available')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold ${tab === 'available' ? 'bg-blue-600 text-white' : 'bg-slate-100'}`}
          >
            In inventory
          </button>
          <button
            type="button"
            onClick={() => setTab('request')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold ${tab === 'request' ? 'bg-blue-600 text-white' : 'bg-slate-100'}`}
          >
            Not available
          </button>
        </div>
        {tab === 'available' ? (
          <div className="space-y-3">
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="Search parts…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : null}
            <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
              {parts.map((p) => (
                <button
                  key={p.part_id}
                  type="button"
                  onClick={() => setSelectedPart(p)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${selectedPart?.part_id === p.part_id ? 'bg-blue-50' : ''}`}
                >
                  <span className="font-medium">{p.part_name}</span>
                  <span className="text-slate-500 ml-2">{p.part_type} · Qty {p.quantity} · ₹{p.cost}</span>
                </button>
              ))}
              {!loading && query.length >= 2 && !parts.length ? (
                <p className="p-3 text-sm text-slate-500">No parts found</p>
              ) : null}
            </div>
            <label className="text-sm flex items-center gap-2">
              Quantity
              <input type="number" min={1} className="w-20 rounded border px-2 py-1" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            </label>
            <button type="button" disabled={saving} onClick={attachPart} className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">
              Attach part
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="Part name"
              value={requestForm.part_name}
              onChange={(e) => setRequestForm((f) => ({ ...f, part_name: e.target.value }))}
            />
            <select
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={requestForm.part_category}
              onChange={(e) => setRequestForm((f) => ({ ...f, part_category: e.target.value }))}
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              type="number"
              min={1}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="Quantity"
              value={requestForm.quantity}
              onChange={(e) => setRequestForm((f) => ({ ...f, quantity: e.target.value }))}
            />
            <textarea
              className="w-full rounded-lg border px-3 py-2 text-sm min-h-[60px]"
              placeholder="Notes"
              value={requestForm.notes}
              onChange={(e) => setRequestForm((f) => ({ ...f, notes: e.target.value }))}
            />
            <button type="button" disabled={saving} onClick={raiseRequest} className="w-full py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold">
              Raise procurement request
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
