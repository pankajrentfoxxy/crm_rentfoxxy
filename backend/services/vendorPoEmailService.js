const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { formatPoType } = require('./vendorPurchaseOrderPdfService');

function getMailTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

function loadTemplate(vars) {
  const templatePath = path.join(__dirname, '../templates/po-approved.html');
  let html = fs.readFileSync(templatePath, 'utf8');
  Object.entries(vars).forEach(([key, val]) => {
    html = html.replace(new RegExp(`{{${key}}}`, 'g'), String(val ?? ''));
  });
  return html;
}

/**
 * Email approved PO to vendor with PDF attachment.
 * @returns {Promise<boolean>} true if sent
 */
async function sendPurchaseOrderApprovedEmail({ po, vendor, pdfAbsolutePath }) {
  const transport = getMailTransport();
  const to = vendor?.email;
  if (!transport || !to) {
    console.warn('[vendorPoEmail] SMTP not configured or vendor email missing — skipping PO email');
    return false;
  }

  const poNumber = po.purchase_order_number || `PO-${po.po_id}`;
  const vendorName = vendor.business_name || vendor.first_name || 'Vendor';
  const portalUrl = process.env.VENDOR_PORTAL_URL || 'http://localhost:3001';
  const totalAmount = Number(po.total_amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const html = loadTemplate({
    vendorName,
    poNumber,
    poDate: po.purchase_order_date || '—',
    poType: formatPoType(po.purchase_order_type),
    totalAmount,
    portalUrl
  });

  const subject = `Purchase Order [${poNumber}] from Rentfoxxy — Action Required`;
  const text = `Dear ${vendorName},\n\nPurchase order ${poNumber} has been approved. Please see the attached PDF.\n\nVendor portal: ${portalUrl}`;

  const attachments = [];
  if (pdfAbsolutePath && fs.existsSync(pdfAbsolutePath)) {
    attachments.push({
      filename: `${poNumber.replace(/[^\w-]/g, '_')}.pdf`,
      path: pdfAbsolutePath
    });
  }

  await transport.sendMail({
    from: process.env.FROM_EMAIL || process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
    attachments
  });

  return true;
}

module.exports = { sendPurchaseOrderApprovedEmail };
