import React, { useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';

export default function BodyPaintPanel({ ticketId, onUpdated }) {
  const [form, setForm] = useState({ damage_areas: '', paint_color: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/tickets/${ticketId}/notes`, {
        notes: `Body & Paint: ${form.damage_areas} | Color: ${form.paint_color} | ${form.notes}`
      });
      toast.success('Body & paint notes saved');
      onUpdated?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-pink-200 bg-pink-50/30 p-4 space-y-3">
      <h3 className="font-semibold text-pink-900">Body & Paint</h3>
      <input
        className="w-full rounded-lg border px-3 py-2 text-sm"
        placeholder="Damage areas (lid, bezel, hinge…)"
        value={form.damage_areas}
        onChange={(e) => setForm((f) => ({ ...f, damage_areas: e.target.value }))}
      />
      <input
        className="w-full rounded-lg border px-3 py-2 text-sm"
        placeholder="Paint / finish color"
        value={form.paint_color}
        onChange={(e) => setForm((f) => ({ ...f, paint_color: e.target.value }))}
      />
      <textarea
        className="w-full rounded-lg border px-3 py-2 text-sm min-h-[80px]"
        placeholder="Work notes"
        value={form.notes}
        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
      />
      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="px-4 py-2 rounded-lg bg-pink-600 text-white text-sm font-semibold"
      >
        Save body & paint notes
      </button>
    </div>
  );
}
