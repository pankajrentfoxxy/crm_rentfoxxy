/**
 * VRDC (Out for Repair) E-way Bill compliance — mirrors demo DC e-way flow.
 * VRDC creation is never blocked; download is locked until Accounts adds E-way when value > threshold.
 */
const pool = require('../config/db');
const { sendDispatchMail, isDispatchMailConfigured, getDispatchFromAddress } = require('./dispatchEmailService');
const {
  EWAY_VALUE_THRESHOLD,
  normalizeEwayBillNumber,
  requiresVrdcEway,
} = require('./vendorRepairDcShared');
const { canManageDcEwayBill } = require('./saleDcComplianceService');

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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isVrdcEwayComplete(head, needsEway) {
  if (!needsEway) return true;
  return Boolean(String(head?.eway_bill_number || '').trim());
}

async function computeVrdcTotalValue(dcNumber) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(price), 0)::float AS total
       FROM vendor_repair_dc_items
      WHERE dc_number = $1`,
    [dcNumber]
  );
  return Number(r.rows[0]?.total || 0);
}

function laptopRowsFromItems(items = []) {
  return items.map((row) => ({
    ttspl: row.ttspl_id || '—',
    serial: row.serial_number || '—',
    config: row.configuration || '—',
  }));
}

function formatLaptopTableRows(laptops = []) {
  if (!laptops.length) {
    return '<tr><td colspan="3" style="padding:8px 0;color:#64748b;">No laptops listed</td></tr>';
  }
  return laptops.map((row) => (
    `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-family:monospace;">${escapeHtml(row.ttspl)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-family:monospace;">${escapeHtml(row.serial)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(row.config)}</td>
    </tr>`
  )).join('');
}

async function buildVrdcEwayCompliance(head, items, user, permissionCache = {}) {
  const productValue = items?.reduce(
    (sum, row) => sum + (Number.isFinite(Number(row.price)) ? Number(row.price) : 0),
    0
  ) ?? await computeVrdcTotalValue(head.dc_number);
  const needsEway = requiresVrdcEway(productValue);
  const ewayComplete = isVrdcEwayComplete(head, needsEway);
  const isSuperAdmin = user?.role === 'super_admin';
  const canUpload = isSuperAdmin || await canManageDcEwayBill(user, permissionCache);
  const canRequest = isSuperAdmin
    || user?.role === 'warehouse'
    || user?.role === 'admin'
    || user?.role === 'manager'
    || user?.role === 'floor_manager'
    || user?.role === 'dispatch';

  return {
    applies: needsEway,
    requires_eway_bill: needsEway,
    eway_threshold: EWAY_VALUE_THRESHOLD,
    product_value: productValue,
    laptop_count: items?.length || 0,
    eway_complete: ewayComplete,
    eway_status: !needsEway ? 'not_required' : (ewayComplete ? 'uploaded' : 'pending'),
    can_download_pdf: isSuperAdmin || !needsEway || ewayComplete,
    can_upload_eway: isSuperAdmin || canUpload,
    can_request_eway: isSuperAdmin || canRequest,
    request_sent: Boolean(head?.accounts_notified_at),
    accounts_notified_at: head?.accounts_notified_at || null,
    accounts_email: ACCOUNTS_EMAIL,
    dispatch_mail_configured: isDispatchMailConfigured(),
    dispatch_mail_from: getDispatchFromAddress(),
    eway_bill_number: head?.eway_bill_number || null,
    eway_bill_date: head?.eway_bill_date || null,
    eway_bill_uploaded_at: head?.eway_bill_uploaded_at || null,
    lock_message: needsEway && !ewayComplete
      ? 'E-way Bill is required for this VRDC. Please ask the Accounts Team to add the E-way Bill before downloading.'
      : null,
  };
}

async function assertCanDownloadVrdcPdf(user, dcNumber) {
  if (user?.role === 'super_admin') return;
  const headRes = await pool.query(
    `SELECT dc_number, eway_bill_number, eway_bill_date, item_domain
       FROM vendor_repair_delivery_challans
      WHERE dc_number = $1`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head || head.item_domain === 'part') return;

  const total = await computeVrdcTotalValue(dcNumber);
  if (!requiresVrdcEway(total)) return;
  if (isVrdcEwayComplete(head, true)) return;

  throw new Error(
    'E-way Bill is required for this VRDC. Please ask the Accounts Team to add the E-way Bill before downloading.'
  );
}

async function sendAccountsVrdcEwayEmail({ dcNumber, vendorName, productValue, laptops = [] }) {
  if (!isDispatchMailConfigured()) {
    throw new Error(
      'Dispatch mail is not configured. Set DISPATCH_SMTP_HOST, DISPATCH_SMTP_USER, DISPATCH_SMTP_PASS, and DISPATCH_SMTP_FROM in backend/.env'
    );
  }

  const valueStr = Number(productValue || 0).toLocaleString('en-IN');
  const thresholdStr = EWAY_VALUE_THRESHOLD.toLocaleString('en-IN');
  const portalUrl = `${FRONTEND_URL}/vendor-management/vendor-repair-dc/${encodeURIComponent(dcNumber)}`;
  const fromAddress = getDispatchFromAddress();
  const laptopText = laptops.length
    ? laptops.map((row) => `  ${row.ttspl} / ${row.serial} — ${row.config}`).join('\n')
    : '  —';

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;font-family:Segoe UI,Helvetica,Arial,sans-serif;background:#f8fafc;color:#334155;">
  <div style="max-width:640px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#ffffff;">
    <div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
      <p style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">Rentfoxxy</p>
      <p style="margin:12px 0 0;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">VRDC E-Way Bill Required</p>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;font-size:15px;">Hi Accounts Team,</p>
      <p style="margin:0 0 16px;line-height:1.6;">
        An <strong>Out for Repair Vendor Return DC (VRDC)</strong> exceeds ₹${escapeHtml(thresholdStr)} declared value
        and needs an E-Way Bill before the VRDC PDF can be downloaded.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;">
        <tr><td style="padding:8px 0;color:#64748b;width:160px;">VRDC Number</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(dcNumber)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Vendor</td><td style="padding:8px 0;">${escapeHtml(vendorName || '—')}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Total Value</td><td style="padding:8px 0;">₹${escapeHtml(valueStr)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Laptop Count</td><td style="padding:8px 0;">${escapeHtml(String(laptops.length))}</td></tr>
      </table>
      <p style="margin:0 0 8px;font-weight:600;">Laptops</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:13px;">
        <tr style="background:#f8fafc;color:#64748b;text-align:left;">
          <th style="padding:6px 8px;">TTSPL</th>
          <th style="padding:6px 8px;">Serial</th>
          <th style="padding:6px 8px;">Configuration</th>
        </tr>
        ${formatLaptopTableRows(laptops)}
      </table>
      <p style="margin:0 0 20px;padding:12px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#9a3412;">
        Action required: please enter the <strong>E-Way Bill Number</strong>${'' /* date supported in CRM */} on this VRDC.
      </p>
      <a href="${escapeHtml(portalUrl)}"
         style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">
        Open VRDC — Enter E-Way Bill
      </a>
      <p style="margin:24px 0 0;font-size:14px;line-height:1.6;">
        Regards,<br/>
        <strong>Team Rentfoxxy</strong>
      </p>
    </div>
  </div>
</body>
</html>`;

  const sent = await sendDispatchMail({
    to: ACCOUNTS_EMAIL,
    cc: ACCOUNTS_EMAIL_CC,
    subject: `${dcNumber} : ${vendorName || 'Vendor'} : VRDC E-Way Bill Required`,
    text: [
      'Hi Accounts Team,',
      '',
      `VRDC ${dcNumber} for vendor ${vendorName || '—'} requires an E-Way Bill.`,
      `Total declared value: ₹${valueStr} (threshold ₹${thresholdStr}).`,
      `Laptops (${laptops.length}):`,
      laptopText,
      '',
      `Open in CRM: ${portalUrl}`,
      '',
      'Please enter the E-Way Bill Number on the VRDC page.',
      '',
      'Regards,',
      'Team Rentfoxxy',
    ].join('\n'),
    html,
    replyTo: process.env.DISPATCH_SMTP_REPLY_TO || fromAddress,
  });

  if (!sent) {
    throw new Error('Failed to send mail — check DISPATCH_SMTP settings');
  }

  console.log(`Accounts VRDC e-way email sent: ${dcNumber} → ${ACCOUNTS_EMAIL}`);
  return { sent: true, from: fromAddress, to: ACCOUNTS_EMAIL, cc: ACCOUNTS_EMAIL_CC };
}

async function saveVrdcEwayBill({ dcNumber, ewayBillNumber, ewayBillDate, userId }) {
  const num = normalizeEwayBillNumber(ewayBillNumber);
  if (!num) throw new Error('E-Way Bill number is required');
  const date = ewayBillDate ? String(ewayBillDate).trim() || null : null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('E-way Bill date must be YYYY-MM-DD');
  }

  const total = await computeVrdcTotalValue(dcNumber);
  if (!requiresVrdcEway(total)) {
    throw new Error('E-Way Bill upload applies only when VRDC value is above the configured threshold');
  }

  await pool.query(
    `UPDATE vendor_repair_delivery_challans SET
        eway_bill_number = $2,
        eway_bill_date = $3::date,
        eway_bill_uploaded_at = NOW(),
        eway_bill_uploaded_by = $4,
        pdf_path = NULL,
        updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber, num, date, userId || null]
  );

  return { eway_bill_number: num, eway_bill_date: date };
}

module.exports = {
  ACCOUNTS_EMAIL,
  buildVrdcEwayCompliance,
  assertCanDownloadVrdcPdf,
  computeVrdcTotalValue,
  sendAccountsVrdcEwayEmail,
  saveVrdcEwayBill,
  laptopRowsFromItems,
  requiresVrdcEway,
  isVrdcEwayComplete,
};
