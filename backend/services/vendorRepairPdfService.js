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

function writeAddressBlock(doc, title, text) {
  doc.fontSize(11).text(title, { underline: true });
  doc.fontSize(9).text(String(text || '—'), { width: 240 });
  doc.moveDown(0.5);
}

function writeItemsTable(doc, items, { title = 'Laptops' } = {}) {
  doc.fontSize(12).text(title, { underline: true });
  doc.moveDown(0.3);
  (items || []).forEach((item, idx) => {
    doc.fontSize(9).text(
      `${idx + 1}. TTSPL ${item.ttspl_id || '—'} · SN ${item.serial_number || '—'}`
    );
    doc.fontSize(8).fillColor('#444').text(`   Config: ${item.configuration || '—'}`);
    if (item.item_remarks) {
      doc.fontSize(8).fillColor('#666').text(`   Remarks: ${item.item_remarks}`);
    }
    doc.fillColor('#000');
    doc.moveDown(0.2);
  });
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
    doc.fontSize(10).text(`Dispatch DC: ${dc.dc_number}`);
    doc.text(`Status: ${dc.status}`);
    doc.text(`Out Date: ${dc.out_date ? new Date(dc.out_date).toLocaleDateString('en-IN') : '—'}`);
    doc.text(`Expected Return: ${dc.expected_return_date || '—'}`);
    doc.moveDown();

    doc.fontSize(11).text('Addresses', { underline: true });
    doc.moveDown(0.3);
    const y0 = doc.y;
    doc.fontSize(9).text('Billing (From)', 40, y0, { width: 240, continued: false });
    doc.text(String(dc.billing_address || dc.warehouse_address || dc.warehouse_name || '—'), 40, doc.y, { width: 240 });
    const leftEnd = doc.y;
    doc.fontSize(9).text('Shipping (To Vendor)', 310, y0, { width: 240 });
    doc.text(String(dc.shipping_address || dc.vendor_address || '—'), 310, y0 + 14, { width: 240 });
    doc.y = Math.max(leftEnd, doc.y) + 10;

    doc.fontSize(10).text(`Vendor: ${dc.vendor_name || '—'}`);
    doc.text(`Contact: ${dc.contact_person || '—'} · ${dc.contact_mobile || '—'}`);
    doc.moveDown();

    writeItemsTable(doc, dc.items);
    if (dc.remarks) {
      doc.moveDown().fontSize(10).text(`DC Remarks: ${dc.remarks}`);
    }

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return rel;
}

async function generateVendorRepairReceivePdf(dcNumber, receiveDcNumber, itemIds = []) {
  const dc = await loadDc(dcNumber);
  if (!dc) return null;
  const ids = (itemIds || []).map(Number).filter(Boolean);
  const items = (dc.items || []).filter((it) => !ids.length || ids.includes(Number(it.id)));

  const dir = path.join(__dirname, '../uploads/vendor-repair');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(receiveDcNumber).replace(/[^\w-]+/g, '_');
  const rel = `vendor-repair/VRDC_RECEIVE_${safe}.pdf`;
  const abs = path.join(__dirname, '../uploads', rel);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const stream = fs.createWriteStream(abs);
    doc.pipe(stream);

    doc.fontSize(16).text('Vendor Repair — Return / Receive Challan', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Receive DC: ${receiveDcNumber}`);
    doc.text(`Original Dispatch DC: ${dc.dc_number}`);
    doc.text(`Receive Date: ${new Date().toLocaleDateString('en-IN')}`);
    doc.moveDown();

    writeAddressBlock(doc, 'Billing (Warehouse)', dc.billing_address || dc.warehouse_address);
    writeAddressBlock(doc, 'Shipping (Vendor)', dc.shipping_address || dc.vendor_address);

    writeItemsTable(doc, items, { title: 'Laptops Received' });
    doc.moveDown().fontSize(9).text('Signatures: Warehouse POD + Vendor acknowledgement captured via e-sign in CRM.');

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return rel;
}

module.exports = { generateVendorRepairPdf, generateVendorRepairReceivePdf };
