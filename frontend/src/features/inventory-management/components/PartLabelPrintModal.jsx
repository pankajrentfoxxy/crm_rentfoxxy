import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import QRCode from 'qrcode';
import { Info, Loader2, Minus, Plus, Printer, QrCode, X } from 'lucide-react';
import { buildPartLabelsPdf } from '../partTrackingApi';

const SIZE_OPTIONS = [
  { value: 10, label: '10 × 10 mm' },
  { value: 12, label: '12 × 12 mm' },
  { value: 15, label: '15 × 15 mm' },
  { value: 20, label: '20 × 20 mm' },
];

/** Height added under the QR when the PO number is printed as text. */
const CAPTION_MM = 4;
/** Matches the floor the PDF renderer will not shrink text below. */
const MIN_CAPTION_PT = 3;

/**
 * Width of `text` in points at 1 pt, using the same bold face the PDF uses, so
 * we can tell the operator up front when a PO number will not fit the sticker
 * rather than quietly printing a truncated one.
 */
let measureCtx = null;
function textWidthPerPt(text) {
  if (!measureCtx) {
    const canvas = document.createElement('canvas');
    measureCtx = canvas.getContext('2d');
  }
  if (!measureCtx) return String(text).length * 0.6;
  measureCtx.font = 'bold 100px Helvetica, Arial, sans-serif';
  return measureCtx.measureText(String(text)).width / 100;
}

function captionFits(caption, sizeMm) {
  if (!caption) return true;
  const usableMm = sizeMm - Math.min(0.3, sizeMm * 0.03) * 2;
  const usablePt = (usableMm / 25.4) * 72;
  return textWidthPerPt(caption) * MIN_CAPTION_PT <= usablePt;
}

/** The PO travels in the QR after a slash; the scanner strips it back off. */
function encodedFor(unit, includePo) {
  const code = String(unit?.code || '').trim();
  const po = String(unit?.poNumber || '').trim();
  return includePo && po ? `${code}/${po}` : code;
}

/**
 * Module count of the symbol we are about to print, so the operator can see the
 * density cost of adding the PO before they commit a roll of labels to it.
 */
function symbolInfo(text, sizeMm) {
  try {
    const qr = QRCode.create(String(text), { errorCorrectionLevel: 'M' });
    const modules = qr.modules.size + 8; // includes the 4-module quiet zone
    const moduleMm = sizeMm / modules;
    return {
      version: qr.version,
      modules,
      moduleMm,
      dots300: (moduleMm / 25.4) * 300,
    };
  } catch {
    return null;
  }
}

/** Same settings the server uses, so the preview matches the printed sticker. */
function useQrPreviews(payloads) {
  const [previews, setPreviews] = useState({});
  const key = payloads.join('\u0001');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = {};
      for (const text of payloads) {
        try {
          next[text] = await QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 4, width: 200 });
        } catch {
          next[text] = null;
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
 * `units` is [{ code, title, subtitle, poNumber }]. The QR always carries the
 * Part ID; scanning it resolves the serial, specs, PO and vendor from the
 * system so nothing on the sticker can go stale. The PO can additionally be
 * carried in the symbol, printed as readable text under it, or both.
 */
export default function PartLabelPrintModal({ open, units = [], onClose, defaultCopies = 2, title = 'Print QR labels' }) {
  const [copies, setCopies] = useState({});
  const [sizeMm, setSizeMm] = useState(10);
  const [poInQr, setPoInQr] = useState(false);
  const [poUnderQr, setPoUnderQr] = useState(true);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () => units
      .map((u) => ({
        code: String(u?.code || '').trim(),
        title: u?.title || '',
        subtitle: u?.subtitle || '',
        poNumber: String(u?.poNumber || '').trim(),
      }))
      .filter((u) => u.code),
    [units]
  );

  const anyPo = rows.some((u) => u.poNumber);
  const usePoInQr = poInQr && anyPo;
  const usePoUnderQr = poUnderQr && anyPo;
  const captionMm = usePoUnderQr ? CAPTION_MM : 0;

  const payloads = useMemo(
    () => rows.map((u) => encodedFor(u, usePoInQr)),
    [rows, usePoInQr]
  );
  const previews = useQrPreviews(open ? payloads : []);

  useEffect(() => {
    if (!open) return;
    setCopies(Object.fromEntries(rows.map((u) => [u.code, defaultCopies])));
  }, [open, rows, defaultCopies]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  const totalLabels = rows.reduce((sum, u) => sum + (Number(copies[u.code]) || 0), 0);

  // Worst case across the batch, since one roll prints them all.
  const density = useMemo(() => {
    if (!payloads.length) return null;
    const longest = payloads.reduce((a, b) => (b.length > a.length ? b : a), payloads[0]);
    return symbolInfo(longest, sizeMm);
  }, [payloads, sizeMm]);

  const overlongPo = useMemo(() => {
    if (!usePoUnderQr) return null;
    return rows.find((u) => u.poNumber && !captionFits(u.poNumber, sizeMm))?.poNumber || null;
  }, [rows, usePoUnderQr, sizeMm]);

  function setCopiesFor(code, value) {
    const n = Math.max(0, Math.min(50, Number(value) || 0));
    setCopies((prev) => ({ ...prev, [code]: n }));
  }

  function setAllCopies(value) {
    const n = Math.max(0, Math.min(50, Number(value) || 0));
    setCopies(Object.fromEntries(rows.map((u) => [u.code, n])));
  }

  async function handlePrint() {
    const labels = rows
      .map((u) => ({
        code: encodedFor(u, usePoInQr),
        caption: usePoUnderQr ? u.poNumber : '',
        copies: Number(copies[u.code]) || 0,
      }))
      .filter((l) => l.copies > 0);
    if (!labels.length) {
      toast.error('Set at least one copy to print');
      return;
    }

    setBusy(true);
    try {
      const { data } = await buildPartLabelsPdf(labels, {
        widthMm: sizeMm,
        heightMm: sizeMm + captionMm,
        captionMm,
      });
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

  const labelDims = `${sizeMm} × ${sizeMm + captionMm} mm`;

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
                {rows.length} unit{rows.length === 1 ? '' : 's'} · {totalLabels} sticker{totalLabels === 1 ? '' : 's'} · {labelDims}
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

          {anyPo ? (
            <fieldset className="rounded-xl border border-slate-200 p-3.5 space-y-2.5">
              <legend className="px-1.5 text-xs font-semibold text-slate-600">Purchase order on the label</legend>

              <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={poUnderQr}
                  disabled={busy}
                  onChange={(e) => setPoUnderQr(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-slate-800">Print the PO number under the QR</span>
                  <span className="block text-[11px] text-slate-500">
                    Readable without a scanner. Adds {CAPTION_MM} mm of height and leaves the QR at full size.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={poInQr}
                  disabled={busy}
                  onChange={(e) => setPoInQr(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-slate-800">Include the PO number inside the QR</span>
                  <span className="block text-[11px] text-slate-500">
                    A phone camera outside the CRM then shows the PO too — at the cost of a denser symbol.
                  </span>
                </span>
              </label>

              {overlongPo ? (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 m-0 flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    &ldquo;{overlongPo}&rdquo; is too long to print legibly on a {sizeMm} mm sticker and would be
                    cut short. Pick a 12 mm or wider sticker, or leave the PO to the QR only.
                  </span>
                </p>
              ) : null}

              {density ? (
                <p className={`text-[11px] m-0 flex items-start gap-1.5 rounded-lg px-2.5 py-2 ${
                  density.dots300 >= 3.4
                    ? 'text-slate-600 bg-slate-50'
                    : 'text-amber-800 bg-amber-50 border border-amber-200'
                }`}>
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    Version {density.version} symbol, {density.modules} modules across {sizeMm} mm
                    — {density.moduleMm.toFixed(3)} mm per module ({density.dots300.toFixed(1)} dots on a 300 dpi printer).
                    {density.dots300 < 3.4
                      ? ' That is tight for a 203 dpi printer; use a 12 mm sticker or turn off the PO inside the QR.'
                      : ''}
                  </span>
                </p>
              ) : null}
            </fieldset>
          ) : null}

          <p className="text-[11px] text-slate-500 m-0 leading-relaxed">
            Scanning a sticker pulls the serial, part details, PO and vendor from the system, so the code stays
            small enough to read at {sizeMm} mm and the details never go stale. Stick two on each part so a
            damaged label does not lose the unit.
          </p>

          <div className="max-h-[min(24rem,calc(100vh-24rem))] overflow-y-auto rounded-xl border border-slate-100 divide-y divide-slate-100">
            {rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">No units to label.</p>
            ) : rows.map((u) => {
              const payload = encodedFor(u, usePoInQr);
              return (
                <div key={u.code} className="flex items-center gap-3 px-3 py-2.5">
                  <div
                    className="shrink-0 rounded-lg border border-slate-200 bg-white flex flex-col items-center justify-center overflow-hidden p-0.5"
                    style={{ width: 48, height: 48 + (usePoUnderQr && u.poNumber ? 10 : 0) }}
                  >
                    {previews[payload]
                      ? <img src={previews[payload]} alt={`QR for ${u.code}`} className="w-full flex-1 object-contain min-h-0" />
                      : <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                    {usePoUnderQr && u.poNumber ? (
                      <span className="block w-full text-center font-bold text-slate-900 leading-none truncate" style={{ fontSize: 5 }}>
                        {u.poNumber}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono font-semibold text-slate-900 truncate m-0">{u.code}</p>
                    {u.title ? <p className="text-xs text-slate-600 truncate m-0">{u.title}</p> : null}
                    <p className="text-[11px] text-slate-400 truncate m-0">
                      {u.subtitle}
                      {u.poNumber ? `${u.subtitle ? ' · ' : ''}${u.poNumber}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setCopiesFor(u.code, (Number(copies[u.code]) || 0) - 1)}
                      className="w-9 h-9 grid place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                      aria-label={`One less copy of ${u.code}`}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={copies[u.code] ?? 0}
                      disabled={busy}
                      onChange={(e) => setCopiesFor(u.code, e.target.value)}
                      className="w-14 text-center border border-slate-200 rounded-lg px-1 py-2 text-sm tabular-nums"
                      aria-label={`Copies of ${u.code}`}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setCopiesFor(u.code, (Number(copies[u.code]) || 0) + 1)}
                      className="w-9 h-9 grid place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                      aria-label={`One more copy of ${u.code}`}
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
