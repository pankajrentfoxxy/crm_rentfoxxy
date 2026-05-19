import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '../../utils/api';

export default function SupportSettings() {
  const [settings, setSettings] = useState(null);
  const [categories, setCategories] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [newCategory, setNewCategory] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [settingsRes, categoriesRes, techRes] = await Promise.all([
      api.get('/support/settings'),
      api.get('/support/categories'),
      api.get('/support/technicians')
    ]);
    setSettings(settingsRes.data.settings || {});
    setCategories(categoriesRes.data.categories || []);
    setTechnicians(techRes.data.technicians || []);
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/support/settings', settings);
      setSettings(data.settings);
    } finally {
      setSaving(false);
    }
  };

  const addCategory = async () => {
    if (!newCategory.trim()) return;
    const { data } = await api.post('/support/categories', { name: newCategory.trim() });
    setCategories(data.categories || []);
    setNewCategory('');
  };

  const removeCategory = async (id) => {
    const { data } = await api.delete(`/support/categories/${id}`);
    setCategories(data.categories || []);
  };

  if (!settings) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-[#534AB7]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h2 className="font-semibold">Ticket rules</h2>
        <label className="flex items-center gap-2 min-h-[44px]">
          <input
            type="checkbox"
            checked={!!settings.auto_close_enabled}
            onChange={(e) => setSettings((s) => ({ ...s, auto_close_enabled: e.target.checked }))}
          />
          Auto-close ticket when all items are resolved
        </label>
        <label className="block text-sm">
          Overdue threshold (hours)
          <input
            type="number"
            min={1}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-3 min-h-[44px] text-base"
            value={settings.overdue_threshold_hours || 48}
            onChange={(e) => setSettings((s) => ({ ...s, overdue_threshold_hours: Number(e.target.value) }))}
          />
        </label>
        <button type="button" className="support-btn-primary" disabled={saving} onClick={saveSettings}>
          Save settings
        </button>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h2 className="font-semibold">Issue categories</h2>
        <ul className="space-y-2">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 border border-slate-100 rounded-lg px-3 py-2">
              <span>{c.name}</span>
              <button type="button" className="text-sm text-red-700 min-h-[44px] px-2" onClick={() => removeCategory(c.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="New category"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-3 min-h-[44px] text-base"
          />
          <button type="button" className="support-btn-outline" onClick={addCategory}>Add</button>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h2 className="font-semibold">Technician accounts</h2>
        <p className="text-sm text-slate-500">Create or deactivate accounts from the Teams module.</p>
        <ul className="space-y-2">
          {technicians.map((t) => (
            <li key={t.user_id} className="flex justify-between gap-2 border border-slate-100 rounded-lg px-3 py-2 text-sm">
              <span>{t.name}</span>
              <span className="text-slate-500">{t.active ? 'Active' : 'Inactive'} · {t.open_ticket_count || 0} open</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 opacity-70">
        <h2 className="font-semibold">OTP settings</h2>
        <label className="flex items-center gap-2 min-h-[44px]">
          <input type="checkbox" disabled checked={false} readOnly />
          MSR91 SMS integration — Coming in Phase 2
        </label>
      </section>
    </div>
  );
}
