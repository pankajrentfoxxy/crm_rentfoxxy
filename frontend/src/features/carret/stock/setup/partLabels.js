import QRCode from 'qrcode';
import { buildPartLabelsPdf } from '../../../inventory-management/partTrackingApi';

/*
 * Label-sheet logic for PartLabelPrintDrawer, lifted as-is from the old
 * inventory-management PartLabelPrintModal (which the old screens still use
 * and which exports none of it). The PDF itself is built by the server
 * (POST part-tracking/labels/print); these numbers must match what it expects.
 */

export const SIZE_OPTIONS = [
  { value: 10, label: '10 × 10 mm' },
  { value: 12, label: '12 × 12 mm' },
  { value: 15, label: '15 × 15 mm' },
  { value: 20, label: '20 × 20 mm' },
];

/** Stickers per paper strip — 4 × 15 mm die-cuts with 3 mm gaps on a 71.6 × 15 mm row. */
export const COLUMNS = 4;
export const PAPER_WIDTH_MM = 71.6;
export const PAPER_HEIGHT_MM = 15;
export const LABEL_MM = 15;
export const GAP_MM = 3;
export const SIDE_MARGIN_MM = 1.3;
/** Serial/PO text band under each QR (within the 15 mm height). */
export const CAPTION_MM = 3.2;
export const MAX_COPIES = 50;

/** Below this many printer dots per module a 203 dpi printer smears the symbol. */
export const TIGHT_DOTS = 3.4;

/** Human-readable line under the QR: serial preferred, else PO. */
export function captionFor(unit, { showSerial, showPo }) {
  const serial = String(unit?.serialNumber || '').trim();
  const po = String(unit?.poNumber || '').trim();
  // Prefer serial when requested; fall back to PO so labels still show a number.
  if (showSerial && serial) return serial;
  if (showPo && po) return po;
  if (showSerial && po) return po;
  return '';
}

/** The PO travels in the QR after a slash; the scanner strips it back off. */
export function encodedFor(unit, includePo) {
  const code = String(unit?.code || '').trim();
  const po = String(unit?.poNumber || '').trim();
  return includePo && po ? `${code}/${po}` : code;
}

/**
 * Module count of the symbol we are about to print, so the operator can see the
 * density cost of adding the PO before they commit a roll of labels to it.
 */
export function symbolInfo(text, sizeMm) {
  try {
    const qr = QRCode.create(String(text), { errorCorrectionLevel: 'M' });
    const modules = qr.modules.size + 8; // includes the 4-module quiet zone
    const moduleMm = sizeMm / modules;
    return { version: qr.version, modules, moduleMm, dots300: (moduleMm / 25.4) * 300 };
  } catch {
    return null;
  }
}

/** Same settings the server uses, so the preview matches the printed sticker. */
export function qrDataUrl(text) {
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 4, width: 200 });
}

/** Caller rows → the clean shape; a row without a code cannot be labelled. */
export function normaliseUnits(units = []) {
  return units
    .map((u) => ({
      code: String(u?.code || '').trim(),
      title: u?.title || '',
      subtitle: u?.subtitle || '',
      poNumber: String(u?.poNumber || '').trim(),
      serialNumber: String(u?.serialNumber || '').trim(),
    }))
    .filter((u) => u.code);
}

export const clampCopies = (v) => Math.max(0, Math.min(MAX_COPIES, Number(v) || 0));

/**
 * The PDF opens in a new tab and asks for the print dialog; a blocked popup
 * falls back to a download. Returns { opened, win }.
 */
function openPdfBlob(data, filename) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
  const win = window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    return { opened: false };
  }
  return { opened: true, win };
}

/**
 * Build the sheet on the server and hand it to the printer.
 * labels: [{ code, caption, copies }]. Returns the sticker count and whether
 * it opened (false = downloaded).
 */
export async function printLabelSheet(labels, { sizeMm, withCaption, filename }) {
  const { data } = await buildPartLabelsPdf(labels, {
    qrMm: sizeMm,
    columns: COLUMNS,
    captionMm: withCaption ? CAPTION_MM : 0,
    paperWidthMm: PAPER_WIDTH_MM,
    paperHeightMm: PAPER_HEIGHT_MM,
    labelMm: LABEL_MM,
    gapMm: GAP_MM,
    sideMarginMm: SIDE_MARGIN_MM,
  });
  const stickers = labels.reduce((s, l) => s + (Number(l.copies) || 0), 0);
  const result = openPdfBlob(data, filename || `part-labels-${Date.now()}.pdf`);
  if (result.opened) {
    try {
      result.win.focus();
      setTimeout(() => {
        try { result.win.print?.(); } catch { /* PDF viewer may block auto-print */ }
      }, 400);
    } catch { /* ignore */ }
  }
  return { stickers, opened: result.opened };
}
