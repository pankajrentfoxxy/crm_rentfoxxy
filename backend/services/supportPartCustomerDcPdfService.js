'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { formatPdfNowIst } = require('../utils/pdfDateTimeUtils');
const { parseJsonSafe } = require('./supportPartCustomerDcService');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'sales-documents');
const C = {
  accent: '#E64C1E',
  ink: '#1A1A2E',
  sub: '#6B7280',
  line: '#E5E7EB',
  green: '#059669',
};

const money = (v) => `Rs. ${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function loadCompany() {
  try {
    const r = await pool.query(
      `SELECT code, legal_name, gstin, pan, email, phone, address, logo_url
         FROM companies WHERE code = 'rentfoxxy' LIMIT 1`
    );
    if (r.rows.length) return r.rows[0];
  } catch (_) { /* pre-migration */ }
  return {};
}

function addrBlock(addr) {
  if (!addr) return '—';
  if (typeof addr === 'string') return addr;
  return [
    addr.name, addr.phone,
    addr.address, addr.city, addr.state, addr.pincode || addr.zip_code,
  ].filter(Boolean).join('\n');
}

/**
 * Generate Part Delivery Challan PDF (PDC) for customer-bound spare parts.
 */
async function generatePartCustomerDcPdf(dcNumber) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const safeName = String(dcNumber).replace(/[^\w/-]/g, '_').replace(/\//g, '-');
  const fileName = `${safeName}_${Date.now()}.pdf`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  const relPath = `uploads/sales-documents/${fileName}`;

  const dclRes = await pool.query(
    `SELECT dcl.*, st.id AS ticket_id,
            ('STK-' || LPAD(st.id::text, 4, '0')) AS ticket_number
       FROM delivery_challan_lines dcl
       LEFT JOIN support_tickets st ON st.id = dcl.support_ticket_id
      WHERE dcl.dc_number = $1 AND dcl.dc_purpose = 'part_delivery'
      LIMIT 1`,
    [dcNumber]
  );
  const dcl = dclRes.rows[0];
  if (!dcl) throw new Error('Part DC not found');

  const sprRes = await pool.query(
    `SELECT spr.*, p.part_name, pi.prt_id
       FROM support_part_requests spr
       JOIN parts p ON p.part_id = spr.part_id
       LEFT JOIN part_instances pi ON pi.instance_id = spr.instance_id
      WHERE spr.customer_dc_number = $1
      ORDER BY spr.id`,
    [dcNumber]
  );
  const parts = sprRes.rows;
  const co = await loadCompany();
  const billing = parseJsonSafe(dcl.customer_billing_address);
  const shipping = parseJsonSafe(dcl.customer_shipping_address);
  const isWarranty = parts.every((p) => p.billing_type === 'under_warranty');
  const totalCharge = parts.reduce((s, p) => s + Number(p.charge_amount || 0), 0);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);

    const L = 40; const R = 555; const W = R - L;
    let y = 40;

    const logoAbs = co.logo_url
      ? path.join(__dirname, '..', String(co.logo_url).replace(/^\//, ''))
      : null;
    let logoDrawn = false;
    if (logoAbs && fs.existsSync(logoAbs)) {
      try { doc.image(logoAbs, L, y, { height: 36 }); logoDrawn = true; } catch (_) {}
    }
    if (!logoDrawn) {
      doc.fillColor(C.accent).font('Helvetica-Bold').fontSize(20).text('RENTFOXXY', L, y + 6);
    }

    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(14)
      .text('PART DELIVERY CHALLAN', R - 220, y, { width: 220, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(C.sub)
      .text(dcNumber, R - 220, y + 18, { width: 220, align: 'right' });

    y += 50;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink)
      .text(co.legal_name || 'TRUETECH SERVICES PRIVATE LIMITED', L, y);
    y += 14;
    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
      .text(`GSTIN: ${co.gstin || dcl.gst_number || '06AAHCT0310N1ZG'}`, L, y);
    y += 11;
    doc.text(co.address || '429, 4th Floor, JMD Megapolis Building, Sohna Road, Gurgaon', L, y, { width: W / 2 });
    y += 28;

    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('Document Details', L, y);
    y += 12;
    const meta = [
      ['Date', formatPdfNowIst()],
      ['Support Ticket', dcl.ticket_number || '—'],
      ['Sales Order', dcl.sales_order_number || '—'],
      ['Dispatch', dcl.dispatch_mode === 'courier' ? `Courier — ${dcl.courier_name || '—'}` : 'Inhouse'],
      ['AWB', dcl.awb_number || '—'],
      ['Billing', isWarranty ? 'Under Warranty (No Charge)' : 'Chargeable'],
    ];
    meta.forEach(([k, v]) => {
      doc.font('Helvetica').fontSize(8).fillColor(C.sub).text(`${k}:`, L, y, { continued: true, width: 100 });
      doc.fillColor(C.ink).text(` ${v}`, { width: W - 100 });
      y += 11;
    });

    y += 8;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).stroke();
    y += 12;

    const colW = (W - 20) / 2;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('Bill To', L, y);
    doc.text('Ship To', L + colW + 20, y);
    y += 12;
    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
      .text(addrBlock(billing), L, y, { width: colW })
      .text(addrBlock(shipping), L + colW + 20, y, { width: colW });

    y += 70;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).stroke();
    y += 10;

    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink);
    doc.text('#', L, y, { width: 20 });
    doc.text('Part Description', L + 22, y, { width: 180 });
    doc.text('PRT ID', L + 210, y, { width: 80 });
    doc.text('Laptop TTSPL', L + 295, y, { width: 80 });
    doc.text('HSN', L + 380, y, { width: 50 });
    doc.text('Amount', L + 440, y, { width: 80, align: 'right' });
    y += 14;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).stroke();
    y += 6;

    parts.forEach((p, i) => {
      const amt = p.billing_type === 'charge_customer' ? Number(p.charge_amount || 0) : 0;
      doc.font('Helvetica').fontSize(8).fillColor(C.ink);
      doc.text(String(i + 1), L, y, { width: 20 });
      doc.text(p.part_name || 'Spare Part', L + 22, y, { width: 180 });
      doc.text(p.prt_id || '—', L + 210, y, { width: 80 });
      doc.text(p.ttspl_id || '—', L + 295, y, { width: 80 });
      doc.text(dcl.hsn_code || '847330', L + 380, y, { width: 50 });
      doc.text(amt > 0 ? money(amt) : 'Warranty', L + 440, y, { width: 80, align: 'right' });
      y += 16;
    });

    y += 8;
    if (!isWarranty && totalCharge > 0) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink)
        .text(`Total Chargeable: ${money(totalCharge)}`, L, y, { width: W, align: 'right' });
      y += 16;
    }

    if (dcl.remarks) {
      doc.font('Helvetica').fontSize(8).fillColor(C.sub)
        .text(`Remarks: ${dcl.remarks}`, L, y, { width: W });
      y += 20;
    }

    y = Math.max(y + 20, 680);
    doc.font('Helvetica').fontSize(7).fillColor(C.sub)
      .text(
        'This Part Delivery Challan is a system-generated document from TRUETECH SERVICES PRIVATE LIMITED '
        + 'recording shipment of warranty/replacement spare parts to the customer site. '
        + 'Parts are tracked against the linked laptop TTSPL for internal costing.',
        L, y, { width: W, align: 'center' }
      );

    doc.end();
  });

  await pool.query(
    `UPDATE delivery_challan_lines SET pdf_path = $1, updated_at = NOW() WHERE dc_number = $2`,
    [relPath, dcNumber]
  );

  return relPath;
}

module.exports = { generatePartCustomerDcPdf };
