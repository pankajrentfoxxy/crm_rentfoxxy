const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { mergeCompany, formatCompanyBlock } = require('../utils/companyDefaults');

const C = {
  ink: '#1f2937',
  sub: '#6b7280',
  line: '#e5e7eb',
  accent: '#f26b21',
  teal: '#0e7490',
  panel: '#f9fafb',
};

async function loadCompany() {
  try {
    const r = await pool.query(
      `SELECT code, legal_name, gstin, pan, email, phone, address, state_code, logo_url
         FROM companies WHERE code = 'rentfoxxy' LIMIT 1`
    );
    if (r.rows.length) return mergeCompany(r.rows[0]);
  } catch (_) { /* pre-migration */ }
  return mergeCompany(null);
}

function resolveLogoPath(company) {
  const rel = company?.logo_url;
  if (!rel) return null;
  const candidates = [
    path.join(__dirname, '..', String(rel).replace(/^\//, '')),
    path.join(__dirname, '..', 'uploads', String(rel).replace(/^\/?uploads\//, '')),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

async function loadDc(dcNumber) {
  const headRes = await pool.query(
    `SELECT d.*,
            v.business_name AS vendor_business_name,
            v.first_name AS vendor_first_name,
            v.last_name AS vendor_last_name,
            v.address AS vendor_reg_address,
            v.city AS vendor_reg_city,
            v.state AS vendor_reg_state,
            v.pincode AS vendor_reg_pincode,
            v.shipping_same AS vendor_shipping_same,
            v.shipping_address AS vendor_ship_address,
            v.shipping_city AS vendor_ship_city,
            v.shipping_state AS vendor_ship_state,
            v.shipping_pincode AS vendor_ship_pincode
       FROM vendor_repair_delivery_challans d
       LEFT JOIN vendors v ON v.vendor_id = d.vendor_id AND v.deleted_at IS NULL
      WHERE d.dc_number = $1`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) return null;
  const itemsRes = await pool.query(
    `SELECT * FROM vendor_repair_dc_items WHERE dc_number = $1 ORDER BY id ASC`,
    [dcNumber]
  );
  const vendorMaster = head.vendor_id ? {
    business_name: head.vendor_business_name,
    first_name: head.vendor_first_name,
    last_name: head.vendor_last_name,
    address: head.vendor_reg_address,
    city: head.vendor_reg_city,
    state: head.vendor_reg_state,
    pincode: head.vendor_reg_pincode,
    shipping_same: head.vendor_shipping_same,
    shipping_address: head.vendor_ship_address,
    shipping_city: head.vendor_ship_city,
    shipping_state: head.vendor_ship_state,
    shipping_pincode: head.vendor_ship_pincode,
  } : null;
  return {
    ...head,
    items: itemsRes.rows,
    vendor_billing_display: formatVendorBillingFromRow(vendorMaster) || head.vendor_address || head.vendor_name,
    vendor_shipping_display: formatVendorShippingFromRow(vendorMaster) || head.shipping_address || head.vendor_address,
  };
}

function vendorDisplayName(vendor) {
  if (!vendor) return '';
  return vendor.business_name
    || [vendor.first_name, vendor.last_name].filter(Boolean).join(' ').trim()
    || '';
}

function formatVendorBillingFromRow(vendor) {
  if (!vendor) return '';
  const lines = [vendorDisplayName(vendor)].filter(Boolean);
  const street = [vendor.address, vendor.city, vendor.state, vendor.pincode].filter(Boolean).join(', ');
  if (street) lines.push(street);
  return lines.join('\n');
}

function formatVendorShippingFromRow(vendor) {
  if (!vendor) return '';
  if (vendor.shipping_same !== false) return formatVendorBillingFromRow(vendor);
  const lines = [vendorDisplayName(vendor)].filter(Boolean);
  const street = [vendor.shipping_address, vendor.shipping_city, vendor.shipping_state, vendor.shipping_pincode]
    .filter(Boolean).join(', ');
  if (street) lines.push(street);
  return lines.join('\n');
}

function drawCompanyHeader(doc, company, { docTitle, docNumber, rightLabel, rightValue, yStart = 40 } = {}) {
  const L = 40;
  const R = 555;
  const W = R - L;
  let y = yStart;

  const logoAbs = resolveLogoPath(company);
  let logoDrawn = false;
  if (logoAbs) {
    try {
      doc.image(logoAbs, L, y, { height: 36 });
      logoDrawn = true;
    } catch (_) { /* ignore */ }
  }
  if (!logoDrawn) {
    doc.fillColor(C.accent).font('Helvetica-Bold').fontSize(20).text(company.code || 'rentfoxxy', L, y + 6);
  }

  if (rightValue) {
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(13)
      .text(rightValue, R - 210, y, { width: 210, align: 'right' });
    if (rightLabel) {
      doc.font('Helvetica').fontSize(8).fillColor(C.sub)
        .text(rightLabel, R - 210, y + 18, { width: 210, align: 'right' });
    }
  }

  y += 48;
  doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).lineWidth(1).stroke();
  y += 12;

  if (docTitle) {
    doc.font('Helvetica-Bold').fontSize(14).fillColor(C.teal).text(docTitle, L, y, { align: 'center', width: W });
    y += 20;
  }

  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text(company.legal_name, L, y);
  y += 14;
  doc.font('Helvetica').fontSize(9).fillColor(C.sub);
  if (company.email) { doc.text(`Email: ${company.email}`, L, y); y += 12; }
  if (company.gstin) { doc.text(`GSTIN: ${company.gstin}`, L, y); y += 12; }
  if (company.address) {
    doc.text(`Address: ${company.address}`, L, y, { width: W });
    y += doc.heightOfString(`Address: ${company.address}`, { width: W }) + 4;
  }
  if (docNumber) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text(`Challan No: ${docNumber}`, L, y);
    y += 14;
  }

  return y + 8;
}

function writeAddressColumns(doc, y, companyFrom, vendorBilling, vendorShipping) {
  const L = 40;
  const colW = 168;
  const cols = [
    { title: 'Our Address (Dispatch From)', text: companyFrom },
    { title: 'Vendor Billing Address', text: vendorBilling },
    { title: 'Vendor Shipping Address', text: vendorShipping },
  ];
  let maxH = 0;
  cols.forEach((col, idx) => {
    const x = L + idx * (colW + 8);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(col.title, x, y, { width: colW });
    doc.font('Helvetica').fontSize(8).fillColor(C.ink);
    const h = doc.heightOfString(String(col.text || '—'), { width: colW });
    doc.text(String(col.text || '—'), x, y + 14, { width: colW });
    maxH = Math.max(maxH, h + 14);
  });
  return y + maxH + 12;
}

function writeItemsTable(doc, y, items, { title = 'Laptops' } = {}) {
  const L = 40;
  const R = 555;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text(title, L, y);
  y += 16;
  doc.rect(L, y, R - L, 18).fill(C.panel);
  doc.fillColor(C.sub).font('Helvetica-Bold').fontSize(8);
  doc.text('#', L + 6, y + 5, { width: 20 });
  doc.text('TTSPL', L + 28, y + 5, { width: 80 });
  doc.text('Serial', L + 110, y + 5, { width: 90 });
  doc.text('Configuration', L + 205, y + 5, { width: 180 });
  doc.text('Remarks', L + 390, y + 5, { width: 150 });
  y += 22;

  (items || []).forEach((item, idx) => {
    if (y > 720) {
      doc.addPage();
      y = 40;
    }
    doc.fillColor(C.ink).font('Helvetica').fontSize(8);
    doc.text(String(idx + 1), L + 6, y, { width: 20 });
    doc.text(String(item.ttspl_id || '—'), L + 28, y, { width: 80 });
    doc.text(String(item.serial_number || '—'), L + 110, y, { width: 90 });
    doc.text(String(item.configuration || '—'), L + 205, y, { width: 180 });
    doc.text(String(item.item_remarks || '—'), L + 390, y, { width: 150 });
    y += 16;
  });
  return y + 8;
}

async function generateVendorRepairPdf(dcNumber) {
  const dc = await loadDc(dcNumber);
  if (!dc) return null;

  const company = await loadCompany();
  const companyFrom = formatCompanyBlock(company);
  const vendorBilling = dc.vendor_billing_display || dc.vendor_address || dc.vendor_name || '—';
  const vendorShipping = dc.vendor_shipping_display || dc.shipping_address || dc.vendor_address || '—';

  const dir = path.join(__dirname, '../uploads/vendor-repair');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(dcNumber).replace(/[^\w-]+/g, '_');
  const rel = `vendor-repair/VRDC_${safe}.pdf`;
  const abs = path.join(__dirname, '../uploads', rel);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(abs);
    doc.pipe(stream);

    let y = drawCompanyHeader(doc, company, {
      docTitle: 'Vendor Repair — Out for Repair Delivery Challan',
      docNumber: dc.dc_number,
      rightLabel: 'Dispatch DC',
      rightValue: dc.dc_number,
    });

    doc.font('Helvetica').fontSize(9).fillColor(C.sub);
    doc.text(`Status: ${dc.status || '—'}`, 40, y);
    doc.text(`Out Date: ${dc.out_date ? new Date(dc.out_date).toLocaleDateString('en-IN') : '—'}`, 200, y);
    doc.text(`Expected Return: ${dc.expected_return_date ? new Date(dc.expected_return_date).toLocaleDateString('en-IN') : '—'}`, 360, y);
    y += 20;

    y = writeAddressColumns(doc, y, companyFrom, vendorBilling, vendorShipping);
    doc.font('Helvetica').fontSize(9).fillColor(C.ink);
    doc.text(`Vendor: ${dc.vendor_name || '—'}`, 40, y);
    y += 12;
    doc.text(`Contact: ${dc.contact_person || '—'} · ${dc.contact_mobile || '—'}`, 40, y);
    y += 16;

    y = writeItemsTable(doc, y, dc.items);
    if (dc.remarks) {
      doc.font('Helvetica-Bold').fontSize(9).text('Remarks:', 40, y);
      doc.font('Helvetica').fontSize(9).text(dc.remarks, 40, y + 12, { width: 515 });
    }

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  await pool.query(
    `UPDATE vendor_repair_delivery_challans SET pdf_path = $2, updated_at = NOW() WHERE dc_number = $1`,
    [dcNumber, rel]
  ).catch(() => {});

  return rel;
}

async function generateVendorRepairReceivePdf(dcNumber, receiveDcNumber, itemIds = []) {
  const dc = await loadDc(dcNumber);
  if (!dc) return null;
  const company = await loadCompany();
  const companyFrom = formatCompanyBlock(company);
  const vendorBilling = dc.vendor_billing_display || dc.vendor_address || dc.vendor_name || '—';
  const vendorShipping = dc.vendor_shipping_display || dc.shipping_address || dc.vendor_address || '—';
  const ids = (itemIds || []).map(Number).filter(Boolean);
  const items = (dc.items || []).filter((it) => !ids.length || ids.includes(Number(it.id)));

  const dir = path.join(__dirname, '../uploads/vendor-repair');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(receiveDcNumber).replace(/[^\w-]+/g, '_');
  const rel = `vendor-repair/VRDC_RECEIVE_${safe}.pdf`;
  const abs = path.join(__dirname, '../uploads', rel);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(abs);
    doc.pipe(stream);

    let y = drawCompanyHeader(doc, company, {
      docTitle: 'Vendor Repair — Return / Receive Challan',
      docNumber: receiveDcNumber,
      rightLabel: 'Receive DC',
      rightValue: receiveDcNumber,
    });

    doc.font('Helvetica').fontSize(9).fillColor(C.sub);
    doc.text(`Original Dispatch DC: ${dc.dc_number}`, 40, y);
    doc.text(`Receive Date: ${new Date().toLocaleDateString('en-IN')}`, 300, y);
    y += 20;

    y = writeAddressColumns(doc, y, companyFrom, vendorBilling, vendorShipping);
    y = writeItemsTable(doc, y, items, { title: 'Laptops Received' });
    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
      .text('Warehouse POD + Vendor acknowledgement captured via e-sign in CRM.', 40, y);

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return rel;
}

module.exports = { generateVendorRepairPdf, generateVendorRepairReceivePdf, loadCompany, formatCompanyBlock };
