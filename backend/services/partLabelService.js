/**
 * QR labels for physical spare-part units.
 *
 * Symbol size is the binding constraint. A Part ID on its own
 * ("PRT-20260729-0042", 17 alphanumeric characters) fits a version-1 symbol:
 * 21 modules plus the 4-module quiet zone is 29 modules, so on a 10 mm sticker
 * each module is 0.345 mm — about 4 dots on a 300 dpi label printer, which
 * scans reliably.
 *
 * Adding the PO number ("PRT-20260729-0042/SP-PO-0042") pushes it to a
 * version-2 symbol: 25 modules plus quiet zone is 33, so each module drops to
 * 0.303 mm (~3.6 dots at 300 dpi). Still readable on a 300 dpi printer, but
 * with less margin for print quality, so it is opt-in rather than the default.
 *
 * The alternative — and the more legible one — is `captionMm`, which reserves a
 * band under the QR for the PO number in plain text. That leaves the symbol at
 * full size and lets a human read the PO without any scanner at all.
 *
 * Everything else about a unit (serial, specs, vendor, warranty) is resolved
 * from the API on scan, so it is always current rather than frozen at print time.
 */
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const MM_TO_PT = 72 / 25.4;
const DEFAULT_LABEL_MM = 10;
const MAX_LABELS_PER_JOB = 500;
const CAPTION_FONT = 'Helvetica-Bold';

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
 * Largest font size at which `text` still fits `maxWidth`, capped by the height
 * of the caption band. Small label printers cannot resolve much below 3.5 pt.
 */
function fitFontSize(doc, text, maxWidth, maxHeight) {
  let size = Math.min(maxHeight * 0.78, 7);
  doc.font(CAPTION_FONT);
  while (size > 3 && doc.fontSize(size).widthOfString(text) > maxWidth) {
    size -= 0.1;
  }
  return size;
}

/**
 * One PDF page per physical label, sized to the exact sticker dimensions so the
 * printer does not scale it. Repeated codes simply get repeated pages.
 *
 * @param {{code: string, caption?: string, copies?: number}[]} labels
 * @param {object} opts
 * @param {number} opts.widthMm   total sticker width
 * @param {number} opts.heightMm  total sticker height
 * @param {number} opts.captionMm height reserved at the bottom for caption text
 * @returns {Promise<Buffer>}
 */
async function buildLabelPdf(labels, {
  widthMm = DEFAULT_LABEL_MM,
  heightMm = DEFAULT_LABEL_MM,
  captionMm = 0,
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

  const pageW = widthMm * MM_TO_PT;
  const pageH = heightMm * MM_TO_PT;

  // Never let the caption band eat more than half the sticker.
  const captionH = Math.max(0, Math.min(captionMm, heightMm / 2)) * MM_TO_PT;
  const qrAreaH = pageH - captionH;
  const side = Math.min(pageW, qrAreaH);
  if (side <= 0) throw new Error('Label is too small once the caption band is reserved');

  // Cache renders so printing 2 copies of 50 units does 50 renders, not 100.
  const pngCache = new Map();
  for (const code of new Set(jobs.map((j) => j.code))) {
    pngCache.set(code, await renderQrPng(code));
  }

  const doc = new PDFDocument({ size: [pageW, pageH], margin: 0, autoFirstPage: false });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  jobs.forEach(({ code, caption }) => {
    doc.addPage({ size: [pageW, pageH], margin: 0 });
    // The quiet zone is baked into the PNG, so filling the area edge to edge
    // still leaves the margin the scanner needs.
    doc.image(pngCache.get(code), (pageW - side) / 2, (qrAreaH - side) / 2, {
      width: side,
      height: side,
    });

    if (captionH > 0 && caption) {
      // Minimal side padding: on a 10 mm sticker every tenth of a millimetre of
      // width is another usable tenth of a point of font size.
      const padX = Math.min(0.3 * MM_TO_PT, pageW * 0.03);
      const maxWidth = pageW - padX * 2;
      const size = fitFontSize(doc, caption, maxWidth, captionH);
      doc.font(CAPTION_FONT).fontSize(size).fillColor('#000000');
      doc.text(caption, padX, qrAreaH + (captionH - size) / 2, {
        width: maxWidth,
        align: 'center',
        lineBreak: false,
        ellipsis: true,
      });
    }
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
