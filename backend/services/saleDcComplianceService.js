/**
 * Sale delivery challan compliance — e-invoice upload, conditional e-way bill (>= threshold).
 * New-customer Demo DCs use a separate e-way-only lock (see requiresDemoEwayCompliance).
 * A new customer's first DC is covered too; their later rental DCs are unaffected.
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
  assetValue = null,
  billedValue = null,
  assetUnits = [],
} = {}) {
  const billed = Number(billedValue ?? totals?.subtotal ?? totals?.grand_total ?? 0);
  const productValue = Number(assetValue ?? billed);
  const needsEway = requiresOutboundEway(head, productValue)
    || requiresDemoEwayCompliance(head?.quotation_type, isFirstCustomerOrder, productValue);
  const ewayComplete = isEwayComplete(head, needsEway);
  const isSuperAdmin = userRole === 'super_admin';
  const requested = Boolean(head?.accounts_notified_at);

  return {
    applies: needsEway,
    is_demo_dc: isDemoDc(head?.quotation_type),
    is_first_customer_order: Boolean(isFirstCustomerOrder),
    requires_eway_bill: needsEway,
    eway_threshold: EWAY_VALUE_THRESHOLD,
    product_value: productValue,
    asset_value: productValue,
    billed_value: billed,
    value_basis: 'processor_generation_matrix',
    asset_units: assetUnits,
    eway_complete: ewayComplete,
    eway_status: !needsEway ? 'not_required' : (ewayComplete ? 'uploaded' : 'pending'),
    can_download_pdf: isSuperAdmin || canUpload || !needsEway || ewayComplete,
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
    ship_by: head?.ship_by || null,
    dispatch_mode: head?.dispatch_mode || null,
    vehicle_number: head?.vehicle_number || null,
    requires_vehicle_number: requiresVehicleNumber(head, needsEway),
    vehicle_number_missing: requiresVehicleNumber(head, needsEway)
      && !normalizeVehicleNumber(head?.vehicle_number),
    lock_message: needsEway && !ewayComplete && !(isSuperAdmin || canUpload)
      ? 'E-Way Bill is required for this DC. Accounts must add the E-Way Bill before download or dispatch.'
      : (needsEway && !ewayComplete && (isSuperAdmin || canUpload)
        ? 'Download the DC PDF if needed for the GST portal, then enter the E-Way Bill below to unlock the DC for dispatch.'
        : null),
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
 * A repair/service return: the customer's own machine going back to them after
 * work on it. Nothing is sold, so there is no supply to raise an e-invoice for —
 * only the e-way bill, which still applies on value like any other movement.
 */
function isServiceReturnDc(dcPurpose) {
  return String(dcPurpose || '').toLowerCase() === 'service_return';
}

/**
 * First live sales order for this customer (new-customer 1st order).
 * Cancelled SOs are ignored. Used only for demo e-way, not e-invoice.
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

/**
 * Customer's first-ever billable outbound DC (cancelled / return / service DCs
 * ignored).
 *
 * Demo DCs are excluded from the candidate set, not just from the answer. A demo
 * shipment used to occupy the first-DC slot, so a customer who demoed before they
 * rented had their real opening rental DC classified as a later DC — which meant
 * requiresInvoiceCompliance() returned false, Accounts was never asked for the
 * e-invoice, and the DC was never locked. Five customers reached production that
 * way (BILLPLAN, Indigenesis, KHUSHI HOUSING, MEDIOTIX, SPNN).
 *
 * A demo is not a billable order, so the first rental order is the customer's
 * first order and its first DC is the one that must be invoiced and locked.
 */
async function isNewCustomerFirstDc(db, customerId, dcNumber) {
  if (!customerId || !dcNumber) return false;
  const first = await db.query(
    `SELECT dcl.dc_number
       FROM delivery_challan_lines dcl
       LEFT JOIN sales_order_lines sol
              ON sol.sales_order_number = dcl.sales_order_number
       LEFT JOIN sales_quotations sq
              ON sq.quotation_number = dcl.quotation_number
      WHERE dcl.customer_id = $1
        AND COALESCE(dcl.movement_type, 'outbound') = 'outbound'
        AND LOWER(COALESCE(dcl.status, '')) NOT IN ('cancelled')
        AND (
          dcl.dc_number ILIKE 'DC/%'
          OR dcl.dc_number ILIKE 'DC-%'
          OR dcl.dc_number ILIKE 'GDC%'
        )
      GROUP BY dcl.dc_number
     HAVING LOWER(COALESCE(
              MIN(sol.quotation_type), MIN(sq.quotation_type), 'rental')) <> 'demo'
      ORDER BY MIN(dcl.created_at) ASC NULLS LAST, dcl.dc_number ASC
      LIMIT 1`,
    [customerId]
  );
  return first.rows[0]?.dc_number === dcNumber;
}

/**
 * E-invoice / Accounts mail applies to every sale DC, and to a new customer's
 * first-ever DC whatever the order type — a rental customer's opening shipment
 * still needs an invoice before it leaves. Their *later* DCs do not, which is why
 * this keys off the first DC (isNewCustomerFirstDc) and not the first SO.
 * Demo DCs are excluded: they use the e-way-only path.
 */
function requiresInvoiceCompliance(entityCode, quotationType, isFirstDc = false, dcPurpose = null) {
  if (isDemoDc(quotationType)) return false;
  // A service return is not a supply. TTSPL5286 is a gorefurbo unit the customer
  // already owns; it came in on a support ticket and went back out on
  // SDC/26-27/0011, and isSaleDc() saw entity_code 'gorefurbo' and demanded an
  // e-invoice for a laptop nobody was selling. The e-way bill is unaffected —
  // requiresOutboundEway() still applies it above the value threshold.
  if (isServiceReturnDc(dcPurpose)) return false;
  return isSaleDc(entityCode, quotationType) || Boolean(isFirstDc);
}

function requiresDemoEwayCompliance(quotationType, isFirstOrder, productValue) {
  return isDemoDc(quotationType) && Boolean(isFirstOrder) && requiresEwayBill(productValue);
}

/** Any outbound DC whose laptop value (ex. GST) reaches the e-way threshold. */
function requiresOutboundEway(head, productValue) {
  const movement = String(head?.movement_type || 'outbound').toLowerCase();
  if (movement === 'return') return false;
  if (String(head?.status || '').toLowerCase() === 'cancelled') return false;
  return requiresEwayBill(productValue);
}

/** Accounts / super_admin / dc_eway_bill — same gate as VRDC e-way upload. */
async function canUploadDcValueEway(user, permissionCache = {}) {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'accounts') return true;
  const { hasPermission } = require('./permissionService');
  return (await hasPermission(user.user_id, user.role, 'dc_eway_bill', 'can_edit', permissionCache))
    || (await hasPermission(user.user_id, user.role, 'dc_eway_bill', 'can_create', permissionCache));
}

async function canViewEwayLockedDc(user, permissionCache = {}) {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'accounts') return true;
  if (await canUploadDcValueEway(user, permissionCache)) return true;
  const { hasPermission } = require('./permissionService');
  return hasPermission(user.user_id, user.role, 'dc_eway_bill', 'can_view', permissionCache);
}

// Once a DC has left the warehouse, or is rejected/cancelled, a fresh e-invoice /
// e-way request only confuses Accounts. Mirrors isAccountsMailBlocked in the frontend.
const ACCOUNTS_MAIL_BLOCKED_STATUSES = new Set([
  'in_transit', 'shipped', 'reached', 'delivered', 'rejected', 'cancelled',
]);

/** Reason string if any line of the DC is in a status that must not mail Accounts, else null. */
function accountsMailBlockedReason(lines = []) {
  const blocked = [...new Set(lines.map((l) => String(l.status || '').toLowerCase()))]
    .filter((s) => ACCOUNTS_MAIL_BLOCKED_STATUSES.has(s));
  if (!blocked.length) return null;
  return `Mail to Accounts is not sent for a DC that is ${blocked.map((s) => s.replace(/_/g, ' ')).join('/')}.`;
}

/**
 * Inclusive of the threshold: a consignment valued at exactly ₹50,000 needs an
 * e-way bill. DC/26-27/1342 (2 × i5 11th Gen at ₹25,000) landed on the boundary
 * and shipped unlocked while the value was strictly compared.
 */
function requiresEwayBill(grandTotal) {
  return Number(grandTotal) >= EWAY_VALUE_THRESHOLD;
}

/**
 * Dispatches where we move the goods ourselves. The e-way bill's Part B needs the
 * vehicle number for these; a courier/BlueDart consignment carries the AWB instead.
 */
function isOwnVehicleDispatch(shipBy, dispatchMode) {
  const s = String(shipBy || '').toLowerCase();
  const d = String(dispatchMode || '').toLowerCase();
  return s === 'by_hand' || s === 'by_porter' || d === 'inhouse' || d === 'porter';
}

/** Vehicle number is mandatory once an e-way bill is due and we carry the goods. */
function requiresVehicleNumber(head, needsEway) {
  if (!needsEway) return false;
  return isOwnVehicleDispatch(head?.ship_by, head?.dispatch_mode);
}

/**
 * Declared asset value for serials that are not on a DC yet (DC-create validation).
 * Same processor + generation matrix the DC e-way check uses.
 */
async function assetValueForSerialIds(db, serialIds = []) {
  const ids = [...new Set(serialIds.map((n) => Number(n)).filter((n) => n > 0))];
  if (!ids.length) return 0;
  const { lookupDeclaredValueForUnit } = require('../constants/bluedartDeclaredValue');
  const { rows } = await db.query(
    `SELECT extra->>'processor' AS processor,
            extra->>'generation' AS generation,
            COALESCE(extra->>'model', extra->>'model_name') AS model_name
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL AND serial_id = ANY($1::int[])`,
    [ids]
  );
  let total = 0;
  for (const row of rows) {
    const amount = await lookupDeclaredValueForUnit(row.processor, row.generation, row.model_name);
    if (amount != null && Number(amount) > 0) total += Number(amount);
  }
  return +total.toFixed(2);
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
  assetValue = null,
} = {}) {
  const productValue = Number(totals?.subtotal ?? totals?.grand_total ?? 0);
  const ewayValue = Number(assetValue ?? productValue);
  const needsEway = requiresEwayBill(ewayValue);
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
    asset_value: ewayValue,
    billed_value: productValue,
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

function parseDcSerialEntries(raw) {
  if (!raw) return [];
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.filter(Boolean).map((entry) => {
    const parts = String(entry).split('|');
    const serialId = /^\d+$/.test(parts[0]) ? parseInt(parts[0], 10) : null;
    return {
      serialId,
      serialNumber: parts[1] || parts[0] || null,
      ttsplId: parts[2] || null,
    };
  });
}

/**
 * E-way / BlueDart asset value per laptop from the processor + generation matrix.
 * Rental billed amount is ignored — GST portal needs laptop value, not rent.
 */
async function collectDcAssetUnits(dcNumber, lines = null) {
  const pool = require('../config/db');
  const { lookupDeclaredValueForUnit } = require('../constants/bluedartDeclaredValue');
  const dcLines = lines && lines.length ? lines : await getDeliveryChallanLines(dcNumber);
  const units = [];

  for (const line of dcLines) {
    const details = Array.isArray(line.serials_detail) ? line.serials_detail : [];
    if (details.length) {
      for (const d of details) {
        const processor = d.processor || line.processor || '';
        const generation = d.generation || line.generation || '';
        const model = d.model || d.model_name || line.model_name || '';
        const amount = await lookupDeclaredValueForUnit(processor, generation, model);
        units.push({
          ttspl: d.ttspl || d.inventory_asset_code || null,
          serial: d.serial_number || d.serial || null,
          brand: d.brand || line.brand || '',
          model,
          processor,
          generation,
          config: [d.brand || line.brand, model, processor, generation].filter(Boolean).join(' · '),
          asset_value: amount,
        });
      }
      continue;
    }

    const serials = parseDcSerialEntries(line.serial_number);
    if (serials.length) {
      const ids = serials.map((s) => s.serialId).filter(Boolean);
      const nums = serials.flatMap((s) => [s.serialNumber, s.ttsplId].filter(Boolean));
      let specRows = [];
      if (ids.length || nums.length) {
        const r = await pool.query(
          `SELECT serial_id, serial_number, inventory_asset_code,
                  extra->>'processor' AS processor,
                  extra->>'generation' AS generation,
                  extra->>'brand' AS brand,
                  COALESCE(extra->>'model', extra->>'model_name') AS model_name
             FROM vendor_serial_numbers
            WHERE deleted_at IS NULL
              AND (serial_id = ANY($1::int[])
                   OR serial_number = ANY($2::text[])
                   OR inventory_asset_code = ANY($2::text[]))`,
          [ids.length ? ids : [-1], nums.length ? nums : ['']]
        );
        specRows = r.rows;
      }
      for (const s of serials) {
        const spec = specRows.find((x) =>
          (s.serialId && x.serial_id === s.serialId)
          || (s.serialNumber && x.serial_number === s.serialNumber)
          || (s.ttsplId && x.inventory_asset_code === s.ttsplId)
        ) || {};
        const processor = spec.processor || line.processor || '';
        const generation = spec.generation || line.generation || '';
        const model = spec.model_name || line.model_name || '';
        const amount = await lookupDeclaredValueForUnit(processor, generation, model);
        units.push({
          ttspl: spec.inventory_asset_code || s.ttsplId || null,
          serial: spec.serial_number || s.serialNumber || null,
          brand: spec.brand || line.brand || '',
          model,
          processor,
          generation,
          config: [spec.brand || line.brand, model, processor, generation].filter(Boolean).join(' · '),
          asset_value: amount,
        });
      }
      continue;
    }

    const qty = Math.max(1, Number(line.quantity || line.main_qty || 1) || 1);
    for (let i = 0; i < qty; i += 1) {
      const processor = line.processor || '';
      const generation = line.generation || '';
      const model = line.model_name || '';
      const amount = await lookupDeclaredValueForUnit(processor, generation, model);
      units.push({
        ttspl: null,
        serial: null,
        brand: line.brand || '',
        model,
        processor,
        generation,
        config: [line.brand, model, processor, generation].filter(Boolean).join(' · '),
        asset_value: amount,
      });
    }
  }
  return units;
}

async function computeDcAssetValue(dcNumber, lines = null) {
  const units = await collectDcAssetUnits(dcNumber, lines);
  const matched = units.filter((u) => u.asset_value != null && Number(u.asset_value) > 0);
  const total = matched.reduce((sum, u) => sum + Number(u.asset_value), 0);
  if (matched.length) {
    return {
      total: +total.toFixed(2),
      units,
      matched: matched.length,
      unmatched: units.length - matched.length,
      fallback_billed: false,
    };
  }
  const billed = await computeDcProductValue(dcNumber);
  return {
    total: billed,
    units,
    matched: 0,
    unmatched: units.length,
    fallback_billed: true,
  };
}

/** E-way uses asset (processor + generation) value, not rental billed amount. */
async function computeDcGrandTotal(dcNumber) {
  const { total } = await computeDcAssetValue(dcNumber);
  return total;
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
  const firstDc = await isNewCustomerFirstDc(pool, head.customer_id, dcNumber);
  const grandTotal = await computeDcGrandTotal(dcNumber);

  if (requiresOutboundEway({ ...head, quotation_type: quotationType }, grandTotal)
    || requiresDemoEwayCompliance(quotationType, firstOrder, grandTotal)) {
    const cache = {};
    if (isEwayComplete(head, true)) {
      // fall through to sale e-invoice lock if any
    } else if (user?.role === 'super_admin' || await canUploadDcValueEway(user, cache)) {
      return;
    } else {
      throw new Error(
        `E-Way Bill must be uploaded before downloading this DC PDF (value ₹${Number(grandTotal).toLocaleString('en-IN')})`
      );
    }
  }

  if (!requiresInvoiceCompliance(head.entity_code, quotationType, firstDc, head.dc_purpose)) return;
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
  needsVehicle = false,
  vehicleNumber = null,
}) {
  const vehicleRow = needsVehicle
    ? `<tr><td style="padding:8px 0;color:#64748b;">Vehicle number</td><td style="padding:8px 0;font-weight:600;">${vehicleNumber
      ? escapeHtml(vehicleNumber)
      : '<span style="color:#b45309;">Not captured</span>'}</td></tr>`
    : '';
  const ewayBlock = needsEway
    ? `<p style="margin:0 0 12px;padding:12px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#9a3412;">
         DC laptop value is ₹${EWAY_VALUE_THRESHOLD.toLocaleString('en-IN')} or more
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
        ${vehicleRow}
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
  shipBy = null,
  dispatchMode = null,
  vehicleNumber = null,
  userTriggered = false,
}) {
  if (!isDispatchMailConfigured()) {
    throw new Error(
      'Dispatch mail is not configured. Set DISPATCH_SMTP_HOST, DISPATCH_SMTP_USER, DISPATCH_SMTP_PASS, and DISPATCH_SMTP_FROM in backend/.env'
    );
  }

  const value = Number(productValue ?? grandTotal ?? 0);
  const needsEway = requiresEwayBill(value);
  // Porter / inhouse: Accounts needs the vehicle for E-Way Bill Part B.
  const needsVehicle = isOwnVehicleDispatch(shipBy, dispatchMode);
  const vehicle = normalizeVehicleNumber(vehicleNumber) || null;
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
    needsVehicle,
    vehicleNumber: vehicle,
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
    needsVehicle ? `Vehicle number: ${vehicle || 'not captured'}` : '',
    '',
    needsEway
      ? `DC laptop value is ₹${EWAY_VALUE_THRESHOLD.toLocaleString('en-IN')} or more — e-way bill is mandatory. Please upload the waybill also.`
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
    userTriggered,
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
  if (!laptops.length) return '<tr><td colspan="5" style="padding:8px 0;color:#64748b;">No laptops listed</td></tr>';
  return laptops.map((row) => {
    const unitVal = row.asset_value != null ? `₹${Number(row.asset_value).toLocaleString('en-IN')}` : '—';
    return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-family:monospace;">${escapeHtml(row.ttspl || '—')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-family:monospace;">${escapeHtml(row.serial || '—')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(row.processor || '—')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(row.generation || '—')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;">${escapeHtml(unitVal)}</td>
    </tr>`;
  }).join('');
}

async function sendAccountsDemoEwayEmail({
  dcNumber,
  salesOrderNumber,
  customerName,
  productValue,
  billedValue = null,
  laptops = [],
  pdfPath = null,
  vehicleNumber = null,
  needsVehicle = false,
  userTriggered = false,
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
  const billedStr = billedValue != null ? Number(billedValue).toLocaleString('en-IN') : null;
  const laptopText = laptops.length
    ? laptops.map((row) => {
      const unitVal = row.asset_value != null ? `₹${Number(row.asset_value).toLocaleString('en-IN')}` : '—';
      return `  ${row.ttspl || '—'} / ${row.serial || '—'} — ${row.processor || '—'} / ${row.generation || '—'} — ${unitVal}`;
    }).join('\n')
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
        A delivery challan has <strong>asset value</strong> of ₹${escapeHtml(thresholdStr)} or more
        (processor + generation matrix — not rental charges) and needs an E-Way Bill.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;">
        <tr><td style="padding:8px 0;color:#64748b;width:180px;">Customer</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(customerName || '—')}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Sales Order</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(salesOrderNumber || '—')}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Delivery Challan</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(dcNumber)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Asset / E-Way Value</td><td style="padding:8px 0;font-weight:700;">₹${escapeHtml(valueStr)}</td></tr>
        ${billedStr ? `<tr><td style="padding:8px 0;color:#64748b;">Rental / billed amount</td><td style="padding:8px 0;">₹${escapeHtml(billedStr)} <span style="color:#64748b;">(not used for E-Way)</span></td></tr>` : ''}
        ${needsVehicle ? `<tr><td style="padding:8px 0;color:#64748b;">Vehicle number</td><td style="padding:8px 0;font-weight:600;">${vehicleNumber
          ? escapeHtml(vehicleNumber)
          : '<span style="color:#9a3412;">Not captured — dispatch must add it before Part B</span>'}</td></tr>` : ''}
      </table>
      <p style="margin:0 0 8px;font-weight:600;">Laptops — use these values on the GST portal</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:13px;">
        <tr style="background:#f8fafc;color:#64748b;text-align:left;">
          <th style="padding:6px 8px;">TTSPL</th>
          <th style="padding:6px 8px;">Serial</th>
          <th style="padding:6px 8px;">Processor</th>
          <th style="padding:6px 8px;">Generation</th>
          <th style="padding:6px 8px;text-align:right;">Asset value</th>
        </tr>
        ${formatDemoLaptopRows(laptops)}
      </table>
      ${pdfPath ? `<p style="margin:0 0 16px;line-height:1.6;">The generated <strong>DC PDF is attached</strong> for GST portal entry.</p>` : ''}
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
    'A delivery challan needs an E-Way Bill before DC download.',
    '',
    `Customer: ${customerName || '—'}`,
    `Sales Order: ${salesOrderNumber || '—'}`,
    `Delivery Challan: ${dcNumber}`,
    `Asset / E-Way value (processor + generation): ₹${valueStr}`,
    billedStr ? `Rental / billed amount (not used for E-Way): ₹${billedStr}` : '',
    needsVehicle
      ? `Vehicle number: ${vehicleNumber || 'not captured — dispatch must add it before Part B'}`
      : '',
    '',
    'Laptops:',
    laptopText,
    '',
    pdfPath ? 'The generated DC PDF is attached for GST portal entry.' : '',
    'Action required: Upload E-Way Bill (number, date, and document).',
    portalUrl,
    '',
    'Regards,',
    'Team Rentfoxxy',
  ].join('\n');

  const pdfRelativePath = pdfPath
    ? `uploads/${String(pdfPath).replace(/^uploads\//, '')}`
    : null;
  const sent = await sendDispatchMail({
    to: ACCOUNTS_EMAIL,
    cc: ACCOUNTS_EMAIL_CC,
    subject: `${dcNumber} : ${customerName || 'Customer'} : Upload E-Way Bill`,
    userTriggered,
    html,
    text,
    pdfRelativePath,
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

/**
 * Existing challan PDF for the mail, regenerated in its own format if absent.
 *
 * Never falls back to generateDocumentPdf for a service return: that is a
 * different document from the SDC the warehouse printed.
 */
async function resolveChallanAttachment(dcNumber, head) {
  const fsMod = require('fs');
  const pathMod = require('path');
  const stored = head?.pdf_path ? String(head.pdf_path) : null;
  if (stored && fsMod.existsSync(pathMod.join(__dirname, '..', stored))) return stored;

  if (String(head?.dc_purpose || '').toLowerCase() === 'service_return') {
    const { regenerateServiceDcPdfByNumber } = require('./serviceDcPdfService');
    const pool = require('../config/db');
    return (await regenerateServiceDcPdfByNumber(pool, dcNumber)) || null;
  }
  return stored;
}

/**
 * Ask Accounts for the e-way bill on an outbound DC whose value needs one.
 *
 * Extracted so a challan raised outside the sales pipeline can trigger the same
 * mail the "Request E-Way Bill" button sends. Support raises a Service DC from
 * the support shell and never sees that button, so nothing asked Accounts for
 * the bill -- and the SDC is locked until they upload it, so it stayed locked.
 * SDC/26-27/0009 and /0010 shipped that way.
 *
 * Reports why it did nothing rather than throwing, so a caller can treat the
 * mail as best-effort; a genuine SMTP failure still throws.
 *
 * `force` is for a retrospective request on a consignment that has already left
 * without the bill it needed. The normal guard suppresses requests after
 * dispatch because they confuse Accounts, but a challan that shipped without an
 * e-way bill is exactly the case where one still has to be raised.
 */
async function requestEwayFromAccounts(dcNumber, { actorUserId = null, force = false } = {}) {
  const pool = require('../config/db');
  const lines = await getDeliveryChallanLines(dcNumber);
  if (!lines.length) return { sent: false, reason: 'dc_not_found' };
  const head = lines[0];

  const blocked = accountsMailBlockedReason(lines);
  if (blocked && !force) return { sent: false, reason: 'status_blocked', message: blocked };

  const asset = await computeDcAssetValue(dcNumber, lines);
  const productValue = asset.total;
  if (!requiresOutboundEway(head, productValue)) {
    return { sent: false, reason: 'below_threshold', assetValue: productValue };
  }

  await markDcEwayRequired(dcNumber, true, productValue);

  // Attach the challan itself, and make sure it is the RIGHT challan. A service
  // return must go out as its Service Delivery Challan, never as a freshly
  // generated plain DC: Accounts are entering this into the GST portal, so the
  // attachment has to be the document the customer and the driver are holding.
  const pdfRelative = await resolveChallanAttachment(dcNumber, head);

  const { subtotal: billedSubtotal } = await resolveDcBilling(dcNumber, lines);
  const mailResult = await sendAccountsDemoEwayEmail({
    dcNumber,
    salesOrderNumber: head.sales_order_number,
    customerName: head.customer_name,
    productValue,
    billedValue: billedSubtotal,
    laptops: asset.units,
    pdfPath: pdfRelative,
    vehicleNumber: normalizeVehicleNumber(head.vehicle_number) || null,
    needsVehicle: requiresVehicleNumber(head, true),
  });

  await pool.query(
    `UPDATE delivery_challan_lines SET
        accounts_notified_at = NOW(),
        accounts_notified_by = $1,
        updated_at = NOW()
      WHERE dc_number = $2`,
    [actorUserId, dcNumber]
  );

  return {
    sent: true,
    assetValue: productValue,
    to: mailResult.to,
    cc: mailResult.cc,
    from: mailResult.from,
    resend: Boolean(head.accounts_notified_at),
  };
}

async function markDcEwayRequired(dcNumber, required, assetValue = null) {
  const pool = require('../config/db');
  const params = [dcNumber, Boolean(required), assetValue == null ? null : Number(assetValue)];
  try {
    await pool.query(
      `UPDATE delivery_challan_lines
          SET eway_required = $2,
              eway_asset_value = COALESCE($3, eway_asset_value),
              updated_at = NOW()
        WHERE dc_number = $1`,
      params
    );
  } catch (err) {
    if (err.code !== '42703') throw err;
    await pool.query(
      `UPDATE delivery_challan_lines
          SET eway_required = $2, updated_at = NOW()
        WHERE dc_number = $1`,
      [dcNumber, Boolean(required)]
    );
  }
}

/**
 * After DC create: if billed value > threshold, lock the DC and email Accounts.
 * Mail failure must not roll back DC create.
 */
function laptopRowsFromDcLines(lines = []) {
  const rows = [];
  for (const line of lines) {
    const config = [line.brand, line.model_name || line.model, line.processor, line.generation, line.ram, line.storage]
      .filter(Boolean).join(' · ');
    let parsed = line.serial_number;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { parsed = parsed; }
    }
    const list = Array.isArray(line.serials_detail) && line.serials_detail.length
      ? line.serials_detail.map((d) => ({
        ttspl: d.ttspl || d.inventory_asset_code || null,
        serial: d.serial_number || null,
        config: [d.brand, d.model, d.processor, d.generation, d.ram, d.storage].filter(Boolean).join(' · ') || config,
      }))
      : (Array.isArray(parsed) ? parsed : parsed ? [parsed] : []).map((entry) => {
        const parts = String(entry).split('|');
        return { serial: parts[1] || parts[0] || null, ttspl: parts[2] || null, config };
      });
    if (list.length) rows.push(...list);
    else rows.push({ ttspl: null, serial: null, config });
  }
  return rows;
}

/** Lock the DC when asset value > threshold. Does not send mail — dispatch clicks Send. */
async function flagDcValueEwayIfNeeded(dcNumber) {
  const lines = await getDeliveryChallanLines(dcNumber);
  if (!lines.length) return { skipped: true };
  const asset = await computeDcAssetValue(dcNumber, lines);
  const productValue = asset.total;
  if (!requiresOutboundEway(lines[0], productValue)) {
    await markDcEwayRequired(dcNumber, false, productValue);
    return { skipped: true, product_value: productValue };
  }
  await markDcEwayRequired(dcNumber, true, productValue);
  return { flagged: true, product_value: productValue };
}

/** @deprecated Auto-send on DC create removed — dispatch uses requestDemoEway. */
async function notifyAccountsDcValueEwayIfNeeded(dcNumber) {
  return flagDcValueEwayIfNeeded(dcNumber);
}

module.exports = {
  EWAY_VALUE_THRESHOLD,
  ACCOUNTS_MAIL_BLOCKED_STATUSES,
  accountsMailBlockedReason,
  ACCOUNTS_EMAIL,
  ACCOUNTS_EMAIL_CC,
  isSaleDc,
  isServiceReturnDc,
  isDemoDc,
  isNewCustomerFirstOrder,
  isNewCustomerFirstDc,
  requiresInvoiceCompliance,
  requiresDemoEwayCompliance,
  requiresEwayBill,
  requiresVehicleNumber,
  isOwnVehicleDispatch,
  assetValueForSerialIds,
  isEinvoiceComplete,
  isEwayComplete,
  buildSaleCompliance,
  buildDemoEwayCompliance,
  computeDcProductValue,
  computeDcGrandTotal,
  computeDcAssetValue,
  collectDcAssetUnits,
  assertCanDownloadSaleDcPdf,
  normalizeVehicleNumber,
  sendAccountsSaleDcEmail,
  sendAccountsDemoEwayEmail,
  requestEwayFromAccounts,
  emailAccountsSaleDcCreated,
  canUploadSaleDcCompliance,
  canManageDcEwayBill,
  canUploadDcValueEway,
  canViewEwayLockedDc,
  requiresOutboundEway,
  flagDcValueEwayIfNeeded,
  notifyAccountsDcValueEwayIfNeeded,
  markDcEwayRequired,
  laptopRowsFromDcLines,
  UPLOAD_PERMISSION_CHECKS,
};
