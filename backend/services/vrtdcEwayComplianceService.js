/**
 * VRTDC (Return to Vendor) E-way Bill compliance.
 *
 * A port of vrdcEwayComplianceService for the return-to-vendor consignment,
 * which had no e-way support at all. Deliberately reuses the VRDC primitives —
 * EWAY_VALUE_THRESHOLD, normalizeEwayBillNumber, requiresVrdcEway — rather than
 * restating the threshold, so there is one number to change if the law does.
 *
 * Shape of the flow, matching VRDC:
 *   1. Warehouse picks laptops and enters the delivery partner + declared values.
 *   2. If the consignment is over the threshold, "Send for E-way Bill" mails
 *      Accounts and stamps accounts_notified_at.
 *   3. Accounts enters the e-way number, date and document.
 *   4. Only then does the gate let the consignment out.
 *
 * Two things are withheld above the threshold until the bill exists — the gate,
 * and the challan PDF. Creating the DC is never blocked: a return is picked and
 * packed before anyone knows the transporter, so blocking creation would stop
 * the warehouse working. But the consignment must not leave, and the paperwork
 * must not circulate, because a challan naming a twelve-lakh consignment with no
 * e-way number on it is exactly the document someone loads a van on the strength
 * of.
 *
 * super_admin keeps a break-glass path to the PDF. Accounts is not given one:
 * the request mail carries the challan to them as an attachment, which is how
 * they raise the bill in the first place.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { sendDispatchMail, isDispatchMailConfigured, getDispatchFromAddress } = require('./dispatchEmailService');
const { escapeHtml } = require('../utils/escapeHtml');
const {
  EWAY_VALUE_THRESHOLD,
  normalizeEwayBillNumber,
  requiresVrdcEway,
} = require('./vendorRepairDcShared');

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

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Total declared value of a VRTDC — always summed from the items, never stored. */
async function computeVrtdcTotalValue(dcNumber, db = pool) {
  const r = await db.query(
    `SELECT COALESCE(SUM(declared_value), 0)::float AS total
       FROM vendor_return_dc_items
      WHERE dc_number = $1 AND COALESCE(item_status, '') <> 'cancelled'`,
    [dcNumber]
  );
  return Number(r.rows[0]?.total || 0);
}

function isVrtdcEwayComplete(head, needsEway) {
  if (!needsEway) return true;
  return Boolean(String(head?.eway_bill_number || '').trim());
}

/** Accounts / dc_eway_bill holders — the same gate VRDC and sale DCs use. */
async function canUploadVrtdcEwayBill(user, permissionCache = {}) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const { hasPermission } = require('./permissionService');
  return (await hasPermission(user.user_id, user.role, 'dc_eway_bill', 'can_edit', permissionCache))
    || (await hasPermission(user.user_id, user.role, 'dc_eway_bill', 'can_create', permissionCache));
}

const REQUESTER_ROLES = new Set([
  'super_admin', 'admin', 'manager', 'warehouse', 'floor_manager', 'dispatch', 'procurement',
]);

/**
 * Compliance state for one VRTDC, for the UI and for the gate check.
 *
 * `items` may be passed when the caller already has them, to save a query.
 */
async function buildVrtdcEwayCompliance(head, items, user, permissionCache = {}) {
  const productValue = Array.isArray(items)
    ? items.reduce((sum, row) => {
      const v = Number(row.declared_value);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0)
    : await computeVrtdcTotalValue(head.dc_number);

  const needsEway = requiresVrdcEway(productValue);
  const ewayComplete = isVrtdcEwayComplete(head, needsEway);
  const isSuperAdmin = user?.role === 'super_admin';
  const canUpload = isSuperAdmin || await canUploadVrtdcEwayBill(user, permissionCache);
  const valued = Array.isArray(items)
    ? items.filter((r) => Number.isFinite(Number(r.declared_value))).length
    : null;
  const missingValues = Array.isArray(items) ? items.length - valued : null;

  return {
    applies: needsEway,
    requires_eway_bill: needsEway,
    eway_threshold: EWAY_VALUE_THRESHOLD,
    product_value: productValue,
    laptop_count: Array.isArray(items) ? items.length : null,
    items_missing_value: missingValues,
    eway_complete: ewayComplete,
    eway_status: !needsEway ? 'not_required' : (ewayComplete ? 'uploaded' : 'pending'),
    can_dispatch_out: !needsEway || ewayComplete,
    // The challan is also withheld while a bill is required and missing. A
    // document that names a Rs 12.6 lakh consignment and carries no e-way
    // number is the one thing that must not be circulating — someone will load
    // the van on the strength of it. super_admin keeps a break-glass path;
    // Accounts does not need one, because the request mail delivers the challan
    // to them as an attachment.
    can_download_pdf: !needsEway || ewayComplete || isSuperAdmin,
    can_upload_eway: canUpload,
    can_request_eway: isSuperAdmin || REQUESTER_ROLES.has(String(user?.role || '')),
    request_sent: Boolean(head?.accounts_notified_at),
    accounts_notified_at: head?.accounts_notified_at || null,
    accounts_email: ACCOUNTS_EMAIL,
    dispatch_mail_configured: isDispatchMailConfigured(),
    dispatch_mail_from: getDispatchFromAddress(),
    eway_bill_number: head?.eway_bill_number || null,
    eway_bill_date: head?.eway_bill_date || null,
    eway_bill_pdf_path: head?.eway_bill_pdf_path || null,
    eway_bill_uploaded_at: head?.eway_bill_uploaded_at || null,
    lock_message: needsEway && !ewayComplete
      ? (canUpload
        ? `Consignment is ${money(productValue)}, above the ${money(EWAY_VALUE_THRESHOLD)} threshold. Enter the E-way Bill below to release it to the gate.`
        : `Consignment is ${money(productValue)}. The gate cannot release it until Accounts adds the E-way Bill.`)
      : null,
  };
}

/**
 * Throws if the challan must not be handed out yet.
 *
 * Separate from the gate check because they answer different questions: the
 * gate asks "may this leave", this asks "may anyone hold the paperwork". Both
 * are open once the bill exists.
 */
async function assertVrtdcPdfDownloadable(dcNumber, user, db = pool) {
  if (user?.role === 'super_admin') return { ok: true, override: 'super_admin' };
  const r = await db.query(
    `SELECT eway_bill_number FROM vendor_return_delivery_challans WHERE dc_number = $1`,
    [dcNumber]
  );
  const head = r.rows[0];
  if (!head) throw new Error('Return DC not found');
  const total = await computeVrtdcTotalValue(dcNumber, db);
  if (!requiresVrdcEway(total)) return { ok: true, required: false };
  if (isVrtdcEwayComplete(head, true)) return { ok: true, required: true };
  const err = new Error(
    `This challan is locked: declared value ${money(total)} is above ${money(EWAY_VALUE_THRESHOLD)}`
    + ' and no E-way Bill has been recorded yet. Accounts must add the E-way Bill number,'
    + ' date and document before the challan can be downloaded.'
  );
  err.status = 423; // Locked
  throw err;
}

/** Throws if this consignment must not leave the gate yet. */
async function assertVrtdcCanLeaveGate(dcNumber, db = pool) {
  const r = await db.query(
    `SELECT eway_bill_number FROM vendor_return_delivery_challans WHERE dc_number = $1`,
    [dcNumber]
  );
  const head = r.rows[0];
  if (!head) throw new Error('Return DC not found');
  const total = await computeVrtdcTotalValue(dcNumber, db);
  if (!requiresVrdcEway(total)) return { ok: true, total, required: false };
  if (isVrtdcEwayComplete(head, true)) return { ok: true, total, required: true };
  const err = new Error(
    `E-way Bill required before this consignment can leave: declared value ${money(total)}`
    + ` is above ${money(EWAY_VALUE_THRESHOLD)}. Ask Accounts to add the E-way Bill.`
  );
  err.status = 409;
  throw err;
}

function laptopRowsFromItems(items = []) {
  return items.map((row) => ({
    ttspl: row.ttspl_id || '—',
    serial: row.serial_number || '—',
    config: row.configuration || '—',
    value: row.declared_value,
  }));
}

function laptopTableRows(laptops = []) {
  if (!laptops.length) {
    return '<tr><td colspan="4" style="padding:8px 0;color:#64748b;">No laptops listed</td></tr>';
  }
  return laptops.map((row) => (
    `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-family:monospace;">${escapeHtml(row.ttspl)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-family:monospace;">${escapeHtml(row.serial)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(row.config)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${escapeHtml(row.value == null ? '—' : money(row.value))}</td>
    </tr>`
  )).join('');
}

/** Human label for the delivery partner block in the Accounts mail. */
function describeTransport(head) {
  const shipBy = String(head?.ship_by || '').toLowerCase();
  const rows = [];
  if (shipBy === 'by_courier') {
    rows.push(['Mode', 'Courier']);
    if (head.courier_name) rows.push(['Courier', head.courier_name]);
    if (head.awb_number) rows.push(['AWB', head.awb_number]);
  } else if (shipBy === 'by_porter') {
    rows.push(['Mode', 'Porter']);
    if (head.porter_tracking_id) rows.push(['Porter tracking', head.porter_tracking_id]);
  } else if (shipBy === 'by_hand') {
    rows.push(['Mode', 'In-house delivery']);
    if (head.delivery_person_name) rows.push(['Delivery person', head.delivery_person_name]);
    if (head.delivery_person_phone) rows.push(['Phone', head.delivery_person_phone]);
  } else if (shipBy === 'by_vendor_pickup') {
    rows.push(['Mode', 'Vendor pickup']);
    if (head.vendor_pickup_person) rows.push(['Pickup person', head.vendor_pickup_person]);
    if (head.vendor_pickup_mobile) rows.push(['Phone', head.vendor_pickup_mobile]);
  } else {
    rows.push(['Mode', shipBy || 'Not set']);
  }
  if (head.vehicle_number) rows.push(['Vehicle number', head.vehicle_number]);
  return rows;
}

/**
 * Mail Accounts asking for the E-way Bill, and stamp the request on the DC.
 *
 * Everything the GST portal needs is in the body — vendor, transport, per-laptop
 * value and the total — because Accounts raises the bill on the portal, not here.
 */
async function sendAccountsVrtdcEwayEmail({ dcNumber, head, items = [], actorUserId = null }) {
  const laptops = laptopRowsFromItems(items);
  const productValue = items.reduce((s, r) => s + (Number.isFinite(Number(r.declared_value)) ? Number(r.declared_value) : 0), 0);
  const vendorName = head.vendor_name || head.vendor_business_name || 'Vendor';
  const portalUrl = `${FRONTEND_URL}/vendor-management/return-to-vendor/${encodeURIComponent(dcNumber)}`;
  const transport = describeTransport(head);

  const transportRows = transport
    .map(([k, v]) => `<tr><td style="padding:3px 10px 3px 0;color:#64748b;">${escapeHtml(k)}</td><td style="padding:3px 0;font-weight:600;">${escapeHtml(v)}</td></tr>`)
    .join('');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;">
      <p>E-way Bill required for a <strong>Return to Vendor</strong> consignment.</p>
      <table style="border-collapse:collapse;margin:12px 0;">
        <tr><td style="padding:3px 10px 3px 0;color:#64748b;">Return DC</td><td style="padding:3px 0;font-weight:600;font-family:monospace;">${escapeHtml(dcNumber)}</td></tr>
        <tr><td style="padding:3px 10px 3px 0;color:#64748b;">Vendor</td><td style="padding:3px 0;font-weight:600;">${escapeHtml(vendorName)}</td></tr>
        <tr><td style="padding:3px 10px 3px 0;color:#64748b;">Laptops</td><td style="padding:3px 0;font-weight:600;">${laptops.length}</td></tr>
        <tr><td style="padding:3px 10px 3px 0;color:#64748b;">Declared value</td><td style="padding:3px 0;font-weight:600;">${escapeHtml(money(productValue))}</td></tr>
        ${transportRows}
      </table>
      <p style="margin:14px 0 6px;font-weight:600;">Ship to</p>
      <p style="margin:0;white-space:pre-line;color:#334155;">${escapeHtml(head.shipping_address || head.vendor_address || '—')}</p>
      <p style="margin:16px 0 6px;font-weight:600;">Laptops in this consignment</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead><tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #cbd5e1;">TTSPL</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #cbd5e1;">Serial</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #cbd5e1;">Configuration</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #cbd5e1;">Value</th>
        </tr></thead>
        <tbody>${laptopTableRows(laptops)}</tbody>
      </table>
      <p style="margin:18px 0 6px;"><strong>Action required:</strong> raise the E-way Bill and enter the number, date and document in the CRM. The consignment cannot leave the gate until then.</p>
      <p style="margin:0;"><a href="${portalUrl}">${portalUrl}</a></p>
      <p style="margin:18px 0 0;color:#64748b;">Regards,<br/>Team Rentfoxxy</p>
    </div>`;

  const text = [
    `E-way Bill required for Return to Vendor ${dcNumber}`,
    `Vendor: ${vendorName}`,
    `Laptops: ${laptops.length}`,
    `Declared value: ${money(productValue)}`,
    ...transport.map(([k, v]) => `${k}: ${v}`),
    '',
    'Action required: raise the E-way Bill and enter it in the CRM.',
    'The consignment cannot leave the gate until then.',
    portalUrl,
    '',
    'Regards,',
    'Team Rentfoxxy',
  ].join('\n');

  // Accounts raises the bill off the challan, so the PDF has to travel with the
  // request. Generated fresh rather than reusing a stored path: the laptops and
  // their declared values are usually set minutes before this is sent, and a
  // stale PDF would show the wrong consignment value.
  //
  // Hard-fail if it cannot be produced. sendDispatchMail drops a missing
  // attachment silently and still reports success, so without this check the
  // request would arrive with no challan and nobody would know until Accounts
  // asked for it.
  let pdfRel = null;
  try {
    const { generateVendorReturnDcPdf } = require('./vendorReturnToVendorPdfService');
    pdfRel = await generateVendorReturnDcPdf(dcNumber);
  } catch (pdfErr) {
    console.error('[vrtdcEway] VRTDC PDF generation failed:', pdfErr.message);
  }
  if (!pdfRel) {
    throw new Error('Could not generate the Return DC PDF to attach for Accounts');
  }
  const pdfRelativePath = `uploads/${String(pdfRel).replace(/^uploads\//, '')}`;
  const pdfAbs = path.join(__dirname, '..', pdfRelativePath);
  if (!fs.existsSync(pdfAbs)) {
    throw new Error(`Return DC PDF is missing at ${pdfRelativePath} — not sending a request without the challan`);
  }

  const sent = await sendDispatchMail({
    to: ACCOUNTS_EMAIL,
    cc: ACCOUNTS_EMAIL_CC,
    subject: `${dcNumber} : ${vendorName} : E-way Bill required (${money(productValue)})`,
    html,
    text,
    pdfRelativePath,
  });
  if (!sent) throw new Error('Failed to send mail — check DISPATCH_SMTP settings');

  await pool.query(
    `UPDATE vendor_return_delivery_challans
        SET accounts_notified_at = NOW(), accounts_notified_by = $2, updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber, actorUserId || null]
  );

  return { sent: true, to: ACCOUNTS_EMAIL, cc: ACCOUNTS_EMAIL_CC, product_value: productValue };
}

/** Accounts records the E-way Bill. Regenerates the PDF so it carries the number. */
async function saveVrtdcEwayBill({ dcNumber, ewayBillNumber, ewayBillDate, ewayBillPdfPath, userId }) {
  const num = normalizeEwayBillNumber(ewayBillNumber);
  if (!num) throw new Error('E-Way Bill number is required');
  const date = ewayBillDate ? String(ewayBillDate).trim() || null : null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('E-way Bill date must be YYYY-MM-DD');
  }

  const total = await computeVrtdcTotalValue(dcNumber);
  if (!requiresVrdcEway(total)) {
    throw new Error(
      `E-Way Bill applies only above ${money(EWAY_VALUE_THRESHOLD)} — this consignment is declared at ${money(total)}.`
      + ' Enter the declared values on the laptops first if that looks wrong.'
    );
  }

  const existing = await pool.query(
    `SELECT eway_bill_pdf_path FROM vendor_return_delivery_challans WHERE dc_number = $1`,
    [dcNumber]
  );
  if (!existing.rows.length) throw new Error('Return DC not found');
  const pdfPath = ewayBillPdfPath || existing.rows[0]?.eway_bill_pdf_path || null;
  if (!pdfPath) throw new Error('E-Way Bill document (image or PDF) is required');

  await pool.query(
    `UPDATE vendor_return_delivery_challans SET
        eway_bill_number = $2,
        eway_bill_date = $3::date,
        eway_bill_pdf_path = $4,
        eway_bill_uploaded_at = NOW(),
        eway_bill_uploaded_by = $5,
        updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber, num, date, pdfPath, userId || null]
  );

  try {
    const { generateVendorReturnDcPdf } = require('./vendorReturnToVendorPdfService');
    await generateVendorReturnDcPdf(dcNumber);
  } catch (pdfErr) {
    // The bill is recorded either way; a stale PDF must not fail the save.
    console.error('[vrtdcEway] post-upload PDF regeneration failed:', pdfErr.message);
  }

  return { eway_bill_number: num, eway_bill_date: date, eway_bill_pdf_path: pdfPath };
}

/** Persist per-laptop declared values entered at dispatch. */
async function saveDeclaredValues(db, dcNumber, values = {}) {
  const entries = Object.entries(values || {});
  if (!entries.length) return 0;
  let updated = 0;
  for (const [serialId, raw] of entries) {
    const id = Number(serialId);
    if (!Number.isFinite(id)) continue;
    const v = raw === '' || raw == null ? null : Number(raw);
    if (v != null && (!Number.isFinite(v) || v < 0)) {
      throw new Error(`Declared value for serial ${id} must be a number of 0 or more`);
    }
    const r = await db.query(
      `UPDATE vendor_return_dc_items
          SET declared_value = $3
        WHERE dc_number = $1 AND serial_id = $2`,
      [dcNumber, id, v]
    );
    updated += r.rowCount;
  }
  return updated;
}

module.exports = {
  ACCOUNTS_EMAIL,
  EWAY_VALUE_THRESHOLD,
  computeVrtdcTotalValue,
  isVrtdcEwayComplete,
  buildVrtdcEwayCompliance,
  assertVrtdcCanLeaveGate,
  assertVrtdcPdfDownloadable,
  canUploadVrtdcEwayBill,
  sendAccountsVrtdcEwayEmail,
  saveVrtdcEwayBill,
  saveDeclaredValues,
  laptopRowsFromItems,
  requiresVrtdcEway: requiresVrdcEway,
};
