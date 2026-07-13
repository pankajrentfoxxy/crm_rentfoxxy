/**
 * Rent / laptop proforma invoice PDF + email helpers (Rentfoxxy / TRUETECH format).
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { formatPdfDateIst, formatPdfDateTimeIst } = require('../utils/pdfDateTimeUtils');

const LOGO_PATH = path.join(__dirname, '../assets/rentfoxxy-logo.png');

const SELLER_LINES = [
  'TRUETECH SERVICES PRIVATE LIMITED',
  'UNIT NO-429, 4TH FLOOR JMD MEGAPOLIS BUILDING',
  'SEC-48, SOHNA ROAD, GURGAON',
  'GSTIN/UIN: 06AAHCT0310N1ZG'
];

const DEFAULT_HSN_SAC = '363684';

const FALLBACK_QUOTATION_CC = ['pankaj@rentfoxxy.com', 'shivam@rentfoxxy.com', 'pradeep@rentfoxxy.com'];

/** Team CC on quotation emails — override via QUOTATION_DEFAULT_CC (comma-separated). */
function getDefaultQuotationCc() {
  const fromEnv = process.env.QUOTATION_DEFAULT_CC;
  if (fromEnv !== undefined && fromEnv !== null) {
    return parseCcList(fromEnv);
  }
  return [...FALLBACK_QUOTATION_CC];
}

function buildDefaultCcRecipients(senderEmail) {
  return uniqueEmails([...getDefaultQuotationCc(), senderEmail].filter(Boolean));
}

/** @deprecated use getDefaultQuotationCc() */
const DEFAULT_CC = FALLBACK_QUOTATION_CC;

/** Rentfoxxy branding — lighter orange accents on white */
const BRAND_PRIMARY = '#fb923c';
const BRAND_PRIMARY_DARK = '#ea580c';
const BRAND_BG_LIGHT = '#ffffff';
const BRAND_BORDER = '#fed7aa';
const BRAND_CELL_HEADER_BG = '#fff7ed';
const BRAND_HEADER_TEXT = '#9a3412';

const TERMS = [
  '1-The quotation is valid for 10 days from the date of issuance.',
  '2-Delivery within 3-4 working days after order confirmation.',
  '3-In case of damage or Non-Return by employees, Rent continues until full payment or recovery.',
  '4-Hidden damages will be assessed upon technical inspection after return.',
  '5-Clients will be updated on every item post-return.',
  '6-All rented equipment remains the property of Rentfoxxy',
  '7-All disputes are subject to the jurisdiction of Gurgaon Courts only.'
];

function numberToIndianRupeesWords(n) {
  const num = Math.round(Number(n));
  if (!Number.isFinite(num) || num < 0) return 'Indian Rupee Zero Only';
  if (num === 0) return 'Indian Rupee Zero Only';

  const ones = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen'
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function twoDigits(x) {
    if (x < 20) return ones[x];
    return tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '');
  }

  function threeDigits(x) {
    let s = '';
    if (x >= 100) {
      s += ones[Math.floor(x / 100)] + ' Hundred';
      if (x % 100) s += ' ';
    }
    if (x % 100) s += twoDigits(x % 100);
    return s.trim();
  }

  let rest = num;
  let str = '';

  const crore = Math.floor(rest / 10000000);
  if (crore) {
    str += threeDigits(crore) + ' Crore ';
    rest %= 10000000;
  }
  const lakh = Math.floor(rest / 100000);
  if (lakh) {
    str += twoDigits(lakh) + ' Lakh ';
    rest %= 100000;
  }
  const thousand = Math.floor(rest / 1000);
  if (thousand) {
    str += twoDigits(thousand) + ' Thousand ';
    rest %= 1000;
  }
  if (rest) str += threeDigits(rest);

  return `Indian Rupee ${str.trim()} Only`.replace(/\s+/g, ' ');
}

function formatMoney(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatEstimateDate(d) {
  return formatPdfDateIst(d, { fallback: '—' });
}

function formatSentAtLine(d) {
  return formatPdfDateTimeIst(d, { fallback: '—' });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatRsIndian(amount) {
  if (amount == null || !Number.isFinite(Number(amount)) || Number(amount) < 0) return '—';
  return `Rs. ${Number(amount).toLocaleString('en-IN')}/-`;
}

function buildConfigOneFromLead(lead, monthlyRate) {
  const procCore = [lead.processor, lead.generation].filter(Boolean).join(' - ') || '—';
  const processor = lead.brand ? `${lead.brand} — ${procCore}` : procCore;
  return {
    processor,
    ram: lead.ram || '—',
    storage: lead.storage || '—',
    monthlyRate: Number(monthlyRate)
  };
}

function isConfigTwoActive(c2) {
  if (!c2) return false;
  const hasProc = c2.processor && String(c2.processor).trim();
  const hasRam = c2.ram && String(c2.ram).trim();
  const hasSt = c2.storage && String(c2.storage).trim();
  const rate = Number(c2.monthlyRate);
  const hasRate = Number.isFinite(rate) && rate > 0;
  return Boolean(hasProc || hasRam || hasSt || hasRate);
}

function buildQuotationEmailHtml({ senderName, senderPhone, estimateNo, sentAtLine, config1, config2, acceptUrl }) {
  const hasC2 = isConfigTwoActive(config2);
  const thMain = `padding:10px 12px;text-align:left;font-size:13px;border:1px solid ${BRAND_BORDER};background:${BRAND_CELL_HEADER_BG};color:${BRAND_HEADER_TEXT};font-weight:bold;`;
  const td = `padding:10px 12px;font-size:13px;border:1px solid ${BRAND_BORDER};color:#334155;vertical-align:top;`;
  const tdSpec = `${td}background:${BRAND_CELL_HEADER_BG};color:${BRAND_PRIMARY_DARK};font-weight:600;width:34%;`;

  const c1p = escapeHtml(config1.processor);
  const c1r = escapeHtml(config1.ram);
  const c1s = escapeHtml(config1.storage);
  const c1m = escapeHtml(formatRsIndian(config1.monthlyRate));

  const c2p = hasC2 ? escapeHtml(config2.processor || '—') : '';
  const c2r = hasC2 ? escapeHtml(config2.ram || '—') : '';
  const c2s = hasC2 ? escapeHtml(config2.storage || '—') : '';
  const c2m = hasC2 ? escapeHtml(formatRsIndian(config2.monthlyRate)) : '';

  const headerCols = hasC2
    ? `<th style="${thMain}">Specification</th><th style="${thMain}">Configuration 1</th><th style="${thMain}">Configuration 2</th>`
    : `<th style="${thMain}">Specification</th><th style="${thMain}">Configuration</th>`;

  const rowProcessor = hasC2
    ? `<tr><td style="${tdSpec}">Processor</td><td style="${td}">${c1p}</td><td style="${td}">${c2p}</td></tr>`
    : `<tr><td style="${tdSpec}">Processor</td><td style="${td}">${c1p}</td></tr>`;
  const rowRam = hasC2
    ? `<tr><td style="${tdSpec}">RAM</td><td style="${td}">${c1r}</td><td style="${td}">${c2r}</td></tr>`
    : `<tr><td style="${tdSpec}">RAM</td><td style="${td}">${c1r}</td></tr>`;
  const rowStorage = hasC2
    ? `<tr><td style="${tdSpec}">Storage</td><td style="${td}">${c1s}</td><td style="${td}">${c2s}</td></tr>`
    : `<tr><td style="${tdSpec}">Storage</td><td style="${td}">${c1s}</td></tr>`;
  const rowPrice = hasC2
    ? `<tr><td style="${tdSpec}">Monthly Unit Rental Price</td><td style="${td}"><strong>${c1m}</strong></td><td style="${td}"><strong>${c2m}</strong></td></tr>`
    : `<tr><td style="${tdSpec}">Monthly Unit Rental Price</td><td style="${td}"><strong>${c1m}</strong></td></tr>`;

  const phoneLine = escapeHtml(senderPhone || '');

  const acceptBlock = acceptUrl
    ? `<p style="margin:0 0 12px;text-align:center;">
        <a href="${escapeHtml(acceptUrl)}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;font-size:14px;">Accept quotation</a>
      </p>
      <p style="margin:0 0 16px;font-size:12px;color:#64748b;text-align:center;">Click to confirm you accept this rental quotation.</p>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px 32px;">
    <div style="border-radius:12px;border:1px solid ${BRAND_BORDER};overflow:hidden;background:#ffffff;">
      <div style="background:${BRAND_CELL_HEADER_BG};border-bottom:2px solid ${BRAND_PRIMARY};padding:14px 20px;">
        <div style="font-size:18px;font-weight:700;letter-spacing:0.03em;color:${BRAND_HEADER_TEXT};">Rentfoxxy</div>
        <div style="font-size:12px;color:#78716c;margin-top:4px;">Quotation · ${escapeHtml(
          estimateNo
        )}${sentAtLine ? ` · ${escapeHtml(sentAtLine)}` : ''}</div>
      </div>
      <div style="padding:22px 20px;color:#334155;line-height:1.55;font-size:14px;">
        <p style="margin:0 0 14px;"><strong>Dear Sir,</strong></p>
        <p style="margin:0 0 14px;">Thank you for your invaluable time today.</p>
        <p style="margin:0 0 8px;">Please find below the details of the laptop rental pricing for the configuration below:</p>
        <p style="margin:0 0 16px;font-size:13px;color:#475569;"><em>Models can vary as per Stock availability but configuration will be the same.</em></p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 16px;">
          <thead><tr>${headerCols}</tr></thead>
          <tbody>${rowProcessor}${rowRam}${rowStorage}${rowPrice}</tbody>
        </table>
        <p style="margin:0 0 14px;font-size:13px;color:${BRAND_PRIMARY_DARK};font-weight:600;">Note: Prices are exclusive of taxes.</p>
        <p style="margin:0 0 6px;font-weight:700;color:${BRAND_PRIMARY_DARK};font-size:14px;">Terms &amp; Conditions</p>
        <ul style="margin:0 0 16px;padding-left:20px;color:#475569;font-size:13px;">
          <li style="margin-bottom:6px;">The quotation is valid for 10 days from the date of issuance.</li>
        </ul>
        ${acceptBlock}
        <p style="margin:0 0 20px;font-size:14px;">Please feel free to contact or revert for any clarification required.</p>
        <p style="margin:0;font-size:14px;"><strong>Regards</strong><br/>
        <strong>${escapeHtml(senderName || 'Team')}</strong>${phoneLine ? ` (${phoneLine})` : ''}<br/>
        <span style="color:${BRAND_PRIMARY};font-weight:bold;">Team Rentfoxxy</span></p>
      </div>
    </div>
    <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:16px;">Proforma invoice PDF is attached.</p>
  </div>
</body></html>`;
}

function buildQuotationEmailText({
  senderName,
  senderPhone,
  estimateNo,
  sentAtLine,
  config1,
  config2,
  acceptUrl
}) {
  const hasC2 = isConfigTwoActive(config2);
  let table = '';
  if (hasC2) {
    table = `
Specification\tConfiguration 1\tConfiguration 2
Processor\t${config1.processor}\t${config2.processor || '—'}
RAM\t${config1.ram}\t${config2.ram || '—'}
Storage\t${config1.storage}\t${config2.storage || '—'}
Monthly Unit Rental Price\t${formatRsIndian(config1.monthlyRate)}\t${formatRsIndian(
      config2.monthlyRate
    )}`;
  } else {
    table = `
Specification\tConfiguration
Processor\t${config1.processor}
RAM\t${config1.ram}
Storage\t${config1.storage}
Monthly Unit Rental Price\t${formatRsIndian(config1.monthlyRate)}`;
  }

  return `Dear Sir,

Thank you for your invaluable time today.

Please find below the details of the laptop rental pricing for the configuration below:

Models can vary as per Stock availability but configuration will be the same.
${table}

Note: Prices are exclusive of taxes.

Terms & Conditions
- The quotation is valid for 10 days from the date of issuance.

Please feel free to contact or revert for any clarification required.
${acceptUrl ? `\nAccept quotation: ${acceptUrl}\n` : ''}

Regards
${senderName || 'Team'} (${senderPhone || '—'})
Team Rentfoxxy

--
${estimateNo}${sentAtLine ? ` · ${sentAtLine}` : ''}
(Proforma PDF attached.)`;
}

async function sendQuotationAcceptedEmail({ toEmail, companyName, estimateNo, senderEmail, senderName }) {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error('Email is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS)');
  }
  const fromAddress = process.env.QUOTATION_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER;
  const companyLabel = (companyName || '').trim() || 'your organization';
  const subject = `Quotation accepted — ${companyLabel} (${estimateNo})`;
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;font-family:Segoe UI,sans-serif;background:#ffffff;color:#334155;">
    <div style="max-width:560px;margin:0 auto;border:1px solid ${BRAND_BORDER};border-radius:12px;padding:24px;background:#fff;">
      <p style="margin:0 0 12px;font-size:16px;color:${BRAND_HEADER_TEXT};"><strong>Thank you — quotation accepted</strong></p>
      <p style="margin:0 0 12px;">We have recorded your acceptance of rental laptop quotation <strong>${escapeHtml(estimateNo)}</strong> for <strong>${escapeHtml(companyLabel)}</strong>.</p>
      <p style="margin:0 0 12px;">Our team will contact you shortly regarding the next steps.</p>
      <p style="margin:0;font-size:14px;">Regards,<br/><strong>Team Rentfoxxy</strong></p>
    </div>
  </body></html>`;
  const text = `Thank you — we have recorded your acceptance of quotation ${estimateNo} for ${companyLabel}. Our team will contact you shortly.\n\nTeam Rentfoxxy`;

  await transporter.sendMail({
    from: fromAddress,
    to: toEmail,
    cc: uniqueEmails(buildDefaultCcRecipients(senderEmail)).join(', ') || undefined,
    subject,
    text,
    html
  });
}

function buildPartyBlockLines(party) {
  const lines = [];
  const name = (party.company_name || party.companyName || '').trim();
  if (name) lines.push(name);
  const addr = (party.address || '').trim();
  if (addr) {
    addr.split(/\n+/).forEach((l) => {
      const t = l.trim();
      if (t) lines.push(t);
    });
  }
  const gst = (party.gstin || party.gst || '').trim();
  if (gst) lines.push(`GSTIN ${gst}`);
  const em = (party.email || '').trim();
  if (em) lines.push(em);
  const ph = (party.phone || '').trim();
  if (ph) lines.push(ph.startsWith('+') ? ph : `+${ph.replace(/^\+/, '')}`);
  return lines.length ? lines : ['—'];
}

/**
 * Generates PDF matching proforma invoice layout (Rentfoxxy sample).
 *
 * @param {object} opts
 */
function generateProformaPdfBuffer(opts) {
  const {
    estimateNo,
    estimateDate,
    placeOfSupply,
    billTo,
    shipTo,
    itemDescriptionLines,
    hsnSac,
    quantity,
    rate,
    taxableAmount,
    cgstAmount,
    sgstAmount,
    roundingAdjustment,
    grandTotal,
    notes
  } = opts;

  const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
  const chunks = [];

  doc.on('data', (c) => chunks.push(c));

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  let y = doc.page.margins.top;

  const logoW = 118;
  const logoH = 40;
  let textX = left;
  let headerBottom = y;
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, left, y, { width: logoW, height: logoH });
      textX = left + logoW + 12;
    } catch (logoErr) {
      console.warn('Quotation PDF logo skipped:', logoErr.message);
    }
  }
  const textW = pageWidth - (textX - left);
  doc.font('Helvetica-Bold').fontSize(9);
  let ty = y + 2;
  for (const line of SELLER_LINES) {
    doc.text(line, textX, ty, { width: textW });
    ty += 12;
  }
  headerBottom = Math.max(y + logoH, ty);
  y = headerBottom + 6;
  doc.fontSize(14).text('PROFORMA INVOICE', left, y, { align: 'center', width: pageWidth });
  y += 22;

  doc.font('Helvetica').fontSize(10);
  doc.text(`Estimate Date : ${estimateDate}`, left, y);
  doc.text(`Place Of Supply : ${placeOfSupply}`, left + pageWidth / 2, y);
  y += 18;

  const colW = (pageWidth - 12) / 2;
  const mid = left + colW + 12;

  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Bill To', left, y);
  doc.text('Ship To', mid, y);
  y += 13;

  doc.font('Helvetica').fontSize(8.5);
  const billLines = buildPartyBlockLines(billTo);
  const shipLines = buildPartyBlockLines(shipTo);

  let yBill = y;
  let yShip = y;
  billLines.forEach((ln) => {
    doc.text(ln, left, yBill, { width: colW });
    yBill += 11;
  });
  shipLines.forEach((ln) => {
    doc.text(ln, mid, yShip, { width: colW });
    yShip += 11;
  });
  y = Math.max(yBill, yShip) + 14;

  // Table header
  doc.font('Helvetica-Bold').fontSize(8);
  const tblTop = y;
  doc.rect(left, tblTop - 2, pageWidth, 14).stroke();
  doc.text('#', left + 4, tblTop + 2, { width: 16 });
  doc.text('Item & Description', left + 22, tblTop + 2, { width: 145 });
  doc.text('HSN/SAC', left + 170, tblTop + 2, { width: 48 });
  doc.text('Qty', left + 218, tblTop + 2, { width: 28 });
  doc.text('Rate', left + 248, tblTop + 2, { width: 42 });
  doc.text('CGST', left + 290, tblTop + 2, { width: 55 });
  doc.text('SGST', left + 345, tblTop + 2, { width: 55 });
  doc.text('Amount', left + 400, tblTop + 2, { width: pageWidth - 400 - 8 });
  y = tblTop + 16;

  doc.font('Helvetica').fontSize(8);
  const rowH = Math.max(36, 12 + itemDescriptionLines.length * 10);
  doc.rect(left, y - 2, pageWidth, rowH).stroke();

  doc.text('1', left + 4, y + 2, { width: 16 });
  let descY = y + 2;
  itemDescriptionLines.forEach((line) => {
    doc.text(line, left + 22, descY, { width: 145 });
    descY += 10;
  });

  const valuesY = y + 2;
  doc.text(String(hsnSac), left + 170, valuesY, { width: 48 });
  doc.text(String(quantity), left + 218, valuesY, { width: 28 });
  doc.text(formatMoney(rate), left + 248, valuesY, { width: 42 });
  doc.text(`9% ${formatMoney(cgstAmount)}`, left + 290, valuesY, { width: 55 });
  doc.text(`9% ${formatMoney(sgstAmount)}`, left + 345, valuesY, { width: 55 });
  doc.text(formatMoney(taxableAmount), left + 400, valuesY, { width: pageWidth - 400 - 8, align: 'right' });

  y += rowH + 10;

  const sumLabelX = left + pageWidth - 190;
  const sumAmtX = left + pageWidth - 82;
  const sumAmtW = 80;

  doc.font('Helvetica').fontSize(9);
  doc.text('Sub Total', sumLabelX, y);
  doc.text(formatMoney(taxableAmount), sumAmtX, y, { width: sumAmtW, align: 'right' });
  y += 14;
  doc.text('CGST9 (9%)', sumLabelX, y);
  doc.text(formatMoney(cgstAmount), sumAmtX, y, { width: sumAmtW, align: 'right' });
  y += 14;
  doc.text('SGST9 (9%)', sumLabelX, y);
  doc.text(formatMoney(sgstAmount), sumAmtX, y, { width: sumAmtW, align: 'right' });
  y += 14;
  doc.text('Rounding', sumLabelX, y);
  doc.text(formatMoney(roundingAdjustment), sumAmtX, y, { width: sumAmtW, align: 'right' });
  y += 14;
  doc.font('Helvetica-Bold').text('Total', sumLabelX, y);
  doc.text(`₹${formatMoney(grandTotal)}`, sumAmtX, y, { width: sumAmtW, align: 'right' });
  y += 18;

  doc.font('Helvetica').fontSize(8.5);
  doc.text('Total In Words', left, y);
  y += 12;
  doc.text(numberToIndianRupeesWords(grandTotal), left, y, { width: pageWidth });
  y += 20;

  doc.font('Helvetica-Bold').fontSize(9).text('Notes', left, y);
  y += 12;

  doc.font('Helvetica').fontSize(8.5);
  (notes || ['Thank You for you interest in our services.', 'Looking forward for your business.']).forEach((n) => {
    if (y > 720) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.text(n, left, y, { width: pageWidth });
    y += 11;
  });
  y += 6;

  doc.font('Helvetica-Bold').fontSize(9).text('Terms & Conditions', left, y);
  y += 12;
  doc.font('Helvetica').fontSize(8);
  TERMS.forEach((t) => {
    if (y > 720) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.text(t, left, y, { width: pageWidth });
    y += 10;
  });

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

function uniqueEmails(list) {
  const seen = new Set();
  const out = [];
  for (const e of list) {
    const n = (e || '').trim().toLowerCase();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(e.trim());
  }
  return out;
}

/**
 * @param {object} params
 */
function parseCcList(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  return String(input)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function getFrontendBaseUrl() {
  const raw = process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || 'https://crm.rentfoxxy.com';
  return String(raw).split(',')[0].trim().replace(/\/$/, '');
}

function buildAcceptUrl(token) {
  if (!token) return null;
  return `${getFrontendBaseUrl()}/quotation/accept/${encodeURIComponent(token)}`;
}

async function buildQuotationPdfAndSend(params) {
  const {
    toEmail,
    senderEmail,
    senderName,
    senderPhone,
    billTo,
    shipTo,
    quantity,
    monthlyRate,
    lockinMonths,
    securityMonths,
    placeOfSupply,
    hsnSac,
    itemDescriptionLines,
    estimateNo,
    estimateDate,
    emailConfig,
    companyName,
    ccExtra,
    ccRecipients,
    acceptToken
  } = params;

  const qty = Math.max(1, parseInt(String(quantity), 10) || 1);
  const rate = Number(monthlyRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Invalid monthly rate');
  }

  const taxableAmount = Math.round(qty * rate * 100) / 100;
  const cgstAmount = Math.round(taxableAmount * 0.09 * 100) / 100;
  const sgstAmount = Math.round(taxableAmount * 0.09 * 100) / 100;
  const rawTotal = taxableAmount + cgstAmount + sgstAmount;
  const grandTotal = Math.round(rawTotal);
  const roundingAdjustment = Math.round((grandTotal - rawTotal) * 100) / 100;

  const pdfBuffer = await generateProformaPdfBuffer({
    estimateNo,
    estimateDate: estimateDate || formatEstimateDate(new Date()),
    placeOfSupply: placeOfSupply || 'Haryana (06)',
    billTo,
    shipTo,
    itemDescriptionLines,
    hsnSac: hsnSac || DEFAULT_HSN_SAC,
    quantity: qty,
    rate,
    taxableAmount,
    cgstAmount,
    sgstAmount,
    roundingAdjustment,
    grandTotal,
    notes: ['Thank You for you interest in our services.', 'Looking forward for your business.']
  });

  const transporter = getTransporter();
  if (!transporter) {
    throw new Error('Email is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS)');
  }

  const fromAddress = process.env.QUOTATION_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER;
  const ccList = ccRecipients != null
    ? uniqueEmails(ccRecipients)
    : uniqueEmails([...getDefaultQuotationCc(), senderEmail, ...parseCcList(ccExtra)].filter(Boolean));

  const safeEstimate = String(estimateNo || 'EST').replace(/[^\w.-]+/g, '_');
  const companyLabel = (companyName || billTo?.company_name || '').trim() || 'Customer';
  const subject = `Rentfoxxy Rental Laptop Quotation - ${companyLabel}`;

  const sentAtLine = formatSentAtLine(new Date());
  const acceptUrl = buildAcceptUrl(acceptToken);
  const html = buildQuotationEmailHtml({
    senderName: senderName || 'Team',
    senderPhone: senderPhone || '',
    estimateNo,
    sentAtLine,
    config1: emailConfig.config1,
    config2: emailConfig.config2,
    acceptUrl
  });
  const text = buildQuotationEmailText({
    senderName: senderName || 'Team',
    senderPhone: senderPhone || '',
    estimateNo,
    sentAtLine,
    config1: emailConfig.config1,
    config2: emailConfig.config2,
    acceptUrl
  });

  await transporter.sendMail({
    from: fromAddress,
    to: toEmail,
    cc: ccList.length ? ccList.join(', ') : undefined,
    subject,
    text,
    html,
    attachments: [
      {
        filename: `${safeEstimate}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  });

  return { estimateNo, grandTotal, pdfBuffer };
}

module.exports = {
  SELLER_LINES,
  DEFAULT_HSN_SAC,
  DEFAULT_CC,
  getDefaultQuotationCc,
  buildDefaultCcRecipients,
  BRAND_PRIMARY,
  LOGO_PATH,
  formatEstimateDate,
  formatSentAtLine,
  numberToIndianRupeesWords,
  buildConfigOneFromLead,
  isConfigTwoActive,
  buildQuotationEmailHtml,
  buildQuotationEmailText,
  generateProformaPdfBuffer,
  buildQuotationPdfAndSend,
  sendQuotationAcceptedEmail,
  buildAcceptUrl,
  getTransporter,
  parseCcList
};
