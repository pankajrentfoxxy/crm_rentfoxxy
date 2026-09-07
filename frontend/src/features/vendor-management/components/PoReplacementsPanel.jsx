import React from 'react';

export default function PoReplacementsPanel({ replacements, className = '' }) {
  const rows = Array.isArray(replacements) ? replacements.filter(Boolean) : [];
  if (!rows.length) return null;

  return (
    <div className={`rounded-xl border border-violet-200 bg-violet-50/50 overflow-hidden ${className}`.trim()}>
      <div className="px-4 py-3 border-b border-violet-100">
        <p className="text-sm font-semibold text-slate-900">Vendor repair replacements</p>
        <p className="text-xs text-slate-600 mt-0.5">
          These units replaced a laptop already received on this PO. They do not add to received quantity.
        </p>
      </div>
      <ul className="divide-y divide-violet-100 bg-white">
        {rows.map((r, idx) => {
          const oldTtspl = r.replaced_ttspl_id || r.replaced_ttspl || '—';
          const newTtspl = r.ttspl_id || r.inventory_asset_code || '—';
          const label = r.label || `${oldTtspl} → ${newTtspl}`;
          return (
            <li key={r.serial_id || `${newTtspl}-${idx}`} className="px-4 py-2.5 flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 font-mono text-xs sm:text-sm font-semibold text-slate-800">
                <span className="text-slate-500">{oldTtspl}</span>
                <span className="text-violet-500" aria-hidden>→</span>
                <span className="text-violet-800">{newTtspl}</span>
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-violet-100 text-violet-800">
                Replacement
              </span>
              {r.serial_number ? (
                <span className="text-xs font-mono text-slate-500">S/N {r.serial_number}</span>
              ) : null}
              {r.replaced_serial ? (
                <span className="text-xs text-slate-500">was {r.replaced_serial}</span>
              ) : null}
              {[r.brand, r.model].filter(Boolean).length ? (
                <span className="text-xs text-slate-600">{[r.brand, r.model].filter(Boolean).join(' ')}</span>
              ) : null}
              <span className="sr-only">{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
