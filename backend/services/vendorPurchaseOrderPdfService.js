const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const UPLOAD_DIR = path.join(__dirname, '../uploads/vendor-po-documents');

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function parseLineItems(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function formatPoType(t) {
  if (!t) return '—';
  return String(t)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCurrency(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0.00';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Generate a purchase order PDF for vendor email / portal download.
 * @param {{ po: object, vendor?: object }} params
 * @returns {Promise<{ relativePath: string, absolutePath: string }>}
 */
async function generatePurchaseOrderPdf({ po, vendor }) {
  ensureUploadDir();
  const poNumber = po.purchase_order_number || `PO-${po.po_id}`;
  const fileName = `${poNumber.replace(/[^\w-]/g, '_')}_${Date.now()}.pdf`;
  const absolutePath = path.join(UPLOAD_DIR, fileName);
  const relativePath = `uploads/vendor-po-documents/${fileName}`;

  const lines = parseLineItems(po.line_items);
  const companyName = process.env.COMPANY_NAME || 'Rentfoxxy Technologies Pvt Ltd';
  const companyGst = process.env.COMPANY_GSTIN || '';

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const stream = fs.createWriteStream(absolutePath);
    doc.pipe(stream);

    doc.fontSize(20).fillColor('#2563EB').text(companyName, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(14).fillColor('#111827').text('PURCHASE ORDER', { align: 'center' });
    doc.moveDown();

    doc.fontSize(10).fillColor('#374151');
    doc.text(`PO Number: ${poNumber}`);
    doc.text(`PO Date: ${po.purchase_order_date || '—'}`);
    doc.text(`PO Type: ${formatPoType(po.purchase_order_type)}`);
    if (po.expected_delivery_date) doc.text(`Expected Delivery: ${po.expected_delivery_date}`);
    doc.text(`Supply State: ${String(po.po_state || '').replace(/_/g, ' ')}`);
    doc.moveDown();

    const vName =
      vendor?.business_name || po.vendor_business_name || vendor?.first_name || po.vendor_first_name || 'Vendor';
    doc.fontSize(11).fillColor('#111827').text('Vendor Details', { underline: true });
    doc.fontSize(10).fillColor('#374151');
    doc.text(`Business: ${vName}`);
    if (vendor?.email || po.vendor_email) doc.text(`Email: ${vendor?.email || po.vendor_email}`);
    if (vendor?.phone || po.vendor_phone) doc.text(`Phone: ${vendor?.phone || po.vendor_phone}`);
    if (vendor?.gst_number || po.vendor_gst) doc.text(`GSTIN: ${vendor?.gst_number || po.vendor_gst || '—'}`);
    doc.moveDown();

    doc.fontSize(11).fillColor('#111827').text('Line Items', { underline: true });
    doc.moveDown(0.4);

    lines.forEach((line, idx) => {
      const config = [line.brand, line.model, line.processor, line.generation, line.ram, line.storage]
        .filter(Boolean)
        .join(' | ');
      const qty = Number(line.quantity) || 0;
      const rate = Number(line.rate) || 0;
      const lineTotal = qty * rate;
      doc
        .fontSize(9)
        .fillColor('#111827')
        .text(`${idx + 1}. ${config || 'Item'}`);
      doc
        .fontSize(9)
        .fillColor('#4B5563')
        .text(`   Qty: ${qty}  |  Rate: ₹${formatCurrency(rate)}  |  Amount: ₹${formatCurrency(lineTotal)}`);
      doc.moveDown(0.2);
    });

    doc.moveDown();
    const sub = Number(po.sub_total_amount) || 0;
    const total = Number(po.total_amount) || sub;
    doc.fontSize(10).fillColor('#111827');
    doc.text(`Subtotal: ₹${formatCurrency(sub)}`);
    doc.text(`Grand Total: ₹${formatCurrency(total)}`, { continued: false });
    if (companyGst) doc.text(`Company GSTIN: ${companyGst}`);

    if (po.remarks) {
      doc.moveDown();
      doc.fontSize(10).text('Remarks / Terms:', { underline: true });
      doc.fontSize(9).fillColor('#4B5563').text(String(po.remarks));
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#9CA3AF').text('This is a system-generated purchase order from Rentfoxxy CRM.', {
      align: 'center'
    });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return { relativePath, absolutePath };
}

module.exports = { generatePurchaseOrderPdf, formatPoType };
