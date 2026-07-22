import React, { useState } from 'react';
import { Eye, X } from 'lucide-react';
import { formatSoLineConfig, getOrderLines, getTotalQuantity } from '../dispatchSoConfigUtils';

function SoOrderLinesConfigModal({ lines, open, onClose }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50"
        aria-label="Close configuration dialog"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Laptop configuration{lines.length > 1 ? ` (${lines.length} lines)` : ''}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3">
          {lines.map((line, idx) => (
            <div key={line.line_id || idx} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Line {idx + 1}
                </p>
                <span className="text-xs font-medium text-slate-600">
                  Qty {line.quantity ?? '—'}
                </span>
              </div>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {[line.brand, line.model_name].filter(Boolean).join(' ') || '—'}
              </p>
              <p className="mt-1 text-xs text-slate-600">{formatSoLineConfig(line)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SoOrderLinesConfigBlock({ row, compact = false }) {
  const [open, setOpen] = useState(false);
  const lines = getOrderLines(row);
  const first = lines[0];
  const totalQty = getTotalQuantity(lines);

  if (!first) {
    return <span className="text-slate-400">—</span>;
  }

  const viewLabel = lines.length > 1 ? `View all (${lines.length})` : 'View';

  if (compact) {
    return (
      <>
        <div className="space-y-1">
          <p className="text-xs text-slate-700 line-clamp-2" title={formatSoLineConfig(first)}>
            {formatSoLineConfig(first)}
          </p>
          {lines.length > 1 ? (
            <p className="text-[11px] text-slate-500">+{lines.length - 1} more line{lines.length - 1 === 1 ? '' : 's'}</p>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 hover:underline"
          >
            <Eye className="w-3 h-3" />
            {viewLabel}
          </button>
        </div>
        <SoOrderLinesConfigModal lines={lines} open={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  return (
    <>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-slate-900">{formatSoLineConfig(first)}</p>
        <p className="text-xs text-slate-500">
          {lines.length > 1
            ? `Line 1 of ${lines.length} · total qty ${totalQty || first.quantity || '—'}`
            : `Qty ${first.quantity ?? '—'}`}
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100"
        >
          <Eye className="w-3.5 h-3.5" />
          {viewLabel}
        </button>
      </div>
      <SoOrderLinesConfigModal lines={lines} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
