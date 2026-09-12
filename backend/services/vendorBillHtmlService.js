'use strict';

const fs = require('fs');
const path = require('path');
const { loadCompany } = require('./customerInvoiceHtmlService');
const { amountInIndianWords } = require('../utils/indianAmountWords');
const { formatPdfDateIst, PDF_TZ_LABEL } = require('../utils/pdfDateTimeUtils');
const { fmtMoneyInr, fmtMoneyPlain, escapeHtml } = require('../utils/invoiceItemFormatting');

const CSS_PATH = path.join(__dirname, '../templates/rentfoxxy-invoice.css');
const LOGO_PATH = path.join(__dirname, '../assets/rentfoxxy-logo.png');

function logoDataUri() {
  try {
    if (!fs.existsSync(LOGO_PATH)) return '';
    return `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`;
  } catch {
    return '';
  }
}

function parseLineItems(bill) {
  if (typeof bill.line_items === 'string') {
    try { return JSON.parse(bill.line_items); } catch { return []; }
  }
  return bill.line_items || [];
}

function fmtDate(d) {
  return formatPdfDateIst(d, { fallback: '—', withLabel: false });
}

async function buildVendorBillHtml(bill, company) {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  const lines = parseLineItems(bill);
  const logo = logoDataUri();
  const gst = parseFloat(bill.gst_amount || 0);
  const debit = parseFloat(bill.debit_note_adjustment || 0);
  const deviceCount = lines.length;

  const bodyRows = lines.map((line) => `
    <tr>
      <td>${escapeHtml(line.ttspl_id || '—')}</td>
      <td>${escapeHtml(line.serial_number || '—')}</td>
      <td>${escapeHtml(fmtDate(line.received_date || line.rent_start))}</td>
      <td>${escapeHtml(line.return_date || line.rent_end ? fmtDate(line.return_date || line.rent_end) : '—')}</td>
      <td class="num">${escapeHtml(String(line.days_in_month ?? '—'))}</td>
      <td class="num">${fmtMoneyInr(line.monthly_rate)}</td>
      <td class="num">${fmtMoneyInr(line.amount)}</td>
    </tr>`).join('');

  const totalsRows = [
    `<tr><td>Subtotal (${deviceCount} unit${deviceCount === 1 ? '' : 's'})</td><td>${fmtMoneyInr(bill.subtotal)}</td></tr>`,
    `<tr><td>GST 18%</td><td>${fmtMoneyInr(gst)}</td></tr>`,
  ];
  if (debit > 0) {
    totalsRows.push(`<tr class="credit"><td>Debit adjustments</td><td>- ${fmtMoneyPlain(debit)}</td></tr>`);
  }
  totalsRows.push(`<tr class="grand"><td>Total payable</td><td>${fmtMoneyInr(bill.total_payable)}</td></tr>`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(bill.bill_number)} – Rentfoxxy vendor bill</title>
<style>${css}</style>
</head>
<body>
<table class="head">
  <tr>
    <td>
      ${logo
    ? `<img class="brand-img" src="${logo}" alt="Rentfoxxy">`
    : '<div class="brand">rent<span>foxxy</span></div>'}
    </td>
    <td class="doc-title">
      <div class="kind">Vendor Bill</div>
      <div class="sub">Monthly rental purchase</div>
      <div class="num">${escapeHtml(bill.bill_number)}</div>
    </td>
  </tr>
</table>

<table class="supplier">
  <tr>
    <td>
      <div class="name">${escapeHtml(company.legal_name)}</div>
      <div class="addr">${escapeHtml(company.address || '')}${company.gstin ? ` &nbsp;|&nbsp; GSTIN ${escapeHtml(company.gstin)}` : ''}</div>
    </td>
  </tr>
</table>

<table class="meta">
  <tr>
    <td class="block">
      <h3>Vendor</h3>
      <div class="party">${escapeHtml(bill.vendor_name || bill.vendor_id)}</div>
      <div class="addr">${escapeHtml(bill.vendor_address || '')}</div>
      <table class="kv" style="margin-top:6px">
        ${bill.gst_number ? `<tr><td>GSTIN</td><td>${escapeHtml(bill.gst_number)}</td></tr>` : ''}
        ${bill.vendor_email ? `<tr><td>Email</td><td>${escapeHtml(bill.vendor_email)}</td></tr>` : ''}
      </table>
    </td>
    <td class="block">
      <h3>Bill details</h3>
      <table class="kv">
        <tr><td>Bill number</td><td>${escapeHtml(bill.bill_number)}</td></tr>
        <tr><td>Bill date</td><td>${fmtDate(bill.bill_date)}</td></tr>
        <tr><td>Billing period</td><td>${fmtDate(bill.from_date)} – ${fmtDate(bill.to_date)} (${PDF_TZ_LABEL})</td></tr>
        <tr><td>Units billed</td><td>${deviceCount}</td></tr>
      </table>
    </td>
  </tr>
</table>

<table class="items">
  <thead>
    <tr>
      <th>TTSPL ID</th>
      <th>Serial</th>
      <th>Received</th>
      <th>Return</th>
      <th class="num">Days</th>
      <th class="num">Rate</th>
      <th class="num">Amount</th>
    </tr>
  </thead>
  <tbody>
    ${bodyRows || '<tr><td colspan="7">No line items</td></tr>'}
  </tbody>
</table>

<table class="totals-wrap">
  <tr>
    <td class="words-cell">
      <div class="words">
        <div class="lbl">Amount in words</div>
        <div class="val">${escapeHtml(amountInIndianWords(bill.total_payable))}</div>
      </div>
    </td>
    <td>
      <table class="totals" align="right">
        ${totalsRows.join('\n        ')}
      </table>
    </td>
  </tr>
</table>

<div class="computer">This is a computer-generated vendor bill and does not require a physical signature.</div>
</body>
</html>`;
}

module.exports = {
  buildVendorBillHtml,
  loadCompany,
  parseLineItems,
};
