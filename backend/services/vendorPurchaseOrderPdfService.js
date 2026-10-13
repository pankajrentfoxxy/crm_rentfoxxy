const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { formatPdfDateIstOrDash } = require('../utils/pdfDateTimeUtils');
const { mergeCompany } = require('../utils/companyDefaults');
const { escapeHtml } = require('../utils/escapeHtml');
const { amountInIndianWords } = require('../utils/indianAmountWords');
const { STATE_NAMES } = require('../utils/invoiceItemFormatting');

const UPLOAD_DIR = path.join(__dirname, '../uploads/vendor-po-documents');
const LOGO_PATH = path.join(__dirname, '../assets/rentfoxxy-logo.png');
const GST_RATE = 18;
const LAPTOP_HSN = '847130';
const BUYER_STATE_CODE = '06'; // TrueTech Services is registered in Haryana.

// Vendor `state` is free text: "MH", "maharashtra", "Delhi"... map the common ones to GST codes.
const STATE_ALIASES = {
  hr: '06', haryana: '06', dl: '07', delhi: '07', 'new delhi': '07', mh: '27', maharashtra: '27',
  up: '09', 'uttar pradesh': '09', ka: '29', karnataka: '29', tn: '33', 'tamil nadu': '33',
  gj: '24', gujarat: '24', rj: '08', rajasthan: '08', pb: '03', punjab: '03', wb: '19',
  'west bengal': '19', ts: '36', tg: '36', telangana: '36', ap: '37', 'andhra pradesh': '37',
  kl: '32', kerala: '32', ch: '04', chandigarh: '04', mp: '23', 'madhya pradesh': '23',
  uk: '05', uttarakhand: '05', hp: '02', 'himachal pradesh': '02', br: '10', bihar: '10',
  od: '21', or: '21', odisha: '21', jh: '20', jharkhand: '20', cg: '22', chhattisgarh: '22',
};

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function parseLineItems(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function formatPoType(t) {
  if (!t) return '—';
  return String(t)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCurrency(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0.00';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function stateCodeFromGstin(gstin) {
  const g = String(gstin || '').trim().toUpperCase();
  return /^\d{2}[A-Z0-9]{13}$/.test(g) ? g.slice(0, 2) : '';
}

function stateCodeFromText(state) {
  const s = String(state || '').trim().toLowerCase().replace(/_/g, ' ');
  if (!s) return '';
  if (STATE_ALIASES[s]) return STATE_ALIASES[s];
  const hit = Object.entries(STATE_NAMES).find(([, name]) => name.toLowerCase() === s);
  return hit ? hit[0] : '';
}

function stateLabel(code, fallbackText) {
  if (code && STATE_NAMES[code]) return `${STATE_NAMES[code]} (${code})`;
  return fallbackText ? formatPoType(fallbackText) : '—';
}

function paymentTermsLabel(vendor) {
  const t = String(vendor?.po_payment_terms || '').toLowerCase();
  const base = {
    postpaid_monthly: 'Postpaid monthly',
    prepaid: 'Advance / prepaid',
    postpaid: 'Postpaid',
  }[t] || (t ? formatPoType(t) : '');
  const days = Number(vendor?.credit_days) || 0;
  if (base && days) return `${base}, ${days} day(s) credit`;
  return base || (days ? `${days} day(s) credit` : 'As agreed');
}

function logoDataUri() {
  try {
    if (!fs.existsSync(LOGO_PATH)) return '';
    return `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`;
  } catch {
    return '';
  }
}

async function loadVendor(po, vendorArg) {
  if (po.vendor_id) {
    try {
      const r = await pool.query(
        `SELECT vendor_id, business_name, first_name, last_name, email, phone, address, city, state,
                pincode, gst_number, pan_number, msme_number, contact_person_name, contact_person_phone,
                po_payment_terms, credit_days
           FROM vendors WHERE vendor_id = $1`,
        [po.vendor_id]
      );
      if (r.rows[0]) return { ...r.rows[0], ...Object.fromEntries(Object.entries(vendorArg || {}).filter(([, v]) => v)) };
    } catch (e) {
      console.warn('PO pdf vendor load:', e.message);
    }
  }
  return {
    business_name: vendorArg?.business_name || po.vendor_business_name,
    first_name: vendorArg?.first_name || po.vendor_first_name,
    email: vendorArg?.email || po.vendor_email,
    phone: po.vendor_phone,
    address: po.vendor_address,
    state: po.vendor_state,
    gst_number: vendorArg?.gst_number || po.vendor_gst,
  };
}

async function loadCompany() {
  try {
    const r = await pool.query(
      `SELECT code, legal_name, gstin, pan, email, phone, address, state_code, logo_url
         FROM companies WHERE code = 'rentfoxxy' LIMIT 1`
    );
    return mergeCompany(r.rows[0] ? { ...r.rows[0], code: 'rentfoxxy' } : { code: 'rentfoxxy' });
  } catch {
    return mergeCompany({ code: 'rentfoxxy' });
  }
}

/** Line rows + GST split. Intra-state = vendor's GST state equals ours (Haryana). */
function computePoTotals(po, vendor, company) {
  const buyerCode = String(company.state_code || BUYER_STATE_CODE).padStart(2, '0').slice(0, 2);
  const vendorCode = stateCodeFromGstin(vendor.gst_number) || stateCodeFromText(vendor.state);
  const intra = vendorCode ? vendorCode === buyerCode : !!po.is_same_state;
  const isDirect = String(po.purchase_order_type || '').toLowerCase() === 'direct_purchase';

  const rows = parseLineItems(po.line_items).map((line, idx) => {
    const qty = Number(line.quantity ?? line.qty) || 0;
    const rate = Number(line.rate ?? line.unit_price ?? line.price) || 0;
    const taxable = round2(qty * rate);
    const gst = round2((taxable * GST_RATE) / 100);
    const periodMonths = Number(isDirect ? line.warranty : (line.vendor_locking_period ?? line.locking_period)) || 0;
    return {
      sn: idx + 1,
      title: [line.brand || line.brand_name, line.model || line.model_name || line.product_name].filter(Boolean).join(' ') || 'Item',
      category: line.category || 'Laptop',
      specs: [line.processor, line.generation, line.ram, line.storage, line.screen_size, line.gpu]
        .filter((x) => x != null && !['', '-', '—', 'na', 'n/a'].includes(String(x).trim().toLowerCase()))
        .map((x) => String(x).trim()),
      period: periodMonths ? `${periodMonths} month${periodMonths === 1 ? '' : 's'}` : '',
      hsn: line.hsn_code || LAPTOP_HSN,
      qty,
      rate,
      taxable,
      gst,
      total: round2(taxable + gst),
    };
  });

  const subtotal = round2(rows.reduce((s, r) => s + r.taxable, 0));
  const tax = round2(rows.reduce((s, r) => s + r.gst, 0));
  const half = round2(tax / 2);
  return {
    rows,
    intra,
    isDirect,
    vendorCode,
    buyerCode,
    subtotal,
    cgst: intra ? half : 0,
    sgst: intra ? round2(tax - half) : 0,
    igst: intra ? 0 : tax,
    tax,
    grandTotal: round2(subtotal + tax),
    totalQty: rows.reduce((s, r) => s + r.qty, 0),
  };
}

function buildPoHtml({ po, vendor, company, t }) {
  const esc = escapeHtml;
  const poNumber = po.purchase_order_number || `PO-${po.po_id}`;
  const logo = logoDataUri();
  const vendorName = vendor.business_name || [vendor.first_name, vendor.last_name].filter(Boolean).join(' ') || 'Vendor';
  const vendorAddr = [vendor.address, vendor.city, vendor.pincode].filter(Boolean).join(', ');
  const contactName = vendor.contact_person_name && vendor.contact_person_name !== vendorName ? vendor.contact_person_name : '';
  const periodHead = t.isDirect ? 'Warranty' : 'Locking';
  const showPeriod = t.rows.some((r) => r.period);

  const itemRows = t.rows.map((r) => `
    <tr>
      <td class="c">${r.sn}</td>
      <td>
        <div class="item">${esc(r.title)}</div>
        ${r.specs.length ? `<div class="spec">${esc(r.specs.join(' | '))}</div>` : ''}
      </td>
      <td class="c">${esc(r.hsn)}</td>
      ${showPeriod ? `<td class="c">${esc(r.period || '—')}</td>` : ''}
      <td class="n">${r.qty}</td>
      <td class="n">${formatCurrency(r.rate)}</td>
      <td class="n">${formatCurrency(r.taxable)}</td>
      <td class="c">${GST_RATE}%</td>
      <td class="n">${formatCurrency(r.gst)}</td>
      <td class="n b">${formatCurrency(r.total)}</td>
    </tr>`).join('');

  const taxRows = t.intra
    ? `<tr><td>CGST @ ${GST_RATE / 2}%</td><td class="n">${formatCurrency(t.cgst)}</td></tr>
       <tr><td>SGST @ ${GST_RATE / 2}%</td><td class="n">${formatCurrency(t.sgst)}</td></tr>`
    : `<tr><td>IGST @ ${GST_RATE}%</td><td class="n">${formatCurrency(t.igst)}</td></tr>`;

  const terms = [
    `Payment terms: ${paymentTermsLabel(vendor)}.`,
    'Please quote this PO number on your tax invoice, delivery challan and all correspondence.',
    `Goods must match the configuration above. Units that are dead, damaged or not to specification may be rejected at the GRN.`,
    t.isDirect
      ? 'Warranty period is counted from the date of goods receipt (GRN) at our warehouse.'
      : 'Locking period is counted from the date of goods receipt (GRN) at our warehouse.',
    `Tax invoice must be raised on ${company.legal_name}, GSTIN ${company.gstin}, with ${t.intra ? 'CGST + SGST' : 'IGST'}.`,
  ];

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(poNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1f2937; font-size: 10.5px; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #f97316; padding-bottom: 10px; }
  .brand img { height: 46px; }
  .brand .legal { font-weight: 700; font-size: 13px; margin-top: 6px; }
  .brand .meta { color: #4b5563; line-height: 1.45; margin-top: 2px; max-width: 330px; }
  .doc { text-align: right; }
  .doc h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: 1px; color: #111827; }
  .doc table { margin-left: auto; border-collapse: collapse; }
  .doc td { padding: 1.5px 0 1.5px 10px; text-align: right; }
  .doc td.k { color: #6b7280; }
  .doc td.v { font-weight: 600; }
  .parties { display: flex; gap: 10px; margin-top: 12px; }
  .box { flex: 1; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; }
  .box h3 { margin: 0 0 4px; font-size: 9.5px; text-transform: uppercase; letter-spacing: .6px; color: #f97316; }
  .box .name { font-weight: 700; font-size: 11.5px; margin-bottom: 2px; }
  .box div { line-height: 1.45; }
  .box .lbl { color: #6b7280; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 12px; }
  table.items th { background: #1f2937; color: #fff; font-weight: 600; font-size: 9.5px; padding: 6px 5px; text-align: left; }
  table.items td { border-bottom: 1px solid #e5e7eb; padding: 6px 5px; vertical-align: top; }
  table.items tr:nth-child(even) td { background: #fafafa; }
  table.items tfoot td { background: #f3f4f6; font-weight: 700; border-bottom: none; }
  .item { font-weight: 600; }
  .spec { color: #6b7280; font-size: 9.5px; margin-top: 2px; }
  .n { text-align: right; white-space: nowrap; }
  .c { text-align: center; white-space: nowrap; }
  .b { font-weight: 700; }
  th.n { text-align: right; } th.c { text-align: center; }
  .summary { display: flex; gap: 12px; margin-top: 12px; align-items: flex-start; }
  .words { flex: 1; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; }
  .words .lbl { color: #6b7280; font-size: 9.5px; text-transform: uppercase; letter-spacing: .5px; }
  .words .val { font-weight: 600; margin-top: 3px; text-transform: capitalize; }
  table.totals { width: 270px; border-collapse: collapse; }
  table.totals td { padding: 4px 8px; border-bottom: 1px solid #e5e7eb; }
  table.totals tr.grand td { background: #f97316; color: #fff; font-weight: 700; font-size: 12px; border: none; }
  .terms { margin-top: 12px; border-top: 1px solid #e5e7eb; padding-top: 8px; }
  .terms h3 { margin: 0 0 4px; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; }
  .terms ol { margin: 0; padding-left: 16px; color: #374151; line-height: 1.5; }
  .remarks { margin-top: 8px; color: #374151; }
  .sign { display: flex; justify-content: space-between; margin-top: 28px; }
  .sign .blk { width: 46%; }
  .sign .line { border-top: 1px solid #9ca3af; margin-top: 38px; padding-top: 4px; color: #4b5563; }
  .foot { margin-top: 16px; text-align: center; color: #9ca3af; font-size: 8.5px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
</style></head>
<body>
  <div class="head">
    <div class="brand">
      ${logo ? `<img src="${logo}" alt="Rentfoxxy">` : '<div class="legal">Rentfoxxy</div>'}
      <div class="legal">${esc(company.legal_name)}</div>
      <div class="meta">
        ${esc(company.address)}<br>
        GSTIN: <b>${esc(company.gstin)}</b>${company.pan ? ` &nbsp;|&nbsp; PAN: ${esc(company.pan)}` : ''}<br>
        ${esc(company.email)}${company.phone ? ` &nbsp;|&nbsp; ${esc(company.phone)}` : ''} &nbsp;|&nbsp; www.rentfoxxy.com
      </div>
    </div>
    <div class="doc">
      <h1>PURCHASE ORDER</h1>
      <table>
        <tr><td class="k">PO No.</td><td class="v">${esc(poNumber)}</td></tr>
        <tr><td class="k">PO Date</td><td class="v">${esc(formatPdfDateIstOrDash(po.purchase_order_date))}</td></tr>
        <tr><td class="k">PO Type</td><td class="v">${esc(formatPoType(po.purchase_order_type))}</td></tr>
        ${po.expected_delivery_date ? `<tr><td class="k">Expected Delivery</td><td class="v">${esc(formatPdfDateIstOrDash(po.expected_delivery_date))}</td></tr>` : ''}
        <tr><td class="k">Place of Supply</td><td class="v">${esc(stateLabel(t.buyerCode))}</td></tr>
      </table>
    </div>
  </div>

  <div class="parties">
    <div class="box">
      <h3>Vendor (Supplier)</h3>
      <div class="name">${esc(vendorName)}</div>
      ${vendorAddr ? `<div>${esc(vendorAddr)}</div>` : ''}
      <div><span class="lbl">State:</span> ${esc(stateLabel(t.vendorCode, vendor.state))}</div>
      <div><span class="lbl">GSTIN:</span> <b>${esc(vendor.gst_number || 'Unregistered')}</b>${vendor.pan_number ? ` &nbsp; <span class="lbl">PAN:</span> ${esc(vendor.pan_number)}` : ''}</div>
      ${vendor.msme_number ? `<div><span class="lbl">MSME:</span> ${esc(vendor.msme_number)}</div>` : ''}
      ${contactName ? `<div><span class="lbl">Contact:</span> ${esc(contactName)}${vendor.contact_person_phone ? `, ${esc(vendor.contact_person_phone)}` : ''}</div>` : ''}
      ${vendor.phone || vendor.email ? `<div>${[vendor.phone, vendor.email].filter(Boolean).map(esc).join(' &nbsp;|&nbsp; ')}</div>` : ''}
    </div>
    <div class="box">
      <h3>Bill To</h3>
      <div class="name">${esc(company.legal_name)}</div>
      <div>${esc(company.address)}</div>
      <div><span class="lbl">State:</span> ${esc(stateLabel(t.buyerCode))}</div>
      <div><span class="lbl">GSTIN:</span> <b>${esc(company.gstin)}</b></div>
    </div>
    <div class="box">
      <h3>Ship To</h3>
      <div class="name">${esc(company.legal_name)} (Rentfoxxy Warehouse)</div>
      <div>${esc(company.address)}</div>
      <div><span class="lbl">State:</span> ${esc(stateLabel(t.buyerCode))}</div>
      <div><span class="lbl">GSTIN:</span> <b>${esc(company.gstin)}</b></div>
    </div>
  </div>

  <table class="items">
    <thead><tr>
      <th class="c">#</th><th>Description</th><th class="c">HSN</th>
      ${showPeriod ? `<th class="c">${periodHead}</th>` : ''}
      <th class="n">Qty</th><th class="n">Rate (₹)</th><th class="n">Taxable (₹)</th>
      <th class="c">GST</th><th class="n">GST (₹)</th><th class="n">Amount (₹)</th>
    </tr></thead>
    <tbody>${itemRows || `<tr><td colspan="${showPeriod ? 10 : 9}" class="c">No items</td></tr>`}</tbody>
    <tfoot><tr>
      <td colspan="${showPeriod ? 4 : 3}">Total</td>
      <td class="n">${t.totalQty}</td><td></td>
      <td class="n">${formatCurrency(t.subtotal)}</td><td></td>
      <td class="n">${formatCurrency(t.tax)}</td>
      <td class="n">${formatCurrency(t.grandTotal)}</td>
    </tr></tfoot>
  </table>

  <div class="summary">
    <div class="words">
      <div class="lbl">Amount in words</div>
      <div class="val">${esc(amountInIndianWords(t.grandTotal))}</div>
      <div class="lbl" style="margin-top:8px">GST</div>
      <div>${t.intra
    ? `Intra-state supply (${esc(stateLabel(t.vendorCode || t.buyerCode))} → ${esc(stateLabel(t.buyerCode))}): CGST + SGST`
    : `Inter-state supply (${esc(stateLabel(t.vendorCode, vendor.state))} → ${esc(stateLabel(t.buyerCode))}): IGST`}</div>
    </div>
    <table class="totals">
      <tr><td>Taxable value</td><td class="n">${formatCurrency(t.subtotal)}</td></tr>
      ${taxRows}
      <tr class="grand"><td>Grand Total (₹)</td><td class="n">${formatCurrency(t.grandTotal)}</td></tr>
    </table>
  </div>

  <div class="terms">
    <h3>Terms &amp; Conditions</h3>
    <ol>${terms.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
    ${po.remarks ? `<div class="remarks"><b>Remarks:</b> ${esc(po.remarks)}</div>` : ''}
  </div>

  <div class="sign">
    <div class="blk"><div>&nbsp;</div><div class="line">Vendor acceptance (sign &amp; stamp)</div></div>
    <div class="blk" style="text-align:right">
      <div>For <b>${esc(company.legal_name)}</b></div>
      <div class="line">Authorised Signatory</div>
    </div>
  </div>
  <div class="foot">This is a computer-generated purchase order from the Rentfoxxy CRM.</div>
</body></html>`;
}

/** Old plain pdfkit layout — used only if headless Chrome is unavailable. */
async function renderPlainPdf({ po, vendor, company, t }, absolutePath) {
  const poNumber = po.purchase_order_number || `PO-${po.po_id}`;
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const stream = fs.createWriteStream(absolutePath);
    doc.pipe(stream);
    doc.fontSize(18).fillColor('#111827').text(company.legal_name, { align: 'center' });
    doc.fontSize(9).fillColor('#4B5563').text(`${company.address} | GSTIN ${company.gstin}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor('#111827').text('PURCHASE ORDER', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).fillColor('#374151');
    doc.text(`PO Number: ${poNumber}    PO Date: ${formatPdfDateIstOrDash(po.purchase_order_date)}`);
    doc.text(`Vendor: ${vendor.business_name || vendor.first_name || 'Vendor'}  GSTIN: ${vendor.gst_number || '—'}`);
    if (vendor.address) doc.text(vendor.address);
    doc.moveDown();
    t.rows.forEach((r) => {
      doc.fontSize(9).fillColor('#111827').text(`${r.sn}. ${r.title} — ${r.specs.join(' | ')}`);
      doc.fillColor('#4B5563').text(`   HSN ${r.hsn} | Qty ${r.qty} x Rs ${formatCurrency(r.rate)} = Rs ${formatCurrency(r.taxable)} + GST ${GST_RATE}% Rs ${formatCurrency(r.gst)}`);
    });
    doc.moveDown();
    doc.fontSize(10).fillColor('#111827').text(`Taxable value: Rs ${formatCurrency(t.subtotal)}`);
    if (t.intra) {
      doc.text(`CGST ${GST_RATE / 2}%: Rs ${formatCurrency(t.cgst)}   SGST ${GST_RATE / 2}%: Rs ${formatCurrency(t.sgst)}`);
    } else {
      doc.text(`IGST ${GST_RATE}%: Rs ${formatCurrency(t.igst)}`);
    }
    doc.text(`Grand Total: Rs ${formatCurrency(t.grandTotal)}`);
    if (po.remarks) doc.text(`Remarks: ${po.remarks}`);
    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

/**
 * Generate the purchase order PDF (vendor email on approval, vendor portal, CRM download).
 * @param {{ po: object, vendor?: object }} params
 * @returns {Promise<{ relativePath: string, absolutePath: string }>}
 */
async function generatePurchaseOrderPdf({ po, vendor: vendorArg }) {
  ensureUploadDir();
  const poNumber = po.purchase_order_number || `PO-${po.po_id}`;
  const fileName = `${poNumber.replace(/[^\w-]/g, '_')}_${Date.now()}.pdf`;
  const absolutePath = path.join(UPLOAD_DIR, fileName);
  const relativePath = `uploads/vendor-po-documents/${fileName}`;

  const [vendor, company] = await Promise.all([loadVendor(po, vendorArg), loadCompany()]);
  const t = computePoTotals(po, vendor, company);

  try {
    // eslint-disable-next-line global-require
    const { renderHtmlToPdf } = require('./customerInvoicePdfService');
    await renderHtmlToPdf(buildPoHtml({ po, vendor, company, t }), absolutePath);
  } catch (e) {
    console.error('PO pdf (html) failed, using plain layout:', e.message);
    await renderPlainPdf({ po, vendor, company, t }, absolutePath);
  }

  return { relativePath, absolutePath };
}

module.exports = { generatePurchaseOrderPdf, formatPoType, computePoTotals, buildPoHtml };
