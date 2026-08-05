/**
 * QR labels for physical spare-part units.
 *
 * Media: one continuous strip / sheet row of 102.6 mm × 15 mm.
 * Layout: exactly 4 QR codes of 15 × 15 mm across that strip (left → right).
 * Optional PO text sits under each QR as normal (not rotated) text. Because the
 * strip is only 15 mm tall, the QR is nudged up and slightly shortened when a
 * caption is printed so both fit on the same label.
 *
 * Everything else about a unit is resolved from the API on scan.
 */
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const MM_TO_PT = 72 / 25.4;
/** Exact printer media size for one row of 4 labels. */
const PAPER_WIDTH_MM = 102.6;
const PAPER_HEIGHT_MM = 15;
/** QR square when no caption is drawn underneath. */
const DEFAULT_QR_MM = 15;
const DEFAULT_COLUMNS = 4;
/** Band reserved under the QR for upright serial/PO text (within the 15 mm height). */
const DEFAULT_CAPTION_MM = 3.2;
/** Keep text clear of the die-cut / thermal edge so digits are not clipped. */
const EDGE_PAD_MM = 0.8;
const MAX_LABELS_PER_JOB = 500;
/** Regular weight reads cleaner than bold at ~3 pt on thermal labels. */
const CAPTION_FONT = 'Helvetica';

async function renderQrPng(text, pixels = 600) {
  return QRCode.toBuffer(String(text), {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 4,
    width: pixels,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}

async function renderQrDataUrl(text, pixels = 240) {
  return QRCode.toDataURL(String(text), {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: pixels,
  });
}

/** Prefer a small font that fits width; never grow large enough to hit the cut edge. */
function fitFontSize(doc, text, maxWidth, maxHeight) {
  let size = Math.min(maxHeight * 0.7, 3.2);
  doc.font(CAPTION_FONT);
  while (size > 2.0 && doc.fontSize(size).widthOfString(text) > maxWidth) {
    size -= 0.05;
  }
  return size;
}

/**
 * One cell: QR centred, optional serial/PO as small upright text under the QR.
 * IMPORTANT: PDFKit auto-adds pages when text overflows — always pass `height`.
 * Bottom/side padding avoids the minor cut-off on thermal label edges.
 */
function drawSticker(doc, {
  png, caption, x, y, cellW, cellH, qrMm, captionMm,
}) {
  const edgePad = EDGE_PAD_MM * MM_TO_PT;
  const captionH = caption && captionMm > 0
    ? Math.min(captionMm * MM_TO_PT, cellH * 0.28)
    : 0;
  const qrMax = Math.min(
    qrMm * MM_TO_PT,
    cellW - edgePad * 2,
    cellH - captionH - edgePad
  );
  if (qrMax <= 0 || !png) return;

  const qrX = x + (cellW - qrMax) / 2;
  const qrY = y + edgePad * 0.35;

  doc.image(png, qrX, qrY, { width: qrMax, height: qrMax });

  if (!caption || captionH <= 0) return;

  const padX = Math.max(edgePad, cellW * 0.05);
  const maxWidth = Math.max(2, cellW - padX * 2);
  const textBoxH = Math.max(2, captionH - edgePad * 0.5);
  const size = fitFontSize(doc, caption, maxWidth, textBoxH);
  // Keep baseline above the die-cut so descenders (g, y, 9) are not clipped.
  const textY = Math.min(
    qrY + qrMax + 0.2 * MM_TO_PT,
    y + cellH - edgePad - size
  );

  const prevX = doc.x;
  const prevY = doc.y;
  doc.font(CAPTION_FONT).fontSize(size).fillColor('#000000');
  doc.text(caption, x + padX, textY, {
    width: maxWidth,
    height: textBoxH,
    align: 'center',
    lineBreak: false,
    ellipsis: true,
  });
  doc.x = prevX;
  doc.y = prevY;
}

/**
 * Build a PDF where every page is exactly PAPER_WIDTH × PAPER_HEIGHT and holds
 * up to `columns` stickers in one horizontal row.
 *
 * @param {{code: string, caption?: string, copies?: number}[]} labels
 */
async function buildLabelPdf(labels, {
  qrMm = DEFAULT_QR_MM,
  columns = DEFAULT_COLUMNS,
  captionMm = DEFAULT_CAPTION_MM,
  paperWidthMm = PAPER_WIDTH_MM,
  paperHeightMm = PAPER_HEIGHT_MM,
  // legacy ignored / mapped
  cellWidthMm,
  cellHeightMm,
  gapMm,
  captionVertical,
  widthMm,
  heightMm,
} = {}) {
  const jobs = [];
  for (const label of Array.isArray(labels) ? labels : []) {
    const code = String(label?.code || '').trim();
    if (!code) continue;
    const caption = String(label?.caption || '').trim();
    const copies = Math.max(1, Math.min(50, Number(label?.copies) || 1));
    for (let i = 0; i < copies; i += 1) jobs.push({ code, caption });
  }
  if (!jobs.length) throw new Error('No labels to print');
  if (jobs.length > MAX_LABELS_PER_JOB) {
    throw new Error(`Too many labels in one job (${jobs.length}); maximum is ${MAX_LABELS_PER_JOB}`);
  }

  const cols = Math.max(1, Math.min(8, Number(columns) || DEFAULT_COLUMNS));
  const qr = Math.max(8, Math.min(40, Number(qrMm) || DEFAULT_QR_MM));
  const paperWmm = Math.max(40, Math.min(300, Number(paperWidthMm) || PAPER_WIDTH_MM));
  const paperHmm = Math.max(10, Math.min(80, Number(paperHeightMm) || Number(cellHeightMm) || Number(heightMm) || PAPER_HEIGHT_MM));
  const capMm = Math.max(0, Math.min(8, Number(captionMm) || 0));

  const pageW = paperWmm * MM_TO_PT;
  const pageH = paperHmm * MM_TO_PT;
  const cellW = pageW / cols;
  const cellH = pageH;

  const pngCache = new Map();
  for (const code of new Set(jobs.map((j) => j.code))) {
    pngCache.set(code, await renderQrPng(code));
  }

  // Left → right across the 102.6 mm strip; next page = next physical label row.
  // bufferPages avoids PDFKit auto-flush mid-row if text ever misbehaves.
  const doc = new PDFDocument({
    size: [pageW, pageH],
    margin: 0,
    autoFirstPage: false,
    bufferPages: true,
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  for (let i = 0; i < jobs.length; i += cols) {
    doc.addPage({ size: [pageW, pageH], margin: 0 });
    const pageIndex = doc.bufferedPageRange().start + doc.bufferedPageRange().count - 1;
    const row = jobs.slice(i, i + cols);
    row.forEach((job, col) => {
      // Pin drawing to this strip so a text glitch cannot jump pages mid-row.
      doc.switchToPage(pageIndex);
      drawSticker(doc, {
        png: pngCache.get(job.code),
        caption: job.caption,
        x: col * cellW,
        y: 0,
        cellW,
        cellH,
        qrMm: qr,
        captionMm: job.caption ? capMm : 0,
      });
    });
  }

  doc.end();
  return done;
}

module.exports = {
  renderQrPng,
  renderQrDataUrl,
  buildLabelPdf,
  PAPER_WIDTH_MM,
  PAPER_HEIGHT_MM,
  DEFAULT_QR_MM,
  DEFAULT_LABEL_MM: DEFAULT_QR_MM,
  DEFAULT_COLUMNS,
  DEFAULT_CAPTION_MM,
  DEFAULT_CELL_WIDTH_MM: PAPER_WIDTH_MM / DEFAULT_COLUMNS,
  DEFAULT_CELL_HEIGHT_MM: PAPER_HEIGHT_MM,
  DEFAULT_GAP_MM: 0,
  MAX_LABELS_PER_JOB,
};
