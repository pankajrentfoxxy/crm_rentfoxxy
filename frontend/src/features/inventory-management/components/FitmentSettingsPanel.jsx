import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';

const STAGES = [
  {
    value: 'filter',
    label: 'Filter',
    copy: 'Hide unfit units by default; warehouse can still show all and retag.',
  },
  {
    value: 'warn',
    label: 'Warn',
    copy: 'Show unfit units with a warning; approval still allowed.',
  },
  {
    value: 'block',
    label: 'Block',
    copy: 'Block approving an unfit unit until it is retagged.',
  },
];

/**
 * Minimal admin control for parts_fitment_enforcement.
 * Calls GET/PUT /api/parts/fitment-settings (backend to match).
 */
export default function FitmentSettingsPanel() {
  const [stage, setStage] = useState('filter');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/parts/fitment-settings');
      const v = data?.enforcement || data?.stage || data?.value || data?.parts_fitment_enforcement || 'filter';
      setStage(STAGES.some((s) => s.value === v) ? v : 'filter');
    } catch {
      setStage('filter');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (next) => {
    setSaving(true);
    try {
      await api.put('/parts/fitment-settings', { enforcement: next });
      setStage(next);
      toast.success('Fitment enforcement updated');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save fitment setting');
    } finally {
      setSaving(false);
    }
  };

  const meta = STAGES.find((s) => s.value === stage) || STAGES[0];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-2 mb-3">
        <Shield className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-sm font-semibold text-slate-900 m-0">Part fitment enforcement</h3>
          <p className="text-xs text-slate-500 m-0 mt-0.5">
            Controls how warehouse approval treats units that do not fit the laptop.
          </p>
        </div>
      </div>
      {loading ? (
        <p className="text-xs text-slate-500 flex items-center gap-1.5 m-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </p>
      ) : (
        <>
          <label className="block text-sm">
            <span className="text-xs text-slate-500">Mode</span>
            <select
              className="mt-1 w-full max-w-xs border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              value={stage}
              disabled={saving}
              onChange={(e) => save(e.target.value)}
            >
              {STAGES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <p className="text-[11px] text-slate-500 mt-2 m-0">{meta.copy}</p>
        </>
      )}
    </div>
  );
}
