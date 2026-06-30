const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');

async function loadDc(dcNumber) {
  const headRes = await pool.query(`SELECT * FROM vendor_repair_delivery_challans WHERE dc_number = $1`, [dcNumber]);
  const head = headRes.rows[0];
  if (!head) return null;
  const itemsRes = await pool.query(
    `SELECT * FROM vendor_repair_dc_items WHERE dc_number = $1 ORDER BY id ASC`,
    [dcNumber]
  );
  return { ...head, items: itemsRes.rows };
}

async function generateVendorRepairPdf(dcNumber) {
  const dc = await loadDc(dcNumber);
  if (!dc) return null;

  const dir = path.join(__dirname, '../uploads/vendor-repair');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(dcNumber).replace(/[^\w-]+/g, '_');
  const rel = `vendor-repair/VRDC_${safe}.pdf`;
  const abs = path.join(__dirname, '../uploads', rel);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const stream = fs.createWriteStream(abs);
    doc.pipe(stream);

    doc.fontSize(16).text('Out for Repair — Vendor Delivery Challan', { align: 'center' });
    doc.moveDown();
    doc.fontSize(11).text(`DC Number: ${dc.dc_number}`);
    doc.text(`Status: ${dc.status}`);
    doc.text(`Out Date: ${dc.out_date ? new Date(dc.out_date).toLocaleDateString('en-IN') : '—'}`);
    doc.moveDown();
    doc.fontSize(12).text('Vendor Details', { underline: true });
    doc.fontSize(10).text(`Name: ${dc.vendor_name || '—'}`);
    doc.text(`Address: ${dc.vendor_address || '—'}`);
    doc.text(`Contact: ${dc.contact_person || '—'} · ${dc.contact_mobile || '—'}`);
    doc.text(`Expected Return: ${dc.expected_return_date || '—'}`);
    doc.moveDown();
    doc.fontSize(12).text('Warehouse', { underline: true });
    doc.fontSize(10).text(`${dc.warehouse_name || '—'}`);
    doc.text(`${dc.warehouse_address || '—'}`);
    doc.moveDown();
    doc.fontSize(12).text('Laptops', { underline: true });
    (dc.items || []).forEach((item, idx) => {
      doc.fontSize(10).text(
        `${idx + 1}. TTSPL ${item.ttspl_id || '—'} · SN ${item.serial_number || '—'} · ${item.configuration || '—'}`
      );
    });
    if (dc.remarks) {
      doc.moveDown().fontSize(10).text(`Remarks: ${dc.remarks}`);
    }
    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return rel;
}

module.exports = { generateVendorRepairPdf };
