import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, EmptyState, PageHeader } from '../../../components/ui/supportPrimitives';
import usePermission from '../../../hooks/usePermission';
import { fetchSupportSettings, patchSupportSettings, patchSupportTemplate } from '../supportV2Api';

const FIELDS = [
  { group: 'SLA', key: 'auto_close_hours', label: 'Auto-close hours' },
  { group: 'SLA', key: 'reopen_window_days', label: 'Reopen window (days)' },
  { group: 'SLA', key: 'csat_token_days', label: 'CSAT token days' },
  { group: 'Repair', key: 'free_repair_days', label: 'Free repair days' },
  { group: 'Repair', key: 'max_repair_days', label: 'Max repair days' },
  { group: 'Field', key: 'max_jobs_per_day', label: 'Default max jobs / day' },
  { group: 'Field', key: 'accept_window_minutes', label: 'Accept window (minutes)' },
  { group: 'Field', key: 'photo_min_count', label: 'Photo minimum' },
  { group: 'Parts', key: 'parts_lead_threshold', label: 'Lead approval threshold (₹)' },
  { group: 'Parts', key: 'parts_manager_threshold', label: 'Manager approval threshold (₹)' },
];

export default function SettingsPage() {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('support_settings', 'edit');
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    fetchSupportSettings()
      .then((r) => {
        setData(r.data);
        setForm(r.data.settings || {});
      })
      .catch((e) => toast.error(e.response?.data?.message || 'Failed to load settings'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true);
    try {
      const patch = {};
      for (const f of FIELDS) patch[f.key] = Number(form[f.key]);
      if (form.escalation_thresholds) patch.escalation_thresholds = form.escalation_thresholds;
      if (form.portal) patch.portal = form.portal;
      const r = await patchSupportSettings({ settings: patch });
      setData((d) => ({ ...d, settings: r.data.settings, groups: r.data.groups }));
      setForm(r.data.settings);
      toast.success('Settings saved — next invoice / approval uses these values');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleTemplate(row) {
    try {
      const r = await patchSupportTemplate(row.template_id, { active: !row.active });
      setData((d) => ({
        ...d,
        templates: (d.templates || []).map((t) => (t.template_id === row.template_id ? r.data.template : t)),
      }));
    } catch (e) {
      toast.error(e.response?.data?.message || 'Template update failed');
    }
  }

  if (loading) return <div className="p-6 text-[12.5px] text-sup-muted">Loading settings…</div>;
  if (!data) return <EmptyState title="Settings unavailable" hint="support_settings · view" />;

  const groups = [...new Set(FIELDS.map((f) => f.group))];

  return (
    <div className="p-4 md:p-6 max-w-[900px] mx-auto space-y-4">
      <PageHeader
        title="Settings"
        subtitle="S19 · stored in support_settings_v2. No deploy required."
        actions={canEdit ? <Button size="sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button> : null}
      />

      {groups.map((g) => (
        <div key={g} className="bg-white rounded-[10px] border border-sup-lineSoft shadow-sup p-4 space-y-2">
          <div className="text-[13px] font-semibold text-sup-ink">{g}</div>
          {FIELDS.filter((f) => f.group === g).map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-3 text-[12.5px]">
              <span>{f.label}</span>
              <input
                type="number"
                disabled={!canEdit}
                value={form[f.key] ?? ''}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                className="w-28 h-9 rounded-lg border border-sup-line px-2 font-mono text-right"
              />
            </label>
          ))}
        </div>
      ))}

      <div className="bg-white rounded-[10px] border border-sup-lineSoft shadow-sup p-4">
        <div className="text-[13px] font-semibold mb-2">Notifications</div>
        {(data.templates || []).map((t) => (
          <div key={t.template_id} className="flex items-center justify-between gap-2 py-1.5 border-t border-sup-lineSoft text-[12.5px]">
            <div>
              <div className="font-semibold">{t.event_code}</div>
              <div className="text-sup-muted">{t.channel} · {t.audience}</div>
            </div>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => toggleTemplate(t)}
              className={`h-8 px-3 rounded-full text-[11px] font-semibold ${t.active ? 'bg-sup-ok text-white' : 'bg-sup-canvas2 text-sup-muted'}`}
            >
              {t.active ? 'On' : 'Off'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
