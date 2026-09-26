/**
 * Vendor return request PDF (D10) — attached to the mail that tells a vendor we
 * are returning rented laptops: vendor, us, rent stop date, pickup slot and
 * every laptop with TTSPL, serial and configuration.
 *
 * Built from the data handed in, not re-read from the database, because it is
 * generated inside the send transaction before that commits.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const {
  loadCompany,
  drawCompanyHeader,
  formatVendorBillingFromRow,
} = require('./vendorRepairPdfService');
const { prettyDate, prettyTime, lastBilledDay, SIGN_OFF } = require('./vendorReturnRequestMail');

const C = { ink: '#1f2937', sub: '#6b7280', line: '#d9dee5', teal: '#0e7490', warm: '#fff7ed', warmLine: '#ea580c' };
const L = 40;
const R = 555;
const W = R - L;

function box(doc, x, y, w, title, lines) {
  let yy = y + 8;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.ink).text(title, x + 10, yy, { width: w - 20 });
  yy += 15;
  doc.font('Helvetica').fontSize(8.5).fillColor(C.ink);
  for (const line of lines.filter(Boolean)) {
    doc.text(String(line), x + 10, yy, { width: w - 20 });
    yy = doc.y + 2;
  }
  return yy + 6;
}

function laptopsTable(doc, y, items) {
  const cols = [
    { label: '#', w: 20, align: 'right' },
    { label: 'TTSPL ID', w: 70 },
    { label: 'Serial no.', w: 80 },
    { label: 'Brand / model', w: 95 },
    { label: 'Processor', w: 92 },
    { label: 'RAM', w: 42 },
    { label: 'Storage', w: 58 },
    { label: 'PO', w: W - 457 },
  ];
  const header = (yy) => {
    doc.rect(L, yy, W, 20).fill(C.teal);
    let cx = L;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5);
    for (const c of cols) {
      doc.text(c.label, cx + 3, yy + 6, { width: c.w - 6, align: c.align || 'left' });
      cx += c.w;
    }
    return yy + 20;
  };
  y = header(y);
  items.forEach((it, i) => {
    const values = [
      String(i + 1),
      it.ttspl_id || '—',
      it.serial_number || '—',
      [it.brand, it.model].filter(Boolean).join(' ') || '—',
      [it.processor, it.generation].filter(Boolean).join(' ') || '—',
      it.ram || '—',
      it.storage || '—',
      it.po_number || '—',
    ];
    doc.font('Helvetica').fontSize(7.5);
    const h = Math.max(22, 10 + Math.max(...values.map((v, k) => doc.heightOfString(v, { width: cols[k].w - 6 }))));
    if (y + h > 770) {
      doc.addPage();
      y = header(40);
    }
    let cx = L;
    values.forEach((v, k) => {
      doc.rect(cx, y, cols[k].w, h).strokeColor(C.line).lineWidth(0.6).stroke();
      doc.font(k === 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(C.ink)
        .text(v, cx + 3, y + 5, { width: cols[k].w - 6, align: cols[k].align || 'left' });
      cx += cols[k].w;
    });
    y += h;
  });
  return y + 12;
}

/**
 * @returns {Promise<string>} path relative to uploads/, e.g. vendor-return-requests/VRT_26-27_0001.pdf
 */
async function generateReturnRequestPdf({ ticket, items, vendor, stopDate, pickupAddress }) {
  const company = await loadCompany();
  const dir = path.join(__dirname, '../uploads/vendor-return-requests');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(ticket.ticket_number).replace(/[^\w-]+/g, '_');
  const rel = `vendor-return-requests/${safe}.pdf`;
  const abs = path.join(__dirname, '../uploads', rel);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(abs);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.pipe(stream);

    let y = drawCompanyHeader(doc, company, {
      docTitle: 'Laptop Return Request',
      docNumber: ticket.ticket_number,
      rightLabel: 'Request',
      rightValue: ticket.ticket_number,
    });

    doc.font('Helvetica').fontSize(9).fillColor(C.sub)
      .text(`Request date: ${prettyDate(ticket.request_date || new Date())}`, L, y)
      .text(`Laptops: ${items.length}`, 300, y);
    y += 18;

    // Rent stop — the line the vendor must act on, so it stands out.
    doc.rect(L, y, W, 34).fill(C.warm);
    doc.rect(L, y, 4, 34).fill(C.warmLine);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink)
      .text(`Rent stops from ${prettyDate(stopDate)}`, L + 12, y + 6, { width: W - 20 });
    doc.font('Helvetica').fontSize(8.5).fillColor(C.ink)
      .text(`Please invoice rent for these laptops only up to ${prettyDate(lastBilledDay(stopDate))}.`, L + 12, y + 20, { width: W - 20 });
    y += 44;

    const colW = (W - 12) / 2;
    const top = y;
    const vendorLines = String(formatVendorBillingFromRow(vendor) || ticket.vendor_name || '').split('\n');
    const contact = [vendor?.contact_person_name, vendor?.contact_person_phone || vendor?.phone].filter(Boolean).join(' · ');
    const leftEnd = box(doc, L, top, colW, 'Vendor', [
      ...vendorLines,
      contact ? `Contact: ${contact}` : null,
      vendor?.email ? `Email: ${vendor.email}` : null,
    ]);
    const rightEnd = box(doc, L + colW + 12, top, colW, 'From (pickup address)', [
      company.legal_name,
      company.address,
      company.gstin ? `GSTIN: ${company.gstin}` : null,
      company.email ? `Email: ${company.email}` : null,
    ]);
    const bottom = Math.max(leftEnd, rightEnd);
    doc.roundedRect(L, top, colW, bottom - top, 5).strokeColor(C.line).lineWidth(1).stroke();
    doc.roundedRect(L + colW + 12, top, colW, bottom - top, 5).strokeColor(C.line).lineWidth(1).stroke();
    y = bottom + 12;

    const pickupWhen = ticket.pickup_date
      ? [prettyDate(ticket.pickup_date), prettyTime(ticket.pickup_time)].filter(Boolean).join(' at ')
      : 'On a date agreed with you';
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('Pickup', L, y);
    doc.font('Helvetica').fontSize(9)
      .text(`${pickupWhen}, from the address above. Please reply with the pickup person's name, phone and vehicle number, or tell us where and when to send the laptops.`, L + 60, y, { width: W - 60 });
    y = doc.y + 6;
    if (ticket.reason_label) {
      doc.font('Helvetica-Bold').fontSize(9).text('Reason', L, y);
      doc.font('Helvetica').fontSize(9).text(ticket.reason_label, L + 60, y, { width: W - 60 });
      y = doc.y + 6;
    }
    if (ticket.remarks) {
      doc.font('Helvetica-Bold').fontSize(9).text('Note', L, y);
      doc.font('Helvetica').fontSize(9).text(ticket.remarks, L + 60, y, { width: W - 60 });
      y = doc.y + 6;
    }
    y += 6;

    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.ink).text('Laptops being returned', L, y);
    y = laptopsTable(doc, y + 14, items);

    if (y > 730) { doc.addPage(); y = 40; }
    doc.font('Helvetica').fontSize(9).fillColor(C.ink).text('Thanks and Regards,', L, y);
    doc.font('Helvetica-Bold').text(SIGN_OFF, L, y + 12);
    doc.font('Helvetica').fontSize(7.5).fillColor(C.sub)
      .text('A return challan goes with the laptops when they leave our warehouse.', L, y + 30, { width: W });
    doc.end();
  });

  return rel;
}

module.exports = { generateReturnRequestPdf };
