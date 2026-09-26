/**
 * VRDC (Out for Repair) E-way Bill compliance — mirrors demo DC e-way flow.
 * VRDC creation is never blocked; download is locked until Accounts adds E-way when value > threshold.
 */
const pool = require('../config/db');
const { sendDispatchMail, isDispatchMailConfigured, getDispatchFromAddress } = require('./dispatchEmailService');
const {
  EWAY_VALUE_THRESHOLD,
  normalizeEwayBillNumber,
} = require('./vendorRepairDcShared');

/**
 * A laptop repair challan needs an e-way bill at Rs 50,000 and above (user's
 * rule, 26 Sep 2026 — claude/carret-vendor-repair.md), the same as a return
 * challan. The shared helper in vendorRepairDcShared keeps "above" for the
 * part-repair and scrap challans that still use it.
 */
function requiresVrdcEway(totalValue) {
  return Number(totalValue || 0) >= EWAY_VALUE_THRESHOLD;
}

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

/** Accounts / dc_eway_bill holders — not warehouse via sale-DC dispatch permissions. */
async function canUploadVrdcEwayBill(user, permissionCache = {}) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const { hasPermission } = require('./permissionService');
  return (await hasPermission(user.user_id, user.role, 'dc_eway_bill', 'can_edit', permissionCache))
    || (await hasPermission(user.user_id, user.role, 'dc_eway_bill', 'can_create', permissionCache));
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
  const canUpload = isSuperAdmin || await canUploadVrdcEwayBill(user, permissionCache);
  const canDownload = isSuperAdmin || !needsEway || ewayComplete || canUpload;

  return {
    applies: needsEway,
    requires_eway_bill: needsEway,
    eway_threshold: EWAY_VALUE_THRESHOLD,
    product_value: productValue,
    laptop_count: items?.length || 0,
    eway_complete: ewayComplete,
    eway_status: !needsEway ? 'not_required' : (ewayComplete ? 'uploaded' : 'pending'),
    can_download_pdf: canDownload,
    can_upload_eway: canUpload,
    can_request_eway: isSuperAdmin
    || user?.role === 'warehouse'
    || user?.role === 'admin'
    || user?.role === 'manager'
    || user?.role === 'floor_manager'
    || user?.role === 'dispatch',
    request_sent: Boolean(head?.accounts_notified_at),
    accounts_notified_at: head?.accounts_notified_at || null,
    accounts_email: ACCOUNTS_EMAIL,
    dispatch_mail_configured: isDispatchMailConfigured(),
    dispatch_mail_from: getDispatchFromAddress(),
    eway_bill_number: head?.eway_bill_number || null,
    eway_bill_date: head?.eway_bill_date || null,
    eway_bill_pdf_path: head?.eway_bill_pdf_path || null,
    eway_bill_uploaded_at: head?.eway_bill_uploaded_at || null,
    lock_message: needsEway && !ewayComplete && !canDownload
      ? 'E-way Bill is required for this VRDC. Please ask the Accounts Team to add the E-way Bill before downloading.'
      : (needsEway && !ewayComplete && canUpload
        ? 'Download the VRDC PDF if needed for the GST portal, then enter the E-way Bill below to unlock download for the warehouse team.'
        : null),
  };
}

async function canDownloadVrdcPdf(user, head, items, permissionCache = {}) {
  if (user?.role === 'super_admin') return true;
  const productValue = items?.reduce(
    (sum, row) => sum + (Number.isFinite(Number(row.price)) ? Number(row.price) : 0),
    0
  ) ?? await computeVrdcTotalValue(head.dc_number);
  if (!requiresVrdcEway(productValue)) return true;
  if (isVrdcEwayComplete(head, true)) return true;
  return canUploadVrdcEwayBill(user, permissionCache);
}

async function shouldPersistPublicVrdcPdf(head, items) {
  const productValue = items?.reduce(
    (sum, row) => sum + (Number.isFinite(Number(row.price)) ? Number(row.price) : 0),
    0
  ) ?? await computeVrdcTotalValue(head.dc_number);
  if (!requiresVrdcEway(productValue)) return true;
  return isVrdcEwayComplete(head, true);
}

async function purgeLockedVrdcPublicPdf(dcNumber) {
  const fs = require('fs');
  const path = require('path');
  const headRes = await pool.query(
    `SELECT dc_number, pdf_path, eway_bill_number, item_domain
       FROM vendor_repair_delivery_challans
      WHERE dc_number = $1`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head?.pdf_path || head.item_domain === 'part') return false;

  const itemsRes = await pool.query(
    `SELECT price FROM vendor_repair_dc_items WHERE dc_number = $1`,
    [dcNumber]
  );
  const shouldKeep = await shouldPersistPublicVrdcPdf(head, itemsRes.rows);
  if (shouldKeep) return false;

  const rel = String(head.pdf_path).replace(/^\/+/, '');
  const abs = path.join(__dirname, '..', 'uploads', rel);
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (_) { /* best-effort */ }
  await pool.query(
    `UPDATE vendor_repair_delivery_challans SET pdf_path = NULL, updated_at = NOW() WHERE dc_number = $1`,
    [dcNumber]
  );
  return true;
}

async function assertCanDownloadVrdcPdf(user, dcNumber) {
  const headRes = await pool.query(
    `SELECT dc_number, eway_bill_number, eway_bill_date, item_domain
       FROM vendor_repair_delivery_challans
      WHERE dc_number = $1`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head || head.item_domain === 'part') return;

  const itemsRes = await pool.query(
    `SELECT price FROM vendor_repair_dc_items WHERE dc_number = $1`,
    [dcNumber]
  );
  const cache = {};
  const allowed = await canDownloadVrdcPdf(user, head, itemsRes.rows, cache);
  if (allowed) return;

  throw new Error(
    'E-way Bill is required for this VRDC. Please ask the Accounts Team to add the E-way Bill before downloading.'
  );
}

/** Brand + model with count and value, for the Accounts mail. */
function summariseRepairByModel(items = []) {
  const groups = new Map();
  for (const row of items) {
    if (['cancelled'].includes(row.item_status)) continue;
    const cfg = String(row.configuration || '').split('·').map((x) => x.trim());
    const brand = String(row.brand || row.ticket_brand || cfg[0] || '').trim() || '—';
    const model = String(row.model || row.ticket_model || cfg[1] || '').trim() || '—';
    const key = `${brand.toLowerCase()}|${model.toLowerCase()}`;
    const g = groups.get(key) || { brand, model, count: 0, value: 0 };
    g.count += 1;
    g.value += Number.isFinite(Number(row.price)) ? Number(row.price) : 0;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.value - a.value);
}

/** How the challan travels, as label/value rows. */
function describeRepairTransport(head = {}) {
  const rows = [];
  const by = String(head.ship_by || '');
  if (by === 'by_courier') {
    rows.push(['Mode', 'Courier']);
    if (head.courier_name) rows.push(['Courier', head.courier_name]);
    if (head.awb_number) rows.push(['Tracking ID (AWB)', head.awb_number]);
  } else if (by === 'by_porter') {
    rows.push(['Mode', 'Porter']);
    if (head.porter_person_name) rows.push(['Porter person', head.porter_person_name]);
    if (head.porter_person_phone) rows.push(['Phone', head.porter_person_phone]);
    if (head.porter_tracking_id) rows.push(['Porter booking', head.porter_tracking_id]);
  } else if (by === 'by_hand') {
    rows.push(['Mode', 'In-house delivery']);
    if (head.delivery_person_name) rows.push(['Delivery person', head.delivery_person_name]);
    const ph = head.inhouse_person_phone || head.delivery_person_phone;
    if (ph) rows.push(['Phone', ph]);
  } else if (by === 'by_vendor_pickup') {
    rows.push(['Mode', 'Vendor pickup']);
    if (head.vendor_pickup_person) rows.push(['Pickup person', head.vendor_pickup_person]);
    if (head.vendor_pickup_mobile) rows.push(['Phone', head.vendor_pickup_mobile]);
  } else {
    rows.push(['Mode', by || 'Not set']);
  }
  if (head.vehicle_number) rows.push(['Vehicle number', head.vehicle_number]);
  return rows;
}

async function sendAccountsVrdcEwayEmail({
  dcNumber, vendorName, productValue, laptops = [], userTriggered = false, summary = [], transport = [],
}) {
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
        An <strong>Out for Repair Vendor Return DC (VRDC)</strong> is ₹${escapeHtml(thresholdStr)} or more in declared value
        and needs an E-Way Bill before the laptops can leave the gate.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;">
        <tr><td style="padding:8px 0;color:#64748b;width:160px;">VRDC Number</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(dcNumber)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Vendor</td><td style="padding:8px 0;">${escapeHtml(vendorName || '—')}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Total Value</td><td style="padding:8px 0;">₹${escapeHtml(valueStr)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Laptop Count</td><td style="padding:8px 0;">${escapeHtml(String(laptops.length))}</td></tr>
        ${transport.map(([k, v]) => `<tr><td style="padding:8px 0;color:#64748b;">${escapeHtml(k)}</td><td style="padding:8px 0;">${escapeHtml(v)}</td></tr>`).join('')}
      </table>
      ${summary.length ? `<p style="margin:0 0 8px;font-weight:600;">By brand and model</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:13px;">
        <tr style="background:#f8fafc;color:#64748b;text-align:left;"><th style="padding:6px 8px;">Brand</th><th style="padding:6px 8px;">Model</th><th style="padding:6px 8px;text-align:right;">Count</th><th style="padding:6px 8px;text-align:right;">Value</th></tr>
        ${summary.map((g) => `<tr><td style="padding:6px 8px;">${escapeHtml(g.brand)}</td><td style="padding:6px 8px;">${escapeHtml(g.model)}</td><td style="padding:6px 8px;text-align:right;">${g.count}</td><td style="padding:6px 8px;text-align:right;">₹${escapeHtml(Number(g.value).toLocaleString('en-IN'))}</td></tr>`).join('')}
      </table>` : ''}
      <p style="margin:0 0 8px;font-weight:600;">Laptops</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:13px;">
        <tr style="background:#f8fafc;color:#64748b;text-align:left;">
          <th style="padding:6px 8px;">TTSPL</th>
          <th style="padding:6px 8px;">Serial</th>
          <th style="padding:6px 8px;">Configuration</th>
        </tr>
        ${formatLaptopTableRows(laptops)}
      </table>
      <p style="margin:0 0 16px;line-height:1.6;">
        The generated <strong>VRDC PDF is attached</strong> for GST portal entry.
      </p>
      <p style="margin:0 0 20px;padding:12px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#9a3412;">
        Action required: generate the E-Way Bill, then enter the number/date and upload the E-Way Bill image or PDF on this VRDC.
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

  let pdfRel = null;
  try {
    const { generateVendorRepairPdf } = require('./vendorRepairPdfService');
    pdfRel = await generateVendorRepairPdf(dcNumber);
  } catch (pdfErr) {
    console.error('[vrdcEway] VRDC PDF attach failed:', pdfErr.message);
  }
  if (!pdfRel) {
    throw new Error('Could not generate the VRDC PDF to attach for Accounts');
  }
  const pdfRelativePath = `uploads/${String(pdfRel).replace(/^uploads\//, '')}`;

  try {
    const sent = await sendDispatchMail({
      to: ACCOUNTS_EMAIL,
      cc: ACCOUNTS_EMAIL_CC,
      subject: `${dcNumber} : ${vendorName || 'Vendor'} : VRDC E-Way Bill Required`,
      userTriggered,
      text: [
        'Hi Accounts Team,',
        '',
        `VRDC ${dcNumber} for vendor ${vendorName || '—'} requires an E-Way Bill.`,
        `Total declared value: ₹${valueStr} (threshold ₹${thresholdStr}).`,
        ...transport.map(([k, v]) => `${k}: ${v}`),
        ...summary.map((g) => `${g.brand} ${g.model}: ${g.count} laptop(s), ₹${Number(g.value).toLocaleString('en-IN')}`),
        `Laptops (${laptops.length}):`,
        laptopText,
        '',
        'The generated VRDC PDF is attached for GST portal entry.',
        `Open in CRM: ${portalUrl}`,
        '',
        'Please enter the E-Way Bill number/date and upload the E-Way Bill image or PDF on the VRDC page.',
        '',
        'Regards,',
        'Team Rentfoxxy',
      ].join('\n'),
      html,
      pdfRelativePath,
      replyTo: process.env.DISPATCH_SMTP_REPLY_TO || fromAddress,
    });

    if (!sent) {
      throw new Error('Failed to send mail — check DISPATCH_SMTP settings');
    }
  } finally {
    try {
      await purgeLockedVrdcPublicPdf(dcNumber);
    } catch (_) { /* warehouse PDF stays locked until e-way is saved */ }
  }

  console.log(`Accounts VRDC e-way email sent: ${dcNumber} → ${ACCOUNTS_EMAIL} (VRDC PDF attached)`);
  return { sent: true, from: fromAddress, to: ACCOUNTS_EMAIL, cc: ACCOUNTS_EMAIL_CC, pdf_attached: true };
}

/**
 * After a repair challan is signed for dispatch (after COMMIT): at Rs 50,000+
 * the Accounts request goes by itself. A failure is recorded on the challan and
 * the existing "Send to Accounts" button resends. Never throws.
 */
async function autoRequestVrdcEway(dcNumber, { actorUserId = null } = {}) {
  try {
    const svc = require('./vendorRepairDcService');
    const dc = await svc.getVendorRepairDc(dcNumber);
    if (!dc || dc.item_domain === 'part') return { required: false };
    const productValue = await computeVrdcTotalValue(dcNumber);
    if (!requiresVrdcEway(productValue)) return { required: false, product_value: productValue };
    if (dc.accounts_notified_at || dc.eway_bill_number) return { required: true, sent: true, already: true, product_value: productValue };
    try {
      const r = await sendAccountsVrdcEwayEmail({
        dcNumber,
        vendorName: dc.vendor_name,
        productValue,
        laptops: laptopRowsFromItems(dc.items || []),
        summary: summariseRepairByModel(dc.items || []),
        transport: describeRepairTransport(dc),
        userTriggered: true,
      });
      await pool.query(
        `UPDATE vendor_repair_delivery_challans
            SET accounts_notified_at = NOW(), accounts_notified_by = $2,
                eway_auto_mail_at = NOW(), eway_auto_mail_error = NULL, updated_at = NOW()
          WHERE dc_number = $1`,
        [dcNumber, actorUserId || null]
      );
      return { required: true, sent: true, to: r.to, product_value: productValue };
    } catch (err) {
      const message = String(err.message || err).slice(0, 1000);
      await pool.query(
        'UPDATE vendor_repair_delivery_challans SET eway_auto_mail_error = $2 WHERE dc_number = $1',
        [dcNumber, message]
      ).catch(() => {});
      return { required: true, sent: false, error: message, product_value: productValue };
    }
  } catch (err) {
    console.error('[vrdcEway] auto request failed:', err.message);
    return { required: null, sent: false, error: err.message };
  }
}

/** The guard may not let a laptop repair challan out at Rs 50,000+ without the e-way bill. */
async function assertVrdcCanLeaveGate(db, dcNumber) {
  const head = (await db.query(
    `SELECT eway_bill_number, COALESCE(item_domain, 'laptop') AS item_domain
       FROM vendor_repair_delivery_challans WHERE dc_number = $1`,
    [dcNumber]
  )).rows[0];
  if (!head || head.item_domain !== 'laptop') return;
  const total = Number((await db.query(
    'SELECT COALESCE(SUM(price), 0)::float AS t FROM vendor_repair_dc_items WHERE dc_number = $1',
    [dcNumber]
  )).rows[0].t || 0);
  if (!requiresVrdcEway(total) || String(head.eway_bill_number || '').trim()) return;
  const err = new Error(
    `E-way Bill required before this repair challan can leave: declared value ₹${total.toLocaleString('en-IN')}`
    + ` is ₹${EWAY_VALUE_THRESHOLD.toLocaleString('en-IN')} or more. Ask Accounts to add the E-way Bill.`
  );
  err.status = 409;
  throw err;
}

async function saveVrdcEwayBill({ dcNumber, ewayBillNumber, ewayBillDate, ewayBillPdfPath, userId }) {
  const num = normalizeEwayBillNumber(ewayBillNumber);
  if (!num) throw new Error('E-Way Bill number is required');
  const date = ewayBillDate ? String(ewayBillDate).trim() || null : null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('E-way Bill date must be YYYY-MM-DD');
  }

  const total = await computeVrdcTotalValue(dcNumber);
  if (!requiresVrdcEway(total)) {
    throw new Error(`E-Way Bill upload applies only when the VRDC value is ₹${EWAY_VALUE_THRESHOLD.toLocaleString('en-IN')} or more`);
  }

  const existing = await pool.query(
    `SELECT eway_bill_pdf_path FROM vendor_repair_delivery_challans WHERE dc_number = $1`,
    [dcNumber]
  );
  const existingPath = existing.rows[0]?.eway_bill_pdf_path || null;
  if (!ewayBillPdfPath && !existingPath) {
    throw new Error('E-Way Bill document (image or PDF) is required');
  }
  const pdfPath = ewayBillPdfPath || existingPath;

  await pool.query(
    `UPDATE vendor_repair_delivery_challans SET
        eway_bill_number = $2,
        eway_bill_date = $3::date,
        eway_bill_pdf_path = $5,
        eway_bill_uploaded_at = NOW(),
        eway_bill_uploaded_by = $4,
        pdf_path = NULL,
        updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber, num, date, userId || null, pdfPath]
  );

  try {
    const { generateVendorRepairPdf } = require('./vendorRepairPdfService');
    await generateVendorRepairPdf(dcNumber);
  } catch (pdfErr) {
    console.error('[vrdcEway] post-upload PDF generation failed:', pdfErr.message);
  }

  return { eway_bill_number: num, eway_bill_date: date, eway_bill_pdf_path: pdfPath };
}

module.exports = {
  ACCOUNTS_EMAIL,
  buildVrdcEwayCompliance,
  assertCanDownloadVrdcPdf,
  canDownloadVrdcPdf,
  shouldPersistPublicVrdcPdf,
  purgeLockedVrdcPublicPdf,
  computeVrdcTotalValue,
  sendAccountsVrdcEwayEmail,
  autoRequestVrdcEway,
  assertVrdcCanLeaveGate,
  summariseRepairByModel,
  describeRepairTransport,
  saveVrdcEwayBill,
  canUploadVrdcEwayBill,
  laptopRowsFromItems,
  requiresVrdcEway,
  isVrdcEwayComplete,
};
