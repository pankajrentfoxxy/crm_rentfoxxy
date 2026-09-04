const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const pool = require('../config/db');
const { computeGstBreakdown, resolveSupplyStateFromAddress, sumSoSecurityAmount } = require('./salesManagementService');
const { resolveHsnForDisplay, txnTypeFromQuotation } = require('../constants/hsnDefaults');

const UPLOAD_DIR = path.join(__dirname, '../uploads/sales-documents');

// ── Palette ────────────────────────────────────────────────────────────────
const C = {
  ink: '#1f2937',
  sub: '#6b7280',
  line: '#e5e7eb',
  docNum: '#d6336c',
  teal: '#0e7490',
  rentfoxxy: '#f26b21',
  gorefurbo: '#0ba86b',
  panel: '#f9fafb',
  white: '#ffffff',
};

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function getMailTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true';
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

const { mergeCompany, formatCompanyBlock, TRUETECH } = require('../utils/companyDefaults');
const { normalizeDeliveryAddress, formatDeliveryAddressLine } = require('../utils/deliveryAddressUtils');
const {
  formatPdfDateIst,
  formatPdfDateIstOrDash,
  formatPdfDateTimeLabel,
  formatPdfNowIst,
} = require('../utils/pdfDateTimeUtils');

async function loadCompany(entityCode) {
  const code = entityCode === 'gorefurbo' ? 'gorefurbo' : 'rentfoxxy';
  try {
    const r = await pool.query(
      `SELECT code, legal_name, gstin, pan, email, phone, address, state_code, logo_url
       FROM companies WHERE code = $1`,
      [code]
    );
    if (r.rows.length) return mergeCompany({ ...r.rows[0], code });
  } catch (_) { /* pre-migration */ }
  return mergeCompany({ code });
}

/** Resolve on-disk logo for a company record. */
function resolveCompanyLogoAbs(company) {
  const candidates = [];
  if (company?.logo_url) {
    const clean = String(company.logo_url).replace(/^\//, '');
    candidates.push(path.join(__dirname, '..', clean));
  }
  // Sale / Gorefurbo always prefers the branded long-mark file.
  if (company?.code === 'gorefurbo') {
    candidates.push(path.join(__dirname, '..', 'assets', 'gorefurbo-logo.png'));
  } else {
    candidates.push(path.join(__dirname, '..', 'assets', 'rentfoxxy-logo.png'));
  }
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * Draw branded header logo (transparent PNG supported).
 * @returns {{ drawn: boolean, height: number, width: number }}
 */
function drawCompanyLogo(doc, company, x, y, { maxHeight = 36, maxWidth = 210 } = {}) {
  const logoAbs = resolveCompanyLogoAbs(company);
  if (!logoAbs) return { drawn: false, height: 0, width: 0 };

  const isGorefurbo = company?.code === 'gorefurbo';
  const height = isGorefurbo ? Math.min(maxHeight, 38) : Math.min(maxHeight, 34);
  const width = isGorefurbo ? maxWidth : Math.min(maxWidth, 160);

  try {
    doc.image(logoAbs, x, y, { height, fit: [width, height] });
    return { drawn: true, height, width };
  } catch (_) {
    return { drawn: false, height: 0, width: 0 };
  }
}

function parseJson(v, fallback = null) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

// Resolve a stored signature/POD path (e.g. "pod/esign_DC_..._.png" or
// "uploads/pod/...") to an absolute file path, or null if it isn't on disk.
function resolveSignFile(url) {
  if (!url) return null;
  const clean = String(url).replace(/^\//, '');
  const candidates = [
    path.join(__dirname, '..', clean),
    path.join(__dirname, '..', 'uploads', clean),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}
// Note: PDFKit's built-in Helvetica has no glyph for the ₹ rupee sign (it
// renders as a stray superscript "1"), so use the ASCII-safe "Rs." prefix.
const money = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dash = (v) => (v == null || v === '' ? 'N/A' : String(v));

// delivery_challan_lines has no rate column; price each DC line from the linked
// sales order so the PDF shows correct Rate/Amount/GST.
async function attachDcLineRates(lines, dcNumber) {
  const {
    getSalesOrderRateMap,
    rateForDcLine,
    getDcSerialRateLookup,
    lookupSerialRate,
    resolveDcBilling,
  } = require('./salesManagementService');
  const head = lines[0] || {};
  const son = head.sales_order_number;
  const dcNum = dcNumber || head.dc_number;
  if (dcNum && son) {
    const { billingLines } = await resolveDcBilling(dcNum, lines);
    if (billingLines.length) {
      const avgRate = billingLines.reduce((s, l) => s + l.amount, 0)
        / Math.max(1, billingLines.reduce((s, l) => s + l.quantity, 0));
      for (const line of lines) {
        if (line.rate != null && Number(line.rate) > 0) continue;
        line.rate = avgRate;
      }
      return lines;
    }
  }
  const cache = new Map();
  for (const line of lines) {
    if (line.rate != null && Number(line.rate) > 0) continue;
    const lineSon = line.sales_order_number || son;
    if (!lineSon) continue;
    if (!cache.has(lineSon)) cache.set(lineSon, await getSalesOrderRateMap(lineSon));
    line.rate = rateForDcLine(line, cache.get(lineSon));
  }
  return lines;
}

// Resolve per-serial spec rows for a DC (one product row per laptop).
async function resolveDcUnitRows(lines, dcNumber) {
  const { getDcSerialRateLookup, lookupSerialRate, lookupSerialRemark, rateForDcLine, getSalesOrderRateMap, loadSerialInventorySpec } = require('./salesManagementService');
  const head = lines[0] || {};
  const son = head.sales_order_number;
  const dcNum = dcNumber || head.dc_number;
  const serialLookup = (dcNum && son) ? await getDcSerialRateLookup(dcNum, son) : null;
  const rateMap = (!serialLookup?.rows?.length && son)
    ? await getSalesOrderRateMap(son)
    : null;
  const rows = [];
  for (const line of lines) {
    const raw = line.serial_number;
    let entries = [];
    const arr = parseJson(raw, null);
    if (Array.isArray(arr)) entries = arr;
    else if (raw) entries = [raw];
    if (!entries.length) {
      rows.push({
        ...line,
        ttspl: '',
        serial: '',
        qty: line.quantity || 1,
        remarks: (line.remarks || line.remark || '').trim(),
      });
      continue;
    }
    for (const e of entries) {
      const parts = String(e).split('|');
      const serialId = /^\d+$/.test(parts[0]) ? Number(parts[0]) : null;
      const serialNumber = parts[1] || parts[0];
      const ttspl = parts[2] || null;
      const priced = lookupSerialRate(serialLookup, { serialId, serialNumber, ttspl });
      const spec = await loadSerialInventorySpec({ serialId, serialNumber, ttspl }) || {};
      // Hardware from serial/QC inventory first; SO line config only fills gaps.
      // (Previously SO line won and every unit looked identical on multi-config DCs.)
      rows.push({
        brand: spec.brand || priced?.brand || line.brand,
        model_name: spec.model || priced?.model_name || line.model_name,
        processor: spec.processor || priced?.processor || line.processor,
        generation: spec.generation || priced?.generation || line.generation,
        ram: spec.ram || priced?.ram || line.ram,
        storage: spec.storage || priced?.storage || line.storage,
        gpu: spec.gpu || priced?.gpu || line.gpu,
        screen_size: spec.screen_size || priced?.screen_size || line.screen_size,
        serial: spec.serial_number || serialNumber,
        ttspl: spec.inventory_asset_code || ttspl || '',
        rate: priced?.rate ?? (rateMap ? rateForDcLine(line, rateMap) : line.rate),
        locking_period: line.locking_period,
        technical_warranty: line.technical_warranty,
        battery_charger_warranty: line.battery_charger_warranty,
        qty: 1,
        hsn_code: line.hsn_code,
        remarks: (line.remarks || line.remark || '').trim()
          || lookupSerialRemark(serialLookup, { serialId, serialNumber, ttspl })
          || '',
      });
    }
  }
  return rows;
}

/** Fill delivery_challan_lines.remarks from linked SO line items when not set on DC. */
async function enrichDcLinesWithSoRemarks(lines, dcNumber) {
  const { getDcSerialRateLookup, lookupSerialRemark } = require('./salesManagementService');
  const head = lines[0] || {};
  const son = head.sales_order_number;
  const dcNum = dcNumber || head.dc_number;
  if (!son || !dcNum) return lines;

  const lookup = await getDcSerialRateLookup(dcNum, son);
  for (const line of lines) {
    if ((line.remarks || line.remark || '').trim()) continue;
    const raw = line.serial_number;
    let entries = [];
    const arr = parseJson(raw, null);
    if (Array.isArray(arr)) entries = arr;
    else if (raw) entries = [raw];
    const remarks = [];
    for (const e of entries) {
      const parts = String(e).split('|');
      const serialId = /^\d+$/.test(parts[0]) ? Number(parts[0]) : null;
      const serialNumber = parts[1] || parts[0];
      const ttspl = parts[2] || null;
      const r = lookupSerialRemark(lookup, { serialId, serialNumber, ttspl });
      if (r) remarks.push(r);
    }
    const uniq = [...new Set(remarks)];
    if (uniq.length) line.remarks = uniq.join('; ');
  }
  return lines;
}

function fmtMonths(v) {
  if (v == null || v === '') return 'N/A';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return `${n} Month${n === 1 ? '' : 's'}`;
}

async function resolveQuotationType(docType, header) {
  let qt = String(header?.quotation_type || '').toLowerCase();
  if (!qt && docType === 'delivery_challan' && header?.sales_order_number) {
    try {
      const r = await pool.query(
        `SELECT COALESCE(sol.quotation_type, sq.quotation_type) AS qt
           FROM sales_order_lines sol
           LEFT JOIN sales_quotations sq ON sq.quotation_number = sol.quotation_number
          WHERE sol.sales_order_number = $1 LIMIT 1`,
        [header.sales_order_number]
      );
      qt = String(r.rows[0]?.qt || '').toLowerCase();
    } catch (_) { /* ignore */ }
  }
  if (!qt) qt = header?.entity_code === 'gorefurbo' ? 'sale' : 'rental';
  return qt;
}

async function generateDocumentPdf({ docType, docNumber, header = {}, lines = [] }) {
  ensureUploadDir();
  const fileName = `${String(docNumber).replace(/[^\w-]/g, '_')}_${Date.now()}.pdf`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  const relativePath = `uploads/sales-documents/${fileName}`;

  let gateQrPng = null;
  if (docType === 'delivery_challan') {
    try {
      const { ensureGateQrPng } = require('./gateQrService');
      const purpose = String(header.dc_purpose || '').toLowerCase();
      const movement = String(header.movement_type || '').toLowerCase();
      const qrType = purpose === 'service_return'
        ? 'sdc'
        : (movement === 'return' || /^RDC/i.test(String(docNumber || '')))
          ? 'rdc'
          : 'dc';
      gateQrPng = (await ensureGateQrPng({ docType: qrType, docNumber })).png;
    } catch (_) { /* gate tokens table may not exist yet */ }
  }

  const qtype = await resolveQuotationType(docType, header);
  const isSale = qtype === 'sale' || qtype === 'sales';
  const isDemo = qtype === 'demo';
  // Sale documents always brand as Gorefurbo (logo + accent).
  const entityCode = header.entity_code
    || (isSale ? 'gorefurbo' : 'rentfoxxy');
  const company = await loadCompany(entityCode);
  const accent = company.code === 'gorefurbo' ? C.gorefurbo : C.rentfoxxy;
  const docLabel = docType === 'quotation' ? 'Quotation' : docType === 'sales_order' ? 'Sales Order' : 'Delivery Challan';
  const typeLabel = isSale ? 'Sale' : isDemo ? 'Demo' : 'Rental';

  // Product rows
  const dcLines = docType === 'delivery_challan'
    ? await enrichDcLinesWithSoRemarks([...lines], docNumber)
    : lines;
  const rows = docType === 'delivery_challan'
    ? await resolveDcUnitRows(await attachDcLineRates(dcLines, docNumber), docNumber)
    : lines.map((l) => ({
      brand: l.brand, model_name: l.model_name, processor: l.processor, generation: l.generation,
      ram: l.ram, storage: l.storage, gpu: l.gpu, screen_size: l.screen_size,
      serial: '', ttspl: '', rate: l.rate, locking_period: l.locking_period,
      technical_warranty: l.technical_warranty, battery_charger_warranty: l.battery_charger_warranty,
      qty: l.quantity || 1,
      hsn_code: l.hsn_code,
    }));

  // Totals
  const goods = rows.reduce((s, r) => s + (Number(r.rate || 0) * Number(r.qty || 1)), 0);
  const shipping = Number(header.shiping_charges || lines[0]?.shiping_charges || 0);
  const security = docType === 'delivery_challan'
    ? Number(header.security_amount || lines[0]?.security_amount || 0)
    : sumSoSecurityAmount(lines);
  const subtotal = +goods.toFixed(2);
  const supplyState = resolveSupplyStateFromAddress(
    header.customer_shipping_address || lines[0]?.customer_shipping_address,
    header.supply_state || lines[0]?.supply_state
  );
  const gstOnShipping = (lines || []).some((l) => l.is_wfh === true || l.is_wfh === 't' || l.is_wfh === 1);
  const gst = computeGstBreakdown({ subtotal, shipping, security, supplyState, gstOnShipping });
  const intra = gst.gst_type === 'intra';
  const gstRate = gst.gst_rate;
  const gstAmount = gst.gst_total;
  const total = gst.grand_total;

  const billing = normalizeDeliveryAddress(
    header.customer_billing_address || lines[0]?.customer_billing_address
  ) || {};
  const shippingAddr = normalizeDeliveryAddress(
    header.customer_shipping_address || lines[0]?.customer_shipping_address
  ) || {};

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    const L = 36; const R = 559; const W = R - L;

    // ── Header band ──────────────────────────────────────────────────────
    let y = 40;
    const logo = drawCompanyLogo(doc, company, L, y, {
      maxHeight: isSale ? 38 : 34,
      maxWidth: isSale ? 220 : 160,
    });
    if (!logo.drawn) {
      doc.fillColor(accent).font('Helvetica-Bold').fontSize(22).text(company.code, L, y + 4);
    }
    // Doc numbers (right cluster)
    const num = (label, value, x, color) => {
      doc.font('Helvetica-Bold').fontSize(13).fillColor(color || C.ink).text(value || 'N/A', x, y, { width: 150, align: 'center' });
      doc.font('Helvetica').fontSize(7).fillColor(C.sub).text(label, x, y + 18, { width: 150, align: 'center' });
    };
    num('DC Number', docType === 'delivery_challan' ? docNumber : (header.dc_number || 'N/A'), 250, C.docNum);
    num('Sales Order Number', docType === 'sales_order' ? docNumber : (header.sales_order_number || 'N/A'), 360, C.ink);
    if (gateQrPng) {
      const { drawGateQr } = require('./gateQrService');
      drawGateQr(doc, gateQrPng, { x: R - 40, y: 38, size: 36, caption: 'Gate scan' });
    } else {
      num('Quotation Number', docType === 'quotation' ? docNumber : (header.quotation_number || 'N/A'), 470, C.ink);
    }
    y += 50;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).lineWidth(1).stroke();
    y += 12;

    // ── Seller block + type/dispatch ─────────────────────────────────────
    const docDate = formatPdfDateIst(header.dc_date || header.created_at) || formatPdfNowIst();
    const dispatchDate = formatPdfDateIst(header.dispatched_at || header.dispatch_date, { fallback: null });
    doc.font('Helvetica').fontSize(9).fillColor(C.sub)
      .text(`Date: ${docDate}`, L, y);
    y += 14;
    if (dispatchDate) {
      doc.text(`Dispatch Date: ${dispatchDate}`, L, y);
      y += 14;
    }
    const estimatedDelivery = formatPdfDateIst(header.estimated_delivery, { fallback: null });
    if (estimatedDelivery) {
      doc.text(`Estimated Delivery: ${estimatedDelivery}`, L, y);
      y += 14;
    }
    doc.font('Helvetica-Bold').fontSize(13).fillColor(accent).text(company.legal_name, L, y);
    y += 18;
    doc.font('Helvetica').fontSize(9).fillColor(C.ink);
    if (company.email) { doc.text(`Email: ${company.email}`, L, y); y += 12; }
    if (company.gstin) { doc.text(`GSTIN: ${company.gstin}`, L, y); y += 12; }
    if (company.address) { doc.text(`Address: ${company.address}`, L, y, { width: W }); y += doc.heightOfString(`Address: ${company.address}`, { width: W }); }
    y += 8;

    // Type badge + dispatch tags
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.teal).text(typeLabel, L, y);
    y += 16;
    const tags = [];
    const shipBy = header.ship_by || header.dispatch_mode;
    if (shipBy === 'by_hand' || shipBy === 'inhouse') tags.push('By Hand');
    else if (shipBy === 'by_courier' || shipBy === 'courier') tags.push('By Courier');
    else if (shipBy === 'by_porter' || shipBy === 'porter') tags.push('By Porter');
    if (header.delivery_person_name) tags.push(header.delivery_person_name);
    if (header.courier_name) tags.push(header.courier_name);
    if (header.awb_number) tags.push(header.awb_number);
    let tx = L;
    for (const t of tags) {
      const w = doc.font('Helvetica').fontSize(8).widthOfString(t) + 16;
      doc.roundedRect(tx, y, w, 16, 8).strokeColor(accent).lineWidth(0.8).stroke();
      doc.fillColor(accent).text(t, tx + 8, y + 4);
      tx += w + 6;
    }
    if (tags.length) y += 24; else y += 4;

    // ── Customer + Shipping two-column ───────────────────────────────────
    const colW = (W - 12) / 2;
    const boxTop = y;
    const addrBlock = (x, title, a, extra, titlePrefix) => {
      let yy = boxTop + 8;
      if (titlePrefix) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text(titlePrefix, x + 10, yy, { width: colW - 20 });
        yy = doc.y + 2;
        doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(title, x + 10, yy, { width: colW - 20 });
        yy = doc.y + 4;
      } else {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text(title, x + 10, yy, { width: colW - 20 });
        yy = doc.y + 4;
      }
      doc.font('Helvetica').fontSize(8.5).fillColor(C.ink);
      const row = (lab, val) => {
        if (val == null || val === '') return;
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink)
          .text(`${lab}: `, x + 10, yy, { continued: true, width: colW - 20 })
          .font('Helvetica').text(String(val), { width: colW - 20 });
        yy = doc.y + 2;
      };
      row('Email', a.email || extra?.email);
      row('Phone', a.phone || extra?.phone);
      row('City', a.city);
      row('State', a.state);
      row('Country', a.country || 'India');
      row('Zip Code', a.zip_code || a.pincode);
      row('Address', a.address);
      if (extra?.gst) row('GST', extra.gst);
      return yy;
    };
    const custName = header.customer_name || billing.name || 'Customer';
    const shipName = shippingAddr.name || custName;
    const leftEnd = addrBlock(L, custName, { ...billing, email: header.customer_email || billing.email, phone: header.customer_mobile || billing.phone }, { email: header.customer_email, phone: header.customer_mobile, gst: header.gst_number || billing.gst_number });
    const rightEnd = addrBlock(L + colW + 12, shipName, shippingAddr, {}, 'Shipping To:');
    const boxBottom = Math.max(leftEnd, rightEnd) + 8;
    doc.roundedRect(L, boxTop, colW, boxBottom - boxTop, 6).strokeColor(C.line).lineWidth(1).stroke();
    doc.roundedRect(L + colW + 12, boxTop, colW, boxBottom - boxTop, 6).strokeColor(C.line).lineWidth(1).stroke();
    y = boxBottom + 14;

    // ── Product table ────────────────────────────────────────────────────
    // Columns depend on type.
    const defaultHsn = resolveHsnForDisplay(null, {
      quotationType: qtype,
      transactionType: txnTypeFromQuotation(qtype),
    });
    let cols;
    if (isSale) {
      cols = [
        { key: 'product', label: 'Product', w: 170, align: 'left' },
        { key: 'hsn', label: 'HSN', w: 55, align: 'center' },
        { key: 'tech', label: 'Tech. Wty.', w: 62, align: 'center' },
        { key: 'bat', label: 'Bat./Chg. Wty.', w: 70, align: 'center' },
        { key: 'qty', label: 'Qty.', w: 38, align: 'center' },
        { key: 'rate', label: 'Rate', w: 60, align: 'right' },
        { key: 'amount', label: 'Amount', w: 68, align: 'right' },
      ];
    } else {
      cols = [
        { key: 'product', label: 'Product', w: 200, align: 'left' },
        { key: 'hsn', label: 'HSN/SAC', w: 58, align: 'center' },
        { key: 'lock', label: 'Locking', w: 65, align: 'center' },
        { key: 'qty', label: 'Qty.', w: 40, align: 'center' },
        { key: 'rate', label: 'Rate', w: 76, align: 'right' },
        { key: 'amount', label: 'Amount', w: 84, align: 'right' },
      ];
    }
    // header row
    const drawTableHeader = (yy) => {
      doc.rect(L, yy, W, 22).fill(C.teal);
      let cx = L;
      doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9);
      for (const c of cols) {
        doc.text(c.label, cx + 6, yy + 6, { width: c.w - 12, align: c.align });
        cx += c.w;
      }
      return yy + 22;
    };
    y = drawTableHeader(y);

    const productText = (r) => {
      const l1 = `${dash(r.brand)} ${dash(r.model_name)}${r.screen_size ? ` | ${r.screen_size}` : ''}`.trim();
      const l2 = [r.processor, r.generation].filter(Boolean).join(' | ');
      const l3 = [r.ram, r.storage].filter(Boolean).join(' | ');
      const l4 = r.gpu || '';
      const l5 = [r.serial, r.ttspl].filter(Boolean).join('  ');
      return { l1, l2, l3, l4, l5 };
    };

    doc.font('Helvetica').fontSize(8.5).fillColor(C.ink);
    for (const r of rows) {
      const p = productText(r);
      // estimate row height from product lines
      const pLines = [p.l1, p.l2, p.l3, p.l4, p.l5].filter(Boolean);
      const rowH = Math.max(46, 12 + pLines.length * 11);
      if (y + rowH > 760) { doc.addPage(); y = 40; y = drawTableHeader(y); }
      // cell borders
      let cx = L;
      for (const c of cols) { doc.rect(cx, y, c.w, rowH).strokeColor(C.line).lineWidth(0.6).stroke(); cx += c.w; }
      // product cell
      cx = L;
      let py = y + 6;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink).text(p.l1, cx + 6, py, { width: cols[0].w - 12 }); py += 11;
      doc.font('Helvetica').fontSize(8).fillColor(C.sub);
      for (const ln of [p.l2, p.l3, p.l4]) { if (ln) { doc.text(ln, cx + 6, py, { width: cols[0].w - 12 }); py += 10; } }
      if (p.l5) { doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink).text(p.l5, cx + 6, py, { width: cols[0].w - 12 }); }
      // other cells
      cx = L + cols[0].w;
      const cellText = (key) => {
        if (key === 'hsn') {
          return resolveHsnForDisplay(r.hsn_code, {
            quotationType: qtype,
            transactionType: txnTypeFromQuotation(qtype),
          }) || defaultHsn;
        }
        if (key === 'lock') return fmtMonths(r.locking_period);
        if (key === 'tech') return fmtMonths(r.technical_warranty);
        if (key === 'bat') return fmtMonths(r.battery_charger_warranty);
        if (key === 'qty') return `${r.qty} Pcs.`;
        if (key === 'rate') return money(r.rate);
        if (key === 'amount') return money(Number(r.rate || 0) * Number(r.qty || 1));
        return '';
      };
      doc.font('Helvetica').fontSize(8.5).fillColor(C.ink);
      for (let i = 1; i < cols.length; i += 1) {
        doc.text(cellText(cols[i].key), cx + 6, y + rowH / 2 - 5, { width: cols[i].w - 12, align: cols[i].align });
        cx += cols[i].w;
      }
      y += rowH;
    }
    y += 14;

    // ── Totals ───────────────────────────────────────────────────────────
    if (y > 700) { doc.addPage(); y = 40; }
    const tw = 230; const tx2 = R - tw;
    const totRow = (label, value, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(bold ? C.ink : C.sub);
      doc.text(label, tx2, y, { width: tw - 90, align: 'right' });
      doc.font('Helvetica-Bold').fillColor(C.ink).text(value, tx2 + tw - 90, y, { width: 90, align: 'right' });
      y += 16;
    };
    totRow('Sub Total:', money(subtotal));
    totRow('Shipping Charges:', money(shipping));
    if (intra) {
      totRow(`CGST (${gstRate / 2}%):`, money(gstAmount / 2));
      totRow(`SGST (${gstRate / 2}%):`, money(gstAmount / 2));
    } else {
      totRow(`IGST (${gstRate}%):`, money(gstAmount));
    }
    totRow('Security Amount:', money(security));
    doc.moveTo(tx2, y).lineTo(R, y).strokeColor(C.line).stroke(); y += 6;
    totRow('Total:', money(total), true);
    y += 10;

    // ── Remarks (one entry per DC line — falls back to SO line remark) ─────
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.teal).text('Remarks', L, y); y += 16;
    doc.font('Helvetica').fontSize(9).fillColor(C.ink);
    const remarkLines = docType === 'delivery_challan' ? dcLines : lines;
    for (const line of remarkLines) {
      const rk = String(line.remarks || line.remark || '').trim();
      doc.text(`• ${rk || '—'}`, L + 6, y); y += 13;
    }
    y += 14;

    // ── Acknowledgement / e-sign area (future tracking) ──────────────────
    if (y > 720) { doc.addPage(); y = 40; }
    doc.roundedRect(L, y, W, 64, 6).strokeColor(C.line).lineWidth(1).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('Acknowledgement of Receipt', L + 10, y + 8);
    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
      .text('Received the above item(s) in good condition.', L + 10, y + 22);
    doc.fillColor(C.ink).font('Helvetica').fontSize(9);
    doc.text('Received by: _________________________', L + 10, y + 42);
    // Populate the Signature field with the technician's saved e-signature when
    // one exists (captured at delivery from My Deliveries). Layout is unchanged:
    // the label stays put and the blank line is only replaced by the image.
    const esignAbs = resolveSignFile(header.esign_url || lines[0]?.esign_url);
    if (esignAbs) {
      doc.text('Signature:', L + 300, y + 42);
      try {
        doc.image(esignAbs, L + 348, y + 24, { fit: [72, 30], align: 'left' });
      } catch (_) {
        doc.text('______________', L + 348, y + 42);
      }
    } else {
      doc.text('Signature: ______________', L + 300, y + 42);
    }
    doc.text('Date: ____________', L + 430, y + 42);

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return relativePath;
}

// ── Return DC PDF ────────────────────────────────────────────────────────────
// A branded "Return Delivery Challan" used when a laptop (or part) is picked up
// from the customer and brought back to the warehouse. It records the originating
// outbound DC + Sales Order (so a unit is traceable end-to-end) and carries two
// signature blocks: the technician signs at the customer site (sign-out) and the
// warehouse signs on receipt.
async function generateReturnDcPdf({ returnDcNumber, header = {}, units = [], esign = {} }) {
  ensureUploadDir();
  const fileName = `${String(returnDcNumber).replace(/[^\w-]/g, '_')}_${Date.now()}.pdf`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  const relativePath = `uploads/sales-documents/${fileName}`;

  const entityCode = header.entity_code
    || (String(header.transaction_type || '').toLowerCase() === 'sale' ? 'gorefurbo' : 'rentfoxxy');
  const company = await loadCompany(entityCode);
  const accent = company.code === 'gorefurbo' ? C.gorefurbo : C.rentfoxxy;
  const pickupTypeLabel = header.pickup_type === 'repair' ? 'Repair Pickup' : 'Return Pickup';
  const addr = normalizeDeliveryAddress(header.pickup_address) || {};

  let gateQrPng = null;
  try {
    const { ensureGateQrPng } = require('./gateQrService');
    gateQrPng = (await ensureGateQrPng({ docType: 'rdc', docNumber: returnDcNumber })).png;
  } catch (_) { /* optional */ }

  const resolveSign = (url) => {
    if (!url) return null;
    const abs = path.join(__dirname, '..', String(url).replace(/^\//, ''));
    return fs.existsSync(abs) ? abs : null;
  };
  const techSign = resolveSign(esign.technician_url);
  const whSign = resolveSign(esign.warehouse_url);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    const L = 36; const R = 559; const W = R - L;
    let y = 40;

    // Header band — entity logo (derived from original SO/DC type)
    const logo = drawCompanyLogo(doc, company, L, y, { maxHeight: 36, maxWidth: 170 });
    if (!logo.drawn) {
      doc.fillColor(accent).font('Helvetica-Bold').fontSize(22).text(company.code || 'rentfoxxy', L, y + 4);
    }

    if (gateQrPng) {
      const { drawGateQr } = require('./gateQrService');
      drawGateQr(doc, gateQrPng, { x: R - 40, y: 36, size: 36, caption: 'Gate scan' });
      doc.font('Helvetica-Bold').fontSize(16).fillColor(accent).text('RETURN DELIVERY CHALLAN', 220, y, { width: 250, align: 'right' });
      doc.font('Helvetica').fontSize(8).fillColor(C.sub).text(pickupTypeLabel, 220, y + 20, { width: 250, align: 'right' });
    } else {
      doc.font('Helvetica-Bold').fontSize(16).fillColor(accent).text('RETURN DELIVERY CHALLAN', 250, y, { width: 273, align: 'right' });
      doc.font('Helvetica').fontSize(8).fillColor(C.sub).text(pickupTypeLabel, 250, y + 20, { width: 273, align: 'right' });
    }
    y += 46;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).lineWidth(1).stroke();
    y += 12;

    // Tracking numbers cluster
    const num = (label, value, x, color) => {
      doc.font('Helvetica-Bold').fontSize(12).fillColor(color || C.ink).text(value || 'N/A', x, y, { width: 165, align: 'center' });
      doc.font('Helvetica').fontSize(7).fillColor(C.sub).text(label, x, y + 17, { width: 165, align: 'center' });
    };
    num('Return DC Number', returnDcNumber, L, C.docNum);
    num('Original DC Number', header.original_dc_number || 'N/A', L + 180, C.teal);
    num('Sales Order Number', header.sales_order_number || 'N/A', L + 360, C.ink);
    y += 38;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).lineWidth(1).stroke();
    y += 12;

    const dateCell = (label, value, x) => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink)
        .text(formatPdfDateIstOrDash(value), x, y, { width: 165, align: 'center' });
      doc.font('Helvetica').fontSize(7).fillColor(C.sub)
        .text(label, x, y + 14, { width: 165, align: 'center' });
    };
    dateCell('Pick-Up Created Date', header.pickup_created_at || header.dc_date || header.created_at, L);
    dateCell('Pick-Up Date', header.pickup_date, L + 180);
    dateCell('Warehouse Received Date', header.warehouse_received_at, L + 360);
    y += 34;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).lineWidth(1).stroke();
    y += 12;

    // Seller
    doc.font('Helvetica-Bold').fontSize(12).fillColor(accent).text(company.legal_name, L, y);
    y += 16;
    doc.font('Helvetica').fontSize(9).fillColor(C.ink);
    if (company.gstin) { doc.text(`GSTIN: ${company.gstin}`, L, y); y += 12; }
    if (company.address) { doc.text(`Address: ${company.address}`, L, y, { width: W }); y += doc.heightOfString(`Address: ${company.address}`, { width: W }); }
    y += 8;

    // Dispatch tags
    const tags = [];
    const mode = header.dispatch_mode;
    if (mode === 'inhouse' || mode === 'technician') tags.push('By Hand / Technician');
    else if (mode === 'courier') tags.push('By Courier');
    else if (mode === 'porter') tags.push('By Porter');
    if (header.delivery_person_name) tags.push(header.delivery_person_name);
    if (header.courier_name) tags.push(header.courier_name);
    if (header.awb_number) tags.push(header.awb_number);
    let tx = L;
    for (const t of tags) {
      const w = doc.font('Helvetica').fontSize(8).widthOfString(t) + 16;
      doc.roundedRect(tx, y, w, 16, 8).strokeColor(accent).lineWidth(0.8).stroke();
      doc.fillColor(accent).text(t, tx + 8, y + 4);
      tx += w + 6;
    }
    if (tags.length) y += 24; else y += 4;

    // Pickup-from box
    const boxTop = y;
    let yy = boxTop + 8;
    const pickupTitle = `Picked up from: ${header.customer_name || addr.name || 'Customer'}`;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text(pickupTitle, L + 10, yy, { width: W - 20 });
    yy = doc.y + 4;
    doc.font('Helvetica').fontSize(8.5).fillColor(C.ink);
    const row = (lab, val) => {
      if (val == null || val === '') return;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink)
        .text(`${lab}: `, L + 10, yy, { continued: true, width: W - 20 })
        .font('Helvetica').text(String(val), { width: W - 20 });
      yy = doc.y + 2;
    };
    row('Phone', header.customer_phone || addr.phone);
    row('Email', header.customer_email);
    row('Address', formatDeliveryAddressLine(header.pickup_address));
    const boxBottom = yy + 8;
    doc.roundedRect(L, boxTop, W, boxBottom - boxTop, 6).strokeColor(C.line).lineWidth(1).stroke();
    y = boxBottom + 14;

    // Product table
    const rdcHsn = resolveHsnForDisplay(header.hsn_code, {
      quotationType: header.quotation_type,
      transactionType: header.transaction_type || txnTypeFromQuotation(header.quotation_type || 'rental'),
    });
    const cols = [
      { key: 'idx', label: '#', w: 28, align: 'center' },
      { key: 'product', label: 'Laptop / Product', w: 230, align: 'left' },
      { key: 'hsn', label: 'HSN/SAC', w: 60, align: 'center' },
      { key: 'ttspl', label: 'Machine No.', w: 100, align: 'left' },
      { key: 'serial', label: 'Serial No.', w: 105, align: 'left' },
    ];
    const drawHeader = (yh) => {
      doc.rect(L, yh, W, 22).fill(C.teal);
      let cx = L;
      doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9);
      for (const c of cols) { doc.text(c.label, cx + 6, yh + 6, { width: c.w - 12, align: c.align }); cx += c.w; }
      return yh + 22;
    };
    y = drawHeader(y);
    doc.font('Helvetica').fontSize(8.5).fillColor(C.ink);
    units.forEach((u, i) => {
      const l1 = `${dash(u.brand)} ${dash(u.model || u.model_name)}`.trim();
      const l2 = [u.processor, u.generation, u.ram, u.storage].filter(Boolean).join(' | ');
      const rowH = Math.max(34, 14 + (l2 ? 11 : 0));
      if (y + rowH > 720) { doc.addPage(); y = 40; y = drawHeader(y); }
      let cx = L;
      for (const c of cols) { doc.rect(cx, y, c.w, rowH).strokeColor(C.line).lineWidth(0.6).stroke(); cx += c.w; }
      doc.font('Helvetica').fontSize(8.5).fillColor(C.ink).text(String(i + 1), L + 4, y + rowH / 2 - 5, { width: cols[0].w - 8, align: 'center' });
      let px = L + cols[0].w + 6; let py = y + 6;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink).text(l1, px, py, { width: cols[1].w - 12 });
      if (l2) { doc.font('Helvetica').fontSize(8).fillColor(C.sub).text(l2, px, py + 11, { width: cols[1].w - 12 }); }
      const unitHsn = resolveHsnForDisplay(u.hsn_code || header.hsn_code, {
        quotationType: header.quotation_type,
        transactionType: header.transaction_type || txnTypeFromQuotation(header.quotation_type || 'rental'),
      }) || rdcHsn;
      doc.font('Helvetica').fontSize(8).fillColor(C.ink)
        .text(unitHsn, L + cols[0].w + cols[1].w + 4, y + rowH / 2 - 5, { width: cols[2].w - 8, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink)
        .text(dash(u.ttspl), L + cols[0].w + cols[1].w + cols[2].w + 6, y + rowH / 2 - 5, { width: cols[3].w - 12 });
      doc.font('Helvetica').fontSize(8.5).fillColor(C.ink)
        .text(dash(u.serial), L + cols[0].w + cols[1].w + cols[2].w + cols[3].w + 6, y + rowH / 2 - 5, { width: cols[4].w - 12 });
      y += rowH;
    });
    y += 18;

    // Remarks (replacement RDC names the laptop being swapped, etc.)
    const remarksText = String(header.remarks || '').trim();
    if (remarksText) {
      if (y > 680) { doc.addPage(); y = 40; }
      doc.font('Helvetica-Bold').fontSize(11).fillColor(C.teal).text('Remarks', L, y);
      y += 14;
      doc.font('Helvetica').fontSize(9).fillColor(C.ink)
        .text(remarksText, L, y, { width: W, lineGap: 2 });
      y = doc.y + 16;
    }

    // Signature blocks (technician sign-out + warehouse receipt)
    if (y > 640) { doc.addPage(); y = 40; }
    const half = (W - 12) / 2;
    const signBox = (x, title, signAbs, name, at, note) => {
      const h = 110;
      doc.roundedRect(x, y, half, h, 6).strokeColor(C.line).lineWidth(1).stroke();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(title, x + 10, y + 8, { width: half - 20 });
      if (signAbs) {
        try { doc.image(signAbs, x + 12, y + 24, { fit: [half - 24, 44] }); } catch (_) { /* ignore */ }
      } else {
        doc.font('Helvetica').fontSize(8).fillColor(C.sub).text('Signature: ______________________', x + 10, y + 50);
      }
      doc.font('Helvetica').fontSize(8).fillColor(C.ink)
        .text(`Name: ${name || '____________________'}`, x + 10, y + 76);
      doc.font('Helvetica').fontSize(7.5).fillColor(C.sub)
        .text(at ? formatPdfDateTimeLabel('Signed at: ', at) : (note || ''), x + 10, y + 90, { width: half - 20 });
    };
    signBox(L, 'Technician (Sign-out at customer site)', techSign, esign.technician_name, esign.technician_at,
      esign.customer_otp_verified ? 'Customer OTP verified at handover' : 'Pending customer OTP');
    signBox(L + half + 12, 'Warehouse (Received)', whSign, esign.warehouse_name, esign.warehouse_at,
      whSign ? '' : 'Pending warehouse confirmation');
    y += 124;

    doc.font('Helvetica').fontSize(7).fillColor(C.sub)
      .text('This Return Delivery Challan is a system-generated document recording the movement of the above unit(s) from the customer back to the warehouse.', L, y, { width: W, align: 'center' });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return relativePath;
}

// ── Service Delivery Challan PDF ─────────────────────────────────────────────
async function generateServiceDcPdf({ serviceDcNumber, header = {}, units = [] }) {
  ensureUploadDir();
  const fileName = `${String(serviceDcNumber).replace(/[^\w-]/g, '_')}_${Date.now()}.pdf`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  const relativePath = `uploads/sales-documents/${fileName}`;

  const entityCode = header.entity_code
    || (String(header.transaction_type || '').toLowerCase() === 'sale' ? 'gorefurbo' : 'rentfoxxy');
  const company = await loadCompany(entityCode);
  const accent = company.code === 'gorefurbo' ? C.gorefurbo : C.rentfoxxy;
  const addr = normalizeDeliveryAddress(header.shipping_address) || {};

  let gateQrPng = null;
  try {
    const { ensureGateQrPng } = require('./gateQrService');
    gateQrPng = (await ensureGateQrPng({ docType: 'sdc', docNumber: serviceDcNumber })).png;
  } catch (_) { /* optional */ }

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    const L = 36; const R = 559; const W = R - L;
    let y = 40;

    const logo = drawCompanyLogo(doc, company, L, y, { maxHeight: 36, maxWidth: 170 });
    if (!logo.drawn) {
      doc.fillColor(accent).font('Helvetica-Bold').fontSize(22).text(company.code || 'rentfoxxy', L, y + 4);
    }
    if (gateQrPng) {
      const { drawGateQr } = require('./gateQrService');
      drawGateQr(doc, gateQrPng, { x: R - 40, y: 36, size: 36, caption: 'Gate scan' });
      doc.font('Helvetica-Bold').fontSize(16).fillColor(accent)
        .text('SERVICE DELIVERY CHALLAN', 200, y, { width: 270, align: 'right' });
      doc.font('Helvetica').fontSize(8).fillColor(C.sub)
        .text('Repaired unit return to customer', 200, y + 20, { width: 270, align: 'right' });
    } else {
      doc.font('Helvetica-Bold').fontSize(16).fillColor(accent)
        .text('SERVICE DELIVERY CHALLAN', 230, y, { width: 293, align: 'right' });
      doc.font('Helvetica').fontSize(8).fillColor(C.sub)
        .text('Repaired unit return to customer', 230, y + 20, { width: 293, align: 'right' });
    }
    y += 46;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).lineWidth(1).stroke();
    y += 12;

    const num = (label, value, x, color) => {
      doc.font('Helvetica-Bold').fontSize(12).fillColor(color || C.ink)
        .text(value || 'N/A', x, y, { width: 165, align: 'center' });
      doc.font('Helvetica').fontSize(7).fillColor(C.sub)
        .text(label, x, y + 17, { width: 165, align: 'center' });
    };
    num('Service DC Number', serviceDcNumber, L, C.docNum);
    num('Original DC Number', header.original_dc_number || 'N/A', L + 180, C.teal);
    num('Sales Order Number', header.sales_order_number || 'N/A', L + 360, C.ink);
    y += 38;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).lineWidth(1).stroke();
    y += 12;

    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink)
      .text(`Support Ticket: #${header.support_ticket_id || '—'}`, L, y);
    y += 16;

    const shipTitle = `Deliver to: ${header.customer_name || addr.name || 'Customer'}`;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text(shipTitle, L, y, { width: W });
    y = doc.y + 6;
    doc.font('Helvetica').fontSize(8.5).fillColor(C.ink);
    const row = (lab, val) => {
      if (val == null || val === '') return;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink)
        .text(`${lab}: `, L, y, { continued: true, width: W })
        .font('Helvetica').text(String(val), { width: W });
      y = doc.y + 2;
    };
    row('Phone', header.customer_phone || addr.phone);
    row('Email', header.customer_email);
    row('Address', formatDeliveryAddressLine(header.shipping_address));
    y += 10;

    const sdcHsn = resolveHsnForDisplay(header.hsn_code, { transactionType: 'repair' }) || '847330';
    const cols = [
      { key: 'idx', label: '#', w: 28, align: 'center' },
      { key: 'product', label: 'Laptop / Product', w: 230, align: 'left' },
      { key: 'hsn', label: 'HSN/SAC', w: 60, align: 'center' },
      { key: 'ttspl', label: 'Machine No.', w: 100, align: 'left' },
      { key: 'serial', label: 'Serial No.', w: 105, align: 'left' },
    ];
    const drawHeader = (yh) => {
      doc.rect(L, yh, W, 22).fill(accent);
      let cx = L;
      doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9);
      for (const c of cols) { doc.text(c.label, cx + 6, yh + 6, { width: c.w - 12, align: c.align }); cx += c.w; }
      return yh + 22;
    };
    y = drawHeader(y);
    doc.font('Helvetica').fontSize(8.5).fillColor(C.ink);
    units.forEach((u, i) => {
      const l1 = `${dash(u.brand)} ${dash(u.model || u.model_name)}`.trim();
      const l2 = [u.processor, u.generation, u.ram, u.storage].filter(Boolean).join(' | ');
      const rowH = Math.max(34, 14 + (l2 ? 11 : 0));
      let cx = L;
      for (const c of cols) { doc.rect(cx, y, c.w, rowH).strokeColor(C.line).lineWidth(0.6).stroke(); cx += c.w; }
      doc.text(String(i + 1), L + 4, y + rowH / 2 - 5, { width: cols[0].w - 8, align: 'center' });
      let px = L + cols[0].w + 6; let py = y + 6;
      doc.font('Helvetica-Bold').fontSize(8.5).text(l1, px, py, { width: cols[1].w - 12 });
      if (l2) doc.font('Helvetica').fontSize(8).fillColor(C.sub).text(l2, px, py + 11, { width: cols[1].w - 12 });
      doc.font('Helvetica').fontSize(8).fillColor(C.ink)
        .text(sdcHsn, L + cols[0].w + cols[1].w + 4, y + rowH / 2 - 5, { width: cols[2].w - 8, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink)
        .text(dash(u.ttspl), L + cols[0].w + cols[1].w + cols[2].w + 6, y + rowH / 2 - 5, { width: cols[3].w - 12 });
      doc.font('Helvetica').fontSize(8.5).fillColor(C.ink)
        .text(dash(u.serial), L + cols[0].w + cols[1].w + cols[2].w + cols[3].w + 6, y + rowH / 2 - 5, { width: cols[4].w - 12 });
      y += rowH;
    });
    y += 14;

    if (header.remarks) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(accent).text('Remarks', L, y);
      y += 12;
      doc.font('Helvetica').fontSize(9).fillColor(C.ink).text(String(header.remarks), L, y, { width: W });
      y = doc.y + 12;
    }

    doc.font('Helvetica').fontSize(7).fillColor(C.sub)
      .text('This Service Delivery Challan records return of the repaired unit to the customer under the original rental/sale agreement. No new Sales Order is created.', L, y, { width: W, align: 'center' });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return relativePath;
}

async function emailDocument({ to, subject, text, html, pdfRelativePath, cc, replyTo }) {
  const transport = getMailTransport();
  if (!transport || !to) return false;
  const abs = pdfRelativePath ? path.join(__dirname, '..', pdfRelativePath) : null;
  const fromAddress = process.env.SMTP_FROM
    || process.env.FROM_EMAIL
    || process.env.EMAIL_FROM
    || process.env.SMTP_USER;
  const mail = {
    from: fromAddress,
    to,
    subject,
    text,
    attachments: abs && fs.existsSync(abs) ? [{ filename: path.basename(abs), path: abs }] : [],
  };
  if (html) mail.html = html;
  if (cc) mail.cc = cc;
  if (replyTo) mail.replyTo = replyTo;
  await transport.sendMail(mail);
  return true;
}

module.exports = { generateDocumentPdf, generateReturnDcPdf, generateServiceDcPdf, emailDocument };
