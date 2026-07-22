import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckSquare, Square } from 'lucide-react';
import { getProductionAssetByTicket, saveQc1SpecChecklist } from '../floorPipelineApi';

const FIELDS = [
  { key: 'brand', label: 'Brand' },
  { key: 'model', label: 'Model' },
  { key: 'processor', label: 'Processor' },
  { key: 'generation', label: 'Generation' },
  { key: 'ram', label: 'RAM' },
  { key: 'ssd', label: 'SSD' },
];

/**
 * QC1 specification checklist — values from Production Asset (fallback: ticket).
 * All six must be ticked before QC1 can advance.
 */
export default function Qc1SpecChecklist({ ticket, onReadyChange, onHeaderSync }) {
  const [loading, setLoading] = useState(true);
  const [paId, setPaId] = useState(null);
  const [config, setConfig] = useState({});
  const [checked, setChecked] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await getProductionAssetByTicket(ticket.ticket_id);
        if (cancelled) return;
        const cfg = data?.config || {};
        const merged = {
          brand: cfg.brand || ticket.brand || '',
          model: cfg.model || ticket.model || '',
          processor: cfg.processor || ticket.processor || '',
          generation: cfg.generation || '',
          ram: cfg.ram || ticket.ram || '',
          ssd: cfg.ssd || cfg.storage || ticket.storage || '',
        };
        setConfig(merged);
        setPaId(cfg.production_asset_id || data?.production_asset?.production_asset_id || null);
        const prior = cfg.qc1_checklist?.fields || {};
        setChecked(prior);
        onHeaderSync?.({
          processor: merged.processor,
          generation: merged.generation,
          storage_type: merged.ssd,
          ram_size: merged.ram,
        });
      } catch {
        if (cancelled) return;
        const merged = {
          brand: ticket.brand || '',
          model: ticket.model || '',
          processor: ticket.processor || '',
          generation: '',
          ram: ticket.ram || '',
          ssd: ticket.storage || '',
        };
        setConfig(merged);
        onHeaderSync?.(merged);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ticket.ticket_id]);

  const allChecked = useMemo(
    () => FIELDS.every((f) => !!checked[f.key]),
    [checked]
  );

  useEffect(() => {
    onReadyChange?.(allChecked);
  }, [allChecked, onReadyChange]);

  const toggle = async (key) => {
    const next = { ...checked, [key]: !checked[key] };
    setChecked(next);
    if (!paId) return;
    setSaving(true);
    try {
      await saveQc1SpecChecklist(paId, {
        fields: next,
        all_checked: FIELDS.every((f) => !!next[f.key]),
      });
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to save checklist');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-slate-500 p-4">Loading specification checklist…</div>;
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h3 className="text-xl font-bold mb-1 flex items-center gap-2">
        <span className="text-red-600">*</span> Specification Checklist
      </h3>
      <p className="text-xs text-slate-500 mb-4">
        Verify each field against the physical laptop (from Production Asset). All must be checked to pass QC1.
        {saving ? ' Saving…' : ''}
      </p>
      <ul className="space-y-2">
        {FIELDS.map((f) => {
          const on = !!checked[f.key];
          return (
            <li key={f.key}>
              <button
                type="button"
                onClick={() => toggle(f.key)}
                className={`w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  on ? 'border-green-300 bg-green-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                {on
                  ? <CheckSquare className="w-5 h-5 text-green-600 shrink-0" />
                  : <Square className="w-5 h-5 text-slate-400 shrink-0" />}
                <span className="font-medium text-slate-700 w-28 shrink-0">{f.label}</span>
                <span className="text-slate-900 truncate">{config[f.key] || '—'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {!allChecked && (
        <p className="mt-3 text-xs text-amber-700">Check all six specifications before submitting QC1 Pass.</p>
      )}
    </div>
  );
}
