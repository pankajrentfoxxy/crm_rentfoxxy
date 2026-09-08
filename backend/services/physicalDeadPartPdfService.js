/**
 * Physical-part outward PDF — scrap layout + gate QR for outward guard.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const {
  loadCompany,
  drawCompanyHeader,
  resolveSignFile,
  fmtIst,
  dispatchTagsForDc,
  drawDispatchTags,
} = require('./vendorRepairPdfService');
const { formatPdfDateIstOrDash } = require('../utils/pdfDateTimeUtils');

const C = {
  ink: '#1f2937',
  sub: '#6b7280',
  line: '#e5e7eb',
  teal: '#0e7490',
};

async function loadPhysicalOutwardPdfData(outwardNumber) {
  const headRes = await pool.query(
    `SELECT o.*,
            dt.first_name AS delivery_person_first_name,
            dt.last_name AS delivery_person_last_name
       FROM physical_part_outwards o
       LEFT JOIN delivery_technicians dt ON dt.technician_id = o.delivery_person_id
      WHERE o.outward_number = $1`,
    [outwardNumber]
  );
  const head = headRes.rows[0];
  if (!head) return null;
  const itemsRes = await pool.query(
    `SELECT p.dp_number, p.part_name, p.category, p.serial_number, p.condition, p.warehouse
       FROM physical_dead_parts p
      WHERE p.outward_id = $1
      ORDER BY p.dp_number`,
    [head.outward_id]
  );
  return { ...head, items: itemsRes.rows };
}

function writePhysicalItemsTable(doc, y, items) {
  const L = 40;
  const R = 555;
  const W = R - L;

  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text('Physical / dead parts', L, y);
  y += 14;

  const cols = [
    { label: 'DP', w: 80 },
    { label: 'Part name', w: 170 },
    { label: 'Category', w: 90 },
    { label: 'Serial', w: 90 },
    { label: 'Condition', w: W - 430 },
  ];

  const drawHeader = (yy) => {
    doc.rect(L, yy, W, 22).fill(C.teal);
    let cx = L;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    for (const c of cols) {
      doc.text(c.label, cx + 4, yy + 7, { width: c.w - 8 });
      cx += c.w;
    }
    return yy + 22;
  };

  y = drawHeader(y);

  for (const item of items || []) {
    const rowH = 32;
    if (y + rowH > 760) {
      doc.addPage();
      y = 40;
      y = drawHeader(y);
    }
    let cx = L;
    for (const c of cols) {
      doc.rect(cx, y, c.w, rowH).strokeColor(C.line).lineWidth(0.6).stroke();
      cx += c.w;
    }
    let x = L;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink)
      .text(item.dp_number || '—', x + 4, y + 10, { width: cols[0].w - 8 });
    x += cols[0].w;
    doc.font('Helvetica').fontSize(8).fillColor(C.ink)
      .text(item.part_name || '—', x + 4, y + 10, { width: cols[1].w - 8 });
    x += cols[1].w;
    doc.text(item.category || '—', x + 4, y + 10, { width: cols[2].w - 8 });
    x += cols[2].w;
    doc.text(item.serial_number || '—', x + 4, y + 10, { width: cols[3].w - 8 });
    x += cols[3].w;
    doc.font('Helvetica').fontSize(7.5)
      .text(item.condition || '—', x + 4, y + 10, { width: cols[4].w - 8 });
    y += rowH;
  }
  return y + 10;
}

function drawPhysicalDispatchSignatures(doc, y, outward) {
  if (y > 620) { doc.addPage(); y = 40; }
  const L = 40;
  const W = 515;
  const half = (W - 12) / 2;
  const whSign = resolveSignFile(outward.warehouse_dispatch_esign_url);
  const rSign = resolveSignFile(outward.recipient_esign_url);

  const signBox = (x, title, signAbs, name, optional = false) => {
    const h = 100;
    doc.roundedRect(x, y, half, h, 6).strokeColor(C.line).lineWidth(1).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink)
      .text(`${title}${optional ? ' (optional)' : ''}`, x + 10, y + 8, { width: half - 20 });
    if (signAbs) {
      try { doc.image(signAbs, x + 12, y + 22, { fit: [half - 24, 40] }); } catch (_) { /* ignore */ }
    } else {
      doc.font('Helvetica').fontSize(8).fillColor(C.sub)
        .text(optional ? 'Not provided' : '______________________', x + 10, y + 48);
    }
    doc.font('Helvetica').fontSize(8).fillColor(C.ink)
      .text(`Name: ${name || '—'}`, x + 10, y + 72, { width: half - 20 });
    if (outward.dispatched_at || outward.updated_at) {
      doc.font('Helvetica').fontSize(7).fillColor(C.sub)
        .text(`Signed: ${fmtIst(outward.dispatched_at || outward.updated_at)}`, x + 10, y + 86, { width: half - 20 });
    }
  };

  signBox(L, 'Warehouse dispatch sign', whSign, outward.warehouse_dispatch_signer_name, false);
  signBox(L + half + 12, 'Recipient sign', rSign, outward.recipient_signer_name, true);
  return y + 112;
}

async function generatePhysicalOutwardPdf(outwardNumber) {
  const outward = await loadPhysicalOutwardPdfData(outwardNumber);
  if (!outward) return null;

  const company = await loadCompany();
  const dir = path.join(__dirname, '../uploads/physical-parts');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(outwardNumber).replace(/[^\w-]+/g, '_');
  const rel = `physical-parts/POUT_${safe}.pdf`;
  const abs = path.join(__dirname, '../uploads', rel);

  const tagDc = {
    ship_by: outward.ship_by,
    dispatch_mode: outward.dispatch_mode,
    courier_name: outward.courier_name,
    awb_number: outward.awb_number,
    porter_tracking_id: outward.porter_tracking_id,
    delivery_person_first_name: outward.delivery_person_first_name,
    delivery_person_last_name: outward.delivery_person_last_name,
  };

  let gateQrPng = null;
  try {
    const { ensureGateQrPng } = require('./gateQrService');
    gateQrPng = (await ensureGateQrPng({ docType: 'pout', docNumber: outward.outward_number })).png;
  } catch (_) { /* optional */ }

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(abs);
    doc.pipe(stream);

    let y = drawCompanyHeader(doc, company, {
      docTitle: 'Physical Part Outward',
      docNumber: outward.outward_number,
      rightLabel: 'Outward',
      rightValue: outward.outward_number,
      qrPng: gateQrPng,
    });

    doc.font('Helvetica').fontSize(9).fillColor(C.sub);
    const status = String(outward.status || 'draft').replace(/_/g, ' ');
    doc.text(`Status: ${status}`, 40, y);
    doc.text(`Created: ${formatPdfDateIstOrDash(outward.created_at)}`, 40, y + 12);
    doc.text(`Dispatched: ${formatPdfDateIstOrDash(outward.dispatched_at)}`, 280, y + 12);
    y += 28;

    y = drawDispatchTags(doc, y, dispatchTagsForDc(tagDc));

    doc.font('Helvetica').fontSize(9).fillColor(C.ink);
    doc.text(`Receiver: ${outward.receiver_name || '—'} (${outward.receiver_type || '—'})`, 40, y);
    y += 12;
    doc.text(`Contact: ${outward.receiver_contact || '—'}`, 40, y);
    y += 12;
    doc.text(`Purpose: ${outward.purpose || '—'}`, 40, y);
    y += 12;
    if (outward.reference_number) {
      doc.text(`Reference: ${outward.reference_number}`, 40, y);
      y += 12;
    }
    y += 4;

    y = writePhysicalItemsTable(doc, y, outward.items);

    if (outward.remarks) {
      y += 4;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('Remarks:', 40, y);
      doc.font('Helvetica').fontSize(9).text(outward.remarks, 40, y + 12, { width: 515 });
      y += 28;
    }

    y = drawPhysicalDispatchSignatures(doc, y, outward);

    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
      .text(
        'Scan the gate QR at outward and submit. No per-part verify — the movement is recorded in guard history.',
        40,
        Math.min(y + 8, 780),
        { width: 515 }
      );

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  await pool.query(
    `UPDATE physical_part_outwards SET pdf_path = $2, updated_at = NOW() WHERE outward_number = $1`,
    [outwardNumber, rel]
  ).catch(() => {});

  return rel;
}

module.exports = {
  loadPhysicalOutwardPdfData,
  generatePhysicalOutwardPdf,
};
