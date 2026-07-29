import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Laptop, Loader2, Printer, X } from 'lucide-react';
import { fetchPartsDrilldown } from '../partTrackingApi';
import { partCategoryLabel } from '../../../constants/laptopConditions';
import PartLabelPrintModal from './PartLabelPrintModal';

const METRIC_TITLES = {
  received: 'Parts received',
  installed: 'Parts installed on laptops',
  installed_upgrade: 'Upgrades installed',
  installed_replacement: 'Replacements installed',
  returned_defective: 'Defective parts returned',
  returned_good: 'Reusable parts returned',
  reserved: 'Parts reserved',
  discarded: 'Parts written off',
};

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function money(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/**
 * Slide-over listing the individual units behind a dashboard number, with the
 * laptop each one went into.
 */
export default function PartsDrilldownPanel({ query, onClose }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [labelsOpen, setLabelsOpen] = useState(false);

  const open = Boolean(query);

  useEffect(() => {
    if (!query) return undefined;
    let alive = true;
    setLoading(true);
    fetchPartsDrilldown(query)
      .then(({ data }) => { if (alive) setRows(data.rows || []); })
      .catch((e) => {
        if (alive) {
          setRows([]);
          toast.error(e.response?.data?.message || 'Could not load the details');
        }
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [query]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const labelUnits = useMemo(
    () => rows.filter((r) => r.prt_id).map((r) => ({
      code: r.prt_id,
      title: r.part_name,
      subtitle: r.serial_number ? `Serial ${r.serial_number}` : 'No serial',
      poNumber: r.purchase_order_number || '',
    })),
    [rows]
  );

  const totalValue = rows.reduce((s, r) => s + (Number(r.unit_cost) || 0) * (Number(r.quantity) || 1), 0);

  if (!open) return null;

  const title = METRIC_TITLES[query.metric] || 'Part movements';
  const scope = [
    query.day ? `on ${query.day}` : `${query.from} to ${query.to}`,
    query.category ? partCategoryLabel(query.category) : null,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <div className="fixed inset-0 z-[110] flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
        <div className="relative w-full max-w-3xl h-full bg-white shadow-2xl flex flex-col">
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">{title}</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {scope} · {loading ? 'loading…' : `${rows.length} unit${rows.length === 1 ? '' : 's'}`}
                {!loading && totalValue > 0 ? ` · ${money(totalValue)}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {labelUnits.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setLabelsOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Printer className="w-4 h-4" /> Labels
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading units…
              </div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center">
                <Laptop className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                <p className="text-sm text-slate-400">Nothing recorded for this selection.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-semibold">Part ID</th>
                    <th className="px-4 py-2.5 font-semibold">Part</th>
                    <th className="px-4 py-2.5 font-semibold">Laptop</th>
                    <th className="px-4 py-2.5 font-semibold">When</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.movement_id} className="hover:bg-slate-50/70 align-top">
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-semibold text-slate-900 m-0">{r.prt_id || '—'}</p>
                        {r.serial_number ? (
                          <p className="text-[11px] text-slate-400 font-mono m-0">{r.serial_number}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-800 m-0">{r.part_name || '—'}</p>
                        <p className="text-[11px] text-slate-400 m-0">
                          {partCategoryLabel(r.category)}
                          {r.is_upgrade ? ' · upgrade' : ''}
                          {r.part_condition ? ` · ${r.part_condition}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {r.ttspl_id ? (
                          <>
                            <p className="font-mono text-xs font-semibold text-blue-700 m-0">{r.ttspl_id}</p>
                            <p className="text-[11px] text-slate-500 m-0">
                              {[r.laptop_brand, r.laptop_model].filter(Boolean).join(' ') || '—'}
                            </p>
                            {r.request_number ? (
                              <p className="text-[11px] text-slate-400 m-0">{r.request_number}</p>
                            ) : null}
                          </>
                        ) : r.purchase_order_number ? (
                          <p className="text-xs text-slate-500 m-0">{r.purchase_order_number}</p>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <p className="m-0">{formatDateTime(r.occurred_at)}</p>
                        {r.actor_name ? <p className="text-[11px] text-slate-400 m-0">{r.actor_name}</p> : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-800">
                        {money((Number(r.unit_cost) || 0) * (Number(r.quantity) || 1))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <PartLabelPrintModal
        open={labelsOpen}
        units={labelUnits}
        onClose={() => setLabelsOpen(false)}
        title="Reprint QR labels"
      />
    </>
  );
}
