/**
 * Vendor Return DC (VRTDC) PDF — one-way warehouse → original supplier.
 * Reuses VRDC drawing primitives.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const {
  loadCompany,
  drawCompanyHeader,
  writeVendorAddressBoxes,
  dispatchTagsForDc,
  drawDispatchTags,
  resolveSignFile,
  fmtIst,
} = require('./vendorRepairPdfService');
const { formatPdfDateIstOrDash } = require('../utils/pdfDateTimeUtils');

const C = {
  ink: '#1f2937',
  sub: '#6b7280',
  line: '#e5e7eb',
  teal: '#0e7490',
};

async function loadReturnDcPdfData(dcNumber) {
  const headRes = await pool.query(
    `SELECT d.*,
            vpo.purchase_order_number AS po_number,
            v.business_name AS vendor_business_name,
            v.address AS vendor_reg_address,
            v.shipping_address AS vendor_ship_address,
            v.contact_person_name, v.contact_person_phone, v.phone,
            dt.first_name AS delivery_person_first_name,
            dt.last_name AS delivery_person_last_name
       FROM vendor_return_delivery_challans d
       LEFT JOIN vendor_purchase_orders vpo ON vpo.po_id = d.po_id
       LEFT JOIN vendors v ON v.vendor_id = d.vendor_id AND v.deleted_at IS NULL
       LEFT JOIN delivery_technicians dt ON dt.technician_id = d.delivery_person_id
      WHERE d.dc_number = $1`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) return null;
  const itemsRes = await pool.query(
    `SELECT i.*, vpo.purchase_order_number AS po_number
       FROM vendor_return_dc_items i
       LEFT JOIN vendor_purchase_orders vpo ON vpo.po_id = i.po_id
      WHERE i.dc_number = $1
      ORDER BY i.id`,
    [dcNumber]
  );
  return { ...head, items: itemsRes.rows };
}

function productLabel(item) {
  const fromCfg = String(item.configuration || '').split('·').map((s) => s.trim()).filter(Boolean);
  const brandModel = [item.brand, item.model].filter(Boolean).join(' ').trim();
  if (brandModel) return brandModel;
  if (fromCfg.length) return fromCfg.slice(0, 2).join(' ');
  return '—';
}

function writeReturnItemsTable(doc, y, items) {
  const L = 40;
  const R = 555;
  const W = R - L;

  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text('Laptops returned to vendor', L, y);
  y += 14;

  const cols = [
    { label: 'Asset ID', w: 80 },
    { label: 'Serial', w: 90 },
    { label: 'Product', w: 130 },
    { label: 'PO', w: 70 },
    { label: 'Reason', w: W - 370 },
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
    const reason = item.return_reason || '—';
    const rowH = Math.max(36, 16 + doc.font('Helvetica').fontSize(7.5).heightOfString(reason, { width: cols[4].w - 8 }));
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

    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink)
      .text(item.ttspl_id || '—', L + 4, y + 10, { width: cols[0].w - 8 });
    let x = L + cols[0].w;
    doc.font('Helvetica').fontSize(8)
      .text(item.serial_number || '—', x + 4, y + 10, { width: cols[1].w - 8 });
    x += cols[1].w;
    doc.text(productLabel(item), x + 4, y + 10, { width: cols[2].w - 8 });
    x += cols[2].w;
    doc.text(item.po_number || item.po_id || '—', x + 4, y + 10, { width: cols[3].w - 8 });
    x += cols[3].w;
    doc.font('Helvetica').fontSize(7.5)
      .text(reason, x + 4, y + 8, { width: cols[4].w - 8 });

    y += rowH;
  }
  return y + 10;
}

function drawReceiverEsign(doc, y, dc) {
  if (y > 640) {
    doc.addPage();
    y = 40;
  }
  const L = 40;
  const W = 250;
  const h = 110;
  const esignAbs = resolveSignFile(dc.delivery_pod_path);
  const signedAt = dc.vendor_received_at || dc.updated_at;

  doc.roundedRect(L, y, W, h, 6).strokeColor(C.line).lineWidth(1).stroke();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink)
    .text('Vendor / receiver e-signature', L + 10, y + 8, { width: W - 20 });
  if (esignAbs) {
    try { doc.image(esignAbs, L + 12, y + 24, { fit: [W - 24, 48] }); } catch (_) { /* ignore */ }
    if (signedAt) {
      doc.font('Helvetica').fontSize(7).fillColor(C.sub)
        .text(`Signed: ${fmtIst(signedAt)}`, L + 10, y + 90, { width: W - 20 });
    }
  } else {
    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
      .text('Pending — capture on delivery', L + 10, y + 48, { width: W - 20 });
  }
  return y + h + 12;
}

async function generateVendorReturnDcPdf(dcNumber) {
  const dc = await loadReturnDcPdfData(dcNumber);
  if (!dc) return null;

  const company = await loadCompany();
  const vendorName = dc.vendor_name || dc.vendor_business_name || '—';
  const vendorBilling = [vendorName, dc.billing_address || dc.vendor_address || dc.vendor_reg_address]
    .filter(Boolean).join('\n');
  const vendorShipping = [vendorName, dc.shipping_address || dc.vendor_ship_address || dc.vendor_address]
    .filter(Boolean).join('\n');

  const dir = path.join(__dirname, '../uploads/vendor-return');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(dcNumber).replace(/[^\w-]+/g, '_');
  const rel = `vendor-return/VRTDC_${safe}.pdf`;
  const abs = path.join(__dirname, '../uploads', rel);

  let gateQrPng = null;
  try {
    const { ensureGateQrPng } = require('./gateQrService');
    gateQrPng = (await ensureGateQrPng({ docType: 'vrtdc', docNumber: dc.dc_number })).png;
  } catch (_) { /* QR is best-effort */ }

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(abs);
    doc.pipe(stream);

    let y = drawCompanyHeader(doc, company, {
      docTitle: 'Vendor Return Delivery Challan',
      docNumber: dc.dc_number,
      rightLabel: 'Return DC',
      rightValue: dc.dc_number,
      qrPng: gateQrPng,
    });

    doc.font('Helvetica').fontSize(9).fillColor(C.sub);
    doc.text(`Status: ${dc.status || '—'}`, 40, y);
    doc.text(`Return date: ${formatPdfDateIstOrDash(dc.return_date || dc.created_at)}`, 40, y + 12);
    doc.text(`Dispatched: ${formatPdfDateIstOrDash(dc.dispatched_at)}`, 280, y + 12);
    y += 28;

    y = drawDispatchTags(doc, y, dispatchTagsForDc(dc));
    y = writeVendorAddressBoxes(doc, y, vendorBilling, vendorShipping);

    doc.font('Helvetica').fontSize(9).fillColor(C.ink);
    doc.text(`Vendor: ${vendorName}`, 40, y);
    y += 12;
    doc.text(
      `Contact: ${dc.contact_person || dc.contact_person_name || '—'} · ${dc.contact_mobile || dc.contact_person_phone || dc.phone || '—'}`,
      40,
      y
    );
    y += 16;

    if (dc.return_reason) {
      doc.font('Helvetica-Bold').fontSize(9).text('Return reason:', 40, y);
      doc.font('Helvetica').fontSize(9).text(dc.return_reason, 40, y + 12, { width: 515 });
      y += 28;
    }

    y = writeReturnItemsTable(doc, y, dc.items);
    y = drawReceiverEsign(doc, y, dc);

    if (dc.remarks) {
      y += 4;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('Remarks:', 40, y);
      doc.font('Helvetica').fontSize(9).text(dc.remarks, 40, y + 12, { width: 515 });
      y += 28;
    }

    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
      .text(
        'One-way return to vendor — stock leaves the warehouse when Guard confirms outward at the gate.',
        40,
        Math.min(y + 8, 780),
        { width: 515 }
      );

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return rel;
}

module.exports = {
  loadReturnDcPdfData,
  generateVendorReturnDcPdf,
};
