/**
 * Sale delivery challan compliance — e-invoice upload, conditional e-way bill (> threshold).
 * New-customer Demo DCs use a separate e-way-only lock (see requiresDemoEwayCompliance).
 * Existing-customer demo and normal rental DCs are unaffected.
 */
const fs = require('fs');
const path = require('path');
const { sendDispatchMail, isDispatchMailConfigured, getDispatchFromAddress } = require('./dispatchEmailService');
const {
  resolveDcBilling,
  getDeliveryChallanLines,
} = require('./salesManagementService');

const parsedEwayThreshold = Number(process.env.EWAY_VALUE_THRESHOLD);
const EWAY_VALUE_THRESHOLD = Number.isFinite(parsedEwayThreshold) && parsedEwayThreshold > 0
  ? parsedEwayThreshold
  : 50000;
const ACCOUNTS_EMAIL = process.env.ACCOUNTS_EMAIL || 'accounts@truetechservices.in';
const ACCOUNTS_EMAIL_CC = process.env.ACCOUNTS_EMAIL_CC || 'adminn@rentfoxxy.com,pankkajyadav@rentfoxxy.com';
const FRONTEND_URL = (
  process.env.CRM_PUBLIC_URL
  || process.env.PUBLIC_APP_URL
  || String(process.env.FRONTEND_URL || '')
    .split(',')
    .map((s) => s.trim())
    .find((s) => /^https:\/\/crm\./i.test(s))
  || 'https://crm.rentfoxxy.com'
).replace(/\/$/, '');

/** Dispatch, accounts, or DC editors may upload sale compliance documents. */
const UPLOAD_PERMISSION_CHECKS = [
  ['delivery_challans', 'can_edit'],
  ['dispatch_ops', 'can_edit'],
  ['dispatch', 'can_edit'],
  ['einvoice_ewb', 'can_create'],
  ['einvoice_ewb', 'can_edit'],
];

async function canManageDcEwayBill(user, permissionCache = {}) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (await canUploadSaleDcCompliance(user, permissionCache)) return true;
  const { hasPermission } = require('./permissionService');
  return (await hasPermission(user.user_id, user.role, 'dc_eway_bill', 'can_edit', permissionCache))
    || (await hasPermission(user.user_id, user.role, 'dc_eway_bill', 'can_create', permissionCache));
}

function buildDemoEwayCompliance(head, totals, userRole, {
  canUpload = false,
  canRequest = false,
  isFirstCustomerOrder = false,
} = {}) {
  const productValue = Number(totals?.subtotal ?? totals?.grand_total ?? 0);
  const needsEway = requiresDemoEwayCompliance(head?.quotation_type, isFirstCustomerOrder, productValue);
  const ewayComplete = isEwayComplete(head, needsEway);
  const isSuperAdmin = userRole === 'super_admin';
  const requested = Boolean(head?.accounts_notified_at);

  return {
    applies: needsEway,
    is_demo_dc: true,
    is_first_customer_order: Boolean(isFirstCustomerOrder),
    requires_eway_bill: needsEway,
    eway_threshold: EWAY_VALUE_THRESHOLD,
    product_value: productValue,
    eway_complete: ewayComplete,
    eway_status: !needsEway ? 'not_required' : (ewayComplete ? 'uploaded' : 'pending'),
    can_download_pdf: isSuperAdmin || !needsEway || ewayComplete,
    can_upload_eway: isSuperAdmin || canUpload,
    can_request_eway: isSuperAdmin || canRequest,
    request_sent: requested,
    accounts_notified_at: head?.accounts_notified_at || null,
    accounts_email: ACCOUNTS_EMAIL,
    dispatch_mail_configured: isDispatchMailConfigured(),
    dispatch_mail_from: getDispatchFromAddress(),
    eway_bill_number: head?.eway_bill_number || null,
    eway_bill_date: head?.eway_bill_date || null,
    eway_bill_pdf_path: head?.eway_bill_pdf_path || null,
    eway_bill_uploaded_at: head?.eway_bill_uploaded_at || null,
    eway_bill_uploaded_by: head?.eway_bill_uploaded_by || null,
  };
}

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

function isDemoDc(quotationType) {
  return String(quotationType || '').toLowerCase() === 'demo';
}

/**
 * First live sales order for this customer (new-customer 1st order).
 * Cancelled SOs are ignored.
 */
async function isNewCustomerFirstOrder(db, customerId, salesOrderNumber) {
  if (!customerId || !salesOrderNumber) return false;
  const first = await db.query(
    `SELECT sales_order_number
       FROM sales_order_lines
      WHERE customer_id = $1
        AND LOWER(COALESCE(status, '')) NOT IN ('cancelled')
      ORDER BY created_at ASC, id ASC
      LIMIT 1`,
    [customerId]
  );
  return first.rows[0]?.sales_order_number === salesOrderNumber;
}

function requiresInvoiceCompliance(entityCode, quotationType, isFirstOrder = false) {
  // Demo first orders use the e-way-only path, not e-invoice lock.
  if (isDemoDc(quotationType)) return false;
  return isSaleDc(entityCode, quotationType) || Boolean(isFirstOrder);
}

function requiresDemoEwayCompliance(quotationType, isFirstOrder, productValue) {
  return isDemoDc(quotationType) && Boolean(isFirstOrder) && requiresEwayBill(productValue);
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

function buildSaleCompliance(head, totals, userRole, {
  canUpload = false,
  canSendMail = false,
  isFirstCustomerOrder = false,
} = {}) {
  const productValue = Number(totals?.subtotal ?? totals?.grand_total ?? 0);
  const needsEway = requiresEwayBill(productValue);
  const einvoiceComplete = isEinvoiceComplete(head);
  const ewayComplete = isEwayComplete(head, needsEway);
  const isSuperAdmin = userRole === 'super_admin';
  const mayUpload = isSuperAdmin || canUpload;
  const maySendMail = isSuperAdmin || canSendMail;
  const sale = isSaleDc(head?.entity_code, head?.quotation_type);

  return {
    is_sale_dc: sale,
    is_first_customer_order: Boolean(isFirstCustomerOrder),
    requires_invoice_compliance: true,
    requires_eway_bill: needsEway,
    eway_threshold: EWAY_VALUE_THRESHOLD,
    product_value: productValue,
    grand_total: productValue,
    einvoice_complete: einvoiceComplete,
    eway_complete: ewayComplete,
    compliance_complete: einvoiceComplete && ewayComplete,
    can_download_pdf: isSuperAdmin || einvoiceComplete,
    can_upload_compliance: mayUpload,
    can_send_accounts_mail: maySendMail,
    dispatch_mail_configured: isDispatchMailConfigured(),
    dispatch_mail_from: getDispatchFromAddress(),
    accounts_notified_at: head?.accounts_notified_at || null,
    accounts_email: ACCOUNTS_EMAIL,
    einvoice_number: head?.einvoice_number || head?.irn || null,
    einvoice_pdf_path: head?.einvoice_pdf_path || null,
    einvoice_uploaded_at: head?.einvoice_uploaded_at || null,
    eway_bill_number: head?.eway_bill_number || null,
    eway_bill_pdf_path: head?.eway_bill_pdf_path || null,
    vehicle_number: head?.vehicle_number || null,
  };
}

/** Laptop / line prices on this DC only — GST is added later on the e-invoice. */
async function computeDcProductValue(dcNumber) {
  const lines = await getDeliveryChallanLines(dcNumber);
  if (!lines.length) return 0;
  const { subtotal } = await resolveDcBilling(dcNumber, lines);
  return +Number(subtotal || 0).toFixed(2);
}

async function computeDcGrandTotal(dcNumber) {
  return computeDcProductValue(dcNumber);
}

function resolveAccountsMailLogo({ isSale = false } = {}) {
  const filename = isSale ? 'gorefurbo-logo.png' : 'rentfoxxy-logo.png';
  const abs = path.join(__dirname, '..', 'assets', filename);
  if (!fs.existsSync(abs)) return null;
  return {
    filename,
    path: abs,
    cid: 'brand-logo',
    contentDisposition: 'inline',
    brandLabel: isSale ? 'Gorefurbo' : 'Rentfoxxy',
  };
}

async function assertCanDownloadSaleDcPdf(user, dcNumber) {
  if (user?.role === 'super_admin') return;
  const lines = await getDeliveryChallanLines(dcNumber);
  if (!lines.length) return;
  const head = lines[0];
  const pool = require('../config/db');
  let quotationType = head.quotation_type || null;
  if (!quotationType && head.sales_order_number) {
    const qt = await pool.query(
      `SELECT quotation_type FROM sales_order_lines WHERE sales_order_number = $1 LIMIT 1`,
      [head.sales_order_number]
    );
    quotationType = qt.rows[0]?.quotation_type || null;
  }
  const firstOrder = await isNewCustomerFirstOrder(pool, head.customer_id, head.sales_order_number);
  const grandTotal = await computeDcGrandTotal(dcNumber);

  if (requiresDemoEwayCompliance(quotationType, firstOrder, grandTotal)) {
    if (isEwayComplete(head, true)) return;
    throw new Error(
      `E-Way Bill must be uploaded before downloading this demo DC PDF (value ₹${Number(grandTotal).toLocaleString('en-IN')})`
    );
  }

  if (!requiresInvoiceCompliance(head.entity_code, quotationType, firstOrder)) return;
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
  brandLabel,
  hasLogo,
}) {
  const ewayBlock = needsEway
    ? `<p style="margin:0 0 12px;padding:12px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#9a3412;">
         DC laptop value is greater than ₹${EWAY_VALUE_THRESHOLD.toLocaleString('en-IN')}
         (value <strong>₹${escapeHtml(valueStr)}</strong>, exclusive of GST) so <strong>e-way bill is mandatory</strong>.
         Please upload the waybill also.
       </p>`
    : `<p style="margin:0 0 12px;padding:12px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;color:#166534;">
         E-Way Bill is <strong>not required</strong> for this DC (laptop value ₹${escapeHtml(valueStr)}, exclusive of GST).
       </p>`;

  const logoBlock = hasLogo
    ? `<img src="cid:brand-logo" alt="${escapeHtml(brandLabel || 'Logo')}" style="height:44px;max-width:240px;display:block;margin:0;" />`
    : `<p style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">${escapeHtml(brandLabel || 'Rentfoxxy')}</p>`;

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;font-family:Segoe UI,Helvetica,Arial,sans-serif;background:#f8fafc;color:#334155;">
  <div style="max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#ffffff;">
    <div style="padding:20px 24px;background:#ffffff;border-bottom:1px solid #e2e8f0;">
      ${logoBlock}
      <p style="margin:12px 0 0;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">Create Invoice</p>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;font-size:15px;">Hi Ankesh Sir,</p>
      <p style="margin:0 0 16px;line-height:1.6;">
        Please create e-invoice and upload in the Delivery challan.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;">
        <tr><td style="padding:8px 0;color:#64748b;width:140px;">Delivery Challan</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(dcNumber)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Sales Order</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(salesOrderNumber)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Customer</td><td style="padding:8px 0;">${escapeHtml(customerName || '—')}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Laptops</td><td style="padding:8px 0;">${escapeHtml(laptopCount)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">DC Value</td><td style="padding:8px 0;">₹${escapeHtml(valueStr)} <span style="font-weight:400;color:#64748b;">(exclusive of GST)</span></td></tr>
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

async function sendAccountsSaleDcEmail({
  dcNumber,
  salesOrderNumber,
  customerName,
  pdfPath,
  grandTotal,
  productValue,
  laptopCount,
  isSale = false,
  isFirstCustomerOrder = false,
}) {
  if (!isDispatchMailConfigured()) {
    throw new Error(
      'Dispatch mail is not configured. Set DISPATCH_SMTP_HOST, DISPATCH_SMTP_USER, DISPATCH_SMTP_PASS, and DISPATCH_SMTP_FROM in backend/.env'
    );
  }

  const value = Number(productValue ?? grandTotal ?? 0);
  const needsEway = requiresEwayBill(value);
  const portalUrl = `${FRONTEND_URL}/sales-pipeline/delivery-challans/${encodeURIComponent(dcNumber)}`;
  const valueStr = value.toLocaleString('en-IN');
  const fromAddress = getDispatchFromAddress();
  // Sale SOs use Gorefurbo; new-customer first orders (rental) use Rentfoxxy.
  const useGorefurbo = Boolean(isSale);
  const logo = resolveAccountsMailLogo({ isSale: useGorefurbo });
  const brandLabel = useGorefurbo ? 'Gorefurbo' : 'Rentfoxxy';

  const html = buildAccountsSaleDcEmailHtml({
    dcNumber,
    salesOrderNumber,
    customerName,
    laptopCount,
    valueStr,
    needsEway,
    portalUrl,
    brandLabel,
    hasLogo: Boolean(logo),
  });

  const text = [
    'Hi Ankesh Sir,',
    '',
    'Please create e-invoice and upload in the Delivery challan.',
    '',
    `Delivery Challan: ${dcNumber}`,
    `Sales Order: ${salesOrderNumber || '—'}`,
    `Customer: ${customerName || '—'}`,
    `Laptops: ${laptopCount}`,
    `DC value (exclusive of GST): ₹${valueStr}`,
    '',
    needsEway
      ? `DC laptop value is greater than ₹${EWAY_VALUE_THRESHOLD.toLocaleString('en-IN')} — e-way bill is mandatory. Please upload the waybill also.`
      : 'E-Way Bill is not required for this value.',
    '',
    'Upload in CRM (Finance → DC Invoice or DC E-Invoice tab):',
    portalUrl,
    '',
    'The delivery challan PDF is attached.',
    '',
    'Regards,',
    'Team Rentfoxxy',
  ].join('\n');

  const sent = await sendDispatchMail({
    to: ACCOUNTS_EMAIL,
    cc: ACCOUNTS_EMAIL_CC,
    subject: `${dcNumber} : ${customerName || 'Customer'} : Create Invoice`,
    html,
    text,
    pdfRelativePath: pdfPath,
    extraAttachments: logo ? [{
      filename: logo.filename,
      path: logo.path,
      cid: logo.cid,
      contentType: 'image/png',
      contentDisposition: 'inline',
    }] : [],
    replyTo: process.env.DISPATCH_SMTP_REPLY_TO || fromAddress,
  });

  if (!sent) {
    throw new Error('Failed to send mail — check DISPATCH_SMTP settings and DC PDF path');
  }

  console.log(`Accounts sale DC email sent: ${dcNumber} → ${ACCOUNTS_EMAIL} cc ${ACCOUNTS_EMAIL_CC} (from dispatch: ${fromAddress})`);
  return { sent: true, from: fromAddress, to: ACCOUNTS_EMAIL, cc: ACCOUNTS_EMAIL_CC };
}

function formatDemoLaptopRows(laptops = []) {
  if (!laptops.length) return '<tr><td colspan="3" style="padding:8px 0;color:#64748b;">No laptops listed</td></tr>';
  return laptops.map((row) => (
    `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-family:monospace;">${escapeHtml(row.ttspl || '—')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-family:monospace;">${escapeHtml(row.serial || '—')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(row.config || '—')}</td>
    </tr>`
  )).join('');
}

async function sendAccountsDemoEwayEmail({
  dcNumber,
  salesOrderNumber,
  customerName,
  productValue,
  laptops = [],
}) {
  if (!isDispatchMailConfigured()) {
    throw new Error(
      'Dispatch mail is not configured. Set DISPATCH_SMTP_HOST, DISPATCH_SMTP_USER, DISPATCH_SMTP_PASS, and DISPATCH_SMTP_FROM in backend/.env'
    );
  }

  const value = Number(productValue || 0);
  const valueStr = value.toLocaleString('en-IN');
  const thresholdStr = EWAY_VALUE_THRESHOLD.toLocaleString('en-IN');
  const portalUrl = `${FRONTEND_URL}/sales-pipeline/delivery-challans/${encodeURIComponent(dcNumber)}`;
  const fromAddress = getDispatchFromAddress();
  const logo = resolveAccountsMailLogo({ isSale: false });
  const brandLabel = 'Rentfoxxy';
  const logoBlock = logo
    ? `<img src="cid:brand-logo" alt="${escapeHtml(brandLabel)}" style="height:44px;max-width:240px;display:block;margin:0;" />`
    : `<p style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">${escapeHtml(brandLabel)}</p>`;
  const laptopText = laptops.length
    ? laptops.map((row) => `  ${row.ttspl || '—'} / ${row.serial || '—'} — ${row.config || '—'}`).join('\n')
    : '  —';

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;font-family:Segoe UI,Helvetica,Arial,sans-serif;background:#f8fafc;color:#334155;">
  <div style="max-width:640px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#ffffff;">
    <div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
      ${logoBlock}
      <p style="margin:12px 0 0;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">E-Way Bill Required</p>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;font-size:15px;">Hi Accounts Team,</p>
      <p style="margin:0 0 16px;line-height:1.6;">
        A <strong>new-customer demo</strong> delivery challan is at or above ₹${escapeHtml(thresholdStr)}
        and needs an E-Way Bill before the DC can be downloaded or dispatched.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;">
        <tr><td style="padding:8px 0;color:#64748b;width:160px;">Customer</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(customerName || '—')}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Sales Order</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(salesOrderNumber || '—')}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Delivery Challan</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(dcNumber)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Consignment Value</td><td style="padding:8px 0;">₹${escapeHtml(valueStr)} <span style="color:#64748b;">(exclusive of GST)</span></td></tr>
      </table>
      <p style="margin:0 0 8px;font-weight:600;">Demo laptops</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:13px;">
        <tr style="background:#f8fafc;color:#64748b;text-align:left;">
          <th style="padding:6px 8px;">TTSPL</th>
          <th style="padding:6px 8px;">Serial</th>
          <th style="padding:6px 8px;">Configuration</th>
        </tr>
        ${formatDemoLaptopRows(laptops)}
      </table>
      <p style="margin:0 0 20px;padding:12px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#9a3412;">
        Action required: <strong>Upload E-Way Bill</strong> (number, date, and document) on this DC.
      </p>
      <a href="${escapeHtml(portalUrl)}"
         style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">
        Open DC — Upload E-Way Bill
      </a>
      <p style="margin:24px 0 0;font-size:14px;line-height:1.6;">
        Regards,<br/>
        <strong>Team Rentfoxxy</strong>
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = [
    'Hi Accounts Team,',
    '',
    'A new-customer demo delivery challan needs an E-Way Bill before DC download.',
    '',
    `Customer: ${customerName || '—'}`,
    `Sales Order: ${salesOrderNumber || '—'}`,
    `Delivery Challan: ${dcNumber}`,
    `Consignment value (exclusive of GST): ₹${valueStr}`,
    '',
    'Demo laptops:',
    laptopText,
    '',
    'Action required: Upload E-Way Bill (number, date, and document).',
    portalUrl,
    '',
    'Regards,',
    'Team Rentfoxxy',
  ].join('\n');

  const sent = await sendDispatchMail({
    to: ACCOUNTS_EMAIL,
    cc: ACCOUNTS_EMAIL_CC,
    subject: `${dcNumber} : ${customerName || 'Customer'} : Upload E-Way Bill (Demo)`,
    html,
    text,
    extraAttachments: logo ? [{
      filename: logo.filename,
      path: logo.path,
      cid: logo.cid,
      contentType: 'image/png',
      contentDisposition: 'inline',
    }] : [],
    replyTo: process.env.DISPATCH_SMTP_REPLY_TO || fromAddress,
  });

  if (!sent) {
    throw new Error('Failed to send mail — check DISPATCH_SMTP settings');
  }

  console.log(`Accounts demo e-way email sent: ${dcNumber} → ${ACCOUNTS_EMAIL}`);
  return { sent: true, from: fromAddress, to: ACCOUNTS_EMAIL, cc: ACCOUNTS_EMAIL_CC };
}

/** @deprecated Auto-send on DC create removed — use sendAccountsSaleDcEmail via API. */
async function emailAccountsSaleDcCreated(params) {
  return sendAccountsSaleDcEmail(params);
}

module.exports = {
  EWAY_VALUE_THRESHOLD,
  ACCOUNTS_EMAIL,
  ACCOUNTS_EMAIL_CC,
  isSaleDc,
  isDemoDc,
  isNewCustomerFirstOrder,
  requiresInvoiceCompliance,
  requiresDemoEwayCompliance,
  requiresEwayBill,
  isEinvoiceComplete,
  isEwayComplete,
  buildSaleCompliance,
  buildDemoEwayCompliance,
  computeDcProductValue,
  computeDcGrandTotal,
  assertCanDownloadSaleDcPdf,
  normalizeVehicleNumber,
  sendAccountsSaleDcEmail,
  sendAccountsDemoEwayEmail,
  emailAccountsSaleDcCreated,
  canUploadSaleDcCompliance,
  canManageDcEwayBill,
  UPLOAD_PERMISSION_CHECKS,
};
