import React, { useEffect, useMemo, useRef, useState } from 'react';
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

/** Stickers per paper strip — 4 × 15 mm die-cuts with 3 mm gaps on a 71.6 × 15 mm row. */
const COLUMNS = 4;
const PAPER_WIDTH_MM = 71.6;
const PAPER_HEIGHT_MM = 15;
const LABEL_MM = 15;
const GAP_MM = 3;
const SIDE_MARGIN_MM = 1.3;
/** Serial/PO text band under each QR (within the 15 mm height). */
const CAPTION_MM = 3.2;

/** Human-readable line under the QR: serial preferred, else PO. */
function captionFor(unit, { showSerial, showPo }) {
  const serial = String(unit?.serialNumber || '').trim();
  const po = String(unit?.poNumber || '').trim();
  // Prefer serial when requested; fall back to PO so labels still show a number.
  if (showSerial && serial) return serial;
  if (showPo && po) return po;
  if (showSerial && po) return po;
  return '';    
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
 * carried in the symbol, printed as upright text under the QR, or both.
 */
function openPdfBlob(data, filename) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
  const win = window.open(url, '_blank');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { url, opened: false };
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { url, opened: true, win };
}

export default function PartLabelPrintModal({ open, units = [], onClose, defaultCopies = 4, title = 'Print QR labels' }) {
  const [copies, setCopies] = useState({});
  const [sizeMm, setSizeMm] = useState(15);
  const [poInQr, setPoInQr] = useState(false);
  const [showSerialOnLabel, setShowSerialOnLabel] = useState(true);
  const [showPoOnLabel, setShowPoOnLabel] = useState(true);
  const [busy, setBusy] = useState(false);
  /** Guided one-by-one queue: list of units still waiting, current index into original queue. */
  const [oneByOne, setOneByOne] = useState(null);
  const oneByOneBusy = useRef(false);

  const rows = useMemo(
    () => units
      .map((u) => ({
        code: String(u?.code || '').trim(),
        title: u?.title || '',
        subtitle: u?.subtitle || '',
        poNumber: String(u?.poNumber || '').trim(),
        serialNumber: String(u?.serialNumber || '').trim(),
      }))
      .filter((u) => u.code),
    [units]
  );

  const anyPo = rows.some((u) => u.poNumber);
  const anySerial = rows.some((u) => u.serialNumber);
  const usePoInQr = poInQr && anyPo;
  const useCaption = (showSerialOnLabel && anySerial) || (showPoOnLabel && anyPo);

  const payloads = useMemo(
    () => rows.map((u) => encodedFor(u, usePoInQr)),
    [rows, usePoInQr]
  );
  const previews = useQrPreviews(open ? payloads : []);

  useEffect(() => {
    if (!open) return;
    setCopies(Object.fromEntries(rows.map((u) => [u.code, defaultCopies])));
    setOneByOne(null);
  }, [open, rows, defaultCopies]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy && !oneByOne) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, oneByOne, onClose]);

  const totalLabels = rows.reduce((sum, u) => sum + (Number(copies[u.code]) || 0), 0);
  const rowCount = Math.ceil(totalLabels / COLUMNS) || 0;

  // Worst case across the batch, since one roll prints them all.
  const density = useMemo(() => {
    if (!payloads.length) return null;
    const longest = payloads.reduce((a, b) => (b.length > a.length ? b : a), payloads[0]);
    return symbolInfo(longest, sizeMm);
  }, [payloads, sizeMm]);

  function setCopiesFor(code, value) {
    const n = Math.max(0, Math.min(50, Number(value) || 0));
    setCopies((prev) => ({ ...prev, [code]: n }));
  }

  function setAllCopies(value) {
    const n = Math.max(0, Math.min(50, Number(value) || 0));
    setCopies(Object.fromEntries(rows.map((u) => [u.code, n])));
  }

  function labelPayloadFor(u) {
    return {
      code: encodedFor(u, usePoInQr),
      caption: captionFor(u, { showSerial: showSerialOnLabel, showPo: showPoOnLabel }),
      copies: Number(copies[u.code]) || 0,
    };
  }

  const pdfOptions = () => ({
    qrMm: sizeMm,
    columns: COLUMNS,
    captionMm: useCaption ? CAPTION_MM : 0,
    paperWidthMm: PAPER_WIDTH_MM,
    paperHeightMm: PAPER_HEIGHT_MM,
    labelMm: LABEL_MM,
    gapMm: GAP_MM,
    sideMarginMm: SIDE_MARGIN_MM,
  });

  async function printLabels(labels, { filename, successMsg } = {}) {
    const { data } = await buildPartLabelsPdf(labels, pdfOptions());
    const stickerCount = labels.reduce((s, l) => s + (Number(l.copies) || 0), 0);
    const result = openPdfBlob(data, filename || `part-labels-${Date.now()}.pdf`);
    if (!result.opened) {
      toast.success(successMsg || `${stickerCount} label(s) downloaded`);
    } else {
      toast.success(successMsg || `${stickerCount} label(s) ready — use your label printer's print dialog`);
      try {
        result.win?.focus();
        setTimeout(() => {
          try { result.win?.print?.(); } catch { /* PDF viewer may block auto-print */ }
        }, 400);
      } catch { /* ignore */ }
    }
    return result;
  }

  async function printUnit(unit) {
    const label = labelPayloadFor(unit);
    if (!label.copies) throw new Error('no_copies');
    await printLabels([label], {
      filename: `part-label-${unit.code}.pdf`,
      successMsg: `${unit.code}: ${label.copies} sticker(s) ready to print`,
    });
  }

  async function handlePrintAll() {
    const labels = rows.map((u) => labelPayloadFor(u)).filter((l) => l.copies > 0);
    if (!labels.length) {
      toast.error('Set at least one copy to print');
      return;
    }
    setBusy(true);
    try {
      await printLabels(labels, {
        successMsg: `${totalLabels} label(s) ready — use your label printer's print dialog`,
      });
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not build the label sheet');
    } finally {
      setBusy(false);
    }
  }

  /** Print one part from the list (its configured copy count). */
  async function handlePrintOnePart(unit) {
    if (busy || oneByOneBusy.current) return;
    setBusy(true);
    try {
      await printUnit(unit);
    } catch (e) {
      if (e?.message === 'no_copies') toast.error('Set at least one copy for this part');
      else toast.error(e.response?.data?.message || `Could not print ${unit.code}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Start guided one-by-one printing: each part opens its own print job so
   * the operator can stick labels before moving to the next part.
   */
  async function startOneByOne() {
    const queue = rows.filter((u) => (Number(copies[u.code]) || 0) > 0);
    if (!queue.length) {
      toast.error('Set at least one copy to print');
      return;
    }
    oneByOneBusy.current = true;
    setBusy(true);
    setOneByOne({ queue, index: 0, phase: 'printing' });
    try {
      await printUnit(queue[0]);
      if (queue.length === 1) {
        toast.success('Finished — printed 1 part');
        setOneByOne(null);
      } else {
        setOneByOne({ queue, index: 0, phase: 'awaiting_next' });
      }
    } catch (e) {
      toast.error(e.response?.data?.message || `Could not print ${queue[0].code}`);
      setOneByOne(null);
    } finally {
      oneByOneBusy.current = false;
      setBusy(false);
    }
  }

  async function printNextOneByOne() {
    if (!oneByOne || oneByOneBusy.current) return;
    const nextIndex = oneByOne.index + 1;
    const { queue } = oneByOne;
    const unit = queue[nextIndex];
    if (!unit) {
      setOneByOne(null);
      return;
    }

    oneByOneBusy.current = true;
    setBusy(true);
    setOneByOne({ queue, index: nextIndex, phase: 'printing' });
    try {
      await printUnit(unit);
      if (nextIndex + 1 >= queue.length) {
        toast.success(`Finished — printed ${queue.length} part(s) one by one`);
        setOneByOne(null);
      } else {
        setOneByOne({ queue, index: nextIndex, phase: 'awaiting_next' });
      }
    } catch (e) {
      toast.error(e.response?.data?.message || `Could not print ${unit.code}`);
      setOneByOne({ queue, index: nextIndex, phase: 'awaiting_next' });
    } finally {
      oneByOneBusy.current = false;
      setBusy(false);
    }
  }

  if (!open) return null;

  const rowDims = `${PAPER_WIDTH_MM} × ${PAPER_HEIGHT_MM} mm`;
  const oneByOneNext = oneByOne?.phase === 'awaiting_next'
    ? oneByOne.queue[oneByOne.index + 1]
    : null;
  const oneByOneCurrent = oneByOne ? oneByOne.queue[oneByOne.index] : null;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (!busy && !oneByOne && e.target === e.currentTarget) onClose?.(); }}
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
                {rows.length} unit{rows.length === 1 ? '' : 's'} · {totalLabels} sticker{totalLabels === 1 ? '' : 's'}
                {' · '}paper {rowDims} · 4 × {LABEL_MM} mm · {GAP_MM} mm gap · {rowCount} strip{rowCount === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 min-h-[44px] min-w-[44px] grid place-items-center"
            onClick={() => { if (!busy) { setOneByOne(null); onClose?.(); } }}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="label-size">
                QR size
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
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={busy || Boolean(oneByOne)}
                    onClick={() => setAllCopies(n)}
                    className={`px-3 py-2 rounded-xl border text-sm font-semibold min-w-[2.75rem] ${
                      rows.length && rows.every((u) => Number(copies[u.code]) === n)
                        ? 'border-teal-600 bg-teal-50 text-teal-800'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {n}×
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <p className="text-[11px] font-semibold text-slate-600 m-0 mb-2">
              Paper {rowDims} · four {LABEL_MM}×{LABEL_MM} mm labels · {GAP_MM} mm gap
            </p>
            <div className="flex items-center justify-center" style={{ gap: 6 }}>
              {[1, 2, 3, 4].map((col) => (
                <div
                  key={col}
                  className="flex flex-col items-center justify-center rounded-sm border border-dashed border-teal-300 bg-white"
                  style={{ width: 48, height: 48 }}
                >
                  <span className="w-7 h-7 shrink-0 rounded-sm bg-slate-800/90" aria-hidden />
                  <span className="text-[9px] font-semibold text-teal-700">{col}</span>
                </div>
              ))}
            </div>
          </div>

          {(anyPo || anySerial) ? (
            <fieldset className="rounded-xl border border-slate-200 p-3.5 space-y-2.5">
              <legend className="px-1.5 text-xs font-semibold text-slate-600">Text under the QR</legend>

              <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={showSerialOnLabel}
                  disabled={busy || !anySerial}
                  onChange={(e) => setShowSerialOnLabel(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-slate-800">Print serial number under the QR</span>
                  <span className="block text-[11px] text-slate-500">
                    Small upright text. Preferred when a serial exists.
                    {!anySerial ? ' (none on these units)' : ''}
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={showPoOnLabel}
                  disabled={busy || !anyPo}
                  onChange={(e) => setShowPoOnLabel(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-slate-800">Print PO number under the QR</span>
                  <span className="block text-[11px] text-slate-500">
                    Used when serial is off or missing (e.g. SP-PO-0499). Tiny font so it is not cut at the edge.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={poInQr}
                  disabled={busy || !anyPo}
                  onChange={(e) => setPoInQr(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-slate-800">Include the PO number inside the QR</span>
                  <span className="block text-[11px] text-slate-500">
                    Encodes PO in the QR payload — denser symbol; leave off unless you need it.
                  </span>
                </span>
              </label>

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
                      ? ' That is tight for a 203 dpi printer; turn off the PO inside the QR.'
                      : ''}
                  </span>
                </p>
              ) : null}
            </fieldset>
          ) : null}

          <p className="text-[11px] text-slate-500 m-0 leading-relaxed">
            Set printer paper to <strong>{rowDims}</strong> (4 labels of <strong>{LABEL_MM}×{LABEL_MM} mm</strong>,
            {' '}<strong>{GAP_MM} mm</strong> gap). Print at <strong>actual size / 100%</strong> (no fit-to-page).
          </p>

          {oneByOne ? (
            <div className="rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 text-sm text-teal-900">
                <p className="font-semibold m-0">
                  One by one · part {oneByOne.index + 1} of {oneByOne.queue.length}
                </p>
                <p className="text-xs m-0 mt-0.5 truncate">
                  {oneByOne.phase === 'printing'
                    ? `Printing ${oneByOneCurrent?.code}…`
                    : `Printed ${oneByOneCurrent?.code}. Next: ${oneByOneNext?.code || '—'}`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setOneByOne(null)}
                  className="px-3 py-2 rounded-xl border border-teal-200 bg-white text-sm font-semibold text-teal-800 hover:bg-teal-100"
                >
                  Cancel
                </button>
                {oneByOne.phase === 'awaiting_next' && oneByOneNext ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={printNextOneByOne}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                    Print next ({oneByOneNext.code})
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="max-h-[min(24rem,calc(100vh-24rem))] overflow-y-auto rounded-xl border border-slate-100 divide-y divide-slate-100">
            {rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">No units to label.</p>
            ) : rows.map((u) => {
              const payload = encodedFor(u, usePoInQr);
              return (
                <div key={u.code} className="flex items-center gap-3 px-3 py-2.5">
                  <div
                    className="shrink-0 rounded-lg border border-slate-200 bg-white flex flex-col items-center justify-center overflow-hidden px-1 py-1"
                    style={{ width: 48, height: 52 }}
                  >
                    {previews[payload]
                      ? <img src={previews[payload]} alt={`QR for ${u.code}`} className="w-8 h-8 object-contain" />
                      : <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                    {captionFor(u, { showSerial: showSerialOnLabel, showPo: showPoOnLabel }) ? (
                      <span className="font-medium text-slate-900 leading-none truncate max-w-full" style={{ fontSize: 5.5 }}>
                        {captionFor(u, { showSerial: showSerialOnLabel, showPo: showPoOnLabel })}
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
                      disabled={busy || Boolean(oneByOne)}
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
                      disabled={busy || Boolean(oneByOne)}
                      onChange={(e) => setCopiesFor(u.code, e.target.value)}
                      className="w-14 text-center border border-slate-200 rounded-lg px-1 py-2 text-sm tabular-nums"
                      aria-label={`Copies of ${u.code}`}
                    />
                    <button
                      type="button"
                      disabled={busy || Boolean(oneByOne)}
                      onClick={() => setCopiesFor(u.code, (Number(copies[u.code]) || 0) + 1)}
                      className="w-9 h-9 grid place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                      aria-label={`One more copy of ${u.code}`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={busy || Boolean(oneByOne) || !(Number(copies[u.code]) > 0)}
                      onClick={() => handlePrintOnePart(u)}
                      className="ml-1 inline-flex items-center gap-1 px-2.5 h-9 rounded-lg border border-teal-200 bg-teal-50 text-teal-800 text-xs font-semibold hover:bg-teal-100 disabled:opacity-40"
                      title={`Print only ${u.code}`}
                      aria-label={`Print ${u.code} only`}
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Print
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
              onClick={() => { setOneByOne(null); onClose?.(); }}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 min-h-[44px]"
            >
              Close
            </button>
            <button
              type="button"
              disabled={busy || totalLabels === 0 || Boolean(oneByOne)}
              onClick={startOneByOne}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-teal-600 text-teal-800 bg-white hover:bg-teal-50 text-sm font-semibold disabled:opacity-40 min-h-[44px]"
              title="Open a separate print job for each part"
            >
              {busy && oneByOne ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              Print one by one
            </button>
            <button
              type="button"
              disabled={busy || totalLabels === 0 || Boolean(oneByOne)}
              onClick={handlePrintAll}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold disabled:opacity-40 min-h-[44px]"
            >
              {busy && !oneByOne ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              Print all ({totalLabels || 0})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
