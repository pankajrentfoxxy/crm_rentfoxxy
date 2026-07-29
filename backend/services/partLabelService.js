/**
 * QR labels for physical spare-part units.
 *
 * The QR encodes only the Part ID (e.g. "PRT-20260729-0042"). That is 17
 * alphanumeric characters, which fits a version-1 symbol: 21 modules plus the
 * 4-module quiet zone is 29 modules, so at a 10 mm label each module is about
 * 0.35 mm and scans reliably on a 203/300 dpi label printer. Encoding the
 * serial, part details, PO and vendor inline would need a version 6-7 symbol
 * (~0.19 mm per module at the same size), which does not scan — those details
 * are resolved from the API on scan instead, which also keeps them current.
 */
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const MM_TO_PT = 72 / 25.4;
const DEFAULT_LABEL_MM = 10;
const MAX_LABELS_PER_JOB = 500;

/** High-resolution PNG so the label printer has more dots than it needs. */
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

/**
 * One PDF page per physical label, sized to the exact sticker dimensions so the
 * printer does not scale it. Repeated codes simply get repeated pages.
 *
 * @param {{code: string, copies?: number}[]} labels
 * @param {number} widthMm
 * @param {number} heightMm
 * @returns {Promise<Buffer>}
 */
async function buildLabelPdf(labels, { widthMm = DEFAULT_LABEL_MM, heightMm = DEFAULT_LABEL_MM } = {}) {
  const jobs = [];
  for (const label of Array.isArray(labels) ? labels : []) {
    const code = String(label?.code || '').trim();
    if (!code) continue;
    const copies = Math.max(1, Math.min(50, Number(label?.copies) || 1));
    for (let i = 0; i < copies; i += 1) jobs.push(code);
  }
  if (!jobs.length) throw new Error('No labels to print');
  if (jobs.length > MAX_LABELS_PER_JOB) {
    throw new Error(`Too many labels in one job (${jobs.length}); maximum is ${MAX_LABELS_PER_JOB}`);
  }

  const pageW = widthMm * MM_TO_PT;
  const pageH = heightMm * MM_TO_PT;
  const side = Math.min(pageW, pageH);

  // Cache renders so printing 2 copies of 50 units does 50 renders, not 100.
  const pngCache = new Map();
  for (const code of new Set(jobs)) {
    pngCache.set(code, await renderQrPng(code));
  }

  const doc = new PDFDocument({ size: [pageW, pageH], margin: 0, autoFirstPage: false });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  jobs.forEach((code) => {
    doc.addPage({ size: [pageW, pageH], margin: 0 });
    // The quiet zone is baked into the PNG, so filling the page edge to edge
    // still leaves the margin the scanner needs.
    doc.image(pngCache.get(code), (pageW - side) / 2, (pageH - side) / 2, {
      width: side,
      height: side,
    });
  });

  doc.end();
  return done;
}

module.exports = {
  renderQrPng,
  renderQrDataUrl,
  buildLabelPdf,
  DEFAULT_LABEL_MM,
  MAX_LABELS_PER_JOB,
};
