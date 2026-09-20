/**
 * Rent / laptop proforma invoice PDF + email helpers (Rentfoxxy / TRUETECH format).
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const mailTransport = require('./mailTransport');
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

/** Rentfoxxy brand orange — bright, not burnt/dark */
const BRAND_PRIMARY = '#F97316';
const BRAND_PRIMARY_DARK = '#EA580C';
const BRAND_BG_LIGHT = '#ffffff';
const BRAND_BORDER = '#FDBA74';
const BRAND_CELL_HEADER_BG = '#FFF7ED';
const BRAND_HEADER_TEXT = '#FFFFFF';
const BRAND_LABEL = '#C2410C';

const { QUOTATION_TERMS: TERMS } = require('../constants/quotationTerms');

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

function buildQuotationEmailHtml({
  senderName,
  senderPhone,
  estimateNo,
  sentAtLine,
  config1,
  config2,
  acceptUrl,
  isSale = false,
  priceLabel,
}) {
  const hasC2 = isConfigTwoActive(config2);
  const unitLabel = priceLabel || (isSale ? 'Unit Price' : 'Monthly Unit Rental Price');
  const introLine = isSale
    ? 'Please find below the pricing for the configuration you asked about.'
    : 'Please find below the rental pricing for the configuration you asked about.';

  // One accent, spent on the Accept button and a hairline rule — the rest is ink
  // on white so the numbers read first.
  const INK = '#111827';
  const BODY = '#374151';
  const MUTED = '#6b7280';
  const LINE = '#e5e7eb';
  const HEAD_BG = '#f9fafb';

  const th = `padding:11px 14px;text-align:left;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;`
    + `border-bottom:2px solid ${LINE};color:${MUTED};font-weight:600;background:${HEAD_BG};`;
  const tdSpec = `padding:12px 14px;font-size:14px;border-bottom:1px solid ${LINE};color:${MUTED};width:34%;`;
  const td = `padding:12px 14px;font-size:14px;border-bottom:1px solid ${LINE};color:${INK};font-weight:500;`;
  const tdPrice = `padding:14px;font-size:17px;border-bottom:1px solid ${LINE};color:${INK};font-weight:700;`;

  const c1p = escapeHtml(config1.processor);
  const c1r = escapeHtml(config1.ram);
  const c1s = escapeHtml(config1.storage);
  const c1m = escapeHtml(formatRsIndian(config1.monthlyRate));

  const c2p = hasC2 ? escapeHtml(config2.processor || '—') : '';
  const c2r = hasC2 ? escapeHtml(config2.ram || '—') : '';
  const c2s = hasC2 ? escapeHtml(config2.storage || '—') : '';
  const c2m = hasC2 ? escapeHtml(formatRsIndian(config2.monthlyRate)) : '';

  const headerCols = hasC2
    ? `<th style="${th}">Specification</th><th style="${th}">Configuration 1</th><th style="${th}">Configuration 2</th>`
    : `<th style="${th}">Specification</th><th style="${th}">Configuration</th>`;
  const row = (label, a, b, styleA) => (hasC2
    ? `<tr><td style="${tdSpec}">${label}</td><td style="${styleA}">${a}</td><td style="${styleA}">${b}</td></tr>`
    : `<tr><td style="${tdSpec}">${label}</td><td style="${styleA}">${a}</td></tr>`);

  const rows = row('Processor', c1p, c2p, td)
    + row('RAM', c1r, c2r, td)
    + row('Storage', c1s, c2s, td)
    + row(escapeHtml(unitLabel), c1m, c2m, tdPrice);

  const phoneLine = escapeHtml(senderPhone || '');
  const termsItems = TERMS
    .map((t) => `<li style="margin-bottom:7px;">${escapeHtml(String(t).replace(/^\d+[.\-]\s*/, ''))}</li>`)
    .join('');

  // Bulletproof-ish button: a padded anchor, no background image, so it survives
  // Outlook and still looks like a button in Gmail and Apple Mail.
  const acceptBlock = acceptUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px auto 10px;">
        <tr><td style="border-radius:8px;background:${BRAND_PRIMARY};">
          <a href="${escapeHtml(acceptUrl)}"
             style="display:inline-block;padding:14px 38px;font-size:15px;font-weight:700;color:#ffffff;
                    text-decoration:none;border-radius:8px;letter-spacing:0.01em;">Accept this quotation</a>
        </td></tr>
      </table>
      <p style="margin:0 0 22px;font-size:12px;color:${MUTED};text-align:center;">
        One click confirms the quotation — no login needed.</p>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:620px;margin:0 auto;padding:24px 12px 36px;">
    <div style="border-radius:14px;border:1px solid ${LINE};overflow:hidden;background:#ffffff;">

      <div style="padding:22px 26px 18px;border-bottom:3px solid ${BRAND_PRIMARY};">
        <div style="font-size:21px;font-weight:700;letter-spacing:-0.01em;color:${INK};">Rentfoxxy</div>
        <div style="font-size:12px;color:${MUTED};margin-top:5px;">
          Quotation ${escapeHtml(estimateNo)}${sentAtLine ? ` &nbsp;·&nbsp; ${escapeHtml(sentAtLine)}` : ''}
        </div>
      </div>

      <div style="padding:24px 26px 8px;color:${BODY};line-height:1.6;font-size:14.5px;">
        <p style="margin:0 0 14px;color:${INK};"><strong>Dear Sir,</strong></p>
        <p style="margin:0 0 14px;">Thank you for your time today. ${introLine}</p>

        <table role="presentation" cellpadding="0" cellspacing="0"
               style="width:100%;border-collapse:collapse;margin:18px 0 12px;border:1px solid ${LINE};border-radius:10px;">
          <thead><tr>${headerCols}</tr></thead>
          <tbody>${rows}</tbody>
        </table>

        <p style="margin:0 0 6px;font-size:13px;color:${INK};font-weight:600;">Note: Prices are exclusive of taxes.</p>
        <p style="margin:0 0 20px;font-size:13px;color:${MUTED};">
          Models can vary with stock availability, but the configuration stays the same.</p>

        ${acceptBlock}

        <div style="border-top:1px solid ${LINE};padding-top:18px;">
          <p style="margin:0 0 9px;font-weight:600;color:${INK};font-size:13.5px;">Terms &amp; Conditions</p>
          <ol style="margin:0 0 6px;padding-left:20px;color:${BODY};font-size:13px;line-height:1.55;">${termsItems}</ol>
        </div>

        <p style="margin:20px 0 20px;font-size:14px;">Please feel free to contact me for any clarification.</p>

        <p style="margin:0 0 24px;font-size:14px;color:${INK};">
          Regards,<br/>
          <strong>${escapeHtml(senderName || 'Team')}</strong>${phoneLine ? `<br/>${phoneLine}` : ''}
        </p>
      </div>

      <div style="padding:14px 26px 18px;background:${HEAD_BG};border-top:1px solid ${LINE};">
        <p style="margin:0;font-size:11.5px;color:${MUTED};line-height:1.5;">
          TRUETECH SERVICES PRIVATE LIMITED &nbsp;·&nbsp; GSTIN 06AAHCT0310N1ZG<br/>
          The full quotation is attached as a PDF.
        </p>
      </div>

    </div>
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
${TERMS.map((t) => `- ${String(t).replace(/^\d+[.\-]\s*/, '')}`).join('\n')}

Please feel free to contact me for any clarification.
${acceptUrl ? `\nAccept this quotation: ${acceptUrl}\n` : ''}

Regards,
${senderName || 'Team'}${senderPhone ? `\n${senderPhone}` : ''}

--
${estimateNo}${sentAtLine ? ` · ${sentAtLine}` : ''}
(Proforma PDF attached.)`;
}

async function sendQuotationAcceptedEmail({ toEmail, companyName, estimateNo, senderEmail, senderName }) {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error('Email is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS)');
  }
  const fromAddress = mailTransport.getFromAddress('quotation');
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

/**
 * Lead quotations go out from the no-reply mailbox, same as sales-pipeline
 * quotations: QUOTATION_SMTP_* -> DISPATCH_SMTP_* -> SMTP_*.
 */
function getTransporter() {
  return mailTransport.getTransport('quotation');
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
  const candidates = [
    process.env.CRM_PUBLIC_URL,
    process.env.PUBLIC_APP_URL,
    ...String(process.env.FRONTEND_URL || '').split(','),
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  const httpsCrm = candidates.find((s) => /^https:\/\/crm\./i.test(s));
  if (httpsCrm) return httpsCrm.replace(/\/$/, '');
  const nonLocal = candidates.find((s) => /^https:\/\//i.test(s) && !/localhost|127\.0\.0\.1/i.test(s));
  if (nonLocal) return nonLocal.replace(/\/$/, '');
  return 'https://crm.rentfoxxy.com';
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

  const fromAddress = mailTransport.getFromAddress('quotation');
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
    acceptUrl,
    isSale: Boolean(emailConfig.isSale),
    priceLabel: emailConfig.priceLabel,
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
