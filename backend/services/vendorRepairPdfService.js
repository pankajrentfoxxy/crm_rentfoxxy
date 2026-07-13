const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { mergeCompany, formatCompanyBlock } = require('../utils/companyDefaults');
const { formatPdfDateIstOrDash, formatPdfNowIst } = require('../utils/pdfDateTimeUtils');

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
            v.shipping_pincode AS vendor_ship_pincode,
            dt.first_name AS delivery_person_first_name,
            dt.last_name AS delivery_person_last_name
       FROM vendor_repair_delivery_challans d
       LEFT JOIN vendors v ON v.vendor_id = d.vendor_id AND v.deleted_at IS NULL
       LEFT JOIN delivery_technicians dt ON dt.technician_id = d.delivery_person_id
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

  return y + 8;
}

/** Two boxed columns — vendor billing + shipping (company is already in header). */
function writeVendorAddressBoxes(doc, y, vendorBilling, vendorShipping) {
  const L = 40;
  const R = 555;
  const W = R - L;
  const colW = (W - 12) / 2;
  const boxTop = y;

  const drawBox = (x, title, body) => {
    let yy = boxTop + 8;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text(title, x + 10, yy, { width: colW - 20 });
    yy += 16;
    doc.font('Helvetica').fontSize(8.5).fillColor(C.ink);
    String(body || '—').split('\n').forEach((line) => {
      if (!line.trim()) return;
      doc.text(line.trim(), x + 10, yy, { width: colW - 20 });
      yy = doc.y + 2;
    });
    return yy;
  };

  const leftEnd = drawBox(L, 'Vendor Billing Address', vendorBilling);
  const rightEnd = drawBox(L + colW + 12, 'Vendor Shipping Address', vendorShipping);
  const boxBottom = Math.max(leftEnd, rightEnd) + 8;
  doc.roundedRect(L, boxTop, colW, boxBottom - boxTop, 6).strokeColor(C.line).lineWidth(1).stroke();
  doc.roundedRect(L + colW + 12, boxTop, colW, boxBottom - boxTop, 6).strokeColor(C.line).lineWidth(1).stroke();
  return boxBottom + 14;
}

function resolveSignFile(url) {
  if (!url) return null;
  const clean = String(url).replace(/^\/?uploads\//, '').replace(/^\//, '');
  const candidates = [
    path.join(__dirname, '..', 'uploads', clean),
    path.join(__dirname, '..', clean),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function fmtIst(dt) {
  if (!dt) return '—';
  try {
    return new Date(dt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return String(dt);
  }
}

function drawDispatchSignatures(doc, y, dc) {
  if (y > 620) { doc.addPage(); y = 40; }
  const L = 40;
  const W = 515;
  const half = (W - 12) / 2;
  const whSign = resolveSignFile(dc.warehouse_dispatch_esign_url);
  const vSign = resolveSignFile(dc.vendor_dispatch_esign_url);

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
    if (dc.dispatched_at) {
      doc.font('Helvetica').fontSize(7).fillColor(C.sub)
        .text(`Signed: ${fmtIst(dc.dispatched_at)}`, x + 10, y + 86, { width: half - 20 });
    }
  };

  signBox(L, 'Warehouse dispatch sign', whSign, dc.warehouse_dispatch_signer_name, false);
  signBox(L + half + 12, 'Vendor dispatch sign', vSign, dc.vendor_dispatch_signer_name, true);
  return y + 112;
}

function writeReceiveItemsTable(doc, y, items) {
  const L = 40;
  const R = 555;
  const W = R - L;

  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text('Laptops Received', L, y);
  y += 14;

  const cols = [
    { label: 'Product / Serial', w: 175 },
    { label: 'Mode', w: 55 },
    { label: 'Received by', w: 90 },
    { label: 'Sign', w: 70 },
    { label: 'Date & time (IST)', w: W - 390 },
  ];

  const drawHeader = (yy) => {
    doc.rect(L, yy, W, 22).fill(C.teal);
    let cx = L;
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(8);
    for (const c of cols) {
      doc.text(c.label, cx + 4, yy + 7, { width: c.w - 8 });
      cx += c.w;
    }
    return yy + 22;
  };

  y = drawHeader(y);

  for (const item of items || []) {
    const p = parseItemProduct(item);
    const isRep = item.receive_mode === 'replacement' || item.item_status === 'replacement_received';
    const serialLine = isRep
      ? `${item.replacement_serial_number || '—'} · ${item.replacement_ttspl_id || ''}`
      : (item.receive_verified_serial || p.l5);
    const modeLabel = isRep ? 'Replacement' : 'Repaired';
    const signer = item.receive_wh_signer_name || '—';
    const signAbs = resolveSignFile(item.receive_wh_esign_url);
    const signedAt = fmtIst(item.receive_wh_signed_at || item.returned_at);
    const challan = isRep ? item.replacement_dc_number : item.receive_dc_number;
    const rowH = 58;

    if (y + rowH > 760) { doc.addPage(); y = 40; y = drawHeader(y); }

    let cx = L;
    for (const c of cols) {
      doc.rect(cx, y, c.w, rowH).strokeColor(C.line).lineWidth(0.6).stroke();
      cx += c.w;
    }

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.ink)
      .text(p.l1 || '—', L + 4, y + 4, { width: cols[0].w - 8 });
    doc.font('Helvetica').fontSize(7).fillColor(C.sub)
      .text(serialLine, L + 4, y + 16, { width: cols[0].w - 8 });
    if (challan) {
      doc.font('Helvetica').fontSize(6.5).fillColor(C.accent)
        .text(challan, L + 4, y + 28, { width: cols[0].w - 8 });
    }
    if (isRep && item.replaced_original_ttspl_id) {
      doc.font('Helvetica').fontSize(6.5).fillColor(C.sub)
        .text(`Replaces: ${item.replaced_original_ttspl_id} / ${item.replaced_original_serial || '—'}`, L + 4, y + 38, { width: cols[0].w - 8 });
    }

    let x = L + cols[0].w;
    doc.font('Helvetica').fontSize(7.5).fillColor(C.ink).text(modeLabel, x + 4, y + 20, { width: cols[1].w - 8 });
    x += cols[1].w;
    doc.text(signer, x + 4, y + 20, { width: cols[2].w - 8 });
    x += cols[2].w;
    if (signAbs) {
      try { doc.image(signAbs, x + 4, y + 6, { fit: [cols[3].w - 8, 36] }); } catch (_) { /* ignore */ }
    }
    x += cols[3].w;
    doc.font('Helvetica').fontSize(7).fillColor(C.ink).text(signedAt, x + 4, y + 20, { width: cols[4].w - 8 });

    y += rowH;
  }
  return y + 10;
}

function parseItemProduct(item) {
  const parts = String(item.configuration || '').split('·').map((s) => s.trim()).filter(Boolean);
  const brand = parts[0] || '';
  const model = parts[1] || '';
  const processor = parts[2] || '';
  const generation = parts[3] || '';
  const ram = parts[4] || '';
  const storage = parts[5] || '';
  const l1 = `${brand} ${model}`.replace(/\s+/g, ' ').trim();
  const l2 = [processor, generation].filter(Boolean).join(' | ');
  const l3 = [ram, storage].filter(Boolean).join(' | ');
  const l5 = [item.serial_number, item.ttspl_id].filter(Boolean).join('  ');
  return { l1, l2, l3, l5 };
}

function writeItemsTable(doc, y, items, { title = 'Laptops' } = {}) {
  const L = 40;
  const R = 555;
  const W = R - L;

  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text(title, L, y);
  y += 14;

  const cols = [
    { key: 'product', label: 'Product', w: 320, align: 'left' },
    { key: 'qty', label: 'Qty.', w: 55, align: 'center' },
    { key: 'remarks', label: 'Remarks', w: W - 375, align: 'left' },
  ];

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
  doc.font('Helvetica').fontSize(8.5).fillColor(C.ink);

  (items || []).forEach((item) => {
    const p = parseItemProduct(item);
    const pLines = [p.l1, p.l2, p.l3, p.l5].filter(Boolean);
    const rowH = Math.max(46, 12 + pLines.length * 11);
    if (y + rowH > 760) {
      doc.addPage();
      y = 40;
      y = drawTableHeader(y);
    }

    let cx = L;
    for (const c of cols) {
      doc.rect(cx, y, c.w, rowH).strokeColor(C.line).lineWidth(0.6).stroke();
      cx += c.w;
    }

    let py = y + 6;
    if (p.l1) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink).text(p.l1, L + 6, py, { width: cols[0].w - 12 });
      py += 11;
    }
    doc.font('Helvetica').fontSize(8).fillColor(C.sub);
    if (p.l2) { doc.text(p.l2, L + 6, py, { width: cols[0].w - 12 }); py += 10; }
    if (p.l3) { doc.text(p.l3, L + 6, py, { width: cols[0].w - 12 }); py += 10; }
    if (p.l5) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink).text(p.l5, L + 6, py, { width: cols[0].w - 12 });
    }

    const qtyX = L + cols[0].w;
    doc.font('Helvetica').fontSize(8.5).fillColor(C.ink)
      .text('1 Pcs.', qtyX + 6, y + rowH / 2 - 5, { width: cols[1].w - 12, align: 'center' });

    const remX = qtyX + cols[1].w;
    doc.text(String(item.item_remarks || '—'), remX + 6, y + 8, { width: cols[2].w - 12, align: 'left' });

    y += rowH;
  });

  return y + 10;
}

function dispatchTagsForDc(dc) {
  const tags = [];
  const shipBy = dc.ship_by || dc.dispatch_mode;
  if (shipBy === 'by_hand' || shipBy === 'inhouse') tags.push('By Hand');
  else if (shipBy === 'by_courier' || shipBy === 'courier') tags.push('By Courier');
  else if (shipBy === 'by_porter' || shipBy === 'porter') tags.push('By Porter');
  const person = [dc.delivery_person_first_name, dc.delivery_person_last_name].filter(Boolean).join(' ').trim();
  if (person) tags.push(person);
  if (dc.courier_name) tags.push(dc.courier_name);
  if (dc.awb_number) tags.push(dc.awb_number);
  if (dc.porter_tracking_id) tags.push(dc.porter_tracking_id);
  return tags;
}

function drawDispatchTags(doc, y, tags) {
  if (!tags.length) return y;
  const L = 40;
  const accent = C.accent;
  let tx = L;
  for (const t of tags) {
    const w = doc.font('Helvetica').fontSize(8).widthOfString(t) + 16;
    doc.roundedRect(tx, y, w, 16, 8).strokeColor(accent).lineWidth(0.8).stroke();
    doc.fillColor(accent).text(t, tx + 8, y + 4);
    tx += w + 6;
  }
  return y + 24;
}

async function generateVendorRepairPdf(dcNumber) {
  const dc = await loadDc(dcNumber);
  if (!dc) return null;

  const company = await loadCompany();
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
    const deliveryLabel = dc.vendor_delivered_at
      ? `Delivered to vendor: ${formatPdfDateIstOrDash(dc.vendor_delivered_at)}`
      : (dc.dispatched_at ? 'In transit to vendor' : 'Pending dispatch');
    doc.text(`Status: ${dc.status || '—'} · ${deliveryLabel}`, 40, y);
    doc.text(`Out Date: ${formatPdfDateIstOrDash(dc.out_date)}`, 40, y + 12);
    doc.text(`Expected Return: ${formatPdfDateIstOrDash(dc.expected_return_date)}`, 280, y + 12);
    y += 28;

    y = drawDispatchTags(doc, y, dispatchTagsForDc(dc));

    y = writeVendorAddressBoxes(doc, y, vendorBilling, vendorShipping);
    doc.font('Helvetica').fontSize(9).fillColor(C.ink);
    doc.text(`Vendor: ${dc.vendor_name || '—'}`, 40, y);
    y += 12;
    doc.text(`Contact: ${dc.contact_person || '—'} · ${dc.contact_mobile || '—'}`, 40, y);
    y += 16;

    y = writeItemsTable(doc, y, dc.items);
    if (dc.remarks) {
      y += 4;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('DC Remarks:', 40, y);
      doc.font('Helvetica').fontSize(9).text(dc.remarks, 40, y + 12, { width: 515 });
      y += 28;
    }

    y = drawDispatchSignatures(doc, y, dc);

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
  const vendorBilling = dc.vendor_billing_display || dc.vendor_address || dc.vendor_name || '—';
  const vendorShipping = dc.vendor_shipping_display || dc.shipping_address || dc.vendor_address || '—';
  const ids = (itemIds || []).map(Number).filter(Boolean);
  const items = (dc.items || []).filter((it) => !ids.length || ids.includes(Number(it.id))).map((it) => {
    if (it.receive_mode === 'replacement' || it.item_status === 'replacement_received') {
      const rep = [it.replacement_brand, it.replacement_model].filter(Boolean).join(' ');
      const repIds = [it.replacement_serial_number, it.replacement_ttspl_id].filter(Boolean).join(' · ');
      return {
        ...it,
        item_remarks: `Vendor replacement — ${rep} (${repIds})${it.replacement_dc_number ? ` · ${it.replacement_dc_number}` : ''}`,
      };
    }
    return it;
  });

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
<<<<<<< HEAD
    doc.text(`Generated: ${fmtIst(new Date())}`, 300, y);
=======
    doc.text(`Receive Date: ${formatPdfNowIst()}`, 300, y);
>>>>>>> 06c613216b50a8ada7225373e435b394529f8f33
    y += 20;

    y = writeVendorAddressBoxes(doc, y, vendorBilling, vendorShipping);
    y = writeReceiveItemsTable(doc, y, items);

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return rel;
}

module.exports = { generateVendorRepairPdf, generateVendorRepairReceivePdf, loadCompany, formatCompanyBlock };
