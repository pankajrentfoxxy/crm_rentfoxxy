'use strict';
const fs   = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'support-parts');
const C = {
  accent: '#E64C1E',
  ink:    '#1A1A2E',
  sub:    '#6B7280',
  line:   '#E5E7EB',
  green:  '#059669',
  white:  '#FFFFFF',
};

// PDFKit's Helvetica has no rupee glyph; use ASCII-safe "Rs." prefix.
const money = (v) => `Rs. ${Number(v || 0).toFixed(2)}`;

async function loadCompany() {
  try {
    const r = await pool.query(
      `SELECT code, legal_name, gstin, pan, email, phone, address, logo_url
       FROM companies WHERE code = 'rentfoxxy' LIMIT 1`
    );
    if (r.rows.length) return r.rows[0];
  } catch (_) { /* pre-migration / no companies table */ }
  return {};
}

/**
 * Generates (or regenerates) the PDF for a support part challan.
 * If esignUrl is provided, embeds the e-sign image.
 * Saves to uploads/support-parts/SPC-XXXX.pdf and updates pdf_path in DB.
 */
async function generateChallanPdf(challanId, challanNumber, esignUrl = null) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const fileName = `${String(challanNumber).replace(/[^\w-]/g, '_')}.pdf`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  const relPath  = `uploads/support-parts/${fileName}`;

  const chalRes = await pool.query(
    `SELECT sc.*, u.name AS tech_name, u.email AS tech_email,
            ist.name AS issued_by_name,
            st.customer_name, st.id AS ticket_id,
            ('STK-' || LPAD(st.id::text, 4, '0')) AS ticket_number
     FROM support_part_challans sc
     JOIN users u ON u.user_id = sc.issued_to
     LEFT JOIN users ist ON ist.user_id = sc.issued_by
     JOIN support_tickets st ON st.id = sc.support_ticket_id
     WHERE sc.id = $1`, [challanId]
  );
  if (!chalRes.rows.length) throw new Error('Challan not found');
  const ch = chalRes.rows[0];

  const items = await pool.query(
    'SELECT * FROM support_challan_items WHERE challan_id = $1 ORDER BY id', [challanId]
  );

  const co = await loadCompany();

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);

    const L = 40, R = 555, W = R - L;
    let y = 40;

    // ── HEADER BAND ──
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
       .text(ch.challan_number, R - 200, y, { width: 200, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
       .text('Support Part Challan', R - 200, y + 18, { width: 200, align: 'right' });

    y += 50;

    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink)
       .text(co.legal_name || 'TRUETECH SERVICES PRIVATE LIMITED', L, y);
    y += 14;
    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
       .text(`GSTIN: ${co.gstin || '06AAHCT0310N1ZG'}`, L, y);
    y += 11;
    doc.text(co.address || '429, 4th Floor, JMD Megapolis, Sohna Road, Gurgaon', L, y, { width: W / 2 });
    y += 11;
    doc.text(`Email: ${co.email || 'accounts@truetechservices.in'}`, L, y);
    y += 20;

    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).lineWidth(1).stroke();
    y += 12;

    // ── INFO ROW ──
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('SUPPORT TICKET', L, y);
    doc.font('Helvetica').fontSize(9).fillColor(C.sub)
       .text(`${ch.ticket_number} - ${ch.customer_name || ''}`, L, y + 11, { width: W / 2 - 10 });

    if (ch.ttspl_id) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink)
         .text('LAPTOP (TTSPL)', L, y + 26);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(C.accent)
         .text(ch.ttspl_id, L, y + 37);
    }

    const rCol = L + W / 2 + 20;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('ISSUED TO', rCol, y);
    doc.font('Helvetica').fontSize(10).fillColor(C.ink).text(ch.tech_name || '-', rCol, y + 11);
    doc.font('Helvetica').fontSize(8).fillColor(C.sub).text(ch.tech_email || '', rCol, y + 23);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('DATE', rCol, y + 37);
    doc.font('Helvetica').fontSize(9).fillColor(C.sub)
       .text(
         (ch.issued_at ? new Date(ch.issued_at) : new Date())
           .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
         rCol, y + 48
       );

    y += 70;

    // ── PARTS TABLE ──
    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).lineWidth(1).stroke();
    y += 8;

    const cols = {
      prt:   { x: L,       w: 120, label: 'PRT-ID' },
      name:  { x: L + 125, w: 160, label: 'Part Name' },
      qty:   { x: L + 290, w: 50,  label: 'Qty' },
      cost:  { x: L + 345, w: 80,  label: 'Unit Cost' },
      total: { x: L + 430, w: 85,  label: 'Total' },
    };
    Object.values(cols).forEach(({ x, w, label }) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.sub)
         .text(label.toUpperCase(), x, y, { width: w });
    });
    y += 14;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).stroke();
    y += 8;

    let grandTotal = 0;
    items.rows.forEach((item) => {
      const total = Number(item.unit_cost || 0) * Number(item.quantity || 1);
      grandTotal += total;
      const rowY = y;

      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.accent)
         .text(item.prt_id || '-', cols.prt.x, rowY, { width: cols.prt.w });
      doc.font('Helvetica').fontSize(9).fillColor(C.ink)
         .text(item.part_name || '-', cols.name.x, rowY, { width: cols.name.w });
      doc.font('Helvetica').fontSize(9).fillColor(C.ink)
         .text(String(item.quantity), cols.qty.x, rowY, { width: cols.qty.w, align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor(C.sub)
         .text(money(item.unit_cost), cols.cost.x, rowY, { width: cols.cost.w, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink)
         .text(money(total), cols.total.x, rowY, { width: cols.total.w, align: 'right' });

      y += 18;
      doc.moveTo(L, y - 4).lineTo(R, y - 4).strokeColor(C.line).lineWidth(0.5).stroke();
    });

    y += 4;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink)
       .text(`Total Value: ${money(grandTotal)}`, R - 200, y, { width: 200, align: 'right' });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.sub)
       .text('(Parts are company property. Return unused parts.)', L, y + 1, { width: W - 200 });
    y += 22;

    // ── TERMS BOX ──
    doc.rect(L, y, W, 44).fillAndStroke('#FFF7ED', '#FED7AA');
    doc.fillColor('#92400E').font('Helvetica-Bold').fontSize(8)
       .text('TERMS & CONDITIONS', L + 8, y + 6, { width: W - 16 });
    doc.font('Helvetica').fontSize(7.5)
       .text(
         '1. These parts are issued for the support visit only and remain property of Rentfoxxy.\n' +
         '2. Unused parts must be returned to warehouse within 24 hours of visit completion.\n' +
         '3. Lost/damaged parts will be recovered from the technician.',
         L + 8, y + 16, { width: W - 16 }
       );
    y += 56;

    // ── SIGNATURE SECTION ──
    const sigBoxW = (W - 20) / 2;

    doc.rect(L, y, sigBoxW, 80).strokeColor(C.line).lineWidth(1).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
       .text('Technician Signature (Received parts)', L + 8, y + 6, { width: sigBoxW - 16 });

    const techSign = esignUrl || ch.tech_esign_url;
    if (techSign) {
      const esignPath = path.join(__dirname, '..', String(techSign).replace(/^\//, ''));
      if (fs.existsSync(esignPath)) {
        try { doc.image(esignPath, L + 10, y + 18, { fit: [sigBoxW - 20, 44], align: 'center' }); }
        catch (_) {}
      }
    } else {
      doc.fillColor(C.sub).fontSize(8)
         .text('[ Sign here ]', L + 8, y + 36, { width: sigBoxW - 16, align: 'center' });
    }
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink)
       .text(ch.tech_esign_name || ch.tech_name || '', L + 8, y + 66, { width: sigBoxW - 16 });

    const rSigX = L + sigBoxW + 20;
    doc.rect(rSigX, y, sigBoxW, 80).strokeColor(C.line).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
       .text('Warehouse Staff Signature (Issued)', rSigX + 8, y + 6, { width: sigBoxW - 16 });

    if (ch.wh_esign_url) {
      const whPath = path.join(__dirname, '..', String(ch.wh_esign_url).replace(/^\//, ''));
      if (fs.existsSync(whPath)) {
        try { doc.image(whPath, rSigX + 10, y + 18, { fit: [sigBoxW - 20, 44] }); } catch (_) {}
      }
    } else {
      doc.fillColor(C.sub).fontSize(8)
         .text('[ Warehouse sign ]', rSigX + 8, y + 36, { width: sigBoxW - 16, align: 'center' });
    }
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink)
       .text(ch.wh_esign_name || ch.issued_by_name || 'Warehouse Team', rSigX + 8, y + 66, { width: sigBoxW - 16 });

    y += 92;

    doc.font('Helvetica').fontSize(7).fillColor(C.sub)
       .text(
         `Generated: ${new Date().toLocaleString('en-IN')} - ${ch.challan_number}`,
         L, y, { width: W, align: 'center' }
       );

    doc.end();
  });

  await pool.query(
    `UPDATE support_part_challans SET pdf_path = $1, updated_at = NOW() WHERE id = $2`,
    [relPath, challanId]
  );

  return relPath;
}

module.exports = { generateChallanPdf };
