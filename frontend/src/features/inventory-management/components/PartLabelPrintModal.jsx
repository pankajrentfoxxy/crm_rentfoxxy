import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import QRCode from 'qrcode';
import { Loader2, Minus, Plus, Printer, QrCode, X } from 'lucide-react';
import { buildPartLabelsPdf } from '../partTrackingApi';

const SIZE_OPTIONS = [
  { value: 10, label: '10 × 10 mm' },
  { value: 12, label: '12 × 12 mm' },
  { value: 15, label: '15 × 15 mm' },
  { value: 20, label: '20 × 20 mm' },
];

/** Same settings the server uses, so the preview matches the printed sticker. */
function useQrPreviews(codes) {
  const [previews, setPreviews] = useState({});
  const key = codes.join('|');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = {};
      for (const code of codes) {
        try {
          next[code] = await QRCode.toDataURL(code, { errorCorrectionLevel: 'M', margin: 4, width: 200 });
        } catch {
          next[code] = null;
        }
      }
      if (!cancelled) setPreviews(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return previews;
}

/**
 * Print QR stickers for physical part units.
 *
 * `units` is [{ code, title, subtitle }]. Each sticker carries only the Part ID
 * — scanning it looks the rest up, which keeps the symbol small enough to read
 * at 10 mm. Two copies per unit is the default so a lost sticker is not a lost
 * part.
 */
export default function PartLabelPrintModal({ open, units = [], onClose, defaultCopies = 2, title = 'Print QR labels' }) {
  const [copies, setCopies] = useState({});
  const [sizeMm, setSizeMm] = useState(10);
  const [busy, setBusy] = useState(false);

  const codes = useMemo(
    () => units.map((u) => String(u?.code || '').trim()).filter(Boolean),
    [units]
  );
  const previews = useQrPreviews(open ? codes : []);

  useEffect(() => {
    if (!open) return;
    setCopies(Object.fromEntries(codes.map((c) => [c, defaultCopies])));
  }, [open, codes, defaultCopies]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  const totalLabels = codes.reduce((sum, c) => sum + (Number(copies[c]) || 0), 0);

  function setCopiesFor(code, value) {
    const n = Math.max(0, Math.min(50, Number(value) || 0));
    setCopies((prev) => ({ ...prev, [code]: n }));
  }

  function setAllCopies(value) {
    const n = Math.max(0, Math.min(50, Number(value) || 0));
    setCopies(Object.fromEntries(codes.map((c) => [c, n])));
  }

  async function handlePrint() {
    const labels = codes
      .map((code) => ({ code, copies: Number(copies[code]) || 0 }))
      .filter((l) => l.copies > 0);
    if (!labels.length) {
      toast.error('Set at least one copy to print');
      return;
    }

    setBusy(true);
    try {
      const { data } = await buildPartLabelsPdf(labels, sizeMm);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      const win = window.open(url, '_blank');
      if (!win) {
        // Popup blocked — fall back to a download so the job is not lost.
        const a = document.createElement('a');
        a.href = url;
        a.download = `part-labels-${Date.now()}.pdf`;
        a.click();
        toast.success(`${totalLabels} label(s) downloaded`);
      } else {
        toast.success(`${totalLabels} label(s) ready — use your label printer's print dialog`);
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not build the label sheet');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (!busy && e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-xl border border-slate-200 overflow-hidden my-8">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-teal-100 text-teal-700">
              <QrCode className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">{title}</h2>
              <p className="text-[11px] text-slate-500">
                {codes.length} unit{codes.length === 1 ? '' : 's'} · {totalLabels} sticker{totalLabels === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 min-h-[44px] min-w-[44px] grid place-items-center"
            onClick={() => !busy && onClose?.()}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="label-size">
                Sticker size
              </label>
              <select
                id="label-size"
                className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white"
                value={sizeMm}
                disabled={busy}
                onChange={(e) => setSizeMm(Number(e.target.value))}
              >
                {SIZE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <span className="block text-xs font-semibold text-slate-600 mb-1">Copies for every unit</span>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={busy}
                    onClick={() => setAllCopies(n)}
                    className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {n}×
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 m-0 leading-relaxed">
            Each sticker holds only the Part ID. Scanning it pulls the serial, part details, PO and vendor
            from the system, so the code stays small enough to read at {sizeMm} mm and the details never
            go stale. Stick two on each part so a damaged label does not lose the unit.
          </p>

          <div className="max-h-[min(24rem,calc(100vh-24rem))] overflow-y-auto rounded-xl border border-slate-100 divide-y divide-slate-100">
            {codes.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">No units to label.</p>
            ) : units.map((u) => {
              const code = String(u?.code || '').trim();
              if (!code) return null;
              return (
                <div key={code} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="w-12 h-12 shrink-0 rounded-lg border border-slate-200 bg-white grid place-items-center overflow-hidden">
                    {previews[code]
                      ? <img src={previews[code]} alt={`QR for ${code}`} className="w-full h-full object-contain" />
                      : <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono font-semibold text-slate-900 truncate m-0">{code}</p>
                    {u.title ? <p className="text-xs text-slate-600 truncate m-0">{u.title}</p> : null}
                    {u.subtitle ? <p className="text-[11px] text-slate-400 truncate m-0">{u.subtitle}</p> : null}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setCopiesFor(code, (Number(copies[code]) || 0) - 1)}
                      className="w-9 h-9 grid place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                      aria-label={`One less copy of ${code}`}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={copies[code] ?? 0}
                      disabled={busy}
                      onChange={(e) => setCopiesFor(code, e.target.value)}
                      className="w-14 text-center border border-slate-200 rounded-lg px-1 py-2 text-sm tabular-nums"
                      aria-label={`Copies of ${code}`}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setCopiesFor(code, (Number(copies[code]) || 0) + 1)}
                      className="w-9 h-9 grid place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                      aria-label={`One more copy of ${code}`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => onClose?.()}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 min-h-[44px]"
            >
              Close
            </button>
            <button
              type="button"
              disabled={busy || totalLabels === 0}
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold disabled:opacity-40 min-h-[44px]"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              Print {totalLabels || ''} label{totalLabels === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
