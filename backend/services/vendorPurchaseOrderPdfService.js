const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { formatPdfDateIstOrDash } = require('../utils/pdfDateTimeUtils');

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

  const isRental = ['rental_purchase', 'rent_to_own'].includes(String(po.purchase_order_type || '').toLowerCase());
  const sub = Number(po.sub_total_amount) || lines.reduce((n, l) => n + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);
  const total = Number(po.total_amount) || sub;
  const gst = Math.round((total - sub) * 100) / 100;
  const v = {
    name: vendor?.business_name || po.vendor_business_name || vendor?.first_name || po.vendor_first_name || 'Vendor',
    address: [vendor?.address || po.vendor_address, vendor?.city || po.vendor_city, vendor?.state || po.vendor_state, vendor?.pincode || po.vendor_pincode]
      .filter(Boolean).join(', ').replace(/_/g, ' '),
    gst: vendor?.gst_number || po.vendor_gst,
    phone: vendor?.phone || po.vendor_phone,
    email: vendor?.email || po.vendor_email,
  };
  const status = String(po.status || '').toLowerCase();

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(absolutePath);
    doc.pipe(stream);
    const W = doc.page.width - 80;
    const L = 40;

    if (status === 'cancelled') {
      doc.save().rotate(-30, { origin: [300, 420] }).fontSize(80).fillColor('#DC2626').opacity(0.15)
        .text('CANCELLED', 60, 380).restore().opacity(1);
    }

    doc.fontSize(16).fillColor('#111827').text(companyName, L, 40);
    doc.fontSize(8).fillColor('#4B5563');
    if (process.env.COMPANY_ADDRESS) doc.text(process.env.COMPANY_ADDRESS, { width: W / 2 });
    if (companyGst) doc.text(`GSTIN: ${companyGst}`);
    doc.fontSize(14).fillColor('#111827').text('PURCHASE ORDER', L, 40, { width: W, align: 'right' });
    doc.fontSize(9).fillColor('#374151');
    const head = [
      `PO No: ${poNumber}${Number(po.amendment_no) > 0 ? `  (Amendment ${po.amendment_no})` : ''}`,
      `Date: ${formatPdfDateIstOrDash(po.purchase_order_date)}`,
      `Type: ${formatPoType(po.purchase_order_type)}`,
      po.expected_delivery_date ? `Deliver by: ${formatPdfDateIstOrDash(po.expected_delivery_date)}` : null,
    ].filter(Boolean);
    head.forEach((t) => doc.text(t, { width: W, align: 'right' }));

    const boxY = Math.max(doc.y, 110) + 10;
    doc.fontSize(9).fillColor('#111827').text('Vendor', L, boxY, { underline: true });
    doc.fillColor('#374151').text(v.name, { width: W / 2 - 10 });
    if (v.address) doc.text(v.address, { width: W / 2 - 10 });
    if (v.gst) doc.text(`GSTIN: ${v.gst}`);
    if (v.phone || v.email) doc.text([v.phone, v.email].filter(Boolean).join(' · '), { width: W / 2 - 10 });
    const leftEnd = doc.y;
    doc.fillColor('#111827').text('Deliver to', L + W / 2, boxY, { underline: true });
    doc.fillColor('#374151').text(companyName, { width: W / 2 });
    if (process.env.COMPANY_ADDRESS) doc.text(process.env.COMPANY_ADDRESS, { width: W / 2 });
    doc.text(`Place of supply: ${String(po.po_state || '—').replace(/_/g, ' ')}`, { width: W / 2 });
    doc.y = Math.max(leftEnd, doc.y) + 12;

    // Line table
    const cols = isRental
      ? [['#', 18], ['Laptop', W - 18 - 36 - 60 - 55 - 70 - 75], ['Qty', 36], ['Rent / month', 60], ['Lock-in', 55], ['Asset value', 70], ['Rent / month total', 75]]
      : [['#', 18], ['Laptop', W - 18 - 36 - 75 - 60 - 85], ['Qty', 36], ['Price', 75], ['Warranty', 60], ['Amount', 85]];
    const row = (cells, bold) => {
      const y = doc.y;
      let x = L;
      let h = 0;
      doc.fontSize(8).fillColor(bold ? '#111827' : '#374151').font(bold ? 'Helvetica-Bold' : 'Helvetica');
      cells.forEach((c, i) => {
        const w = cols[i][1];
        doc.text(String(c ?? ''), x + 2, y, { width: w - 4, align: i >= 2 ? 'right' : 'left' });
        h = Math.max(h, doc.y - y);
        x += w;
      });
      doc.y = y + h + 4;
      doc.moveTo(L, doc.y - 2).lineTo(L + W, doc.y - 2).strokeColor('#E5E7EB').stroke();
      doc.font('Helvetica');
    };
    row(cols.map((c) => c[0]), true);
    lines.forEach((l, i) => {
      if (doc.y > doc.page.height - 160) doc.addPage();
      const cfg = [l.brand, l.model || l.model_name, l.processor, l.generation, l.ram, l.storage, l.gpu, l.screen_size].filter(Boolean).join(' · ');
      const qty = Number(l.quantity) || 0;
      const rate = Number(l.rate) || 0;
      const months = l.vendor_locking_period ?? l.locking_period ?? l.tenure_months;
      const warranty = l.warranty ?? l.warranty_months;
      row(isRental
        ? [i + 1, cfg + (l.remarks ? `\n${l.remarks}` : ''), qty, `Rs ${formatCurrency(rate)}`, months ? `${months} months` : '—', l.asset_value ? `Rs ${formatCurrency(l.asset_value)}` : '—', `Rs ${formatCurrency(qty * rate)}`]
        : [i + 1, cfg + (l.remarks ? `\n${l.remarks}` : ''), qty, `Rs ${formatCurrency(rate)}`, warranty ? `${warranty} months` : '—', `Rs ${formatCurrency(qty * rate)}`]);
    });

    doc.moveDown(0.5);
    const tot = (label, val, bold) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#111827');
      doc.text(label, L + W - 260, y, { width: 150, align: 'right', lineBreak: false });
      doc.text(`Rs ${formatCurrency(val)}`, L + W - 100, y, { width: 100, align: 'right', lineBreak: false });
      doc.font('Helvetica');
      doc.x = L;
      doc.y = y + 14;
    };
    tot(isRental ? 'Rent per month' : 'Subtotal', sub);
    if (po.is_same_state) { tot('CGST 9%', gst / 2); tot('SGST 9%', gst / 2); } else tot('IGST 18%', gst);
    tot(isRental ? 'Total per month' : 'Total', total, true);

    doc.moveDown();
    doc.fontSize(9).fillColor('#111827').text('Terms', L, doc.y, { underline: true });
    doc.fontSize(8).fillColor('#374151');
    const terms = [
      isRental ? 'Rent is billed monthly per laptop from the date it is received at our warehouse, at the rent per month shown.' : null,
      isRental ? 'Lock-in is the minimum rental period per laptop.' : 'Warranty runs from the date of delivery.',
      'Every laptop must match the configuration ordered. Laptops that do not, or are dead on arrival, are rejected at receipt and returned at the vendor\'s cost.',
      'Quote this PO number on the delivery challan and on the invoice.',
      po.remarks ? String(po.remarks) : null,
    ].filter(Boolean);
    terms.forEach((t, i) => doc.text(`${i + 1}. ${t}`, { width: W }));
    if (status === 'cancelled' && po.cancel_reason) {
      doc.moveDown().fillColor('#DC2626').fontSize(9).text(`This purchase order was cancelled: ${po.cancel_reason}`);
    }

    doc.moveDown(2);
    doc.fontSize(9).fillColor('#111827').text(`For ${companyName}`, L, doc.y, { width: W, align: 'right' });
    doc.moveDown(2).text('Authorised signatory', { width: W, align: 'right' });
    doc.fontSize(7).fillColor('#9CA3AF').text('System-generated purchase order.', L, doc.page.height - 50, { width: W, align: 'center' });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return { relativePath, absolutePath };
}

module.exports = { generatePurchaseOrderPdf, formatPoType };
