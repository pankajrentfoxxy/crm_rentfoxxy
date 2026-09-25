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
  formatVendorBillingFromRow,
  formatVendorShippingFromRow,
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
            v.first_name AS vendor_first_name, v.last_name AS vendor_last_name,
            v.city AS vendor_city, v.state AS vendor_state, v.pincode AS vendor_pincode,
            v.gst_number AS vendor_gst_number, v.shipping_same AS vendor_shipping_same,
            v.shipping_city AS vendor_shipping_city, v.shipping_state AS vendor_shipping_state,
            v.shipping_pincode AS vendor_shipping_pincode,
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

const fmtMoney = (n) => Number(n || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function writeReturnItemsTable(doc, y, items) {
  const L = 40;
  const R = 555;
  const W = R - L;
  let total = 0;

  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text('Laptops returned to vendor', L, y);
  y += 14;

  // Value is on the challan because an e-way bill is raised against it: a
  // transporter stopped at a checkpoint has to show the declared consignment
  // value, and a return DC with no value on it is not a defensible document.
  const cols = [
    { label: 'Asset ID', w: 78 },
    { label: 'Serial', w: 84 },
    { label: 'Product', w: 118 },
    { label: 'PO', w: 62 },
    { label: 'Reason', w: W - 412 },
    { label: 'Value (Rs)', w: 70, align: 'right' },
  ];

  const drawHeader = (yy) => {
    doc.rect(L, yy, W, 22).fill(C.teal);
    let cx = L;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    for (const c of cols) {
      doc.text(c.label, cx + 4, yy + 7, { width: c.w - 8, align: c.align || 'left' });
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
    x += cols[4].w;
    const dv = Number(item.declared_value);
    total += Number.isFinite(dv) ? dv : 0;
    doc.font('Helvetica').fontSize(8)
      .text(Number.isFinite(dv) ? fmtMoney(dv) : '—', x + 4, y + 10,
        { width: cols[5].w - 8, align: 'right' });

    y += rowH;
  }

  // Total row — the figure the e-way threshold is measured against.
  doc.rect(L, y, W, 20).fillColor('#f1f5f9').fill();
  doc.strokeColor(C.line).lineWidth(0.6).rect(L, y, W, 20).stroke();
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink)
    .text('Total declared value', L + 4, y + 6, { width: W - cols[5].w - 12, align: 'right' });
  doc.text(fmtMoney(total), L + W - cols[5].w + 4, y + 6,
    { width: cols[5].w - 8, align: 'right' });
  y += 20;

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
  // The stored billing_address used to default to our own TrueTech block, so
  // older DCs carry our address in the vendor's "Bill to" box. Rebuild both
  // blocks from the vendor master, and fall back to the stored snapshot only if
  // the vendor row has gone. formatVendorBillingFromRow already leads with the
  // vendor's name, so the name is not prepended again — that is what produced
  // "C PROMPT ... / TRUETECH SERVICES ..." stacked in one box.
  const vendorRow = {
    business_name: dc.vendor_business_name,
    first_name: dc.vendor_first_name,
    last_name: dc.vendor_last_name,
    address: dc.vendor_reg_address,
    city: dc.vendor_city,
    state: dc.vendor_state,
    pincode: dc.vendor_pincode,
    gst_number: dc.vendor_gst_number,
    shipping_same: dc.vendor_shipping_same,
    shipping_address: dc.vendor_ship_address,
    shipping_city: dc.vendor_shipping_city,
    shipping_state: dc.vendor_shipping_state,
    shipping_pincode: dc.vendor_shipping_pincode,
  };
  const vendorBilling = formatVendorBillingFromRow(vendorRow)
    || [vendorName, dc.billing_address || dc.vendor_address].filter(Boolean).join('\n');
  const vendorShipping = formatVendorShippingFromRow(vendorRow)
    || [vendorName, dc.shipping_address || dc.vendor_address].filter(Boolean).join('\n');

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

    // E-way Bill, printed only once it exists. A transporter stopped at a
    // checkpoint shows this challan, so the number and date belong on the face
    // of the document rather than only in the CRM.
    if (dc.eway_bill_number) {
      doc.rect(40, y, 515, 22).fillColor('#eef6f5').fill();
      doc.strokeColor(C.line).lineWidth(0.6).rect(40, y, 515, 22).stroke();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink)
        .text('E-Way Bill', 46, y + 6, { width: 70 });
      doc.font('Helvetica').fontSize(9)
        .text(String(dc.eway_bill_number), 116, y + 6, { width: 200 });
      if (dc.eway_bill_date) {
        doc.fillColor(C.sub)
          .text(`Dated ${formatPdfDateIstOrDash(dc.eway_bill_date)}`, 330, y + 6, { width: 220 });
      }
      y += 30;
    }

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
