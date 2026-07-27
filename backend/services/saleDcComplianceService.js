/**
 * Sale delivery challan compliance — e-invoice upload, conditional e-way bill (> ₹50k).
 * Rental / demo DCs are unaffected.
 */
const { emailDocument } = require('./salesManagementPdfService');
const {
  computeGstBreakdown,
  resolveDcBilling,
  resolveSupplyStateFromAddress,
  getDeliveryChallanLines,
} = require('./salesManagementService');

const EWAY_VALUE_THRESHOLD = 50000;
const ACCOUNTS_EMAIL = process.env.ACCOUNTS_EMAIL || 'accounts@truetechservices.in';
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://crm.rentfoxxy.com').replace(/\/$/, '');

/** Dispatch, accounts, or DC editors may upload sale compliance documents. */
const UPLOAD_PERMISSION_CHECKS = [
  ['delivery_challans', 'can_edit'],
  ['dispatch_ops', 'can_edit'],
  ['dispatch', 'can_edit'],
  ['einvoice_ewb', 'can_create'],
  ['einvoice_ewb', 'can_edit'],
];

async function canUploadSaleDcCompliance(user, permissionCache = {}) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const { hasPermission } = require('./permissionService');
  for (const [section, action] of UPLOAD_PERMISSION_CHECKS) {
    // eslint-disable-next-line no-await-in-loop
    if (await hasPermission(user.user_id, user.role, section, action, permissionCache)) {
      return true;
    }
  }
  return false;
}

function isSaleDc(entityCode, quotationType) {
  const ec = String(entityCode || '').toLowerCase();
  const qt = String(quotationType || '').toLowerCase();
  return ec === 'gorefurbo' || qt === 'sale' || qt === 'sales';
}

function requiresEwayBill(grandTotal) {
  return Number(grandTotal) > EWAY_VALUE_THRESHOLD;
}

function isEinvoiceComplete(head) {
  if (!head) return false;
  const num = String(head.einvoice_number || head.irn || '').trim();
  const pdf = String(head.einvoice_pdf_path || '').trim();
  const qr = String(head.qr_code_url || '').trim();
  return Boolean(num && (pdf || qr));
}

function isEwayComplete(head, needsEway) {
  if (!needsEway) return true;
  if (!head) return false;
  const num = String(head.eway_bill_number || '').trim();
  const pdf = String(head.eway_bill_pdf_path || '').trim();
  return Boolean(num && pdf);
}

function buildSaleCompliance(head, totals, userRole, { canUpload = false } = {}) {
  const needsEway = requiresEwayBill(totals?.grand_total);
  const einvoiceComplete = isEinvoiceComplete(head);
  const ewayComplete = isEwayComplete(head, needsEway);
  const isSuperAdmin = userRole === 'super_admin';
  const mayUpload = isSuperAdmin || canUpload;

  return {
    is_sale_dc: true,
    requires_eway_bill: needsEway,
    eway_threshold: EWAY_VALUE_THRESHOLD,
    grand_total: totals?.grand_total ?? null,
    einvoice_complete: einvoiceComplete,
    eway_complete: ewayComplete,
    compliance_complete: einvoiceComplete && ewayComplete,
    can_download_pdf: isSuperAdmin || einvoiceComplete,
    can_upload_compliance: mayUpload,
    einvoice_number: head?.einvoice_number || head?.irn || null,
    einvoice_pdf_path: head?.einvoice_pdf_path || null,
    einvoice_uploaded_at: head?.einvoice_uploaded_at || null,
    eway_bill_number: head?.eway_bill_number || null,
    eway_bill_pdf_path: head?.eway_bill_pdf_path || null,
    vehicle_number: head?.vehicle_number || null,
  };
}

async function computeDcGrandTotal(dcNumber) {
  const lines = await getDeliveryChallanLines(dcNumber);
  if (!lines.length) return 0;
  const { subtotal } = await resolveDcBilling(dcNumber, lines);
  const head = lines[0];
  const totals = computeGstBreakdown({
    subtotal,
    shipping: head.shiping_charges,
    security: head.security_amount,
    supplyState: resolveSupplyStateFromAddress(head.customer_shipping_address, head.supply_state),
  });
  return totals.grand_total;
}

async function assertCanDownloadSaleDcPdf(user, dcNumber) {
  if (user?.role === 'super_admin') return;
  const lines = await getDeliveryChallanLines(dcNumber);
  if (!lines.length) return;
  const head = lines[0];
  if (!isSaleDc(head.entity_code)) return;

  const grandTotal = await computeDcGrandTotal(dcNumber);
  if (isEinvoiceComplete(head)) return;

  throw new Error(
    `E-Invoice must be uploaded before downloading this sale DC PDF (value ₹${Number(grandTotal).toLocaleString('en-IN')})`
  );
}

function normalizeVehicleNumber(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildAccountsSaleDcEmailHtml({
  dcNumber,
  salesOrderNumber,
  customerName,
  laptopCount,
  valueStr,
  needsEway,
  portalUrl,
}) {
  const ewayBlock = needsEway
    ? `<p style="margin:0 0 12px;padding:12px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#9a3412;">
         <strong>E-Way Bill required:</strong> DC value is <strong>₹${escapeHtml(valueStr)}</strong>
         (above ₹${EWAY_VALUE_THRESHOLD.toLocaleString('en-IN')}). Please include E-Way Bill with the E-Invoice.
       </p>`
    : `<p style="margin:0 0 12px;padding:12px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;color:#166534;">
         E-Way Bill is <strong>not required</strong> for this DC (value ₹${escapeHtml(valueStr)}).
       </p>`;

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;font-family:Segoe UI,Helvetica,Arial,sans-serif;background:#f8fafc;color:#334155;">
  <div style="max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#ffffff;">
    <div style="padding:20px 24px;background:#0e7490;color:#ffffff;">
      <p style="margin:0;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;opacity:0.9;">Rentfoxxy CRM</p>
      <h1 style="margin:8px 0 0;font-size:20px;font-weight:600;">Sale Delivery Challan — E-Invoice Required</h1>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;font-size:15px;">Dear Sir,</p>
      <p style="margin:0 0 16px;line-height:1.6;">
        As we are going to <strong>sell ${escapeHtml(laptopCount)} laptop(s)</strong> under the attached delivery challan.
        Please create the <strong>E-Invoice</strong> and upload it in the CRM portal, or reply to this email with the documents.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;">
        <tr><td style="padding:8px 0;color:#64748b;width:140px;">Delivery Challan</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(dcNumber)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Sales Order</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(salesOrderNumber)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Customer</td><td style="padding:8px 0;">${escapeHtml(customerName || '—')}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Laptops</td><td style="padding:8px 0;">${escapeHtml(laptopCount)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">DC Value</td><td style="padding:8px 0;">₹${escapeHtml(valueStr)}</td></tr>
      </table>
      ${ewayBlock}
      <p style="margin:0 0 20px;line-height:1.6;">
        The delivery challan PDF is attached for your reference.
      </p>
      <a href="${escapeHtml(portalUrl)}"
         style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">
        Open DC in CRM — Upload E-Invoice
      </a>
      <p style="margin:24px 0 0;font-size:14px;line-height:1.6;">
        Regards,<br/>
        <strong>Team Rentfoxxy</strong><br/>
        <span style="color:#64748b;">Truetech Services Pvt Ltd</span>
      </p>
    </div>
  </div>
</body>
</html>`;
}

async function emailAccountsSaleDcCreated({
  dcNumber,
  salesOrderNumber,
  customerName,
  pdfPath,
  grandTotal,
  laptopCount,
}) {
  const needsEway = requiresEwayBill(grandTotal);
  const portalUrl = `${FRONTEND_URL}/sales-pipeline/delivery-challans/${encodeURIComponent(dcNumber)}`;
  const valueStr = Number(grandTotal || 0).toLocaleString('en-IN');
  const fromAddress = process.env.SMTP_FROM
    || process.env.FROM_EMAIL
    || process.env.EMAIL_FROM
    || process.env.SMTP_USER
    || '(SMTP not configured)';

  const html = buildAccountsSaleDcEmailHtml({
    dcNumber,
    salesOrderNumber,
    customerName,
    laptopCount,
    valueStr,
    needsEway,
    portalUrl,
  });

  const text = [
    'Dear Sir,',
    '',
    `We are going to sell ${laptopCount} laptop(s) under delivery challan ${dcNumber}.`,
    `Sales Order: ${salesOrderNumber}`,
    `Customer: ${customerName || '—'}`,
    `DC Value: ₹${valueStr}`,
    '',
    'Please create the E-Invoice and upload it in the CRM portal:',
    portalUrl,
    '',
    needsEway
      ? `E-Way Bill is also required (DC value above ₹${EWAY_VALUE_THRESHOLD.toLocaleString('en-IN')}).`
      : 'E-Way Bill is not required for this DC value.',
    '',
    'The delivery challan PDF is attached.',
    '',
    'Regards,',
    'Team Rentfoxxy',
    'Truetech Services Pvt Ltd',
  ].join('\n');

  try {
    const sent = await emailDocument({
      to: ACCOUNTS_EMAIL,
      subject: `Sale DC ${dcNumber} — E-Invoice required${needsEway ? ' + E-Way Bill' : ''}`,
      html,
      text,
      pdfRelativePath: pdfPath,
      replyTo: process.env.ACCOUNTS_REPLY_TO || process.env.SMTP_FROM || process.env.SMTP_USER,
    });
    if (sent) {
      console.log(`Accounts sale DC email sent: ${dcNumber} → ${ACCOUNTS_EMAIL} (from: ${fromAddress})`);
    } else {
      console.warn(`Accounts sale DC email skipped (SMTP/to missing): ${dcNumber}`);
    }
    return sent;
  } catch (err) {
    console.error(`Accounts email failed for ${dcNumber}:`, err.message);
    return false;
  }
}

module.exports = {
  EWAY_VALUE_THRESHOLD,
  ACCOUNTS_EMAIL,
  isSaleDc,
  requiresEwayBill,
  isEinvoiceComplete,
  isEwayComplete,
  buildSaleCompliance,
  computeDcGrandTotal,
  assertCanDownloadSaleDcPdf,
  normalizeVehicleNumber,
  emailAccountsSaleDcCreated,
  canUploadSaleDcCompliance,
  UPLOAD_PERMISSION_CHECKS,
};
