/**
 * BlueDart printable waybill PDF.
 * - Keeps original AWBPrintContent layout (fixed background)
 * - Builds 3 pages (Shipper / Consignee / Accounts)
 * - Overlays Pickup Date inline beside "Pickup Date:" as DD-MM-YYYY
 * - Saves waybill_<AWB>_final.pdf
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'bluedart');

const COPY_TITLES = [
  'SHIPPER COPY',
  'CONSIGNEE COPY',
  'EDP / ACCOUNTS COPY',
];

// Tuned in test3.js for BlueDart A4 Apex — keep in sync
const PICKUP_DATE_X_RATIO = Number(process.env.BLUEDART_PICKUP_DATE_X_RATIO || 0.155);
const PICKUP_DATE_X_OFFSET = Number(process.env.BLUEDART_PICKUP_DATE_X_OFFSET || 10);
const PICKUP_DATE_Y_RATIO = Number(process.env.BLUEDART_PICKUP_DATE_Y_RATIO || 0.658);
const PICKUP_DATE_Y_OFFSET = Number(process.env.BLUEDART_PICKUP_DATE_Y_OFFSET || 1);
// Time: sits one row below Pickup Date (same X column)
const PICKUP_TIME_X_RATIO = Number(process.env.BLUEDART_PICKUP_TIME_X_RATIO || PICKUP_DATE_X_RATIO);
const PICKUP_TIME_X_OFFSET = Number(process.env.BLUEDART_PICKUP_TIME_X_OFFSET || PICKUP_DATE_X_OFFSET);
const PICKUP_TIME_Y_RATIO = Number(process.env.BLUEDART_PICKUP_TIME_Y_RATIO || 0.640);
const PICKUP_TIME_Y_OFFSET = Number(process.env.BLUEDART_PICKUP_TIME_Y_OFFSET || 1);

/**
 * Build CreditReferenceNo: Serial-TTSPL (max 20).
 * Example: 5CG0278V2Z-7398
 */
function buildShipmentReference({ serialNumber, ttsplId, fallback } = {}) {
  const serial = String(serialNumber || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 12);
  let ttspl = String(ttsplId || '')
    .replace(/^TTSPL/i, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8);
  if (serial && ttspl) return `${serial}-${ttspl}`.slice(0, 20);
  if (serial) return serial.slice(0, 20);
  if (ttspl) return `TTSPL${ttspl}`.slice(0, 20);
  const fb = String(fallback || '')
    .replace(/[^A-Za-z0-9-]/g, '')
    .slice(0, 20);
  return fb || `RFX${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
}

function parsePickupDate(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\/Date\((-?\d+)/);
    if (m) return new Date(Number(m[1]));
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return new Date(raw);
  return null;
}

/** DD-MM-YYYY in IST (hyphens only) */
function formatPickupDateDisplay(pickupDate) {
  const d = parsePickupDate(pickupDate) || new Date();
  const IST_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(d.getTime() + IST_MS);
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = ist.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/** HH:MM from "1530" / "15:30" or from pickupDate timestamp */
function formatPickupTimeDisplay(pickupTime, pickupDate) {
  let hhmm = String(pickupTime || '').replace(/\D/g, '').slice(0, 4);
  if (hhmm.length !== 4) {
    const d = parsePickupDate(pickupDate);
    if (d) {
      const IST_MS = 5.5 * 60 * 60 * 1000;
      const ist = new Date(d.getTime() + IST_MS);
      hhmm = `${String(ist.getUTCHours()).padStart(2, '0')}${String(ist.getUTCMinutes()).padStart(2, '0')}`;
    } else {
      hhmm = '1530';
    }
  }
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}

function drawOverlayText(page, font, text, x, y, fontSize = 8) {
  const value = String(text || '').trim();
  if (!value) return;
  page.drawText(value, {
    x,
    y,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
  });
}

/**
 * Draw Pickup Date + Time on their label rows (same layout as test3.js date).
 * Date: DD-MM-YYYY  |  Time: HH:MM
 */
function drawPickupFieldsOnPage(page, font, { dateValue, timeValue }) {
  const { width, height } = page.getSize();
  const fontSize = 8;

  const xDate = width * PICKUP_DATE_X_RATIO + PICKUP_DATE_X_OFFSET;
  const yDate = height * PICKUP_DATE_Y_RATIO + PICKUP_DATE_Y_OFFSET;
  drawOverlayText(page, font, dateValue, xDate, yDate, fontSize);

  const xTime = width * PICKUP_TIME_X_RATIO + PICKUP_TIME_X_OFFSET;
  const yTime = height * PICKUP_TIME_Y_RATIO + PICKUP_TIME_Y_OFFSET;
  drawOverlayText(page, font, timeValue, xTime, yTime, fontSize);
}

function drawCopyTitleOnPage(page, font, title) {
  const { width, height } = page.getSize();
  const fontSize = Math.max(9, Math.min(11, width * 0.022));
  const titleColor = rgb(0.12, 0.23, 0.54);
  const textWidth = font.widthOfTextAtSize(title, fontSize);
  const padX = 6;
  const padY = 3;
  const boxH = fontSize + padY * 2;
  const boxW = textWidth + padX * 2;
  const boxX = (width - boxW) / 2;
  const boxY = height - boxH - 6;

  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxW,
    height: boxH,
    color: rgb(1, 1, 1),
    opacity: 0.92,
    borderColor: titleColor,
    borderWidth: 0.6,
  });
  page.drawText(title, {
    x: boxX + padX,
    y: boxY + padY + 1,
    size: fontSize,
    font,
    color: titleColor,
  });
}

/**
 * 3-page printable waybill + Pickup Date overlay (DD-MM-YYYY) beside label.
 * Primary file: waybill_<AWB>_final.pdf
 */
async function generateMultiCopyWaybillFromApiPdf(pdfBuffer, awbNumber, opts = {}) {
  if (!pdfBuffer || !pdfBuffer.length) {
    const err = new Error('BlueDart AWBPrintContent PDF is missing');
    err.status = 502;
    throw err;
  }

  const srcBytes = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
  const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  if (srcDoc.getPageCount() < 1) {
    const err = new Error('BlueDart waybill PDF has no pages');
    err.status = 502;
    throw err;
  }

  const outDoc = await PDFDocument.create();
  const fontRegular = await outDoc.embedFont(StandardFonts.Courier);
  const fontBold = await outDoc.embedFont(StandardFonts.HelveticaBold);
  const dateValue = formatPickupDateDisplay(opts.pickupDate);
  const timeValue = formatPickupTimeDisplay(opts.pickupTime, opts.pickupDate);

  for (const title of COPY_TITLES) {
    const [page] = await outDoc.copyPages(srcDoc, [0]);
    outDoc.addPage(page);
    drawCopyTitleOnPage(page, fontBold, title);
    drawPickupFieldsOnPage(page, fontRegular, { dateValue, timeValue });
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const safeAwb = String(awbNumber || 'AWB').replace(/[^A-Za-z0-9_-]/g, '_');
  const outBytes = await outDoc.save();
  const buf = Buffer.from(outBytes);

  const finalName = `waybill_${safeAwb}_final.pdf`;
  const finalAbs = path.join(UPLOAD_DIR, finalName);
  const finalRel = `uploads/bluedart/${finalName}`;
  fs.writeFileSync(finalAbs, buf);

  // Aliases for older download preference chains
  fs.writeFileSync(path.join(UPLOAD_DIR, `waybill_${safeAwb}_fixed.pdf`), buf);
  fs.writeFileSync(path.join(UPLOAD_DIR, `waybill_${safeAwb}_multi.pdf`), buf);

  return {
    pdf_path: finalRel,
    abs_path: finalAbs,
    page_count: COPY_TITLES.length,
    pickup_date_display: dateValue,
    pickup_time_display: timeValue,
    overlay_text: `Pickup Date: ${dateValue}  Time: ${timeValue}`,
  };
}

async function overlayPickupDateOnWaybillPdf(pdfBuffer, awbNumber, opts = {}) {
  return generateMultiCopyWaybillFromApiPdf(pdfBuffer, awbNumber, opts);
}

module.exports = {
  COPY_TITLES,
  buildShipmentReference,
  formatPickupDateDisplay,
  formatPickupTimeDisplay,
  parsePickupDate,
  overlayPickupDateOnWaybillPdf,
  generateMultiCopyWaybillFromApiPdf,
};
