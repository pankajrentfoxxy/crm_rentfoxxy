import React, { useMemo } from 'react';
import { Mono } from '../../../../components/ui/supportPrimitives';

export default function StepMachines({ state, setState, assets }) {
  const site = (state.contextSites || []).find((s) => s.customer_address_id === state.site_id);
  const pin = site?.pincode ? String(site.pincode) : '';
  const rows = useMemo(() => {
    if (!pin) return assets;
    const matched = assets.filter((a) => a.pincode && String(a.pincode) === pin);
    return matched.length ? matched : assets;
  }, [assets, pin]);

  const selected = new Set(state.selectedSerials);
  const toggle = (id) => {
    setState((s) => {
      const next = new Set(s.selectedSerials);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...s, selectedSerials: [...next] };
    });
  };
  const selectAll = () => setState((s) => ({ ...s, selectedSerials: rows.map((a) => a.serial_id) }));

  return (
    <div className="bg-white rounded-[10px] border border-sup-lineSoft overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between gap-2 border-b border-sup-lineSoft">
        <button type="button" className="text-[12px] text-sup-accent underline" onClick={selectAll}>
          Select all at this site
        </button>
        <label className="text-[12px] flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={state.unknownAsset}
            onChange={(e) => setState((s) => ({ ...s, unknownAsset: e.target.checked }))}
          />
          Unknown asset
        </label>
      </div>
      <div className="overflow-auto max-h-[420px]">
        <table className="w-full text-[12px]">
          <thead className="bg-sup-canvas2 text-sup-muted">
            <tr>
              <th className="w-8" />
              <th className="text-left px-2 py-1.5">TTSPL / serial</th>
              <th className="text-left px-2 py-1.5">Model</th>
              <th className="text-left px-2 py-1.5">Assigned</th>
              <th className="text-left px-2 py-1.5">Deployed</th>
              <th className="text-left px-2 py-1.5">History</th>
              <th className="text-left px-2 py-1.5">Warranty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const hot = Number(a.complaint_count_90d) >= 3;
              return (
                <tr key={a.serial_id} className="border-t border-sup-lineSoft">
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={selected.has(a.serial_id)} onChange={() => toggle(a.serial_id)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Mono bold>{a.ttspl_id || '—'}</Mono>
                    <div className="text-sup-muted"><Mono>{a.serial_number}</Mono></div>
                  </td>
                  <td className="px-2 py-1.5">{[a.brand, a.model].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-2 py-1.5">{a.assigned_employee || '—'}</td>
                  <td className="px-2 py-1.5">{a.delivered_at ? String(a.delivered_at).slice(0, 10) : '—'}</td>
                  <td className={`px-2 py-1.5 ${hot ? 'text-pri1 font-semibold' : ''}`}>
                    {a.complaint_count_90d} complaints · 90 d
                    {hot ? <div className="text-[11px]">Consider replacement</div> : null}
                  </td>
                  <td className="px-2 py-1.5">{a.warranty_status || '—'}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-sup-muted">No deployed machines for this customer.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function machinesStepValid(state) {
  return state.unknownAsset || (state.selectedSerials || []).length > 0;
}
