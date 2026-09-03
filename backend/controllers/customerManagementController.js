const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sendCustomerPortalWelcome } = require('../services/emailQueueService');
const { createImpersonationSession } = require('../services/customerPortalImpersonation');
const { getCustomerPortalUrl } = require('../utils/publicUrls');
const {
  DEPLOYED_WITH_CUSTOMER_STATUSES,
  displayDeployedStatus,
} = require('../services/customerDeployedAssets');
const {
  MOBILE_RE,
  normalizeIndianMobile,
  validateIndianMobile,
} = require('../utils/phoneValidation');
const {
  normalizeCustomerType,
  canEditCustomerType,
  customerTypeSqlCondition,
} = require('../utils/customerType');
const {
  appendCustomerTypeCondition,
  isCustomerTypeAllowed,
} = require('../services/customerAccessScope');
const { parseExtra } = require('../services/qcManagementService');
const productionAssetService = require('../services/productionAssetService');
const {
  buildAssetBeforeState,
  buildAssetChangeSet,
  logCustomerAssetEdit,
  listCustomerAssetActivity,
  normalizeAssetDateField,
} = require('../services/customerAssetActivityService');
const {
  buildCustomerLaptopsCacheKey,
  getCachedCustomerLaptops,
  setCachedCustomerLaptops,
  invalidateCustomerLaptopsCache,
} = require('../services/customerLaptopsCache');
const { lookupGstin, sanitizeGstin, isValidGstin } = require('../services/gstinLookupService');

/** Prefer the GST API tradeNam. Lookup is best-effort so save still works if Zoho is down. */
async function resolveGstTradeName(gstNumber, explicitTradeName) {
  const fromBody = String(explicitTradeName || '').trim();
  if (fromBody) return fromBody;
  const gstin = sanitizeGstin(gstNumber);
  if (!isValidGstin(gstin)) return '';
  try {
    const info = await lookupGstin(gstin);
    return String(info.trade_name || '').trim();
  } catch (err) {
    console.warn('GST tradeNam lookup skipped:', err.message);
    return '';
  }
}

const CUSTOMER_ASSET_SPEC_FIELDS = [
  'brand',
  'model',
  'processor',
  'generation',
  'ram',
  'storage',
  'gpu',
  'screen_size',
];

/**
 * Customer Access guard for single-record endpoints (GET/PUT/DELETE /customers/:id
 * and sub-resources). Loads the customer's type and checks it against the
 * caller's allowed types (req.allowedCustomerTypes from customerScope middleware).
 * Returns { ok, status, message } — 404 when missing, 403 when out of scope.
 */
async function checkCustomerAccessById(req, customerId) {
  const id = parseInt(customerId, 10);
  if (!id) return { ok: false, status: 400, message: 'Invalid customer id' };
  const r = await pool.query(
    `SELECT customer_type FROM customers WHERE customer_id = $1`,
    [id]
  );
  if (!r.rows.length) return { ok: false, status: 404, message: 'Customer not found' };
  if (!isCustomerTypeAllowed(req.allowedCustomerTypes, r.rows[0].customer_type)) {
    return { ok: false, status: 403, message: 'Access denied: customer is outside your Customer Access scope' };
  }
  return { ok: true };
}

function parseDetails(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value) || {};
  } catch {
    return {};
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FINANCE_SPOCK_DETAIL_KEYS = [
  'finance_contact_name',
  'finance_contact_email',
  'finance_contact_mobile',
  'spock_person_name',
  'spock_person_email',
  'spock_person_mobile',
];

const LEGACY_EXPOX_DETAIL_KEYS = [
  'expox_person_name',
  'expox_person_email',
  'expox_person_mobile',
];

function spockFieldFromBody(body, spockKey) {
  if (body[spockKey] !== undefined) return body[spockKey];
  const legacyKey = spockKey.replace(/^spock_/, 'expox_');
  return body[legacyKey];
}

function validateFinanceSpockContactFields(body) {
  const errors = [];
  const requiredFields = [
    ['spock_person_name', 'Spoke person name'],
    ['spock_person_email', 'Spoke person email'],
    ['spock_person_mobile', 'Spoke person mobile number'],
  ];
  const optionalEmailFields = [
    ['finance_contact_email', 'Finance Contact Email'],
  ];
  const optionalMobileFields = [
    ['finance_contact_mobile', 'Finance Contact Mobile Number'],
  ];
  for (const [key, label] of requiredFields) {
    const value = String(spockFieldFromBody(body, key) || '').trim();
    if (!value) {
      errors.push(`${label} is required`);
      continue;
    }
    if (key.endsWith('_email') && !EMAIL_RE.test(value)) errors.push(`${label} is invalid`);
    if (key.endsWith('_mobile') && !MOBILE_RE.test(normalizeIndianMobile(value))) {
      errors.push(`${label} must be a 10-digit number`);
    }
  }
  for (const [key, label] of optionalEmailFields) {
    const value = String(body[key] || '').trim();
    if (value && !EMAIL_RE.test(value)) errors.push(`${label} is invalid`);
  }
  for (const [key, label] of optionalMobileFields) {
    const value = String(body[key] || '').trim();
    if (value && !MOBILE_RE.test(normalizeIndianMobile(value))) {
      errors.push(`${label} must be a 10-digit number`);
    }
  }
  return errors;
}

function applyFinanceSpockDetails(details, body) {
  for (const key of FINANCE_SPOCK_DETAIL_KEYS) {
    const raw = spockFieldFromBody(body, key);
    if (raw === undefined) continue;
    let value = String(raw || '').trim();
    if (key.endsWith('_mobile') && value) value = normalizeIndianMobile(value);
    details[key] = value || null;
  }
  for (const legacyKey of LEGACY_EXPOX_DETAIL_KEYS) {
    delete details[legacyKey];
  }
  return details;
}

function validateCustomerPhoneFields(body, { requirePrimary = false } = {}) {
  const errors = [];
  const primary = validateIndianMobile(body.customer_number ?? body.phone, {
    required: requirePrimary,
    label: 'Phone',
  });
  if (primary) errors.push(primary);
  const contact = validateIndianMobile(body.contact_person_number, {
    required: requirePrimary,
    label: 'Contact phone',
  });
  if (contact) errors.push(contact);
  const whatsapp = validateIndianMobile(body.whatsapp_number, { label: 'WhatsApp number' });
  if (whatsapp) errors.push(whatsapp);
  const addrMobile = validateIndianMobile(body.mobile_no, { label: 'Mobile number' });
  if (addrMobile) errors.push(addrMobile);
  return errors;
}

function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function billingAddressFromRow(row, details) {
  const street = typeof row.billing_address === 'string' && row.billing_address
    ? row.billing_address
    : (details.billing_address?.address || details.billing_address || '');
  return {
    name: row.name || row.company_name || '',
    phone: row.phone || '',
    country: 'India',
    state: row.billing_state || '',
    city: row.billing_city || '',
    zip_code: row.billing_pincode || '',
    gst_number: row.gst_no || details.gst_number || '',
    address: street || '',
  };
}

function formatCustomerRow(row) {
  const details = parseDetails(row.details);
  const uploadDocs = Array.isArray(details.upload_docs) ? details.upload_docs : [];
  const billingObj = billingAddressFromRow(row, details);
  return {
    id: row.customer_id,
    customer_id: row.customer_id,
    customer_name: row.name,
    name: row.name,
    company_name: row.company_name || row.name,
    trade_name: row.trade_name || details.trade_name || '',
    email: row.email,
    customer_number: row.phone,
    phone: row.phone,
    contact_person_name: details.contact_person_name || row.name || '',
    contact_person_number: details.contact_person_number || row.phone || '',
    finance_contact_name: details.finance_contact_name || '',
    finance_contact_email: details.finance_contact_email || '',
    finance_contact_mobile: details.finance_contact_mobile || '',
    spock_person_name: details.spock_person_name || details.expox_person_name || '',
    spock_person_email: details.spock_person_email || details.expox_person_email || '',
    spock_person_mobile: details.spock_person_mobile || details.expox_person_mobile || '',
    gst_number: row.gst_no || details.gst_number || '',
    gst_no: row.gst_no || details.gst_number || '',
    pan_card_number: row.pan_number || details.pan_card_number || '',
    pan_number: row.pan_number || details.pan_card_number || '',
    business_type: details.business_type || row.company_type || '',
    company_type: row.company_type || details.business_type || '',
    customer_type: normalizeCustomerType(row.customer_type),
    company_size: row.company_size || null,
    industry: row.industry || null,
    profile: details.profile || null,
    upload_docs: uploadDocs,
    total_security_amount: Number(row.total_security_amount || 0),
    active_item_count: Number(row.active_item_count || 0),
    billing_address: billingObj,
    billingAddress: billingObj.address,
    billing_city: row.billing_city || null,
    billing_state: row.billing_state || null,
    billing_pincode: row.billing_pincode || null,
    shipping_same: row.shipping_same ?? true,
    shipping_address: row.shipping_address || null,
    shipping_city: row.shipping_city || null,
    shipping_state: row.shipping_state || null,
    shipping_pincode: row.shipping_pincode || null,
    whatsapp_number: row.whatsapp_number || null,
    designation: row.designation || null,
    source_lead_id: row.source_lead_id || null,
    source_lead_stage: row.source_lead_stage || null,
    onboarded_by: row.onboarded_by || null,
    onboarded_at: row.onboarded_at || null,
    portal_enabled: row.portal_enabled ?? false,
    portal_last_login: row.portal_last_login || null,
    notes: row.notes || null,
    kyc_verified: row.kyc_verified ?? false,
    kyc_verified_by: row.kyc_verified_by || null,
    kyc_verified_at: row.kyc_verified_at || null,
    shipping_addresses: details.shipping_address || details.shipping_addresses || [],
    status: row.status ?? 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    details,
  };
}

function createAddressExportEntry({ address, city, state, pincode, concern_person, mobile_no } = {}) {
  const location = [address, city, state, pincode].filter((part) => String(part || '').trim()).join(', ');
  return {
    address: location,
    concern_person: String(concern_person || '').trim(),
    mobile_no: String(mobile_no || '').trim(),
  };
}

function profileBillingFields(row, details) {
  return {
    address: typeof row.billing_address === 'string'
      ? row.billing_address
      : (details.billing_address?.address || details.billing_address || ''),
    city: row.billing_city,
    state: row.billing_state,
    pincode: row.billing_pincode,
  };
}

function collectAddressEntries(entries, entry) {
  if (!entry?.address) return;
  const key = `${entry.address}|${entry.concern_person}|${entry.mobile_no}`;
  if (entries.seen.has(key)) return;
  entries.seen.add(key);
  entries.list.push(entry);
}

function collectBillingAddresses(row, details, savedAddresses = []) {
  const entries = { list: [], seen: new Set() };
  collectAddressEntries(entries, createAddressExportEntry(profileBillingFields(row, details)));

  savedAddresses
    .filter((addr) => String(addr.address_type || '').toLowerCase() === 'billing')
    .forEach((addr) => collectAddressEntries(entries, createAddressExportEntry(addr)));

  return entries.list;
}

function collectShippingAddresses(row, details, savedAddresses = []) {
  const entries = { list: [], seen: new Set() };

  if (row.shipping_same === false) {
    collectAddressEntries(entries, createAddressExportEntry({
      address: row.shipping_address,
      city: row.shipping_city,
      state: row.shipping_state,
      pincode: row.shipping_pincode,
    }));
  } else {
    collectAddressEntries(entries, createAddressExportEntry(profileBillingFields(row, details)));
  }

  const legacyShipping = details.shipping_address || details.shipping_addresses;
  if (Array.isArray(legacyShipping)) {
    legacyShipping.forEach((item) => collectAddressEntries(entries, createAddressExportEntry({
      address: item?.address,
      city: item?.city,
      state: item?.state,
      pincode: item?.zip_code || item?.pincode,
      concern_person: item?.name,
      mobile_no: item?.phone,
    })));
  }

  savedAddresses
    .filter((addr) => String(addr.address_type || 'Shipping').toLowerCase() !== 'billing')
    .forEach((addr) => collectAddressEntries(entries, createAddressExportEntry(addr)));

  return entries.list;
}

function buildCustomerExportBaseRow(formatted, assetCount) {
  return {
    'Company Name': formatted.company_name || formatted.customer_name || '',
    'Contact Person': formatted.contact_person_name || formatted.customer_name || '',
    'Phone Number': formatted.customer_number || formatted.phone || '',
    Email: formatted.email || '',
    'GST Number': formatted.gst_number || '',
    'Trade Name': formatted.trade_name || '',
    City: formatted.billing_city || '',
    'Asset Count': assetCount,
    'Finance Contact Name': formatted.finance_contact_name || '',
    'Finance Contact Email': formatted.finance_contact_email || '',
    'Finance Contact Mobile Number': formatted.finance_contact_mobile || '',
    'Spoke Person Name': formatted.spock_person_name || '',
    'Spoke Person Email': formatted.spock_person_email || '',
    'Spoke Person Mobile Number': formatted.spock_person_mobile || '',
  };
}

function appendDynamicAddressColumns(row, billingAddresses, shippingAddresses, maxBilling, maxShipping) {
  for (let i = 0; i < maxBilling; i += 1) {
    const entry = billingAddresses[i] || {};
    row[`Billing Address ${i + 1}`] = entry.address || '';
    row[`Billing Contact Person ${i + 1}`] = entry.concern_person || '';
    row[`Billing Contact Mobile ${i + 1}`] = entry.mobile_no || '';
  }
  for (let i = 0; i < maxShipping; i += 1) {
    const entry = shippingAddresses[i] || {};
    row[`Shipping Address ${i + 1}`] = entry.address || '';
    row[`Shipping Contact Person ${i + 1}`] = entry.concern_person || '';
    row[`Shipping Contact Mobile ${i + 1}`] = entry.mobile_no || '';
  }
  return row;
}

function buildAddressExportColumnOrder(maxBilling, maxShipping) {
  const columns = [];
  for (let i = 0; i < maxBilling; i += 1) {
    columns.push(
      `Billing Address ${i + 1}`,
      `Billing Contact Person ${i + 1}`,
      `Billing Contact Mobile ${i + 1}`,
    );
  }
  for (let i = 0; i < maxShipping; i += 1) {
    columns.push(
      `Shipping Address ${i + 1}`,
      `Shipping Contact Person ${i + 1}`,
      `Shipping Contact Mobile ${i + 1}`,
    );
  }
  return columns;
}

async function ensureCustomerManagementSchema() {
  for (const file of [
    '045_customer_management_module.sql',
    '064_customer_addresses.sql',
    '068_phase6_support_customer_portal.sql',
    '147_customer_type.sql',
  ]) {
    const migrationPath = path.join(__dirname, '../migrations', file);
    if (!fs.existsSync(migrationPath)) continue;
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await pool.query(sql);
  }
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dcl_customer_movement_status
      ON delivery_challan_lines (customer_id, movement_type, status);
    CREATE INDEX IF NOT EXISTS idx_vsn_customer_status_active
      ON vendor_serial_numbers (current_customer_id, inventory_status)
      WHERE deleted_at IS NULL;
  `);
}

exports.ensureCustomerManagementSchema = ensureCustomerManagementSchema;

exports.getAddCustomerMeta = async (req, res) => {
  res.json({ success: true, generated_password: generatePassword() });
};

/** Shared list filters for paginated customers + bulk ID selection. */
function buildCustomerListFilters(query = {}, allowedCustomerTypes = null) {
  const params = [];
  const conditions = [];

  // status: active (default) | inactive | all
  // Pickers/billing omit the param → active only. Admin list passes status=all|inactive.
  const statusFilter = String(query.status || query.status_filter || 'active').trim().toLowerCase();
  if (statusFilter === 'inactive' || statusFilter === '0') {
    conditions.push('COALESCE(c.status, 1) = 0');
  } else if (statusFilter === 'all') {
    // no status condition
  } else {
    conditions.push('COALESCE(c.status, 1) = 1');
  }

  const typeFilter = String(query.customer_type || query.for_order || 'all').trim().toLowerCase();
  const typeSql = customerTypeSqlCondition(typeFilter);
  if (typeSql) conditions.push(typeSql);

  // Role-based Customer Access scope (all/sales/rental)
  appendCustomerTypeCondition(allowedCustomerTypes, conditions, params);

  const search = String(query.search || '').trim();
  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    conditions.push(`(
      c.name ILIKE $${idx} OR c.email ILIKE $${idx} OR c.phone ILIKE $${idx}
      OR c.gst_no ILIKE $${idx} OR c.company_name ILIKE $${idx}
      OR c.trade_name ILIKE $${idx}
      OR c.details->>'contact_person_name' ILIKE $${idx}
      OR c.details->>'pan_card_number' ILIKE $${idx}
    )`);
  }

  const kyc = String(query.kyc || query.kyc_filter || '').trim().toLowerCase();
  if (kyc === 'verified') {
    conditions.push('COALESCE(c.kyc_verified, FALSE) = TRUE');
  } else if (kyc === 'pending') {
    conditions.push('COALESCE(c.kyc_verified, FALSE) = FALSE');
  }

  return {
    params,
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
  };
}

exports.listCustomers = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const sortByRaw = (req.query.sort_by || 'customer_id').trim();
    const sortDirRaw = (req.query.sort_dir || 'desc').toLowerCase();
    const SORT_COLUMNS = {
      customer_id: 'c.customer_id',
      updated_at: 'c.updated_at',
    };
    const orderBy = SORT_COLUMNS[sortByRaw] || SORT_COLUMNS.customer_id;
    const orderDir = sortDirRaw === 'desc' ? 'DESC' : 'ASC';
    const { params, where } = buildCustomerListFilters(req.query, req.allowedCustomerTypes);

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM customers c ${where}`,
      params
    );

    const offset = (page - 1) * limit;
    const statusParamIdx = params.length + 1;
    const listParams = [...params, DEPLOYED_WITH_CUSTOMER_STATUSES, limit, offset];
    const limitIdx = listParams.length - 1;
    const offsetIdx = listParams.length;
    const listResult = await pool.query(
      `SELECT c.*,
        COALESCE((
          SELECT SUM(sd.amount - COALESCE(sd.refund_amount, 0))
            FROM customer_security_deposits sd
           WHERE sd.customer_id = c.customer_id
             AND sd.status IN ('held', 'partially_refunded')
        ), 0) AS total_security_amount,
        COALESCE((
          SELECT COUNT(*)::int
            FROM vendor_serial_numbers vsn
           WHERE vsn.current_customer_id = c.customer_id
             AND vsn.deleted_at IS NULL
             AND vsn.inventory_status = ANY($${statusParamIdx}::text[])
        ), 0) AS active_item_count
       FROM customers c
       ${where}
       ORDER BY ${orderBy} ${orderDir}
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams
    );

    res.json({
      success: true,
      customers: listResult.rows.map(formatCustomerRow),
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total || 0,
        totalPages: Math.ceil((countResult.rows[0]?.total || 0) / limit),
      },
    });
  } catch (error) {
    console.error('listCustomers:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET — all matching customer IDs for the current filters (no pagination).
 * Used by bulk "Select all matching customers".
 */
exports.listCustomerIds = async (req, res) => {
  try {
    const { params, where } = buildCustomerListFilters(req.query, req.allowedCustomerTypes);
    const result = await pool.query(
      `SELECT c.customer_id, c.name, c.company_name, c.email, c.phone, c.customer_type, c.kyc_verified
         FROM customers c
         ${where}
         ORDER BY c.customer_id ASC`,
      params
    );
    res.json({
      success: true,
      total: result.rows.length,
      customer_ids: result.rows.map((r) => r.customer_id),
      customers: result.rows.map((r) => ({
        customer_id: r.customer_id,
        name: r.name,
        customer_name: r.name,
        company_name: r.company_name || r.name,
        email: r.email,
        phone: r.phone,
        customer_type: normalizeCustomerType(r.customer_type),
        kyc_verified: !!r.kyc_verified,
      })),
    });
  } catch (error) {
    console.error('listCustomerIds:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.exportCustomersExcel = async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const params = [];
    const conditions = ['c.status = 1'];

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      conditions.push(`(
        c.name ILIKE $${idx} OR c.email ILIKE $${idx} OR c.phone ILIKE $${idx}
        OR c.gst_no ILIKE $${idx} OR c.company_name ILIKE $${idx}
        OR c.trade_name ILIKE $${idx}
        OR c.details->>'contact_person_name' ILIKE $${idx}
        OR c.details->>'pan_card_number' ILIKE $${idx}
      )`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const customersResult = await pool.query(
      `SELECT c.*,
        COALESCE(ac.asset_count, 0) AS asset_count
       FROM customers c
       LEFT JOIN (
         SELECT current_customer_id AS customer_id, COUNT(*)::int AS asset_count
         FROM vendor_serial_numbers
         WHERE deleted_at IS NULL
           AND current_customer_id IS NOT NULL
           AND inventory_status = ANY($${params.length + 1}::text[])
         GROUP BY current_customer_id
       ) ac ON ac.customer_id = c.customer_id
       ${where}
       ORDER BY c.customer_id ASC`,
      [...params, DEPLOYED_WITH_CUSTOMER_STATUSES]
    );

    const customerRows = customersResult.rows;
    const customerIds = customerRows.map((row) => row.customer_id);
    const addressesByCustomer = new Map();

    if (customerIds.length) {
      const addressesResult = await pool.query(
        `SELECT customer_id, concern_person, mobile_no, address, city, state, pincode, address_type, is_head_office
         FROM customer_addresses
         WHERE customer_id = ANY($1::int[])
         ORDER BY customer_id ASC, is_head_office DESC, customer_address_id ASC`,
        [customerIds]
      );
      addressesResult.rows.forEach((addr) => {
        const list = addressesByCustomer.get(addr.customer_id) || [];
        list.push(addr);
        addressesByCustomer.set(addr.customer_id, list);
      });
    }

    const exportRows = customerRows.map((row) => {
      const formatted = formatCustomerRow(row);
      const savedAddresses = addressesByCustomer.get(row.customer_id) || [];
      return {
        formatted,
        assetCount: Number(row.asset_count || 0),
        billingAddresses: collectBillingAddresses(row, formatted.details, savedAddresses),
        shippingAddresses: collectShippingAddresses(row, formatted.details, savedAddresses),
      };
    });

    const maxBilling = exportRows.reduce((max, item) => Math.max(max, item.billingAddresses.length), 0);
    const maxShipping = exportRows.reduce((max, item) => Math.max(max, item.shippingAddresses.length), 0);

    const XLSX = require('xlsx');
    const sheetRows = exportRows.map((item, idx) => {
      const row = buildCustomerExportBaseRow(item.formatted, item.assetCount);
      row['S.No'] = idx + 1;
      appendDynamicAddressColumns(row, item.billingAddresses, item.shippingAddresses, maxBilling, maxShipping);
      return row;
    });

    const columnOrder = [
      'S.No',
      'Company Name',
      'Contact Person',
      'Phone Number',
      'Email',
      'GST Number',
      'City',
      'Asset Count',
      'Finance Contact Name',
      'Finance Contact Email',
      'Finance Contact Mobile Number',
      'Spoke Person Name',
      'Spoke Person Email',
      'Spoke Person Mobile Number',
      ...buildAddressExportColumnOrder(maxBilling, maxShipping),
    ];

    const orderedRows = sheetRows.map((row) => {
      const ordered = {};
      columnOrder.forEach((key) => { ordered[key] = row[key] ?? ''; });
      return ordered;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(orderedRows, { header: columnOrder });
    XLSX.utils.book_append_sheet(wb, ws, 'Customers');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="customers_export.xlsx"');
    res.send(buf);
  } catch (error) {
    console.error('exportCustomersExcel:', error);
    res.status(500).json({ success: false, message: error.message || 'Export failed' });
  }
};

// Export one row per LIVE customer-held laptop (active/deployed assets).
// Independent of the customer list export; does not touch existing flows.
exports.exportCustomerAssetsExcel = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(c.company_name, c.name) AS customer_name,
         COALESCE(inv.brand, vsn.extra->>'brand') AS brand,
         COALESCE(inv.model, vsn.extra->>'model', vsn.extra->>'model_name') AS model,
         COALESCE(inv.generation, vsn.extra->>'generation') AS generation,
         COALESCE(inv.processor, vsn.extra->>'processor') AS processor,
         COALESCE(NULLIF(vsn.inventory_asset_code, ''), vsn.extra->>'ttspl_id') AS ttspl,
         vsn.serial_number AS serial_number,
         vsn.rent_monthly_rate AS price,
         COALESCE(vsn.delivered_at, dd.delivered_at) AS delivered_at,
         COALESCE(NULLIF(vsn.current_dc_number, ''), dd.dc_number) AS dc_number,
         COALESCE(dd.sales_order_number, sos.sales_order_number) AS sales_order_number
       FROM vendor_serial_numbers vsn
       JOIN customers c ON c.customer_id = vsn.current_customer_id
       LEFT JOIN LATERAL (
         SELECT inv.brand, inv.model, inv.processor, inv.generation
           FROM inventory inv
          WHERE inv.serial_number = vsn.serial_number
             OR (
               vsn.inventory_asset_code IS NOT NULL
               AND inv.machine_number = vsn.inventory_asset_code
             )
          ORDER BY CASE WHEN inv.serial_number = vsn.serial_number THEN 0 ELSE 1 END,
                   inv.inventory_id ASC
          LIMIT 1
       ) inv ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(dcl.delivered_at, dcl.delivery_completed_at) AS delivered_at,
                dcl.dc_number,
                dcl.sales_order_number
           FROM delivery_challan_lines dcl
           CROSS JOIN LATERAL jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(dcl.serial_number) = 'array' THEN dcl.serial_number ELSE '[]'::jsonb END
           ) AS elem
          WHERE COALESCE(dcl.movement_type, 'outbound') = 'outbound'
            AND dcl.status = 'delivered'
            AND NULLIF(REGEXP_REPLACE(split_part(elem, '|', 1), '[^0-9]', '', 'g'), '')::int = vsn.serial_id
          ORDER BY COALESCE(dcl.delivered_at, dcl.delivery_completed_at) DESC NULLS LAST
          LIMIT 1
       ) dd ON TRUE
       LEFT JOIN LATERAL (
         SELECT sos.sales_order_number
           FROM sales_order_serials sos
          WHERE sos.serial_id = vsn.serial_id
            AND sos.status <> 'removed'
          ORDER BY sos.allocation_id DESC
          LIMIT 1
       ) sos ON TRUE
      WHERE vsn.deleted_at IS NULL
        AND vsn.current_customer_id IS NOT NULL
        AND vsn.inventory_status = ANY($1::text[])
      ORDER BY customer_name ASC, ttspl ASC NULLS LAST, vsn.serial_number ASC`,
      [DEPLOYED_WITH_CUSTOMER_STATUSES]
    );

    const columnOrder = [
      'Customer Name',
      'Brand',
      'Model',
      'Generation',
      'Processor',
      'TTSPL',
      'Serial Number',
      'Price',
      'DC Number',
      'SO Number',
      'Delivered Date',
    ];

    const fmtDate = (d) => {
      if (!d) return '';
      const dt = new Date(d);
      if (Number.isNaN(dt.getTime())) return '';
      const dd = String(dt.getDate()).padStart(2, '0');
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      return `${dd}-${mm}-${dt.getFullYear()}`;
    };

    const orderedRows = rows.map((r) => ({
      'Customer Name': r.customer_name || '',
      Brand: r.brand || '',
      Model: r.model || '',
      Generation: r.generation || '',
      Processor: r.processor || '',
      TTSPL: r.ttspl || '',
      'Serial Number': r.serial_number || '',
      Price: r.price != null ? Number(r.price) : '',
      'DC Number': r.dc_number || '',
      'SO Number': r.sales_order_number || '',
      'Delivered Date': fmtDate(r.delivered_at),
    }));

    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(orderedRows, { header: columnOrder });
    XLSX.utils.book_append_sheet(wb, ws, 'Customer Assets');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="customer_assets_export.xlsx"');
    res.send(buf);
  } catch (error) {
    console.error('exportCustomerAssetsExcel:', error);
    res.status(500).json({ success: false, message: error.message || 'Export failed' });
  }
};

/** Export customers with sale (non-rental) laptops held + sale price from the sale SO/DC. */
exports.exportCustomerSaleAssets = async (req, res) => {
  try {
    const format = String(req.query.format || 'xlsx').trim().toLowerCase();
    const { rows } = await pool.query(
      `SELECT
         c.customer_id,
         COALESCE(c.company_name, c.name) AS customer_name,
         c.email AS customer_email,
         c.phone AS customer_phone,
         c.gst_no AS customer_gst,
         COALESCE(inv.brand, vsn.extra->>'brand', sale_line.brand) AS brand,
         COALESCE(inv.model, vsn.extra->>'model', vsn.extra->>'model_name', sale_line.model_name) AS model,
         COALESCE(inv.generation, vsn.extra->>'generation') AS generation,
         COALESCE(inv.processor, vsn.extra->>'processor', sale_line.processor) AS processor,
         COALESCE(inv.ram, vsn.extra->>'ram', sale_line.ram) AS ram,
         COALESCE(inv.storage, vsn.extra->>'storage', sale_line.storage) AS storage,
         COALESCE(NULLIF(vsn.inventory_asset_code, ''), vsn.extra->>'ttspl_id') AS ttspl,
         vsn.serial_number,
         vsn.inventory_status,
         sale_line.rate AS sale_price,
         sale_line.sales_order_number,
         sale_line.dc_number,
         sale_line.delivered_at
       FROM vendor_serial_numbers vsn
       JOIN customers c ON c.customer_id = vsn.current_customer_id
       LEFT JOIN LATERAL (
         SELECT inv.brand, inv.model, inv.processor, inv.generation, inv.ram, inv.storage
           FROM inventory inv
          WHERE inv.serial_number = vsn.serial_number
             OR (
               vsn.inventory_asset_code IS NOT NULL
               AND inv.machine_number = vsn.inventory_asset_code
             )
          ORDER BY CASE WHEN inv.serial_number = vsn.serial_number THEN 0 ELSE 1 END,
                   inv.inventory_id ASC
          LIMIT 1
       ) inv ON TRUE
       INNER JOIN LATERAL (
         SELECT sol.rate,
                sol.sales_order_number,
                sol.brand,
                sol.model_name,
                sol.processor,
                sol.ram,
                sol.storage,
                dcl.dc_number,
                COALESCE(dcl.delivered_at, dcl.delivery_completed_at) AS delivered_at
           FROM delivery_challan_lines dcl
           JOIN sales_order_lines sol ON sol.sales_order_number = dcl.sales_order_number
           CROSS JOIN LATERAL jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(dcl.serial_number) = 'array' THEN dcl.serial_number ELSE '[]'::jsonb END
           ) AS elem
          WHERE dcl.customer_id = vsn.current_customer_id
            AND COALESCE(dcl.movement_type, 'outbound') = 'outbound'
            AND COALESCE(dcl.status, '') = 'delivered'
            AND LOWER(COALESCE(sol.quotation_type, '')) IN ('sale', 'sales')
            AND (
              vsn.serial_id = NULLIF(REGEXP_REPLACE(split_part(elem, '|', 1), '[^0-9]', '', 'g'), '')::int
              OR vsn.inventory_asset_code = NULLIF(split_part(elem, '|', 3), '')
              OR vsn.serial_number = NULLIF(split_part(elem, '|', 2), '')
            )
          ORDER BY COALESCE(dcl.delivered_at, dcl.delivery_completed_at) DESC NULLS LAST, dcl.id DESC
          LIMIT 1
       ) sale_line ON TRUE
      WHERE vsn.deleted_at IS NULL
        AND vsn.current_customer_id IS NOT NULL
        AND vsn.inventory_status = 'sold'
      ORDER BY customer_name ASC, ttspl ASC NULLS LAST, vsn.serial_number ASC`
    );

    const columnOrder = [
      'S.No',
      'Customer ID',
      'Customer Name',
      'Email',
      'Phone',
      'GST Number',
      'TTSPL',
      'Serial Number',
      'Brand',
      'Model',
      'Processor',
      'Generation',
      'RAM',
      'Storage',
      'Sale Price',
      'SO Number',
      'DC Number',
      'Delivered Date',
      'Asset Status',
    ];

    const fmtDate = (d) => {
      if (!d) return '';
      const dt = new Date(d);
      if (Number.isNaN(dt.getTime())) return '';
      const dd = String(dt.getDate()).padStart(2, '0');
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      return `${dd}-${mm}-${dt.getFullYear()}`;
    };

    const orderedRows = rows.map((r, idx) => ({
      'S.No': idx + 1,
      'Customer ID': r.customer_id,
      'Customer Name': r.customer_name || '',
      Email: r.customer_email || '',
      Phone: r.customer_phone || '',
      'GST Number': r.customer_gst || '',
      TTSPL: r.ttspl || '',
      'Serial Number': r.serial_number || '',
      Brand: r.brand || '',
      Model: r.model || '',
      Processor: r.processor || '',
      Generation: r.generation || '',
      RAM: r.ram || '',
      Storage: r.storage || '',
      'Sale Price': r.sale_price != null ? Number(r.sale_price) : '',
      'SO Number': r.sales_order_number || '',
      'DC Number': r.dc_number || '',
      'Delivered Date': fmtDate(r.delivered_at),
      'Asset Status': r.inventory_status || 'sold',
    }));

    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet(orderedRows, { header: columnOrder });

    if (format === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(ws);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="customer_sale_assets_export.csv"');
      return res.send(`\uFEFF${csv}`);
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sale Customer Assets');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="customer_sale_assets_export.xlsx"');
    return res.send(buf);
  } catch (error) {
    console.error('exportCustomerSaleAssets:', error);
    res.status(500).json({ success: false, message: error.message || 'Export failed' });
  }
};

exports.getCustomer = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const result = await pool.query(
      `SELECT c.*,
        COALESCE((
          SELECT SUM(sd.amount - COALESCE(sd.refund_amount, 0))
            FROM customer_security_deposits sd
           WHERE sd.customer_id = c.customer_id
             AND sd.status IN ('held', 'partially_refunded')
        ), 0) AS total_security_amount
       FROM customers c WHERE c.customer_id = $1`,
      [customerId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    if (!isCustomerTypeAllowed(req.allowedCustomerTypes, result.rows[0].customer_type)) {
      return res.status(403).json({ success: false, message: 'Access denied: customer is outside your Customer Access scope' });
    }
    const customer = formatCustomerRow(result.rows[0]);
    res.json({ success: true, customer });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCustomerAddresses = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }
    const access = await checkCustomerAccessById(req, customerId);
    if (!access.ok && access.status === 403) {
      return res.status(403).json({ success: false, message: access.message });
    }
    const { rows } = await pool.query(
      `SELECT customer_address_id, customer_id, concern_person, mobile_no, address, city, state, pincode,
              is_head_office, address_type, created_at, updated_at
       FROM customer_addresses
       WHERE customer_id = $1
       ORDER BY is_head_office DESC, customer_address_id ASC`,
      [customerId]
    );
    res.json({ success: true, addresses: rows });
  } catch (error) {
    if (error.message && error.message.includes('customer_addresses')) {
      return res.json({ success: true, addresses: [] });
    }
    console.error('getCustomerAddresses:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addCustomerAddress = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const body = req.body || {};
    const access = await checkCustomerAccessById(req, customerId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }
    if (!body.address) {
      return res.status(400).json({ success: false, message: 'Address is required' });
    }
    const phoneErrors = validateCustomerPhoneFields(body);
    if (phoneErrors.length) {
      return res.status(400).json({ success: false, message: phoneErrors[0] });
    }
    const mobileNo = body.mobile_no ? normalizeIndianMobile(body.mobile_no) : null;
    const result = await pool.query(
      `INSERT INTO customer_addresses
        (customer_id, concern_person, mobile_no, address, city, state, pincode, is_head_office, address_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        customerId,
        body.concern_person || null,
        mobileNo,
        body.address,
        body.city || null,
        body.state || null,
        body.pincode || null,
        !!body.is_head_office,
        body.address_type || 'Shipping',
      ]
    );
    res.status(201).json({ success: true, address: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateCustomerAddress = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const addressId = parseInt(req.params.addressId, 10);
    const body = req.body || {};
    const check = await pool.query(
      'SELECT 1 FROM customer_addresses WHERE customer_address_id = $1 AND customer_id = $2',
      [addressId, customerId]
    );
    if (!check.rows.length) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }
    if (!body.address || !String(body.address).trim()) {
      return res.status(400).json({ success: false, message: 'Address is required' });
    }
    const phoneErrors = validateCustomerPhoneFields(body);
    if (phoneErrors.length) {
      return res.status(400).json({ success: false, message: phoneErrors[0] });
    }
    const mobileNo = body.mobile_no ? normalizeIndianMobile(body.mobile_no) : null;
    const result = await pool.query(
      `UPDATE customer_addresses
          SET concern_person = $1,
              mobile_no = $2,
              address = $3,
              city = $4,
              state = $5,
              pincode = $6,
              address_type = COALESCE($7, address_type),
              updated_at = NOW()
        WHERE customer_address_id = $8 AND customer_id = $9
        RETURNING *`,
      [
        body.concern_person || null,
        mobileNo,
        String(body.address).trim(),
        body.city || null,
        body.state || null,
        body.pincode || null,
        body.address_type || null,
        addressId,
        customerId,
      ]
    );
    res.json({ success: true, address: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteCustomerAddress = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const addressId = parseInt(req.params.addressId, 10);
    const result = await pool.query(
      `DELETE FROM customer_addresses
       WHERE customer_address_id = $1 AND customer_id = $2
       RETURNING customer_address_id`,
      [addressId, customerId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }
    res.json({ success: true, message: 'Address deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.setDefaultCustomerAddress = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const addressId = parseInt(req.params.addressId, 10);
    const check = await pool.query(
      'SELECT 1 FROM customer_addresses WHERE customer_address_id = $1 AND customer_id = $2',
      [addressId, customerId]
    );
    if (!check.rows.length) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }
    await pool.query(
      'UPDATE customer_addresses SET is_head_office = FALSE WHERE customer_id = $1',
      [customerId]
    );
    await pool.query(
      'UPDATE customer_addresses SET is_head_office = TRUE, updated_at = NOW() WHERE customer_address_id = $1',
      [addressId]
    );
    const { rows } = await pool.query(
      `SELECT customer_address_id, customer_id, concern_person, mobile_no, address, city, state, pincode,
              is_head_office, address_type
       FROM customer_addresses WHERE customer_id = $1
       ORDER BY is_head_office DESC, customer_address_id ASC`,
      [customerId]
    );
    res.json({ success: true, addresses: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.storeCustomer = async (req, res) => {
  try {
    const body = req.body;
    const shippingSame = body.shipping_same !== false && body.shipping_same !== 'false'
      && body.shipping_same_as_billing !== false && body.shipping_same_as_billing !== 'false';

    // Address line 2 is always optional. When shipping is same as billing, shipping
    // fields are copied from billing and must not be required.
    const required = [
      'customer_name', 'customer_number', 'email', 'contact_person_name',
      'contact_person_number', 'billing_state', 'billing_city', 'billing_pin_code',
      'billing_address_1', 'business_type', 'password',
    ];
    if (!shippingSame) {
      required.push(
        'shipping_state', 'shipping_city', 'shipping_pin_code', 'shipping_address_1',
      );
    }
    for (const field of required) {
      if (!String(body[field] ?? '').trim()) {
        return res.status(400).json({ success: false, message: `${field} is required` });
      }
    }

    const joinAddressLines = (line1, line2) => (
      [line1, line2].map((s) => String(s || '').trim()).filter(Boolean).join(', ')
    );

    const shippingState = shippingSame ? body.billing_state : body.shipping_state;
    const shippingCity = shippingSame ? body.billing_city : body.shipping_city;
    const shippingPin = shippingSame
      ? (body.billing_pin_code || body.billing_pincode)
      : (body.shipping_pin_code || body.shipping_pincode);
    const shippingAddress1 = shippingSame ? body.billing_address_1 : body.shipping_address_1;
    const shippingAddress2 = shippingSame
      ? (body.billing_address_2 || '')
      : (body.shipping_address_2 || '');

    const emailCheck = await pool.query(`SELECT customer_id FROM customers WHERE email = $1 LIMIT 1`, [body.email]);
    if (emailCheck.rows.length) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }
    if (body.gst_number) {
      const gstCheck = await pool.query(`SELECT customer_id FROM customers WHERE gst_no = $1 LIMIT 1`, [body.gst_number]);
      if (gstCheck.rows.length) {
        return res.status(400).json({ success: false, message: 'GST number already exists' });
      }
    }
    if (body.pan_card_number) {
      const panCheck = await pool.query(
        `SELECT customer_id FROM customers WHERE details->>'pan_card_number' = $1 LIMIT 1`,
        [body.pan_card_number]
      );
      if (panCheck.rows.length) {
        return res.status(400).json({ success: false, message: 'PAN number already exists' });
      }
    }

    const phoneErrors = validateCustomerPhoneFields(body, { requirePrimary: true });
    if (phoneErrors.length) {
      return res.status(400).json({ success: false, message: phoneErrors[0] });
    }
    const customerNumber = normalizeIndianMobile(body.customer_number);
    const contactPersonNumber = normalizeIndianMobile(body.contact_person_number);

    const billingAddress = {
      name: body.customer_name,
      phone: customerNumber,
      country: 'India',
      state: body.billing_state,
      city: body.billing_city,
      zip_code: body.billing_pin_code,
      address: joinAddressLines(body.billing_address_1, body.billing_address_2),
    };

    const shippingAddresses = [{
      name: body.contact_person_name,
      phone: contactPersonNumber,
      country: 'India',
      state: shippingState,
      city: shippingCity,
      zip_code: shippingPin,
      address: joinAddressLines(shippingAddress1, shippingAddress2),
    }];

    const uploadDocs = [];
    if (req.files?.upload_docs) {
      const files = Array.isArray(req.files.upload_docs) ? req.files.upload_docs : [req.files.upload_docs];
      for (const file of files) {
        const destDir = path.join('uploads', 'customers', 'docs');
        fs.mkdirSync(destDir, { recursive: true });
        const filename = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const dest = path.join(destDir, filename);
        fs.renameSync(file.path, dest);
        uploadDocs.push(dest.replace(/\\/g, '/'));
      }
    }

    let profilePath = null;
    if (req.files?.profile?.[0]) {
      const file = req.files.profile[0];
      const destDir = path.join('uploads', 'customers', 'profiles');
      fs.mkdirSync(destDir, { recursive: true });
      const filename = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const dest = path.join(destDir, filename);
      fs.renameSync(file.path, dest);
      profilePath = dest.replace(/\\/g, '/');
    }

    const passwordHash = await bcrypt.hash(body.password, 10);
    const contactValidationErrors = validateFinanceSpockContactFields(body);
    if (contactValidationErrors.length) {
      return res.status(400).json({ success: false, message: contactValidationErrors[0] });
    }

    let customerType = 'both';
    if (canEditCustomerType(req.user) && body.customer_type != null && String(body.customer_type).trim() !== '') {
      customerType = normalizeCustomerType(body.customer_type);
    }

    const details = {
      contact_person_name: body.contact_person_name,
      contact_person_number: contactPersonNumber,
      business_type: body.business_type,
      pan_card_number: body.pan_card_number || body.pan_number || null,
      billing_address: billingAddress,
      shipping_address: shippingAddresses,
      upload_docs: uploadDocs,
      profile: profilePath,
      password_hash: passwordHash,
    };
    applyFinanceSpockDetails(details, body);

    const result = await pool.query(
      `INSERT INTO customers (
         name, company_name, trade_name, email, phone, gst_no, address, type, customer_type, details,
         billing_address, billing_city, billing_state, billing_pincode,
         shipping_same, shipping_address, shipping_city, shipping_state, shipping_pincode,
         pan_number, company_type, industry, whatsapp_number, designation, notes,
         status, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14,
         $15, $16, $17, $18, $19,
         $20, $21, $22, $23, $24, $25,
         1, NOW(), NOW()
       )
       RETURNING *`,
      [
        body.customer_name,
        body.company_name || body.customer_name,
        await resolveGstTradeName(body.gst_number, body.trade_name) || null,
        body.email,
        customerNumber,
        body.gst_number || null,
        billingAddress.address,
        body.business_type === 'supplier' ? 'Supplier' : 'Regular',
        customerType,
        JSON.stringify(details),
        billingAddress.address,
        body.billing_city || null,
        body.billing_state || null,
        body.billing_pin_code || body.billing_pincode || null,
        shippingSame,
        shippingSame ? null : shippingAddresses[0].address,
        shippingSame ? null : (shippingCity || null),
        shippingSame ? null : (shippingState || null),
        shippingSame ? null : (shippingPin || null),
        body.pan_number || body.pan_card_number || null,
        body.company_type || null,
        body.industry || null,
        body.whatsapp_number ? normalizeIndianMobile(body.whatsapp_number) : null,
        body.designation || null,
        body.notes || null,
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Customer added successfully',
      customer: formatCustomerRow({ ...result.rows[0], total_security_amount: 0 }),
    });
  } catch (error) {
    console.error('storeCustomer:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const existing = await pool.query('SELECT * FROM customers WHERE customer_id = $1', [customerId]);
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const row = existing.rows[0];
    if (!isCustomerTypeAllowed(req.allowedCustomerTypes, row.customer_type)) {
      return res.status(403).json({ success: false, message: 'Access denied: customer is outside your Customer Access scope' });
    }
    const body = req.body || {};
    const details = parseDetails(row.details);

    const contactValidationErrors = validateFinanceSpockContactFields(body);
    if (contactValidationErrors.length) {
      return res.status(400).json({ success: false, message: contactValidationErrors[0] });
    }
    const phoneErrors = validateCustomerPhoneFields(body);
    if (phoneErrors.length) {
      return res.status(400).json({ success: false, message: phoneErrors[0] });
    }

    const name = body.customer_name || body.name || row.name;
    let companyName = body.company_name || row.company_name;
    const email = body.email ?? row.email;
    const phone = body.customer_number != null || body.phone != null
      ? normalizeIndianMobile(body.customer_number ?? body.phone)
      : row.phone;
    const whatsappNumber = body.whatsapp_number != null
      ? (String(body.whatsapp_number).trim() ? normalizeIndianMobile(body.whatsapp_number) : null)
      : row.whatsapp_number;
    const gstNo = body.gst_number ?? row.gst_no;
    const gstChanged = sanitizeGstin(gstNo) !== sanitizeGstin(row.gst_no);
    let tradeName = row.trade_name || '';
    if (String(body.trade_name || '').trim()) {
      tradeName = String(body.trade_name).trim();
    } else if (gstChanged) {
      const resolved = await resolveGstTradeName(gstNo, '');
      if (resolved) {
        tradeName = resolved;
        companyName = resolved;
      }
    }
    const panNumber = body.pan_number || body.pan_card_number || row.pan_number;

    await pool.query(
      `UPDATE customers SET
        name = $1, company_name = $2, trade_name = $3, email = $4, phone = $5, gst_no = $6,
        pan_number = $7, company_type = $8, company_size = $9, industry = $10,
        billing_address = $11, billing_city = $12, billing_state = $13, billing_pincode = $14,
        shipping_same = $15, shipping_address = $16, shipping_city = $17, shipping_state = $18, shipping_pincode = $19,
        whatsapp_number = $20, designation = $21, portal_enabled = COALESCE($22, portal_enabled),
        notes = COALESCE($23, notes), updated_at = NOW()
       WHERE customer_id = $24`,
      [
        name, companyName, tradeName || null, email, phone, gstNo, panNumber,
        body.company_type ?? row.company_type,
        body.company_size ?? row.company_size,
        body.industry ?? row.industry,
        body.billing_address ?? row.billing_address,
        body.billing_city ?? row.billing_city,
        body.billing_state ?? row.billing_state,
        body.billing_pincode ?? row.billing_pincode,
        body.shipping_same ?? row.shipping_same,
        body.shipping_address ?? row.shipping_address,
        body.shipping_city ?? row.shipping_city,
        body.shipping_state ?? row.shipping_state,
        body.shipping_pincode ?? row.shipping_pincode,
        whatsappNumber,
        body.designation ?? row.designation,
        body.portal_enabled !== undefined ? !!body.portal_enabled : null,
        body.notes ?? null,
        customerId,
      ]
    );

    if (body.customer_type != null && String(body.customer_type).trim() !== '') {
      if (!canEditCustomerType(req.user)) {
        const requested = normalizeCustomerType(body.customer_type);
        const current = normalizeCustomerType(row.customer_type);
        if (requested !== current) {
          return res.status(403).json({
            success: false,
            message: 'Only Admin / Super Admin can update Customer Type',
          });
        }
      } else {
        await pool.query(
          `UPDATE customers SET customer_type = $1, updated_at = NOW() WHERE customer_id = $2`,
          [normalizeCustomerType(body.customer_type), customerId]
        );
      }
    }

    let detailsChanged = false;
    if (body.contact_person_name !== undefined) {
      details.contact_person_name = body.contact_person_name || null;
      detailsChanged = true;
    } else if (body.customer_name !== undefined || body.name !== undefined) {
      details.contact_person_name = name || null;
      detailsChanged = true;
    }
    if (body.contact_person_number !== undefined) {
      details.contact_person_number = body.contact_person_number || null;
      detailsChanged = true;
    } else if (body.customer_number !== undefined || body.phone !== undefined) {
      details.contact_person_number = phone || null;
      detailsChanged = true;
    }
    for (const key of FINANCE_SPOCK_DETAIL_KEYS) {
      if (body[key] !== undefined) detailsChanged = true;
    }
    applyFinanceSpockDetails(details, body);
    if (detailsChanged) {
      await pool.query('UPDATE customers SET details = $1 WHERE customer_id = $2', [
        JSON.stringify(details),
        customerId,
      ]);
    }

    const updated = await pool.query(
      `SELECT c.*, COALESCE((
          SELECT SUM(sd.amount - COALESCE(sd.refund_amount, 0))
            FROM customer_security_deposits sd
           WHERE sd.customer_id = c.customer_id
             AND sd.status IN ('held', 'partially_refunded')
        ), 0) AS total_security_amount
       FROM customers c WHERE c.customer_id = $1`,
      [customerId]
    );
    res.json({ success: true, customer: formatCustomerRow(updated.rows[0]) });
  } catch (error) {
    console.error('updateCustomer:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** PATCH — activate (1) or deactivate (0) a customer. Inactive customers are hidden from SO/DC pickers. */
exports.updateCustomerStatus = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (!Number.isFinite(customerId) || customerId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }

    const raw = req.body?.status ?? req.body?.active;
    let nextStatus;
    if (raw === true || raw === 'true' || raw === 1 || raw === '1' || String(raw).toLowerCase() === 'active') {
      nextStatus = 1;
    } else if (raw === false || raw === 'false' || raw === 0 || raw === '0' || String(raw).toLowerCase() === 'inactive') {
      nextStatus = 0;
    } else {
      return res.status(400).json({
        success: false,
        message: 'status must be 1/active or 0/inactive',
      });
    }

    const existing = await pool.query(
      'SELECT customer_id, customer_type, status FROM customers WHERE customer_id = $1',
      [customerId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    if (!isCustomerTypeAllowed(req.allowedCustomerTypes, existing.rows[0].customer_type)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: customer is outside your Customer Access scope',
      });
    }

    const result = await pool.query(
      `UPDATE customers
          SET status = $1, updated_at = NOW()
        WHERE customer_id = $2
        RETURNING *`,
      [nextStatus, customerId]
    );

    res.json({
      success: true,
      message: nextStatus === 1 ? 'Customer activated' : 'Customer deactivated',
      customer: formatCustomerRow(result.rows[0]),
    });
  } catch (error) {
    console.error('updateCustomerStatus:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** PATCH — Admin/Super Admin bulk set customer_type for many customers. */
exports.bulkUpdateCustomerType = async (req, res) => {
  try {
    if (!canEditCustomerType(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Only Admin / Super Admin can update Customer Type',
      });
    }
    const customerType = normalizeCustomerType(req.body?.customer_type);
    const rawIds = Array.isArray(req.body?.customer_ids) ? req.body.customer_ids : [];
    const customerIds = [...new Set(
      rawIds.map((id) => parseInt(id, 10)).filter((id) => Number.isFinite(id) && id > 0)
    )];
    if (!customerIds.length) {
      return res.status(400).json({ success: false, message: 'Select at least one customer' });
    }
    if (!['sales', 'rental', 'both'].includes(String(req.body?.customer_type || '').toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'customer_type must be sales, rental, or both',
      });
    }

    const result = await pool.query(
      `UPDATE customers
          SET customer_type = $1, updated_at = NOW()
        WHERE customer_id = ANY($2::int[])
          AND COALESCE(status, 1) = 1
        RETURNING customer_id, name, company_name, customer_type`,
      [customerType, customerIds]
    );

    res.json({
      success: true,
      message: `Updated ${result.rowCount} customer(s) to ${customerType}`,
      updated_count: result.rowCount,
      customer_type: customerType,
      customers: result.rows.map((row) => ({
        customer_id: row.customer_id,
        name: row.name,
        company_name: row.company_name,
        customer_type: row.customer_type,
      })),
    });
  } catch (error) {
    console.error('bulkUpdateCustomerType:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.verifyCustomerKyc = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const result = await pool.query(
      `UPDATE customers SET kyc_verified = TRUE, kyc_status = 'verified',
              kyc_verified_by = $1, kyc_verified_at = NOW(), updated_at = NOW()
       WHERE customer_id = $2 RETURNING *`,
      [req.user.user_id, customerId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    res.json({ success: true, customer: formatCustomerRow(result.rows[0]) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

function podFromFilePath(raw) {
  const out = [];
  if (!raw) return out;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) out.push(...parsed.filter(Boolean));
    else if (parsed) out.push(String(parsed));
  } catch {
    out.push(raw);
  }
  return out;
}

function mapActiveAssetRow(r) {
  const podFiles = [
    ...podFromFilePath(r.pod_file_path),
    r.pod_image_url,
    r.pod_photo_url,
    r.pod_esign_url,
  ].filter(Boolean);
  return {
    serial_id: r.serial_id,
    ttspl_id: r.ttspl_id,
    serial_number: r.serial_number,
    brand: r.brand,
    model_name: r.model_name,
    processor: r.processor,
    generation: r.generation,
    ram: r.ram,
    storage: r.storage,
    gpu: r.gpu,
    screen_size: r.screen_size,
    status: displayDeployedStatus(r.status),
    entity_code: r.entity_code,
    dc_number: r.dc_number,
    dispatch_date: r.dispatch_date,
    delivered_at: r.delivered_at,
    rent_monthly_rate: r.rent_monthly_rate,
    lifecycle: 'active',
    dc_pdf_path: r.dc_pdf_path || null,
    pod_files: [...new Set(podFiles)],
  };
}

function mapReturnedAssetRow(r) {
  const podFiles = [
    r.proof_of_completion_path,
    r.pod_image_path,
    r.warehouse_esign_url,
  ].filter(Boolean);
  return {
    serial_id: r.serial_id,
    ttspl_id: r.ttspl_id,
    serial_number: r.serial_number,
    brand: r.brand,
    model_name: r.model_name,
    processor: r.processor,
    generation: r.generation,
    ram: r.ram,
    storage: r.storage,
    gpu: r.gpu,
    screen_size: r.screen_size,
    dc_number: r.dc_number,
    delivered_at: r.delivered_at,
    returned_at: r.returned_at,
    pickup_type: r.pickup_type,
    status: 'returned',
    lifecycle: 'returned',
    pod_files: [...new Set(podFiles)],
  };
}

function buildActiveSearchSql(search, params) {
  if (!search) return '';
  params.push(`%${search}%`);
  const i = params.length;
  return ` AND (
    vsn.serial_number ILIKE $${i}
    OR COALESCE(vsn.inventory_asset_code, '') ILIKE $${i}
    OR COALESCE(vsn.extra->>'ttspl_id', '') ILIKE $${i}
    OR COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', inv.model, '') ILIKE $${i}
    OR COALESCE(vsn.extra->>'brand', inv.brand, '') ILIKE $${i}
    OR COALESCE(vsn.current_dc_number, '') ILIKE $${i}
  )`;
}

function buildReturnedSearchSql(search, params) {
  if (!search) return '';
  params.push(`%${search}%`);
  const i = params.length;
  return ` AND (
    COALESCE(rl.dc_number, '') ILIKE $${i}
    OR COALESCE(sti.ttspl_id, '') ILIKE $${i}
    OR COALESCE(sti.unique_serial_number, '') ILIKE $${i}
    OR COALESCE(sti.serial_number, vsn.serial_number, '') ILIKE $${i}
    OR COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', rl.model_name, '') ILIKE $${i}
    OR COALESCE(vsn.extra->>'brand', rl.brand, '') ILIKE $${i}
  )`;
}

function parseCommaList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const RETURNED_PICKUP_TYPE_OPTIONS = ['return', 'repair', 'replacement'];

function resolveActiveInventoryStatuses(raw) {
  const selected = parseCommaList(raw);
  if (!selected.length) return [...DEPLOYED_WITH_CUSTOMER_STATUSES];
  const set = new Set();
  for (const s of selected) {
    if (DEPLOYED_WITH_CUSTOMER_STATUSES.includes(s)) set.add(s);
    if (s === 'rented') set.add('out_stock');
  }
  return set.size ? [...set] : [...DEPLOYED_WITH_CUSTOMER_STATUSES];
}

function resolveReturnedPickupTypes(raw) {
  const selected = parseCommaList(raw);
  if (!selected.length) return [];
  return selected.filter((s) => RETURNED_PICKUP_TYPE_OPTIONS.includes(s));
}

function buildReturnedPickupTypeSql(pickupTypes, params) {
  if (!pickupTypes?.length) return '';
  params.push(pickupTypes);
  return ` AND COALESCE(sti.pickup_type, 'return') = ANY($${params.length}::text[])`;
}

// Delivery-date range filters. Delivery date is compared in IST so it matches
// what the UI shows (timestamps are stored in UTC).
function buildActiveDateSql(from, to, params) {
  const expr = "(COALESCE(vsn.delivered_at, pod.delivery_completed_at) AT TIME ZONE 'Asia/Kolkata')::date";
  let sql = '';
  if (from) { params.push(from); sql += ` AND ${expr} >= $${params.length}`; }
  if (to) { params.push(to); sql += ` AND ${expr} <= $${params.length}`; }
  return sql;
}

function buildReturnedDateSql(from, to, params) {
  const expr = `(${RETURNED_AT_SQL} AT TIME ZONE 'Asia/Kolkata')::date`;
  let sql = '';
  if (from) { params.push(from); sql += ` AND ${expr} >= $${params.length}`; }
  if (to) { params.push(to); sql += ` AND ${expr} <= $${params.length}`; }
  return sql;
}

// Warehouse inward is the source of truth for customer return date; legacy rows without
// warehouse receipt keep rl.delivered_at / rl.created_at for backward compatibility.
const RETURN_WAREHOUSE_RECEIVED_AT_SQL = 'COALESCE(sti.warehouse_received_at, rl.warehouse_received_at)';
const RETURNED_AT_SQL = 'COALESCE(sti.warehouse_received_at, rl.warehouse_received_at, rl.delivered_at, rl.created_at)';
const RETURNED_BUCKET_ELIGIBLE_SQL = `(
  ${RETURN_WAREHOUSE_RECEIVED_AT_SQL} IS NOT NULL
  OR (
    sti.warehouse_received_at IS NULL
    AND rl.warehouse_received_at IS NULL
    AND (rl.delivered_at IS NOT NULL OR LOWER(COALESCE(rl.status, '')) = 'delivered')
  )
)`;

// Exclude a unit from Active when its return was fully received in the warehouse.
const ACTIVE_EXCLUDE_WAREHOUSE_RETURNED_SQL = `
    AND NOT EXISTS (
      SELECT 1
        FROM support_ticket_items sti_done
        JOIN delivery_challan_lines rl_done ON rl_done.dc_number = sti_done.return_dc_number
       WHERE sti_done.item_type = 'pickup'
         AND rl_done.movement_type = 'return'
         AND rl_done.customer_id = $1
         AND COALESCE(rl_done.status, '') NOT IN ('cancelled')
         AND sti_done.warehouse_received_at IS NOT NULL
         AND NOT (
           vsn.current_customer_id = $1
           AND vsn.inventory_status IN ('rented', 'on_demo', 'in_transit')
         )
         AND (
           sti_done.ttspl_id = vsn.inventory_asset_code
           OR sti_done.unique_serial_number = vsn.inventory_asset_code
           OR sti_done.serial_number = vsn.serial_number
         )
         AND NOT EXISTS (
           SELECT 1
             FROM outbound_reout o
            WHERE o.out_at > COALESCE(sti_done.warehouse_received_at, rl_done.delivered_at, rl_done.created_at)
              AND (
                (o.ttspl IS NOT NULL AND o.ttspl = vsn.inventory_asset_code)
                OR (o.serial_no IS NOT NULL AND o.serial_no = vsn.serial_number)
                OR (o.serial_id IS NOT NULL AND o.serial_id = vsn.serial_id)
              )
         )
    )
    AND NOT EXISTS (
      SELECT 1
        FROM delivery_challan_lines rl_legacy
       WHERE rl_legacy.movement_type = 'return'
         AND rl_legacy.customer_id = $1
         AND COALESCE(rl_legacy.status, '') NOT IN ('cancelled')
         AND rl_legacy.warehouse_received_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM support_ticket_items sti_x
            WHERE sti_x.return_dc_number = rl_legacy.dc_number
              AND sti_x.item_type = 'pickup'
         )
         AND NOT (
           vsn.current_customer_id = $1
           AND vsn.inventory_status IN ('rented', 'on_demo', 'in_transit')
         )
         AND (
           vsn.inventory_asset_code = NULLIF(split_part(rl_legacy.serial_number->>0, '|', 3), '')
           OR vsn.serial_number = NULLIF(split_part(rl_legacy.serial_number->>0, '|', 2), '')
         )
         AND NOT EXISTS (
           SELECT 1
             FROM outbound_reout o
            WHERE o.out_at > COALESCE(rl_legacy.warehouse_received_at, rl_legacy.delivered_at, rl_legacy.created_at)
              AND (
                (o.ttspl IS NOT NULL AND o.ttspl = vsn.inventory_asset_code)
                OR (o.serial_no IS NOT NULL AND o.serial_no = vsn.serial_number)
                OR (o.serial_id IS NOT NULL AND o.serial_id = vsn.serial_id)
              )
         )
    )
`;

// Prefer OEM serial match over machine_number (TTSPL) to avoid duplicate rows when stale
// inventory rows share a TTSPL code with a different physical unit.
const INVENTORY_JOIN_SQL = `
  LEFT JOIN LATERAL (
    SELECT inv.brand, inv.model, inv.processor, inv.generation, inv.ram, inv.storage,
           inv.gpu, inv.screen_size, inv.inventory_id
      FROM inventory inv
     WHERE inv.serial_number = vsn.serial_number
        OR (
          vsn.inventory_asset_code IS NOT NULL
          AND inv.machine_number = vsn.inventory_asset_code
        )
     ORDER BY CASE WHEN inv.serial_number = vsn.serial_number THEN 0 ELSE 1 END,
              inv.inventory_id ASC
     LIMIT 1
  ) inv ON TRUE`;

const POD_JOIN_SQL = `
  LEFT JOIN LATERAL (
    SELECT dcl.file_path, dcl.pod_image_url, dcl.pod_photo_url, dcl.esign_url,
           dcl.pdf_path, dcl.delivery_completed_at, dcl.dispatched_at
    FROM delivery_challan_lines dcl
    WHERE dcl.dc_number = vsn.current_dc_number
      AND COALESCE(dcl.movement_type, 'outbound') = 'outbound'
    ORDER BY dcl.delivery_completed_at DESC NULLS LAST, dcl.id DESC
    LIMIT 1
  ) pod ON TRUE`;

const RATE_JOIN_SQL = `
  LEFT JOIN LATERAL (
    SELECT sol.rate
      FROM sales_order_serials sos
      JOIN sales_order_lines sol ON sol.id = sos.line_id
     WHERE sos.serial_id = vsn.serial_id
       AND sos.status <> 'removed'
       AND (
         vsn.current_dc_number IS NULL
         OR sos.dc_number = vsn.current_dc_number
       )
     ORDER BY sos.allocation_id DESC
     LIMIT 1
  ) sos_rate ON TRUE`;

// Expand each outbound DC's jsonb serials once per customer instead of once per laptop.
const ACTIVE_OUTBOUND_REOUT_CTE = `
WITH outbound_reout AS MATERIALIZED (
  SELECT
    COALESCE(dcl.delivered_at, dcl.delivery_completed_at, dcl.created_at) AS out_at,
    NULLIF(split_part(out_elem, '|', 3), '') AS ttspl,
    NULLIF(split_part(out_elem, '|', 2), '') AS serial_no,
    CASE
      WHEN NULLIF(REGEXP_REPLACE(split_part(out_elem, '|', 1), '[^0-9]', '', 'g'), '') ~ '^[0-9]+$'
      THEN NULLIF(REGEXP_REPLACE(split_part(out_elem, '|', 1), '[^0-9]', '', 'g'), '')::int
      ELSE NULL
    END AS serial_id
  FROM delivery_challan_lines dcl
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(dcl.serial_number) = 'array'
         THEN dcl.serial_number ELSE '[]'::jsonb END
  ) AS out_elem
  WHERE dcl.customer_id = $1
    AND COALESCE(dcl.movement_type, 'outbound') = 'outbound'
    AND COALESCE(dcl.status, '') = 'delivered'
)
`;

function withActiveCte(sql) {
  return `${ACTIVE_OUTBOUND_REOUT_CTE}${sql}`;
}

const ACTIVE_WHERE_SQL = `
  WHERE vsn.current_customer_id = $1
    AND vsn.deleted_at IS NULL
    AND vsn.inventory_status = ANY($2::text[])
    -- Pending return DC / pickup stays Active until warehouse inward.
    -- Only a warehouse-received return moves the unit to Returned.
    ${ACTIVE_EXCLUDE_WAREHOUSE_RETURNED_SQL}
`;

const ACTIVE_CORE_FROM_SQL = `
  FROM vendor_serial_numbers vsn
  ${ACTIVE_WHERE_SQL}
`;

const ACTIVE_FROM_SQL = `
  FROM vendor_serial_numbers vsn
  ${INVENTORY_JOIN_SQL}
  ${POD_JOIN_SQL}
  ${RATE_JOIN_SQL}
  ${ACTIVE_WHERE_SQL}
`;

const ACTIVE_SELECT_SQL = `
  SELECT vsn.serial_id,
         COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
         vsn.serial_number,
         COALESCE(vsn.extra->>'brand', inv.brand) AS brand,
         COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', inv.model) AS model_name,
         COALESCE(vsn.extra->>'processor', inv.processor) AS processor,
         vsn.extra->>'generation' AS generation,
         COALESCE(vsn.extra->>'ram', inv.ram) AS ram,
         COALESCE(vsn.extra->>'storage', inv.storage) AS storage,
         vsn.extra->>'gpu' AS gpu,
         vsn.extra->>'screen_size' AS screen_size,
         vsn.inventory_status AS status,
         vsn.current_entity AS entity_code,
         vsn.current_dc_number AS dc_number,
         COALESCE(vsn.dispatched_at, pod.dispatched_at) AS dispatch_date,
         COALESCE(vsn.delivered_at, pod.delivery_completed_at) AS delivered_at,
         vsn.rent_start_date,
         COALESCE(NULLIF(vsn.rent_monthly_rate, 0), sos_rate.rate) AS rent_monthly_rate,
         pod.file_path AS pod_file_path,
         pod.pod_image_url AS pod_image_url,
         pod.pod_photo_url AS pod_photo_url,
         pod.esign_url AS pod_esign_url,
         pod.pdf_path AS dc_pdf_path
`;

const RETURNED_FROM_SQL = `
  FROM delivery_challan_lines rl
  LEFT JOIN support_ticket_items sti
    ON sti.return_dc_number = rl.dc_number
   AND sti.item_type = 'pickup'
  LEFT JOIN LATERAL (
    SELECT v.serial_id, v.serial_number, v.inventory_asset_code, v.extra, v.current_entity,
           v.rent_monthly_rate, v.delivered_at, v.current_customer_id, v.inventory_status
    FROM vendor_serial_numbers v
    WHERE v.deleted_at IS NULL
      AND (
        (sti.ttspl_id IS NOT NULL AND v.inventory_asset_code = sti.ttspl_id)
        OR (sti.unique_serial_number IS NOT NULL AND v.inventory_asset_code = sti.unique_serial_number)
        OR (sti.serial_number IS NOT NULL AND v.serial_number = sti.serial_number)
        OR v.inventory_asset_code = NULLIF(split_part(rl.serial_number->>0, '|', 3), '')
        OR v.serial_number = NULLIF(split_part(rl.serial_number->>0, '|', 2), '')
      )
    LIMIT 1
  ) vsn ON TRUE
  LEFT JOIN LATERAL (
    SELECT COALESCE(dcl.delivered_at, dcl.delivery_completed_at) AS delivered_at
      FROM delivery_challan_lines dcl
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(dcl.serial_number) = 'array' THEN dcl.serial_number ELSE '[]'::jsonb END
      ) AS elem
     WHERE vsn.serial_id IS NOT NULL
       AND COALESCE(dcl.movement_type, 'outbound') = 'outbound'
       AND dcl.customer_id = rl.customer_id
       AND dcl.status = 'delivered'
       AND NULLIF(REGEXP_REPLACE(split_part(elem, '|', 1), '[^0-9]', '', 'g'), '')::int = vsn.serial_id
       AND COALESCE(dcl.delivered_at, dcl.delivery_completed_at, dcl.created_at)
           <= ${RETURNED_AT_SQL}
     ORDER BY COALESCE(dcl.delivered_at, dcl.delivery_completed_at) DESC NULLS LAST
     LIMIT 1
  ) outbound ON TRUE
  WHERE rl.movement_type = 'return'
    AND rl.customer_id = $1
    AND COALESCE(rl.status, '') NOT IN ('cancelled')
    AND ${RETURNED_BUCKET_ELIGIBLE_SQL}
    AND NOT (
      vsn.current_customer_id = $1
      AND vsn.inventory_status IN ('rented', 'on_demo', 'in_transit')
    )
`;

const RETURNED_SELECT_SQL = `
  SELECT vsn.serial_id,
         rl.dc_number AS dc_number,
         rl.created_at,
         ${RETURNED_AT_SQL} AS returned_at,
         outbound.delivered_at AS delivered_at,
         COALESCE(sti.ttspl_id, sti.unique_serial_number, vsn.inventory_asset_code,
                  vsn.extra->>'ttspl_id', NULLIF(split_part(rl.serial_number->>0, '|', 3), '')) AS ttspl_id,
         COALESCE(sti.serial_number, vsn.serial_number,
                  NULLIF(split_part(rl.serial_number->>0, '|', 2), '')) AS serial_number,
         COALESCE(vsn.extra->>'brand', rl.brand) AS brand,
         COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', rl.model_name) AS model_name,
         vsn.extra->>'processor' AS processor,
         vsn.extra->>'generation' AS generation,
         vsn.extra->>'ram' AS ram,
         vsn.extra->>'storage' AS storage,
         vsn.extra->>'gpu' AS gpu,
         vsn.extra->>'screen_size' AS screen_size,
         vsn.current_entity AS entity_code,
         vsn.rent_monthly_rate,
         sti.pickup_type,
         sti.proof_of_completion_path,
         sti.pod_image_path,
         sti.warehouse_esign_url
`;

const RETURNED_COUNT_FROM_SQL = `
  FROM delivery_challan_lines rl
  LEFT JOIN support_ticket_items sti
    ON sti.return_dc_number = rl.dc_number
   AND sti.item_type = 'pickup'
  LEFT JOIN LATERAL (
    SELECT v.current_customer_id, v.inventory_status
      FROM vendor_serial_numbers v
     WHERE v.deleted_at IS NULL
       AND (
         (sti.ttspl_id IS NOT NULL AND v.inventory_asset_code = sti.ttspl_id)
         OR v.inventory_asset_code = NULLIF(split_part(rl.serial_number->>0, '|', 3), '')
         OR v.serial_number = NULLIF(split_part(rl.serial_number->>0, '|', 2), '')
       )
     LIMIT 1
  ) vsn ON TRUE
  WHERE rl.movement_type = 'return'
    AND rl.customer_id = $1
    AND COALESCE(rl.status, '') NOT IN ('cancelled')
    AND ${RETURNED_BUCKET_ELIGIBLE_SQL}
    AND NOT (
      vsn.current_customer_id = $1
      AND vsn.inventory_status IN ('rented', 'on_demo', 'in_transit')
    )
`;

function activeFilterFromSql({ search = '', from = '', to = '' } = {}) {
  const needsInv = Boolean(search);
  const needsPod = Boolean(from || to);
  if (!needsInv && !needsPod) return ACTIVE_CORE_FROM_SQL;
  return `
  FROM vendor_serial_numbers vsn
  ${needsInv ? INVENTORY_JOIN_SQL : ''}
  ${needsPod ? POD_JOIN_SQL : ''}
  ${ACTIVE_WHERE_SQL}
`;
}

async function countCustomerActiveAssets(customerId) {
  const { rows } = await pool.query(
    withActiveCte(`SELECT COUNT(*)::int AS total ${ACTIVE_CORE_FROM_SQL}`),
    [customerId, DEPLOYED_WITH_CUSTOMER_STATUSES]
  );
  return rows[0]?.total || 0;
}

async function countCustomerReturnedAssets(customerId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total ${RETURNED_COUNT_FROM_SQL}`,
    [customerId]
  );
  return rows[0]?.total || 0;
}

async function queryCustomerActiveAssets(customerId, { search = '', from = '', to = '', statuses = '', limit, offset, skipCount = false } = {}) {
  const statusList = resolveActiveInventoryStatuses(statuses);
  const params = [customerId, statusList];
  const searchSql = buildActiveSearchSql(search, params);
  const dateSql = buildActiveDateSql(from, to, params);
  const filterFrom = `${activeFilterFromSql({ search, from, to })}${searchSql}${dateSql}`;
  const hydrateFrom = `${ACTIVE_FROM_SQL}${searchSql}${dateSql}`;

  const countSql = withActiveCte(`SELECT COUNT(*)::int AS total ${filterFrom}`);
  let listSql = withActiveCte(
    `${ACTIVE_SELECT_SQL} ${hydrateFrom} ORDER BY COALESCE(vsn.delivered_at, pod.delivery_completed_at) DESC NULLS LAST, vsn.serial_id DESC`
  );
  const listParams = [...params];
  if (limit != null) {
    listParams.push(limit, offset || 0);
    listSql += ` LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`;
  }

  if (skipCount) {
    const { rows } = await pool.query(listSql, listParams);
    return { rows: rows.map(mapActiveAssetRow), total: undefined };
  }

  const [countR, listR] = await Promise.all([
    pool.query(countSql, params),
    pool.query(listSql, listParams),
  ]);
  return { rows: listR.rows.map(mapActiveAssetRow), total: countR.rows[0]?.total || 0 };
}

// Exposed so the customer portal serves the same deployed-asset rows as this
// screen instead of maintaining a second copy of the query.
exports.queryCustomerActiveAssets = queryCustomerActiveAssets;

async function queryCustomerReturnedAssets(customerId, { search = '', from = '', to = '', statuses = '', limit, offset, skipCount = false } = {}) {
  const params = [customerId];
  const searchSql = buildReturnedSearchSql(search, params);
  const dateSql = buildReturnedDateSql(from, to, params);
  const pickupTypeSql = buildReturnedPickupTypeSql(resolveReturnedPickupTypes(statuses), params);
  const fromWhere = `${RETURNED_FROM_SQL}${searchSql}${dateSql}${pickupTypeSql}`;

  let total;
  if (!skipCount) {
    const countR = await pool.query(`SELECT COUNT(*)::int AS total ${fromWhere}`, params);
    total = countR.rows[0]?.total || 0;
  }

  let listSql = `${RETURNED_SELECT_SQL} ${fromWhere} ORDER BY ${RETURNED_AT_SQL} DESC NULLS LAST, rl.id DESC`;
  const listParams = [...params];
  if (limit != null) {
    listParams.push(limit, offset || 0);
    listSql += ` LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`;
  }

  const { rows } = await pool.query(listSql, listParams);
  return { rows: rows.map(mapReturnedAssetRow), total };
}

exports.queryCustomerReturnedAssets = queryCustomerReturnedAssets;

async function serialInCustomerReturnedHistory(client, customerId, serialId) {
  const { rows } = await client.query(
    `SELECT 1
       FROM delivery_challan_lines rl
       LEFT JOIN LATERAL (
         SELECT v.serial_id, v.inventory_asset_code, v.serial_number AS vsn_serial
           FROM vendor_serial_numbers v
          WHERE v.deleted_at IS NULL
            AND v.serial_id = $2
          LIMIT 1
       ) matched ON TRUE
       LEFT JOIN LATERAL (
         SELECT sti.ttspl_id, sti.unique_serial_number, sti.serial_number,
                sti.warehouse_received_at
           FROM support_ticket_items sti
          WHERE sti.return_dc_number = rl.dc_number
            AND sti.item_type = 'pickup'
            AND matched.serial_id IS NOT NULL
            AND (
              (sti.ttspl_id IS NOT NULL AND sti.ttspl_id = matched.inventory_asset_code)
              OR (sti.unique_serial_number IS NOT NULL AND sti.unique_serial_number = matched.inventory_asset_code)
              OR (sti.serial_number IS NOT NULL AND sti.serial_number = matched.vsn_serial)
              OR matched.inventory_asset_code = NULLIF(split_part(rl.serial_number->>0, '|', 3), '')
              OR matched.vsn_serial = NULLIF(split_part(rl.serial_number->>0, '|', 2), '')
            )
          ORDER BY sti.warehouse_received_at DESC NULLS LAST, sti.id DESC
          LIMIT 1
       ) sti ON TRUE
      WHERE rl.movement_type = 'return'
        AND rl.customer_id = $1
        AND COALESCE(rl.status, '') NOT IN ('cancelled')
        AND matched.serial_id IS NOT NULL
        AND (
          matched.inventory_asset_code = NULLIF(split_part(rl.serial_number->>0, '|', 3), '')
          OR matched.vsn_serial = NULLIF(split_part(rl.serial_number->>0, '|', 2), '')
          OR sti.ttspl_id IS NOT NULL
          OR sti.unique_serial_number IS NOT NULL
          OR sti.serial_number IS NOT NULL
        )
        AND (
          ${RETURN_WAREHOUSE_RECEIVED_AT_SQL} IS NOT NULL
          OR (
            sti.warehouse_received_at IS NULL
            AND rl.warehouse_received_at IS NULL
            AND (rl.delivered_at IS NOT NULL OR LOWER(COALESCE(rl.status, '')) = 'delivered')
          )
        )
      LIMIT 1`,
    [customerId, serialId]
  );
  return rows.length > 0;
}

async function getCustomerReturnAssetContext(client, customerId, serialId, returnDcNumber = null) {
  const params = [customerId, serialId];
  let dcClause = '';
  if (returnDcNumber) {
    params.push(String(returnDcNumber).trim());
    dcClause = `AND rl.dc_number = $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT rl.dc_number,
            rl.delivered_at,
            rl.warehouse_received_at,
            sti.id AS pickup_item_id,
            sti.warehouse_received_at AS pickup_warehouse_received_at,
            ${RETURNED_AT_SQL} AS return_date
       FROM delivery_challan_lines rl
       LEFT JOIN LATERAL (
         SELECT v.serial_id, v.inventory_asset_code, v.serial_number AS vsn_serial
           FROM vendor_serial_numbers v
          WHERE v.deleted_at IS NULL
            AND v.serial_id = $2
          LIMIT 1
       ) matched ON TRUE
       LEFT JOIN LATERAL (
         SELECT sti.id, sti.ttspl_id, sti.unique_serial_number, sti.serial_number,
                sti.warehouse_received_at
           FROM support_ticket_items sti
          WHERE sti.return_dc_number = rl.dc_number
            AND sti.item_type = 'pickup'
            AND matched.serial_id IS NOT NULL
            AND (
              (sti.ttspl_id IS NOT NULL AND sti.ttspl_id = matched.inventory_asset_code)
              OR (sti.unique_serial_number IS NOT NULL AND sti.unique_serial_number = matched.inventory_asset_code)
              OR (sti.serial_number IS NOT NULL AND sti.serial_number = matched.vsn_serial)
              OR matched.inventory_asset_code = NULLIF(split_part(rl.serial_number->>0, '|', 3), '')
              OR matched.vsn_serial = NULLIF(split_part(rl.serial_number->>0, '|', 2), '')
            )
          ORDER BY sti.warehouse_received_at DESC NULLS LAST, sti.id DESC
          LIMIT 1
       ) sti ON TRUE
      WHERE rl.movement_type = 'return'
        AND rl.customer_id = $1
        AND COALESCE(rl.status, '') NOT IN ('cancelled')
        AND matched.serial_id IS NOT NULL
        AND (
          matched.inventory_asset_code = NULLIF(split_part(rl.serial_number->>0, '|', 3), '')
          OR matched.vsn_serial = NULLIF(split_part(rl.serial_number->>0, '|', 2), '')
          OR sti.ttspl_id IS NOT NULL
          OR sti.unique_serial_number IS NOT NULL
          OR sti.serial_number IS NOT NULL
        )
        AND (
          ${RETURN_WAREHOUSE_RECEIVED_AT_SQL} IS NOT NULL
          OR (
            sti.warehouse_received_at IS NULL
            AND rl.warehouse_received_at IS NULL
            AND (rl.delivered_at IS NOT NULL OR LOWER(COALESCE(rl.status, '')) = 'delivered')
          )
        )
        ${dcClause}
      ORDER BY ${RETURNED_AT_SQL} DESC NULLS LAST, rl.id DESC
      LIMIT 1`,
    params
  );
  return rows[0] || null;
}

function isActiveCustomerHeldAsset(row, customerId) {
  return parseInt(row.current_customer_id, 10) === customerId
    && DEPLOYED_WITH_CUSTOMER_STATUSES.includes(String(row.inventory_status || ''));
}

// "Assets with Customer" — derived from the authoritative inventory
// (vendor_serial_numbers), replacing the deprecated customer_inventory table.
/** Edit deployed asset specs / monthly rate for a customer-held serial. */
exports.updateCustomerAsset = async (req, res) => {
  const client = await pool.connect();
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const serialId = parseInt(req.params.serialId, 10);
    if (!customerId || !serialId) {
      return res.status(400).json({ success: false, message: 'Invalid customer or serial id' });
    }

    const access = await checkCustomerAccessById(req, customerId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const specPayload = {};
    for (const field of CUSTOMER_ASSET_SPEC_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
        const val = req.body[field];
        specPayload[field] = val == null ? '' : String(val).trim();
      }
    }

    let rentMonthlyRate;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'rent_monthly_rate')) {
      const raw = req.body.rent_monthly_rate;
      if (raw == null || raw === '') {
        rentMonthlyRate = null;
      } else {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          return res.status(400).json({ success: false, message: 'Invalid monthly rate' });
        }
        rentMonthlyRate = n;
      }
    }

    let dcNumber;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'dc_number')) {
      const raw = req.body.dc_number;
      dcNumber = raw == null || raw === '' ? null : String(raw).trim();
    }

    let dispatchedAt;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'dispatched_at')) {
      const raw = req.body.dispatched_at;
      if (raw == null || raw === '') {
        dispatchedAt = null;
      } else {
        dispatchedAt = normalizeAssetDateField(raw);
        if (!dispatchedAt) {
          return res.status(400).json({ success: false, message: 'Invalid dispatch date' });
        }
      }
    }

    let deliveredAt;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'delivered_at')) {
      const raw = req.body.delivered_at;
      if (raw == null || raw === '') {
        deliveredAt = null;
      } else {
        deliveredAt = normalizeAssetDateField(raw);
        if (!deliveredAt) {
          return res.status(400).json({ success: false, message: 'Invalid delivery date' });
        }
      }
    }

    let returnedAt;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'returned_at')) {
      const raw = req.body.returned_at;
      if (raw == null || raw === '') {
        returnedAt = null;
      } else {
        returnedAt = normalizeAssetDateField(raw);
        if (!returnedAt) {
          return res.status(400).json({ success: false, message: 'Invalid return date' });
        }
      }
    }

    if (
      !Object.keys(specPayload).length
      && rentMonthlyRate === undefined
      && dcNumber === undefined
      && dispatchedAt === undefined
      && deliveredAt === undefined
      && returnedAt === undefined
    ) {
      return res.status(400).json({ success: false, message: 'Provide at least one field to update' });
    }

    await client.query('BEGIN');

    const cur = await client.query(
      `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code, vsn.extra,
              vsn.inventory_status, vsn.current_customer_id, vsn.rent_monthly_rate,
              vsn.current_dc_number, vsn.delivered_at, vsn.rent_start_date,
              vsn.dispatch_mode, vsn.dispatched_at,
              inv.inventory_id, inv.inv_brand, inv.inv_model,
              inv.inv_processor, inv.inv_generation,
              inv.inv_ram, inv.inv_storage, inv.inv_gpu,
              inv.inv_screen_size
         FROM vendor_serial_numbers vsn
         LEFT JOIN LATERAL (
           SELECT inv.inventory_id, inv.brand AS inv_brand, inv.model AS inv_model,
                  inv.processor AS inv_processor, inv.generation AS inv_generation,
                  inv.ram AS inv_ram, inv.storage AS inv_storage, inv.gpu AS inv_gpu,
                  inv.screen_size AS inv_screen_size
             FROM inventory inv
            WHERE inv.serial_number = vsn.serial_number
               OR (
                 vsn.inventory_asset_code IS NOT NULL
                 AND inv.machine_number = vsn.inventory_asset_code
               )
            ORDER BY CASE WHEN inv.serial_number = vsn.serial_number THEN 0 ELSE 1 END,
                     inv.inventory_id ASC
            LIMIT 1
         ) inv ON TRUE
        WHERE vsn.serial_id = $1
          AND vsn.deleted_at IS NULL
        FOR UPDATE OF vsn`,
      [serialId]
    );

    if (!cur.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Serial not found' });
    }

    const row = cur.rows[0];
    const isActiveHeld = isActiveCustomerHeldAsset(row, customerId);
    const isReturnedHistory = !isActiveHeld
      ? await serialInCustomerReturnedHistory(client, customerId, serialId)
      : false;

    if (!isActiveHeld && !isReturnedHistory) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Asset not found for this customer' });
    }

    const returnOnly = isReturnedHistory && !isActiveHeld;
    const returnDcHint = dcNumber !== undefined
      ? dcNumber
      : (req.body?.return_dc_number ? String(req.body.return_dc_number).trim() : null);
    const returnCtx = returnOnly
      ? await getCustomerReturnAssetContext(client, customerId, serialId, returnDcHint)
      : null;

    const extra = parseExtra(row.extra);
    let before = buildAssetBeforeState(row, extra);
    if (returnCtx) {
      before = {
        ...before,
        dc_number: returnCtx.dc_number || before.dc_number,
        delivered_at: normalizeAssetDateField(row.delivered_at) || '',
        returned_at: normalizeAssetDateField(returnCtx.return_date) || '',
      };
    }
    const changes = buildAssetChangeSet(before, {
      specPayload,
      rentMonthlyRate,
      dcNumber,
      dispatchedAt,
      deliveredAt,
      returnedAt,
    });

    if (!changes.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'No changes detected' });
    }

    if (returnOnly) {
      for (const ch of changes) {
        if (ch.field === 'delivered_at') ch.label = 'Delivered to customer';
        if (ch.field === 'returned_at') ch.label = 'Return date';
      }
    }

    for (const [key, val] of Object.entries(specPayload)) {
      if (val) extra[key] = val;
      else delete extra[key];
      if (key === 'model') {
        if (val) extra.model_name = val;
        else delete extra.model_name;
      }
    }
    if (Object.keys(specPayload).length) {
      extra.spec_source = 'customer_asset_edit';
      extra.spec_corrected_at = new Date().toISOString();
      extra.spec_corrected_by = req.user?.user_id || null;
    }

    const vsnPatch = [];
    const vsnParams = [];
    let p = 1;
    if (Object.keys(specPayload).length) {
      vsnPatch.push(`extra = $${p++}::jsonb`);
      vsnParams.push(JSON.stringify(extra));
    }
    if (rentMonthlyRate !== undefined) {
      vsnPatch.push(`rent_monthly_rate = $${p++}`);
      vsnParams.push(rentMonthlyRate);
    }
    if (dcNumber !== undefined && isActiveHeld) {
      vsnPatch.push(`current_dc_number = $${p++}`);
      vsnParams.push(dcNumber);
    }
    if (dispatchedAt !== undefined && !returnOnly) {
      vsnPatch.push(`dispatched_at = $${p++}::timestamptz`);
      vsnParams.push(dispatchedAt ? `${dispatchedAt}T12:00:00.000Z` : null);
    }
    if (deliveredAt !== undefined) {
      vsnPatch.push(`delivered_at = $${p++}::timestamptz`);
      vsnParams.push(deliveredAt ? `${deliveredAt}T12:00:00.000Z` : null);
    }

    const effectiveDispatchedAt = dispatchedAt !== undefined
      ? (dispatchedAt ? `${dispatchedAt}T12:00:00.000Z` : null)
      : row.dispatched_at;
    const effectiveDeliveredAt = deliveredAt !== undefined
      ? (deliveredAt ? `${deliveredAt}T12:00:00.000Z` : null)
      : row.delivered_at;

    if (!returnOnly && (deliveredAt !== undefined || dispatchedAt !== undefined)) {
      const { rentStartForSerial } = require('../services/deliveryDateService');
      const rentStart = rentStartForSerial({
        dispatchMode: row.dispatch_mode,
        dispatchedAt: effectiveDispatchedAt,
        deliveredAt: effectiveDeliveredAt,
        inventoryStatus: row.inventory_status,
      });
      if (rentStart) {
        const rentStartStr = rentStart.toISOString().slice(0, 10);
        vsnPatch.push(`rent_start_date = $${p++}`);
        vsnParams.push(rentStartStr);
        const beforeRent = row.rent_start_date ? String(row.rent_start_date).slice(0, 10) : '';
        if (beforeRent !== rentStartStr) {
          changes.push({
            field: 'rent_start_date',
            before: beforeRent,
            after: rentStartStr,
          });
        }
      }
    }
    vsnPatch.push('updated_at = NOW()');
    vsnParams.push(serialId);

    await client.query(
      `UPDATE vendor_serial_numbers SET ${vsnPatch.join(', ')} WHERE serial_id = $${p}`,
      vsnParams
    );

    const effectiveDcNumber = dcNumber !== undefined ? dcNumber : row.current_dc_number;
    if (dispatchedAt !== undefined && effectiveDcNumber && isActiveHeld) {
      await client.query(
        `UPDATE delivery_challan_lines
            SET dispatched_at = $1::timestamptz,
                updated_at = NOW()
          WHERE dc_number = $2
            AND customer_id = $3
            AND COALESCE(movement_type, 'outbound') = 'outbound'`,
        [dispatchedAt ? `${dispatchedAt}T12:00:00.000Z` : null, effectiveDcNumber, customerId]
      );
    }
    if (deliveredAt !== undefined && effectiveDcNumber && isActiveHeld) {
      await client.query(
        `UPDATE delivery_challan_lines
            SET delivered_at = $1::timestamptz,
                delivery_completed_at = $1::timestamptz,
                updated_at = NOW()
          WHERE dc_number = $2
            AND customer_id = $3
            AND COALESCE(movement_type, 'outbound') = 'outbound'`,
        [`${deliveredAt}T12:00:00.000Z`, effectiveDcNumber, customerId]
      );
    }
    if (returnedAt !== undefined && returnOnly) {
      const returnDcNumber = returnCtx?.dc_number || returnDcHint;
      if (!returnDcNumber) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Return DC not found for this asset' });
      }
      const returnTs = returnedAt ? `${returnedAt}T12:00:00.000Z` : null;
      if (returnCtx?.pickup_item_id) {
        await client.query(
          `UPDATE support_ticket_items
              SET warehouse_received_at = $1::timestamptz,
                  updated_at = NOW()
            WHERE id = $2`,
          [returnTs, returnCtx.pickup_item_id]
        );
      } else {
        await client.query(
          `UPDATE delivery_challan_lines
              SET warehouse_received_at = $1::timestamptz,
                  delivered_at = COALESCE($1::timestamptz, delivered_at),
                  updated_at = NOW()
            WHERE dc_number = $2
              AND customer_id = $3
              AND movement_type = 'return'`,
          [returnTs, returnDcNumber, customerId]
        );
      }
    }

    let invRow = null;
    if (row.inventory_id && Object.keys(specPayload).length) {
      const invUpdates = [];
      const invParams = [];
      let i = 1;
      const setInv = (col, key) => {
        if (!Object.prototype.hasOwnProperty.call(specPayload, key)) return;
        invUpdates.push(`${col} = $${i++}`);
        invParams.push(specPayload[key] || null);
      };
      setInv('brand', 'brand');
      setInv('model', 'model');
      setInv('processor', 'processor');
      setInv('generation', 'generation');
      setInv('ram', 'ram');
      setInv('storage', 'storage');
      setInv('gpu', 'gpu');
      setInv('screen_size', 'screen_size');
      if (invUpdates.length) {
        invUpdates.push('updated_at = CURRENT_TIMESTAMP');
        invParams.push(row.inventory_id);
        const invRes = await client.query(
          `UPDATE inventory SET ${invUpdates.join(', ')} WHERE inventory_id = $${i} RETURNING *`,
          invParams
        );
        invRow = invRes.rows[0] || null;
      }
    }

    let productionAssetSync = null;
    if (Object.keys(specPayload).length) {
      const syncRow = invRow || {
        serial_number: row.serial_number,
        machine_number: row.inventory_asset_code,
        brand: specPayload.brand ?? extra.brand ?? row.inv_brand,
        model: specPayload.model ?? extra.model ?? extra.model_name ?? row.inv_model,
        processor: specPayload.processor ?? extra.processor ?? row.inv_processor,
        generation: specPayload.generation ?? extra.generation ?? row.inv_generation,
        ram: specPayload.ram ?? extra.ram ?? row.inv_ram,
        storage: specPayload.storage ?? extra.storage ?? row.inv_storage,
        gpu: specPayload.gpu ?? extra.gpu ?? row.inv_gpu,
        screen_size: specPayload.screen_size ?? extra.screen_size ?? row.inv_screen_size,
      };
      try {
        productionAssetSync = await productionAssetService.syncWorkingConfigFromInventory(
          client,
          syncRow,
          req.user?.user_id
        );
      } catch (paErr) {
        console.error('updateCustomerAsset production asset sync:', paErr.message);
      }
    }

    await client.query('COMMIT');
    invalidateCustomerLaptopsCache(customerId);

    const ttsplId = row.inventory_asset_code || row.serial_number;
    await logCustomerAssetEdit({
      customerId,
      serialId,
      ttsplId,
      serialNumber: row.serial_number,
      changes,
      actorUserId: req.user?.user_id,
      actorName: req.user?.name || null,
    });

    const responsePayload = {
      ...specPayload,
      model_name: specPayload.model ?? extra.model_name,
    };
    if (rentMonthlyRate !== undefined) responsePayload.rent_monthly_rate = rentMonthlyRate;
    if (dcNumber !== undefined) responsePayload.dc_number = dcNumber;
    if (dispatchedAt !== undefined) responsePayload.dispatched_at = dispatchedAt;
    if (deliveredAt !== undefined) responsePayload.delivered_at = deliveredAt;
    if (returnedAt !== undefined) responsePayload.returned_at = returnedAt;
    const rentStartChange = changes.find((c) => c.field === 'rent_start_date');
    if (rentStartChange?.after) responsePayload.rent_start_date = rentStartChange.after;

    res.json({
      success: true,
      message: 'Customer asset updated',
      asset: responsePayload,
      activity: changes,
      production_asset_changes: productionAssetSync?.changes || null,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('updateCustomerAsset:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to update asset' });
  } finally {
    client.release();
  }
};

exports.getCustomerAssetActivity = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const access = await checkCustomerAccessById(req, customerId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }
    const limit = parseInt(req.query.limit, 10) || 20;
    const serialId = req.query.serial_id ? parseInt(req.query.serial_id, 10) : null;
    const activity = await listCustomerAssetActivity(customerId, { limit, serialId });
    res.json({ success: true, activity });
  } catch (error) {
    console.error('getCustomerAssetActivity:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to load activity' });
  }
};

exports.getCustomerLaptops = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const access = await checkCustomerAccessById(req, customerId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 0);
    const limitRaw = parseInt(req.query.limit, 10) || 0;
    const limit = limitRaw > 0 ? Math.min(100, Math.max(1, limitRaw)) : 0;
    const paginate = page > 0 && limit > 0;
    const lifecycle = req.query.lifecycle === 'returned' ? 'returned' : 'active';
    const search = (req.query.search || '').trim();
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const from = dateRe.test((req.query.from || '').trim()) ? req.query.from.trim() : '';
    const to = dateRe.test((req.query.to || '').trim()) ? req.query.to.trim() : '';
    const statuses = (req.query.status || req.query.statuses || '').trim();

    if (!paginate) {
      const [{ rows: active }, { rows: returned }] = await Promise.all([
        pool.query(withActiveCte(`${ACTIVE_SELECT_SQL} ${ACTIVE_FROM_SQL} ORDER BY COALESCE(vsn.delivered_at, pod.delivery_completed_at) DESC NULLS LAST, vsn.serial_id DESC`), [customerId, DEPLOYED_WITH_CUSTOMER_STATUSES]).then((r) => ({ rows: r.rows.map(mapActiveAssetRow) })),
        pool.query(`${RETURNED_SELECT_SQL} ${RETURNED_FROM_SQL} ORDER BY ${RETURNED_AT_SQL} DESC NULLS LAST, rl.id DESC`, [customerId]).then((r) => ({ rows: r.rows.map(mapReturnedAssetRow) })),
      ]);
      const counts = { active: active.length, returned: returned.length };
      return res.json({
        success: true,
        laptops: active,
        active,
        returned,
        counts,
      });
    }

    const offset = (page - 1) * limit;
    const cacheKey = buildCustomerLaptopsCacheKey({
      customerId, lifecycle, page, limit, search, from, to, statuses, paginate: true,
    });
    const cached = await getCachedCustomerLaptops(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const [result, otherTotal] = await Promise.all([
      lifecycle === 'returned'
        ? queryCustomerReturnedAssets(customerId, { search, from, to, statuses, limit, offset })
        : queryCustomerActiveAssets(customerId, { search, from, to, statuses, limit, offset }),
      lifecycle === 'returned'
        ? countCustomerActiveAssets(customerId)
        : countCustomerReturnedAssets(customerId),
    ]);
    const counts = {
      active: lifecycle === 'active' ? result.total : otherTotal,
      returned: lifecycle === 'returned' ? result.total : otherTotal,
    };

    const payload = {
      success: true,
      lifecycle,
      data: result.rows,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / limit)),
      },
      counts,
    };
    setCachedCustomerLaptops(cacheKey, payload).catch(() => {});
    return res.json(payload);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

function fmtExcelCalendarDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${dt.getFullYear()}`;
}

function assetConfigLine(lap) {
  return [lap.processor, lap.generation, lap.ram, lap.storage, lap.gpu, lap.screen_size]
    .filter(Boolean)
    .join(' · ');
}

function entityLabel(code) {
  if (code === 'gorefurbo') return 'Gorefurbo';
  if (code) return 'Rentfoxxy';
  return '';
}

exports.exportCustomerLaptopsExcel = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const access = await checkCustomerAccessById(req, customerId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const lifecycle = req.query.lifecycle === 'returned' ? 'returned' : 'active';
    const search = (req.query.search || '').trim();
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const from = dateRe.test((req.query.from || '').trim()) ? req.query.from.trim() : '';
    const to = dateRe.test((req.query.to || '').trim()) ? req.query.to.trim() : '';
    const statuses = (req.query.status || req.query.statuses || '').trim();

    const custRes = await pool.query(
      `SELECT COALESCE(company_name, name) AS customer_name FROM customers WHERE customer_id = $1`,
      [customerId]
    );
    const customerName = custRes.rows[0]?.customer_name || `Customer ${customerId}`;

    const EXPORT_LIMIT = 20000;
    const result = lifecycle === 'returned'
      ? await queryCustomerReturnedAssets(customerId, { search, from, to, statuses, limit: EXPORT_LIMIT, offset: 0 })
      : await queryCustomerActiveAssets(customerId, { search, from, to, statuses, limit: EXPORT_LIMIT, offset: 0 });

    let sheetRows;
    let columnOrder;
    let sheetName;

    if (lifecycle === 'returned') {
      sheetName = 'Returned Laptops';
      columnOrder = [
        'S.No', 'TTSPL ID', 'Serial No', 'Model', 'Config',
        'Return DC', 'Delivered to Customer', 'Returned from Customer', 'Type', 'Status',
      ];
      sheetRows = result.rows.map((lap, idx) => ({
        'S.No': idx + 1,
        'TTSPL ID': lap.ttspl_id || '',
        'Serial No': lap.serial_number || '',
        Model: lap.model_name || '',
        Config: assetConfigLine(lap),
        'Return DC': lap.dc_number || '',
        'Delivered to Customer': fmtExcelCalendarDate(lap.delivered_at),
        'Returned from Customer': fmtExcelCalendarDate(lap.returned_at),
        Type: lap.pickup_type || 'return',
        Status: 'returned',
      }));
    } else {
      sheetName = 'Rented Laptops';
      columnOrder = [
        'S.No', 'TTSPL ID', 'Serial No', 'Model', 'Config', 'Entity',
        'DC Number', 'Dispatch Date', 'Delivered Date', 'Monthly Rate', 'Status',
      ];
      sheetRows = result.rows.map((lap, idx) => ({
        'S.No': idx + 1,
        'TTSPL ID': lap.ttspl_id || '',
        'Serial No': lap.serial_number || '',
        Model: lap.model_name || '',
        Config: assetConfigLine(lap),
        Entity: entityLabel(lap.entity_code),
        'DC Number': lap.dc_number || '',
        'Dispatch Date': fmtExcelCalendarDate(lap.dispatch_date),
        'Delivered Date': fmtExcelCalendarDate(lap.delivered_at),
        'Monthly Rate': lap.rent_monthly_rate != null ? Number(lap.rent_monthly_rate) : '',
        Status: lap.status || 'rented',
      }));
    }

    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sheetRows, { header: columnOrder });
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const safeName = String(customerName).replace(/[^\w.-]+/g, '_').slice(0, 40);
    const safeLifecycle = lifecycle === 'returned' ? 'returned' : 'rented';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="customer_${customerId}_${safeName}_${safeLifecycle}_laptops.xlsx"`
    );
    res.send(buf);
  } catch (error) {
    console.error('exportCustomerLaptopsExcel:', error);
    res.status(500).json({ success: false, message: error.message || 'Export failed' });
  }
};

/** Support ticket item statuses treated as still open (mirrors supportQuery.js). */
const OPEN_ITEM_STATUSES_SQL = `sti.status NOT IN ('resolved', 'closed')`;

exports.getCustomerTickets = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (!Number.isInteger(customerId)) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }
    const access = await checkCustomerAccessById(req, customerId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const statusRaw = (req.query.status || req.query.statuses || '').trim();
    const search = (req.query.search || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const params = [customerId];
    const conditions = ['t.customer_id = $1'];

    const ticketStatuses = parseCommaList(statusRaw);
    if (ticketStatuses.length) {
      params.push(ticketStatuses);
      conditions.push(`LOWER(t.status) = ANY($${params.length}::text[])`);
    }

    if (search) {
      const like = `%${search}%`;
      params.push(like);
      const likeIdx = params.length;
      const digits = search.replace(/^#?\s*STK-?/i, '').replace(/\D/g, '');
      const ticketId = digits ? parseInt(digits, 10) : NaN;
      const ttsplMatch = `EXISTS (
        SELECT 1 FROM support_ticket_items sti
         WHERE sti.ticket_id = t.id
           AND (
             COALESCE(sti.ttspl_id, '') ILIKE $${likeIdx}
             OR COALESCE(sti.unique_serial_number, '') ILIKE $${likeIdx}
             OR COALESCE(sti.serial_number, '') ILIKE $${likeIdx}
           )
      )`;
      if (Number.isInteger(ticketId) && ticketId > 0) {
        params.push(ticketId);
        conditions.push(`(
          t.customer_name ILIKE $${likeIdx}
          OR COALESCE(t.customer_phone, '') ILIKE $${likeIdx}
          OR COALESCE(t.ttspl_id, '') ILIKE $${likeIdx}
          OR t.id::text ILIKE $${likeIdx}
          OR t.id = $${params.length}
          OR ${ttsplMatch}
        )`);
      } else {
        conditions.push(`(
          t.customer_name ILIKE $${likeIdx}
          OR COALESCE(t.customer_phone, '') ILIKE $${likeIdx}
          OR COALESCE(t.ttspl_id, '') ILIKE $${likeIdx}
          OR t.id::text ILIKE $${likeIdx}
          OR ${ttsplMatch}
        )`);
      }
    }

    const whereSql = `WHERE ${conditions.join(' AND ')}`;

    const countR = await pool.query(
      `SELECT COUNT(*)::int AS total FROM support_tickets t ${whereSql}`,
      params
    );
    const total = countR.rows[0]?.total || 0;

    const listParams = [...params, limit, offset];
    const { rows } = await pool.query(
      `SELECT t.id,
              t.status,
              t.customer_name,
              t.customer_phone,
              t.priority,
              t.ticket_category,
              t.complaint_type,
              t.created_at,
              t.updated_at,
              t.closed_at,
              COALESCE(u1.name, t.created_by_name) AS created_by_name,
              u2.name AS closed_by_name,
              NULLIF(TRIM(t.top_level_remarks), '') AS top_level_remarks,
              (SELECT COUNT(*)::int FROM support_ticket_items sti WHERE sti.ticket_id = t.id) AS item_count,
              (SELECT COUNT(*)::int FROM support_ticket_items sti
                WHERE sti.ticket_id = t.id AND ${OPEN_ITEM_STATUSES_SQL}) AS open_item_count,
              COALESCE(
                NULLIF(TRIM(t.ttspl_id), ''),
                (
                  SELECT COALESCE(NULLIF(TRIM(sti.ttspl_id), ''), NULLIF(TRIM(sti.unique_serial_number), ''))
                    FROM support_ticket_items sti
                   WHERE sti.ticket_id = t.id
                     AND COALESCE(NULLIF(TRIM(sti.ttspl_id), ''), NULLIF(TRIM(sti.unique_serial_number), '')) IS NOT NULL
                   ORDER BY sti.id ASC
                   LIMIT 1
                )
              ) AS ttspl_id,
              (
                SELECT STRING_AGG(DISTINCT code, ', ' ORDER BY code)
                  FROM (
                    SELECT NULLIF(TRIM(t.ttspl_id), '') AS code
                    UNION ALL
                    SELECT COALESCE(NULLIF(TRIM(sti.ttspl_id), ''), NULLIF(TRIM(sti.unique_serial_number), ''))
                      FROM support_ticket_items sti
                     WHERE sti.ticket_id = t.id
                  ) codes
                 WHERE code IS NOT NULL AND code <> ''
              ) AS ttspl_list,
              COALESCE(
                NULLIF(TRIM(t.ticket_category), ''),
                (
                  SELECT sti.item_type
                    FROM support_ticket_items sti
                   WHERE sti.ticket_id = t.id
                   ORDER BY sti.id ASC
                   LIMIT 1
                ),
                'complaint'
              ) AS complaint_type_label,
              (
                SELECT CASE
                  WHEN COUNT(DISTINCT kind) = 0 THEN NULL
                  WHEN COUNT(DISTINCT kind) > 1 THEN 'mixed'
                  ELSE MIN(kind)
                END
                  FROM (
                    SELECT COALESCE(
                      NULLIF(TRIM(sti.pickup_type), ''),
                      CASE WHEN sti.source_item_id IS NOT NULL THEN 'repair' ELSE 'return' END
                    ) AS kind
                      FROM support_ticket_items sti
                     WHERE sti.ticket_id = t.id
                       AND sti.item_type = 'pickup'
                  ) pk
              ) AS pickup_kind,
              (
                SELECT COALESCE(NULLIF(TRIM(sti.issue_category_label), ''), c.name)
                  FROM support_ticket_items sti
                  LEFT JOIN support_issue_categories c ON c.id = sti.issue_category_id
                 WHERE sti.ticket_id = t.id
                   AND (
                     NULLIF(TRIM(sti.issue_category_label), '') IS NOT NULL
                     OR sti.issue_category_id IS NOT NULL
                   )
                 ORDER BY sti.id ASC
                 LIMIT 1
              ) AS issue_category_label,
              (
                SELECT NULLIF(TRIM(sti.remarks), '')
                  FROM support_ticket_items sti
                 WHERE sti.ticket_id = t.id
                   AND NULLIF(TRIM(sti.remarks), '') IS NOT NULL
                 ORDER BY sti.id ASC
                 LIMIT 1
              ) AS item_remarks,
              (
                SELECT COALESCE(
                  json_agg(
                    json_build_object(
                      'old_ttspl', COALESCE(
                        NULLIF(TRIM(ro.old_machine_serial), ''),
                        NULLIF(TRIM(old_v.inventory_asset_code), ''),
                        NULLIF(TRIM(old_v.serial_number), '')
                      ),
                      'new_ttspl', COALESCE(
                        NULLIF(TRIM(ro.new_machine_serial), ''),
                        NULLIF(TRIM(new_v.inventory_asset_code), ''),
                        NULLIF(TRIM(new_v.serial_number), '')
                      ),
                      'status', ro.status
                    )
                    ORDER BY ro.id
                  ),
                  '[]'::json
                )
                  FROM support_replacement_orders ro
                  LEFT JOIN vendor_serial_numbers old_v
                    ON old_v.serial_id = ro.old_serial_id AND old_v.deleted_at IS NULL
                  LEFT JOIN vendor_serial_numbers new_v
                    ON new_v.serial_id = ro.new_serial_id AND new_v.deleted_at IS NULL
                 WHERE ro.ticket_id = t.id
              ) AS replacements
         FROM support_tickets t
         LEFT JOIN users u1 ON u1.user_id = t.created_by
         LEFT JOIN users u2 ON u2.user_id = t.closed_by
         ${whereSql}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const tickets = rows.map((row) => {
      const type = String(row.complaint_type_label || row.ticket_category || 'complaint').toLowerCase();
      const pickupKind = row.pickup_kind || null;
      let complaint_subtype = null;
      if (type === 'pickup' || pickupKind) {
        if (pickupKind === 'repair') complaint_subtype = 'Repair';
        else if (pickupKind === 'return') complaint_subtype = 'Return';
        else if (pickupKind === 'mixed') complaint_subtype = 'Mixed';
      }
      if (!complaint_subtype && row.issue_category_label) {
        complaint_subtype = row.issue_category_label;
      }
      // Legacy ERP: complaint_type often "complain" / "pickup"
      if (!complaint_subtype && row.complaint_type && !['pickup', 'complain', 'complaint'].includes(String(row.complaint_type).toLowerCase())) {
        complaint_subtype = row.complaint_type;
      }

      let replacements = row.replacements;
      if (typeof replacements === 'string') {
        try { replacements = JSON.parse(replacements); } catch { replacements = []; }
      }
      if (!Array.isArray(replacements)) replacements = [];
      replacements = replacements
        .map((r) => ({
          old_ttspl: r.old_ttspl || null,
          new_ttspl: r.new_ttspl || null,
          status: r.status || null,
        }))
        .filter((r) => r.old_ttspl || r.new_ttspl);

      const replacement_summary = replacements.length
        ? replacements.map((r) => {
          const from = r.old_ttspl || '—';
          const to = r.new_ttspl || 'pending';
          return `${from} → ${to}`;
        }).join('; ')
        : null;

      return {
        ...row,
        complaint_type_label: type,
        complaint_subtype,
        pickup_kind: pickupKind,
        pickup_kind_label: pickupKind === 'repair'
          ? 'Repair Pickup'
          : pickupKind === 'return'
            ? 'Return Pickup'
            : pickupKind === 'mixed'
              ? 'Mixed Pickup'
              : null,
        ttspl_id: row.ttspl_id || null,
        ttspl_list: row.ttspl_list || row.ttspl_id || null,
        remarks: row.item_remarks || row.top_level_remarks || null,
        replacements,
        replacement_summary,
      };
    });

    res.json({
      success: true,
      tickets,
      total,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      statuses: ['open', 'in_progress', 'closed', 'cancelled'],
    });
  } catch (e) {
    console.error('customerManagement getCustomerTickets', e);
    res.status(500).json({ success: false, message: 'Failed to load tickets' });
  }
};

/**
 * Current monthly rental: sum of effective rent_monthly_rate across the same
 * active assets shown on the Assets tab (DEPLOYED + ACTIVE_FROM_SQL rules).
 */
exports.getCustomerRentalSummary = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (!Number.isInteger(customerId)) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }
    const access = await checkCustomerAccessById(req, customerId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const { rows } = await pool.query(
      withActiveCte(`SELECT COALESCE(SUM(COALESCE(NULLIF(vsn.rent_monthly_rate, 0), sos_rate.rate)), 0)::numeric AS total_monthly_rent,
              COUNT(*)::int AS active_asset_count
         ${ACTIVE_FROM_SQL}`),
      [customerId, DEPLOYED_WITH_CUSTOMER_STATUSES]
    );

    res.json({
      success: true,
      total_monthly_rent: Number(rows[0]?.total_monthly_rent || 0),
      active_asset_count: rows[0]?.active_asset_count || 0,
    });
  } catch (e) {
    console.error('customerManagement getCustomerRentalSummary', e);
    res.status(500).json({ success: false, message: 'Failed to load rental summary' });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM customers WHERE customer_id = $1`, [req.params.customerId]);
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    if (!isCustomerTypeAllowed(req.allowedCustomerTypes, result.rows[0].customer_type)) {
      return res.status(403).json({ success: false, message: 'Access denied: customer is outside your Customer Access scope' });
    }
    const details = parseDetails(result.rows[0].details);
    const files = [...(details.upload_docs || [])];
    if (details.profile) files.push(details.profile);
    for (const file of files) {
      try {
        if (file && fs.existsSync(file)) fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
    await pool.query(`DELETE FROM customers WHERE customer_id = $1`, [req.params.customerId]);
    res.json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.enableCustomerPortal = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const { enabled, reset_password, send_login_email } = req.body || {};

    const existing = await pool.query('SELECT * FROM customers WHERE customer_id = $1', [customerId]);
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const row = existing.rows[0];
    if (!isCustomerTypeAllowed(req.allowedCustomerTypes, row.customer_type)) {
      return res.status(403).json({ success: false, message: 'Access denied: customer is outside your Customer Access scope' });
    }

    if (enabled === false) {
      await pool.query(
        `UPDATE customers SET portal_enabled = false, updated_at = NOW() WHERE customer_id = $1`,
        [customerId]
      );
      await pool.query(`DELETE FROM customer_portal_sessions WHERE customer_id = $1`, [customerId]);
      return res.json({ success: true, enabled: false });
    }

    if (send_login_email && enabled !== true && reset_password !== true) {
      if (!row.portal_enabled) {
        return res.status(400).json({ success: false, message: 'Portal is not enabled for this customer' });
      }
      if (!row.email) {
        return res.status(400).json({ success: false, message: 'Customer has no email address' });
      }
      await sendCustomerPortalWelcome({
        customerEmail: row.email,
        customerName: row.company_name || row.name,
        portalUrl: getCustomerPortalUrl(),
        tempPassword: null,
      });
      return res.json({ success: true, enabled: true, email_sent: true });
    }

    let newPassword = null;
    const needsPassword = reset_password === true || (enabled === true && !row.portal_password_hash);

    if (needsPassword) {
      newPassword = generatePassword();
      const hash = await bcrypt.hash(newPassword, 10);
      await pool.query(
        `UPDATE customers SET portal_password_hash = $1, portal_enabled = COALESCE($2, portal_enabled, true), updated_at = NOW() WHERE customer_id = $3`,
        [hash, enabled === true ? true : null, customerId]
      );
      try {
        const { upsertCredential } = require('../services/authCredentialsService');
        await upsertCredential({
          email: row.email,
          passwordHash: hash,
          portal: 'customer',
          entityId: customerId,
          enabled: true,
        });
      } catch (syncErr) {
        console.warn('auth_credentials sync (customer portal password):', syncErr.message);
      }
    } else if (enabled === true) {
      await pool.query(
        `UPDATE customers SET portal_enabled = true, updated_at = NOW() WHERE customer_id = $1`,
        [customerId]
      );
      try {
        const { setEnabledByEntity } = require('../services/authCredentialsService');
        await setEnabledByEntity('customer', customerId, true);
      } catch (syncErr) {
        console.warn('auth_credentials sync (customer enable):', syncErr.message);
      }
    } else {
      return res.status(400).json({ success: false, message: 'Specify enabled, reset_password, or send_login_email' });
    }

    if (send_login_email && row.email) {
      await sendCustomerPortalWelcome({
        customerEmail: row.email,
        customerName: row.company_name || row.name,
        portalUrl: getCustomerPortalUrl(),
        tempPassword: newPassword,
      });
    }

    res.json({
      success: true,
      enabled: enabled !== false,
      new_password: newPassword || undefined,
    });
  } catch (error) {
    console.error('enableCustomerPortal:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /customers/:customerId/portal-login-as
 *
 * Mints a short-lived, read-only customer portal session for a super admin so
 * they can see the portal exactly as the customer does. Works even when portal
 * access is disabled, which is the main reason to use it — verifying what the
 * customer will see before handing over credentials.
 */
exports.loginAsCustomerPortal = async (req, res) => {
  try {
    // Route middleware already restricts this to super admins; repeated here so
    // a future routing change cannot silently widen access to impersonation.
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only a super admin can open the customer portal as a customer',
      });
    }

    const customerId = parseInt(req.params.customerId, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }

    const existing = await pool.query(
      `SELECT customer_id, name, company_name, email, customer_type, portal_enabled
         FROM customers WHERE customer_id = $1`,
      [customerId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const row = existing.rows[0];
    if (!isCustomerTypeAllowed(req.allowedCustomerTypes, row.customer_type)) {
      return res.status(403).json({ success: false, message: 'Access denied: customer is outside your Customer Access scope' });
    }

    const { token, expiresAt, ttlMinutes } = await createImpersonationSession({
      customerId,
      actor: req.user,
      req,
    });

    console.info(
      `[portal-impersonation] user ${req.user?.user_id} (${req.user?.email || 'unknown'}) opened portal as customer ${customerId}`
    );

    res.json({
      success: true,
      token,
      expires_at: expiresAt,
      ttl_minutes: ttlMinutes,
      read_only: true,
      portal_url: getCustomerPortalUrl(),
      portal_enabled: row.portal_enabled === true,
      customer: {
        customer_id: row.customer_id,
        name: row.name,
        company_name: row.company_name,
        email: row.email,
      },
    });
  } catch (error) {
    console.error('loginAsCustomerPortal:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.validateFinanceSpockContactFields = validateFinanceSpockContactFields;
exports.applyFinanceSpockDetails = applyFinanceSpockDetails;
