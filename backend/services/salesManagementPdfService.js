const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const pool = require('../config/db');

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

async function loadCompany(entityCode) {
  const code = entityCode === 'gorefurbo' ? 'gorefurbo' : 'rentfoxxy';
  try {
    const r = await pool.query(
      `SELECT code, legal_name, gstin, pan, email, phone, address, state_code, logo_url
       FROM companies WHERE code = $1`,
      [code]
    );
    if (r.rows.length) return r.rows[0];
  } catch (_) { /* pre-migration */ }
  return {
    code,
    legal_name: code === 'gorefurbo' ? 'Gorefurbo' : 'TRUETECH SERVICES PRIVATE LIMITED',
    gstin: null, pan: null, email: null, phone: null, address: null, state_code: '06', logo_url: null,
  };
}

function parseJson(v, fallback = null) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}
// Note: PDFKit's built-in Helvetica has no glyph for the ₹ rupee sign (it
// renders as a stray superscript "1"), so use the ASCII-safe "Rs." prefix.
const money = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dash = (v) => (v == null || v === '' ? 'N/A' : String(v));

// Resolve per-serial spec rows for a DC (one product row per laptop).
async function resolveDcUnitRows(lines) {
  const rows = [];
  for (const line of lines) {
    const raw = line.serial_number;
    let entries = [];
    const arr = parseJson(raw, null);
    if (Array.isArray(arr)) entries = arr;
    else if (raw) entries = [raw];
    if (!entries.length) {
      rows.push({ ...line, ttspl: '', serial: '', qty: line.quantity || 1 });
      continue;
    }
    for (const e of entries) {
      const parts = String(e).split('|');
      const serialId = /^\d+$/.test(parts[0]) ? Number(parts[0]) : null;
      const serialNumber = parts[1] || parts[0];
      const ttspl = parts[2] || null;
      let spec = {};
      try {
        const r = await pool.query(
          `SELECT vsn.serial_number, vsn.inventory_asset_code,
                  COALESCE(vsn.extra->>'brand', vpd.brand) AS brand,
                  COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', vpd.model) AS model,
                  COALESCE(vsn.extra->>'processor', vpd.processor) AS processor,
                  COALESCE(vsn.extra->>'generation', vpd.generation) AS generation,
                  COALESCE(vsn.extra->>'ram', vpd.ram) AS ram,
                  COALESCE(vsn.extra->>'storage', vpd.storage) AS storage,
                  COALESCE(vsn.extra->>'gpu', vpd.gpu) AS gpu,
                  COALESCE(vsn.extra->>'screen_size', vpd.screen_size) AS screen_size
             FROM vendor_serial_numbers vsn
             LEFT JOIN vendor_product_details vpd ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id','')::int
            WHERE vsn.deleted_at IS NULL AND (vsn.serial_id = $1 OR vsn.serial_number = $2 OR vsn.inventory_asset_code = $2)
            LIMIT 1`,
          [serialId, serialNumber]
        );
        spec = r.rows[0] || {};
      } catch (_) { spec = {}; }
      rows.push({
        brand: spec.brand || line.brand,
        model_name: spec.model || line.model_name,
        processor: spec.processor || line.processor,
        generation: spec.generation || line.generation,
        ram: spec.ram || line.ram,
        storage: spec.storage || line.storage,
        gpu: spec.gpu || line.gpu,
        screen_size: spec.screen_size || line.screen_size,
        serial: spec.serial_number || serialNumber,
        ttspl: spec.inventory_asset_code || ttspl || '',
        rate: line.rate,
        locking_period: line.locking_period,
        technical_warranty: line.technical_warranty,
        battery_charger_warranty: line.battery_charger_warranty,
        qty: 1,
      });
    }
  }
  return rows;
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

  const company = await loadCompany(header.entity_code);
  const accent = company.code === 'gorefurbo' ? C.gorefurbo : C.rentfoxxy;
  const qtype = await resolveQuotationType(docType, header);
  const isSale = qtype === 'sale' || qtype === 'sales';
  const isDemo = qtype === 'demo';
  const docLabel = docType === 'quotation' ? 'Quotation' : docType === 'sales_order' ? 'Sales Order' : 'Delivery Challan';
  const typeLabel = isSale ? 'Sale' : isDemo ? 'Demo' : 'Rental';

  // Product rows
  const rows = docType === 'delivery_challan'
    ? await resolveDcUnitRows(lines)
    : lines.map((l) => ({
      brand: l.brand, model_name: l.model_name, processor: l.processor, generation: l.generation,
      ram: l.ram, storage: l.storage, gpu: l.gpu, screen_size: l.screen_size,
      serial: '', ttspl: '', rate: l.rate, locking_period: l.locking_period,
      technical_warranty: l.technical_warranty, battery_charger_warranty: l.battery_charger_warranty,
      qty: l.quantity || 1,
    }));

  // Totals
  const goods = rows.reduce((s, r) => s + (Number(r.rate || 0) * Number(r.qty || 1)), 0);
  const shipping = Number(header.shiping_charges || lines[0]?.shiping_charges || 0);
  const security = Number(header.security_amount || lines[0]?.security_amount || 0);
  const taxable = goods + shipping;
  // GST: intra-state (CGST+SGST) if buyer state matches seller, else IGST.
  const sellerState = String(company.state_code || '06').toLowerCase();
  const buyerState = String(header.supply_state || '').toLowerCase();
  const intra = buyerState && (buyerState === sellerState || buyerState.includes('haryana') || buyerState === '06');
  const gstRate = 18;
  const gstAmount = +(taxable * gstRate / 100).toFixed(2);
  const total = +(taxable + gstAmount + security).toFixed(2);

  const billing = parseJson(header.customer_billing_address, {}) || {};
  const shippingAddr = parseJson(header.customer_shipping_address, {}) || {};

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    const L = 36; const R = 559; const W = R - L;

    // ── Header band ──────────────────────────────────────────────────────
    let y = 40;
    const logoAbs = company.logo_url
      ? path.join(__dirname, '..', company.logo_url.replace(/^\//, ''))
      : null;
    let logoDrawn = false;
    if (logoAbs && fs.existsSync(logoAbs)) {
      try { doc.image(logoAbs, L, y, { height: 34 }); logoDrawn = true; } catch (_) { /* ignore */ }
    }
    if (!logoDrawn) {
      doc.fillColor(accent).font('Helvetica-Bold').fontSize(22).text(company.code, L, y + 4);
    }
    // Doc numbers (right cluster)
    const num = (label, value, x, color) => {
      doc.font('Helvetica-Bold').fontSize(13).fillColor(color || C.ink).text(value || 'N/A', x, y, { width: 150, align: 'center' });
      doc.font('Helvetica').fontSize(7).fillColor(C.sub).text(label, x, y + 18, { width: 150, align: 'center' });
    };
    num('DC Number', docType === 'delivery_challan' ? docNumber : (header.dc_number || 'N/A'), 250, C.docNum);
    num('Sales Order Number', docType === 'sales_order' ? docNumber : (header.sales_order_number || 'N/A'), 360, C.ink);
    num('Quotation Number', docType === 'quotation' ? docNumber : (header.quotation_number || 'N/A'), 470, C.ink);
    y += 50;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).lineWidth(1).stroke();
    y += 12;

    // ── Seller block + type/dispatch ─────────────────────────────────────
    doc.font('Helvetica').fontSize(9).fillColor(C.sub)
      .text(`Date: ${header.dc_date || new Date().toLocaleDateString('en-GB')}`, L, y);
    y += 14;
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
    const addrBlock = (x, title, name, a, extra) => {
      let yy = boxTop + 8;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text(title, x + 10, yy, { width: colW - 20 });
      yy += 16;
      doc.font('Helvetica').fontSize(8.5).fillColor(C.ink);
      const row = (lab, val) => {
        if (val == null || val === '') return;
        doc.font('Helvetica-Bold').text(`${lab}: `, x + 10, yy, { continued: true, width: colW - 20 })
          .font('Helvetica').text(String(val));
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
    const custName = billing.name || header.customer_name || 'Customer';
    const shipName = shippingAddr.name || custName;
    // measure heights by drawing into temp? Simpler: draw then compute box height after.
    const leftEnd = addrBlock(L, custName, custName, { ...billing, email: header.customer_email || billing.email, phone: header.customer_mobile || billing.phone }, { email: header.customer_email, phone: header.customer_mobile, gst: header.gst_number || billing.gst_number });
    const rightEnd = addrBlock(L + colW + 12, `Shipping To: ${shipName}`, shipName, shippingAddr, {});
    const boxBottom = Math.max(leftEnd, rightEnd) + 8;
    doc.roundedRect(L, boxTop, colW, boxBottom - boxTop, 6).strokeColor(C.line).lineWidth(1).stroke();
    doc.roundedRect(L + colW + 12, boxTop, colW, boxBottom - boxTop, 6).strokeColor(C.line).lineWidth(1).stroke();
    y = boxBottom + 14;

    // ── Product table ────────────────────────────────────────────────────
    // Columns depend on type.
    let cols;
    if (isSale) {
      cols = [
        { key: 'product', label: 'Product', w: 200, align: 'left' },
        { key: 'tech', label: 'Tech. Wty.', w: 70, align: 'center' },
        { key: 'bat', label: 'Bat./Chg. Wty.', w: 78, align: 'center' },
        { key: 'qty', label: 'Qty.', w: 40, align: 'center' },
        { key: 'rate', label: 'Rate', w: 65, align: 'right' },
        { key: 'amount', label: 'Amount', w: 70, align: 'right' },
      ];
    } else {
      cols = [
        { key: 'product', label: 'Product', w: 243, align: 'left' },
        { key: 'lock', label: 'Locking', w: 75, align: 'center' },
        { key: 'qty', label: 'Qty.', w: 45, align: 'center' },
        { key: 'rate', label: 'Rate', w: 80, align: 'right' },
        { key: 'amount', label: 'Amount', w: 80, align: 'right' },
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
    totRow('Shipping Charges:', money(shipping));
    totRow('Sub Total:', money(taxable));
    totRow('Security Amount:', money(security));
    if (intra) {
      totRow(`CGST (${gstRate / 2}%):`, money(gstAmount / 2));
      totRow(`SGST (${gstRate / 2}%):`, money(gstAmount / 2));
    } else {
      totRow(`IGST (${gstRate}%):`, money(gstAmount));
    }
    doc.moveTo(tx2, y).lineTo(R, y).strokeColor(C.line).stroke(); y += 6;
    totRow('Total:', money(total), true);
    y += 10;

    // ── Remarks ──────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.teal).text('Remarks', L, y); y += 16;
    doc.font('Helvetica').fontSize(9).fillColor(C.ink);
    rows.forEach((r, i) => {
      const rk = lines[i]?.remarks || lines[i]?.remark;
      doc.text(`• Product ${i + 1} : ${rk || typeLabel.toUpperCase()}`, L + 6, y); y += 13;
    });
    y += 14;

    // ── Acknowledgement / e-sign area (future tracking) ──────────────────
    if (y > 720) { doc.addPage(); y = 40; }
    doc.roundedRect(L, y, W, 64, 6).strokeColor(C.line).lineWidth(1).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('Acknowledgement of Receipt', L + 10, y + 8);
    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
      .text('Received the above item(s) in good condition.', L + 10, y + 22);
    doc.fillColor(C.ink).font('Helvetica').fontSize(9);
    doc.text('Received by: _________________________', L + 10, y + 42);
    doc.text('Signature: ______________', L + 300, y + 42);
    doc.text('Date: ____________', L + 430, y + 42);

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return relativePath;
}

async function emailDocument({ to, subject, text, pdfRelativePath, cc }) {
  const transport = getMailTransport();
  if (!transport || !to) return false;
  const abs = path.join(__dirname, '..', pdfRelativePath);
  const mail = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    attachments: fs.existsSync(abs) ? [{ filename: path.basename(abs), path: abs }] : [],
  };
  if (cc) mail.cc = cc;
  await transport.sendMail(mail);
  return true;
}

module.exports = { generateDocumentPdf, emailDocument };
