/**
 * Scrap Challan PDF — reuses drawing primitives from vendorRepairPdfService.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const {
  loadCompany,
  drawCompanyHeader,
  writeVendorAddressBoxes,
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

async function loadScrapChallanPdfData(challanNumber) {
  const headRes = await pool.query(
    `SELECT d.*,
            v.business_name AS vendor_business_name,
            dt.first_name AS delivery_person_first_name,
            dt.last_name AS delivery_person_last_name
       FROM scrap_challans d
       LEFT JOIN vendors v ON v.vendor_id = d.recipient_vendor_id AND v.deleted_at IS NULL
       LEFT JOIN delivery_technicians dt ON dt.technician_id = d.delivery_person_id
      WHERE d.challan_number = $1`,
    [challanNumber]
  );
  const head = headRes.rows[0];
  if (!head) return null;
  const itemsRes = await pool.query(
    `SELECT * FROM scrap_challan_items WHERE challan_number = $1 ORDER BY id ASC`,
    [challanNumber]
  );
  return { ...head, items: itemsRes.rows };
}

function writeScrapItemsTable(doc, y, items) {
  const L = 40;
  const R = 555;
  const W = R - L;

  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text('Scrapped Parts', L, y);
  y += 14;

  const cols = [
    { label: 'PRT-ID', w: 90 },
    { label: 'Part Name', w: 160 },
    { label: 'Serial', w: 90 },
    { label: 'Unit Cost', w: 70 },
    { label: 'Remarks', w: W - 410 },
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
    const rowH = 38;
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
    const cost = item.unit_cost != null && Number.isFinite(Number(item.unit_cost))
      ? `Rs ${Number(item.unit_cost).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
      : '—';

    let x = L;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink)
      .text(item.prt_id || '—', x + 4, y + 12, { width: cols[0].w - 8 });
    x += cols[0].w;
    doc.font('Helvetica').fontSize(8).fillColor(C.ink)
      .text(item.part_name || '—', x + 4, y + 12, { width: cols[1].w - 8 });
    x += cols[1].w;
    doc.text(item.serial_number || '—', x + 4, y + 12, { width: cols[2].w - 8 });
    x += cols[2].w;
    doc.text(cost, x + 4, y + 12, { width: cols[3].w - 8, align: 'right' });
    x += cols[3].w;
    doc.font('Helvetica').fontSize(7.5)
      .text(item.item_remarks || '—', x + 4, y + 8, { width: cols[4].w - 8 });

    y += rowH;
  }
  return y + 10;
}

/** Warehouse + recipient signatures only (no repair return loop). */
function drawScrapDispatchSignatures(doc, y, challan) {
  if (y > 620) { doc.addPage(); y = 40; }
  const L = 40;
  const W = 515;
  const half = (W - 12) / 2;
  const whSign = resolveSignFile(challan.warehouse_dispatch_esign_url);
  const rSign = resolveSignFile(challan.recipient_esign_url);

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
    if (challan.dispatched_at) {
      doc.font('Helvetica').fontSize(7).fillColor(C.sub)
        .text(`Signed: ${fmtIst(challan.dispatched_at)}`, x + 10, y + 86, { width: half - 20 });
    }
  };

  signBox(L, 'Warehouse dispatch sign', whSign, challan.warehouse_dispatch_signer_name, false);
  signBox(L + half + 12, 'Recipient sign', rSign, challan.recipient_signer_name, true);
  return y + 112;
}

async function generateScrapChallanPdf(challanNumber) {
  const challan = await loadScrapChallanPdfData(challanNumber);
  if (!challan) return null;

  const company = await loadCompany();
  const recipientBox = [
    challan.recipient_name,
    challan.recipient_address,
  ].filter(Boolean).join('\n');
  const billingBox = challan.billing_address || recipientBox;

  const dir = path.join(__dirname, '../uploads/scrap-challans');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(challanNumber).replace(/[^\w-]+/g, '_');
  const rel = `scrap-challans/SCRAP_${safe}.pdf`;
  const abs = path.join(__dirname, '../uploads', rel);

  // Adapt dispatchTagsForDc shape (expects VRDC-ish fields — scrap_challans has same ship columns)
  const tagDc = {
    ship_by: challan.ship_by,
    dispatch_mode: challan.dispatch_mode,
    courier_name: challan.courier_name,
    awb_number: challan.awb_number,
    porter_tracking_id: challan.porter_tracking_id,
    delivery_person_first_name: challan.delivery_person_first_name,
    delivery_person_last_name: challan.delivery_person_last_name,
  };

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(abs);
    doc.pipe(stream);

    let y = drawCompanyHeader(doc, company, {
      docTitle: 'Scrap Challan',
      docNumber: challan.challan_number,
      rightLabel: 'Scrap Challan',
      rightValue: challan.challan_number,
    });

    doc.font('Helvetica').fontSize(9).fillColor(C.sub);
    doc.text(`Status: ${challan.status || '—'}`, 40, y);
    doc.text(`Created: ${formatPdfDateIstOrDash(challan.created_at)}`, 40, y + 12);
    doc.text(`Dispatched: ${formatPdfDateIstOrDash(challan.dispatched_at)}`, 280, y + 12);
    y += 28;

    if (challan.eway_bill_number) {
      doc.font('Helvetica').fontSize(9).fillColor(C.ink)
        .text(
          `E-way Bill: ${challan.eway_bill_number}${challan.eway_bill_date ? ` · Date: ${formatPdfDateIstOrDash(challan.eway_bill_date)}` : ''}`,
          40,
          y
        );
      y += 14;
    }

    y = drawDispatchTags(doc, y, dispatchTagsForDc(tagDc));
    y = writeVendorAddressBoxes(doc, y, billingBox, recipientBox);

    doc.font('Helvetica').fontSize(9).fillColor(C.ink);
    doc.text(`Recipient: ${challan.recipient_name || '—'}`, 40, y);
    y += 12;
    doc.text(`Contact: ${challan.contact_person || '—'} · ${challan.contact_mobile || '—'}`, 40, y);
    y += 16;

    y = writeScrapItemsTable(doc, y, challan.items);

    const total = (challan.items || []).reduce((sum, it) => {
      const n = Number(it.unit_cost);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
    if (total > 0) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink)
        .text(
          `Total declared value: Rs ${total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
          40,
          y,
          { width: 515, align: 'right' }
        );
      y += 16;
    }
    if (challan.remarks) {
      y += 4;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('Remarks:', 40, y);
      doc.font('Helvetica').fontSize(9).text(challan.remarks, 40, y + 12, { width: 515 });
      y += 28;
    }

    y = drawScrapDispatchSignatures(doc, y, challan);

    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
      .text('One-way scrap disposal — no return leg.', 40, Math.min(y + 8, 780), { width: 515 });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  await pool.query(
    `UPDATE scrap_challans SET pdf_path = $2, updated_at = NOW() WHERE challan_number = $1`,
    [challanNumber, rel]
  ).catch(() => {});

  return rel;
}

module.exports = {
  loadScrapChallanPdfData,
  writeScrapItemsTable,
  generateScrapChallanPdf,
};
