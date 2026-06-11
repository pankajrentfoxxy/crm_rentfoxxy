import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { updateTicketConfig } from '../floorPipelineApi';

const FIELDS = [
  { key: 'processor', label: 'Processor' },
  { key: 'ram', label: 'RAM' },
  { key: 'storage', label: 'Storage' },
  { key: 'gpu', label: 'GPU' },
  { key: 'screen_size', label: 'Screen Size' },
  { key: 'os', label: 'OS' }
];

export default function ConfigUpdateModal({ open, onClose, ticket, extra = {}, onSaved }) {
  const [form, setForm] = useState({});
  const [changeType, setChangeType] = useState('correction');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !ticket) return;
    setForm({
      processor: ticket.processor || extra.processor || '',
      ram: ticket.ram || extra.ram || '',
      storage: ticket.storage || extra.storage || '',
      gpu: extra.gpu || '',
      screen_size: extra.screen_size || '',
      os: extra.os || ''
    });
    setNotes('');
    setChangeType('correction');
  }, [open, ticket, extra]);

  if (!open) return null;

  const diffs = FIELDS.filter((f) => {
    const orig = f.key === 'processor' || f.key === 'ram' || f.key === 'storage'
      ? (ticket[f.key] || extra[f.key] || '')
      : (extra[f.key] || '');
    return String(form[f.key] || '').trim() !== String(orig).trim();
  });

  const handleSave = async () => {
    if (!notes.trim()) {
      toast.error('Notes are required');
      return;
    }
    setSaving(true);
    try {
      const { data } = await updateTicketConfig(ticket.ticket_id, {
        ...form,
        change_type: changeType,
        notes: notes.trim()
      });
      if (data.success) {
        toast.success('Configuration updated');
        onSaved?.(data);
        onClose();
      } else {
        toast.error(data.message || 'Update failed');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-lg rounded-xl border border-gray-100 bg-white shadow-xl p-5 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-slate-900">Update laptop config</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <label key={f.key} className="text-sm">
              <span className="text-xs font-medium text-slate-600">{f.label}</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={form[f.key] || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <label className="block text-sm">
          <span className="text-xs font-medium text-slate-600">Change type</span>
          <select
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={changeType}
            onChange={(e) => setChangeType(e.target.value)}
          >
            <option value="upgrade">Upgrade</option>
            <option value="replacement">Replacement</option>
            <option value="correction">Correction</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs font-medium text-slate-600">Notes *</span>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm min-h-[80px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {diffs.length ? (
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900">
            <p className="font-medium mb-1">Changes preview:</p>
            {diffs.map((f) => {
              const before = ticket[f.key] || extra[f.key] || '—';
              return (
                <p key={f.key}>{f.label}: {before} → <strong>{form[f.key]}</strong></p>
              );
            })}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border">Cancel</button>
          <button
            type="button"
            disabled={saving || !diffs.length}
            onClick={handleSave}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save config'}
          </button>
        </div>
      </div>
    </div>
  );
}
