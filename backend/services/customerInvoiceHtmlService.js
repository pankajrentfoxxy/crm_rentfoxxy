'use strict';

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { mergeCompany } = require('../utils/companyDefaults');
const { amountInIndianWords } = require('../utils/indianAmountWords');
const {
  formatPdfDateIst,
  PDF_TZ_LABEL,
} = require('../utils/pdfDateTimeUtils');
const {
  fmtPeriod,
  parseItemDisplay,
  groupLineItems,
  fmtMoneyPlain,
  fmtMoneyInr,
  escapeHtml,
  gstStateCodeFromGstin,
  placeOfSupplyLabel,
  STATE_NAMES,
  isProRataLine,
} = require('../utils/invoiceItemFormatting');

const SELLER_STATE_CODE = '06';

function isIntraStateSupply(buyerCode, sellerCode = SELLER_STATE_CODE) {
  const b = String(buyerCode || '').trim().slice(0, 2);
  const s = String(sellerCode || SELLER_STATE_CODE).trim().slice(0, 2);
  if (!b || !/^\d{2}$/.test(b)) return true;
  return b === s;
}
const CSS_PATH = path.join(__dirname, '../templates/rentfoxxy-invoice.css');
const LOGO_PATH = path.join(__dirname, '../assets/rentfoxxy-logo.png');

function parseLineItems(invoice) {
  if (typeof invoice.line_items === 'string') {
    try { return JSON.parse(invoice.line_items); } catch { return []; }
  }
  return invoice.line_items || [];
}

function logoDataUri() {
  try {
    if (!fs.existsSync(LOGO_PATH)) return '';
    const buf = fs.readFileSync(LOGO_PATH);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

async function loadCompany(entityCode) {
  const code = entityCode === 'gorefurbo' ? 'gorefurbo' : 'rentfoxxy';
  try {
    const r = await pool.query(
      `SELECT code, legal_name, gstin, pan, email, phone, address, state_code, logo_url
         FROM companies WHERE code = $1 LIMIT 1`,
      [code],
    );
    if (r.rows[0]) return mergeCompany({ ...r.rows[0], code });
  } catch (_) { /* pre-migration */ }
  return mergeCompany({ code });
}

function bankDetails() {
  return {
    accountName: process.env.INVOICE_BANK_ACCOUNT_NAME || 'TrueTech Services Private Limited',
    bankName: process.env.INVOICE_BANK_NAME || 'HDFC Bank',
    accountNumber: process.env.INVOICE_BANK_ACCOUNT || '—',
    ifsc: process.env.INVOICE_BANK_IFSC || '—',
    upi: process.env.INVOICE_BANK_UPI || 'accounts@rentfoxxy.com',
  };
}

function fmtInvoiceDate(d) {
  return formatPdfDateIst(d, { fallback: '—', withLabel: false });
}

function monthYearLabel(ym) {
  if (!ym) return '';
  const m = String(ym).match(/^(\d{4})-(\d{2})$/);
  if (!m) return ym;
  const monthIdx = Number(m[2]) - 1;
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[monthIdx] || m[2]} ${m[1]}`;
}

function groupTitleCatchup(lines) {
  const first = lines[0];
  const label = monthYearLabel(first?.period)
    || fmtPeriod(first?.rent_start, first?.rent_end).replace(/\s\d{4}$/, '');
  return `Catch-up charges${label ? ` for ${label}` : ''} <small>— devices delivered mid-month, billed pro-rata</small>`;
}

function groupTitleFull(invoice) {
  const from = fmtInvoiceDate(invoice.from_date);
  const to = fmtInvoiceDate(invoice.to_date);
  const label = monthYearLabel(`${invoice.invoice_year}-${String(invoice.invoice_month).padStart(2, '0')}`);
  return `Rental for ${label || 'billing period'} <small>— ${from} – ${to}, full month</small>`;
}

function renderLineRow(line, idx, alt) {
  const item = parseItemDisplay(line.brand, line.model);
  const serial = line.serial_number ? `SN ${escapeHtml(line.serial_number)}` : '';
  const proRataTag = isProRataLine(line) ? '<span class="tag">pro-rata</span>' : '';
  const rate = line.monthly_rate != null ? line.monthly_rate : (
    Number(line.month_days) > 0
      ? (Number(line.amount || 0) / Number(line.days_in_month || 1)) * Number(line.month_days)
      : 0
  );
  const daysCell = `${Number(line.days_in_month || 0)} / ${Number(line.month_days || '—')}`;

  return `<tr${alt ? ' class="alt"' : ''}>
    <td>${idx}</td>
    <td><span class="asset">${escapeHtml(line.ttspl_id || '—')}</span>${serial ? `<span class="serial">${serial}</span>` : ''}</td>
    <td>${escapeHtml(item.title)}${item.note ? `<span class="item-note">${escapeHtml(item.note)}</span>` : ''}${proRataTag}</td>
    <td class="period">${escapeHtml(fmtPeriod(line.rent_start, line.rent_end))}</td>
    <td class="ctr">${daysCell}</td>
    <td class="num">${fmtMoneyPlain(rate)}</td>
    <td class="num">${fmtMoneyPlain(line.amount)}</td>
  </tr>`;
}

function renderGroup(titleHtml, lines, startIdx, altStart, subtotalLabel) {
  if (!lines.length) return { html: '', nextIdx: startIdx };
  let html = `<tr class="group"><td colspan="7">${titleHtml}</td></tr>`;
  let idx = startIdx;
  let alt = !!altStart;
  let subtotal = 0;
  for (const line of lines) {
    html += renderLineRow(line, idx, alt);
    subtotal += Number(line.amount || 0);
    idx += 1;
    alt = !alt;
  }
  html += `<tr class="subtotal"><td colspan="6" class="num">${escapeHtml(subtotalLabel)}</td><td class="num">${fmtMoneyPlain(subtotal)}</td></tr>`;
  return { html, nextIdx: idx, subtotal };
}

function gstDisplayRows(invoice, company, customerGstin) {
  const gstAmount = Number(invoice.gst_amount || 0);
  const gstRate = Number(invoice.gst_percent != null ? invoice.gst_percent : 18);
  const sellerCode = String(company.state_code || SELLER_STATE_CODE).padStart(2, '0').slice(0, 2);
  const buyerCode = gstStateCodeFromGstin(customerGstin);
  const intra = isIntraStateSupply(buyerCode || invoice.billing_state, sellerCode);

  const rows = [];
  if (intra) {
    const half = +(gstAmount / 2).toFixed(2);
    const other = +(gstAmount - half).toFixed(2);
    rows.push({ label: `CGST @ ${gstRate / 2}%`, value: half });
    rows.push({ label: `SGST @ ${gstRate / 2}%`, value: other });
  } else {
    rows.push({ label: `IGST @ ${gstRate}%`, value: gstAmount });
  }
  return { rows, intra, sellerCode, buyerCode };
}

function gstNoteText(company, customerGstin, intra) {
  const sellerCode = String(company.state_code || SELLER_STATE_CODE).padStart(2, '0').slice(0, 2);
  const buyerCode = gstStateCodeFromGstin(customerGstin);
  const sellerName = STATE_NAMES[sellerCode] || `State (${sellerCode})`;
  const buyerName = STATE_NAMES[buyerCode] || (buyerCode ? `State (${buyerCode})` : 'customer state');
  const taxLine = intra
    ? 'Intra-state supply — CGST 9% + SGST 9% applies.'
    : `Inter-state supply from ${sellerName} (${sellerCode}) to ${buyerName} (${buyerCode || '—'}) — IGST applies.`;
  return `SAC 997314 – Leasing or rental services of computers without operator. ${taxLine} All amounts in INR. Dates in ${PDF_TZ_LABEL}.`;
}

function customerAddressHtml(invoice) {
  const parts = [
    invoice.billing_address,
    [invoice.billing_city, invoice.billing_state, invoice.billing_pincode].filter(Boolean).join(', '),
  ].filter(Boolean);
  return parts.map((p) => escapeHtml(p)).join('<br>') || '—';
}

function buildInvoiceHtml(invoice, company) {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  const lines = parseLineItems(invoice);
  const { catchup, full } = groupLineItems(lines);
  const logo = logoDataUri();
  const bank = bankDetails();
  const gstin = invoice.gst_number || invoice.gst_no || '';
  const deviceCount = lines.length;
  const credit = parseFloat(invoice.credit_note_adjustment || 0);
  const { rows: gstRows, intra } = gstDisplayRows(invoice, company, gstin);

  let bodyRows = '';
  let rowNum = 1;
  let altToggle = false;
  if (catchup.length) {
    const catchupLabel = monthYearLabel(catchup[0]?.period) || 'prior period';
    const g = renderGroup(groupTitleCatchup(catchup), catchup, rowNum, altToggle, `Catch-up subtotal (${catchupLabel})`);
    bodyRows += g.html;
    rowNum = g.nextIdx;
    altToggle = (catchup.length % 2) === 1;
  }
  if (full.length) {
    const monthLabel = monthYearLabel(`${invoice.invoice_year}-${String(invoice.invoice_month).padStart(2, '0')}`) || 'period';
    const g = renderGroup(groupTitleFull(invoice), full, rowNum, altToggle, `${monthLabel} subtotal`);
    bodyRows += g.html;
  }

  const totalsRows = [
    `<tr><td>Subtotal (${deviceCount} device${deviceCount === 1 ? '' : 's'})</td><td>${fmtMoneyInr(invoice.subtotal)}</td></tr>`,
    ...gstRows.map((r) => `<tr><td>${escapeHtml(r.label)}</td><td>${fmtMoneyInr(r.value)}</td></tr>`),
  ];
  if (credit > 0) {
    totalsRows.push(`<tr class="credit"><td>Credit notes</td><td>- ${fmtMoneyPlain(credit)}</td></tr>`);
  }
  totalsRows.push(`<tr class="grand"><td>Total payable</td><td>${fmtMoneyInr(invoice.grand_total)}</td></tr>`);

  const contactParts = [
    invoice.customer_contact_name || invoice.customer_name,
    invoice.customer_email,
    invoice.customer_phone,
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(invoice.invoice_number)} – Rentfoxxy tax invoice</title>
<style>${css}</style>
</head>
<body>
<table class="head">
  <tr>
    <td>
      ${logo
    ? `<img class="brand-img" src="${logo}" alt="Rentfoxxy">`
    : '<div class="brand">rent<span>foxxy</span></div><div class="brand-sub">Laptop and workstation rentals</div>'}
    </td>
    <td class="doc-title">
      <div class="kind">Tax Invoice</div>
      <div class="sub">Prepaid rental</div>
      <div class="num">${escapeHtml(invoice.invoice_number)}</div>
    </td>
  </tr>
</table>

<table class="supplier">
  <tr>
    <td>
      <div class="name">${escapeHtml(company.legal_name)}</div>
      <div class="addr">${escapeHtml(company.address || '')}${company.address ? ' &nbsp;|&nbsp; ' : ''}GSTIN ${escapeHtml(company.gstin || '—')}${company.pan ? ` &nbsp;|&nbsp; PAN ${escapeHtml(company.pan)}` : ''}</div>
      <div class="addr">${escapeHtml(company.email || 'accounts@rentfoxxy.com')}${company.phone ? ` &nbsp;|&nbsp; ${escapeHtml(company.phone)}` : ''} &nbsp;|&nbsp; www.rentfoxxy.com</div>
    </td>
  </tr>
</table>

<table class="meta">
  <tr>
    <td class="block">
      <h3>Bill to</h3>
      <div class="party">${escapeHtml(invoice.customer_name || invoice.customer_id)}</div>
      <div class="addr">${customerAddressHtml(invoice)}</div>
      <table class="kv" style="margin-top:6px">
        ${gstin ? `<tr><td>GSTIN</td><td>${escapeHtml(gstin)}</td></tr>` : ''}
        <tr><td>Place of supply</td><td>${escapeHtml(placeOfSupplyLabel(gstin, invoice.billing_state))}</td></tr>
        ${contactParts.length ? `<tr><td>Contact</td><td>${escapeHtml(contactParts.join(' · '))}</td></tr>` : ''}
      </table>
    </td>
    <td class="block">
      <h3>Invoice details</h3>
      <table class="kv">
        <tr><td>Invoice number</td><td>${escapeHtml(invoice.invoice_number)}</td></tr>
        <tr><td>Invoice date</td><td>${fmtInvoiceDate(invoice.invoice_date)}</td></tr>
        <tr><td>Billing period</td><td>${fmtInvoiceDate(invoice.from_date)} – ${fmtInvoiceDate(invoice.to_date)} (${PDF_TZ_LABEL})</td></tr>
        <tr><td>Payment due</td><td>${fmtInvoiceDate(invoice.invoice_date)} (prepaid)</td></tr>
        <tr><td>Reverse charge</td><td>No</td></tr>
        <tr><td>Devices billed</td><td>${deviceCount}</td></tr>
      </table>
    </td>
  </tr>
</table>

<table class="items">
  <colgroup>
    <col class="c-idx"><col class="c-asset"><col class="c-item"><col class="c-period"><col class="c-days"><col class="c-rate"><col class="c-amt">
  </colgroup>
  <thead>
    <tr>
      <th>#</th>
      <th>Asset ID / Serial</th>
      <th>Item</th>
      <th>Period</th>
      <th class="ctr">Days</th>
      <th class="num">Rate / mo</th>
      <th class="num">Amount (₹)</th>
    </tr>
  </thead>
  <tbody>
    ${bodyRows}
  </tbody>
</table>

<table class="totals-wrap">
  <tr>
    <td class="words-cell">
      <div class="words">
        <div class="lbl">Amount in words</div>
        <div class="val">${escapeHtml(amountInIndianWords(invoice.grand_total))}</div>
      </div>
      <div class="gst-note">${escapeHtml(gstNoteText(company, gstin, intra))}</div>
    </td>
    <td>
      <table class="totals" align="right">
        ${totalsRows.join('\n        ')}
      </table>
    </td>
  </tr>
</table>

<table class="foot">
  <tr>
    <td>
      <h4>Pay to</h4>
      <table class="kv">
        <tr><td>Account name</td><td>${escapeHtml(bank.accountName)}</td></tr>
        <tr><td>Bank</td><td>${escapeHtml(bank.bankName)}</td></tr>
        <tr><td>Account number</td><td>${escapeHtml(bank.accountNumber)}</td></tr>
        <tr><td>IFSC</td><td>${escapeHtml(bank.ifsc)}</td></tr>
        <tr><td>UPI</td><td>${escapeHtml(bank.upi)}</td></tr>
      </table>
    </td>
    <td>
      <h4>Terms</h4>
      <ol>
        <li>Rental is prepaid; pay on or before the invoice date to keep devices active.</li>
        <li>Mid-month deliveries are billed pro-rata on calendar days.</li>
        <li>Devices remain the property of ${escapeHtml(company.legal_name)}.</li>
        <li>Disputes must be raised within 7 days of the invoice date.</li>
      </ol>
      <div class="sign"><span class="line">For ${escapeHtml(company.legal_name)}<br>Authorised signatory</span></div>
    </td>
  </tr>
</table>

<div class="computer">This is a computer-generated invoice and does not require a physical signature.</div>
</body>
</html>`;
}

module.exports = {
  buildInvoiceHtml,
  loadCompany,
  parseLineItems,
};
