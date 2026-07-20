const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sendCustomerPortalWelcome } = require('../services/emailQueueService');
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
}

exports.ensureCustomerManagementSchema = ensureCustomerManagementSchema;

exports.getAddCustomerMeta = async (req, res) => {
  res.json({ success: true, generated_password: generatePassword() });
};

/** Shared list filters for paginated customers + bulk ID selection. */
function buildCustomerListFilters(query = {}, allowedCustomerTypes = null) {
  const params = [];
  const conditions = ['c.status = 1'];

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
    const sortDirRaw = (req.query.sort_dir || 'asc').toLowerCase();
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
          SELECT SUM(security_amount) FROM sales_quotations sq WHERE sq.customer_id = c.customer_id
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

exports.getCustomer = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const result = await pool.query(
      `SELECT c.*,
        COALESCE((
          SELECT SUM(security_amount) FROM sales_quotations sq WHERE sq.customer_id = c.customer_id
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
    const addrRes = await pool.query(
      `SELECT customer_address_id, customer_id, concern_person, mobile_no, address, city, state, pincode,
              is_head_office, address_type, created_at, updated_at
       FROM customer_addresses
       WHERE customer_id = $1
       ORDER BY is_head_office DESC, customer_address_id ASC`,
      [customerId]
    );
    const customer = formatCustomerRow(result.rows[0]);
    customer.saved_addresses = addrRes.rows;
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
    const required = [
      'customer_name', 'customer_number', 'email', 'contact_person_name',
      'contact_person_number', 'billing_state', 'billing_city', 'billing_pin_code',
      'billing_address_1', 'billing_address_2', 'shipping_state', 'shipping_city',
      'shipping_pin_code', 'shipping_address_1', 'shipping_address_2', 'business_type', 'password',
    ];
    for (const field of required) {
      if (!body[field]) {
        return res.status(400).json({ success: false, message: `${field} is required` });
      }
    }

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
      address: `${body.billing_address_1}, ${body.billing_address_2}`,
    };

    const shippingAddresses = [{
      name: body.contact_person_name,
      phone: contactPersonNumber,
      country: 'India',
      state: body.shipping_state,
      city: body.shipping_city,
      zip_code: body.shipping_pin_code,
      address: `${body.shipping_address_1}, ${body.shipping_address_2}`,
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
      pan_card_number: body.pan_card_number || null,
      billing_address: billingAddress,
      shipping_address: shippingAddresses,
      upload_docs: uploadDocs,
      profile: profilePath,
      password_hash: passwordHash,
    };
    applyFinanceSpockDetails(details, body);

    const result = await pool.query(
      `INSERT INTO customers (name, company_name, email, phone, gst_no, address, type, customer_type, details, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, NOW(), NOW())
       RETURNING *`,
      [
        body.customer_name,
        body.customer_name,
        body.email,
        customerNumber,
        body.gst_number || null,
        billingAddress.address,
        body.business_type === 'supplier' ? 'Supplier' : 'Regular',
        customerType,
        JSON.stringify(details),
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
    const companyName = body.company_name || row.company_name;
    const email = body.email ?? row.email;
    const phone = body.customer_number != null || body.phone != null
      ? normalizeIndianMobile(body.customer_number ?? body.phone)
      : row.phone;
    const whatsappNumber = body.whatsapp_number != null
      ? (String(body.whatsapp_number).trim() ? normalizeIndianMobile(body.whatsapp_number) : null)
      : row.whatsapp_number;
    const gstNo = body.gst_number ?? row.gst_no;
    const panNumber = body.pan_number || body.pan_card_number || row.pan_number;

    await pool.query(
      `UPDATE customers SET
        name = $1, company_name = $2, email = $3, phone = $4, gst_no = $5,
        pan_number = $6, company_type = $7, company_size = $8, industry = $9,
        billing_address = $10, billing_city = $11, billing_state = $12, billing_pincode = $13,
        shipping_same = $14, shipping_address = $15, shipping_city = $16, shipping_state = $17, shipping_pincode = $18,
        whatsapp_number = $19, designation = $20, portal_enabled = COALESCE($21, portal_enabled),
        notes = COALESCE($22, notes), updated_at = NOW()
       WHERE customer_id = $23`,
      [
        name, companyName, email, phone, gstNo, panNumber,
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
    }
    if (body.contact_person_number !== undefined) {
      details.contact_person_number = body.contact_person_number || null;
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
      `SELECT c.*, COALESCE((SELECT SUM(security_amount) FROM sales_quotations sq WHERE sq.customer_id = c.customer_id), 0) AS total_security_amount
       FROM customers c WHERE c.customer_id = $1`,
      [customerId]
    );
    res.json({ success: true, customer: formatCustomerRow(updated.rows[0]) });
  } catch (error) {
    console.error('updateCustomer:', error);
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
  const { pod_file_path, pod_image_url, pod_photo_url, pod_esign_url, ...rest } = r;
  return {
    ...rest,
    status: displayDeployedStatus(rest.status),
    lifecycle: 'active',
    pod_files: [...new Set(podFiles)],
  };
}

function mapReturnedAssetRow(r) {
  const podFiles = [
    r.proof_of_completion_path,
    r.pod_image_path,
    r.warehouse_esign_url,
  ].filter(Boolean);
  const { proof_of_completion_path, pod_image_path, warehouse_esign_url, ...rest } = r;
  return {
    ...rest,
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

const ACTIVE_FROM_SQL = `
  FROM vendor_serial_numbers vsn
  LEFT JOIN inventory inv ON (
    inv.machine_number = vsn.inventory_asset_code
    OR inv.serial_number = vsn.serial_number
  )
  LEFT JOIN LATERAL (
    SELECT dcl.file_path, dcl.pod_image_url, dcl.pod_photo_url, dcl.esign_url,
           dcl.pdf_path, dcl.delivery_completed_at
    FROM delivery_challan_lines dcl
    WHERE dcl.dc_number = vsn.current_dc_number
      AND COALESCE(dcl.movement_type, 'outbound') = 'outbound'
    ORDER BY dcl.delivery_completed_at DESC NULLS LAST, dcl.id DESC
    LIMIT 1
  ) pod ON TRUE
  WHERE vsn.current_customer_id = $1
    AND vsn.deleted_at IS NULL
    AND vsn.inventory_status = ANY($2::text[])
    AND NOT EXISTS (
      SELECT 1
        FROM delivery_challan_lines rl
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS cnt,
                 BOOL_AND(sti.warehouse_received_at IS NOT NULL) AS all_received
            FROM support_ticket_items sti
           WHERE sti.return_dc_number = rl.dc_number
             AND sti.item_type = 'pickup'
        ) wh ON TRUE
       WHERE rl.movement_type = 'return'
         AND rl.customer_id = $1
         AND COALESCE(rl.status, '') NOT IN ('cancelled')
         AND (wh.cnt IS NULL OR wh.cnt = 0 OR wh.all_received IS NOT TRUE)
         AND (
           vsn.inventory_asset_code = NULLIF(split_part(rl.serial_number->>0, '|', 3), '')
           OR vsn.serial_number = NULLIF(split_part(rl.serial_number->>0, '|', 2), '')
           OR EXISTS (
             SELECT 1 FROM support_ticket_items sti2
              WHERE sti2.return_dc_number = rl.dc_number
                AND sti2.item_type = 'pickup'
                AND (
                  sti2.ttspl_id = vsn.inventory_asset_code
                  OR sti2.unique_serial_number = vsn.inventory_asset_code
                  OR sti2.serial_number = vsn.serial_number
                )
           )
         )
    )
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
         vsn.delivered_at AS dispatch_date,
         COALESCE(vsn.delivered_at, pod.delivery_completed_at) AS delivered_at,
         vsn.rent_start_date,
         vsn.rent_monthly_rate,
         pod.file_path AS pod_file_path,
         pod.pod_image_url AS pod_image_url,
         pod.pod_photo_url AS pod_photo_url,
         pod.esign_url AS pod_esign_url,
         pod.pdf_path AS dc_pdf_path
`;

const RETURNED_FROM_SQL = `
  FROM delivery_challan_lines rl
  LEFT JOIN LATERAL (
    SELECT ttspl_id, unique_serial_number, serial_number, pickup_type,
           proof_of_completion_path, pod_image_path, warehouse_esign_url, warehouse_received_at
    FROM support_ticket_items
    WHERE return_dc_number = rl.dc_number AND item_type = 'pickup'
    ORDER BY id DESC
    LIMIT 1
  ) sti ON TRUE
  LEFT JOIN LATERAL (
    SELECT v.serial_number, v.inventory_asset_code, v.extra, v.current_entity, v.rent_monthly_rate
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
  WHERE rl.movement_type = 'return'
    AND rl.customer_id = $1
`;

const RETURNED_SELECT_SQL = `
  SELECT rl.dc_number AS dc_number,
         rl.created_at,
         COALESCE(rl.delivered_at, sti.warehouse_received_at, rl.created_at) AS delivered_at,
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

async function countCustomerActiveAssets(customerId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total ${ACTIVE_FROM_SQL}`,
    [customerId, DEPLOYED_WITH_CUSTOMER_STATUSES]
  );
  return rows[0]?.total || 0;
}

async function countCustomerReturnedAssets(customerId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total ${RETURNED_FROM_SQL}`,
    [customerId]
  );
  return rows[0]?.total || 0;
}

async function queryCustomerActiveAssets(customerId, { search = '', limit, offset } = {}) {
  const params = [customerId, DEPLOYED_WITH_CUSTOMER_STATUSES];
  const searchSql = buildActiveSearchSql(search, params);
  const fromWhere = `${ACTIVE_FROM_SQL}${searchSql}`;

  const countR = await pool.query(`SELECT COUNT(*)::int AS total ${fromWhere}`, params);
  const total = countR.rows[0]?.total || 0;

  let listSql = `${ACTIVE_SELECT_SQL} ${fromWhere} ORDER BY vsn.delivered_at DESC NULLS LAST`;
  const listParams = [...params];
  if (limit != null) {
    listParams.push(limit, offset || 0);
    listSql += ` LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`;
  }

  const { rows } = await pool.query(listSql, listParams);
  return { rows: rows.map(mapActiveAssetRow), total };
}

async function queryCustomerReturnedAssets(customerId, { search = '', limit, offset } = {}) {
  const params = [customerId];
  const searchSql = buildReturnedSearchSql(search, params);
  const fromWhere = `${RETURNED_FROM_SQL}${searchSql}`;

  const countR = await pool.query(`SELECT COUNT(*)::int AS total ${fromWhere}`, params);
  const total = countR.rows[0]?.total || 0;

  let listSql = `${RETURNED_SELECT_SQL} ${fromWhere} ORDER BY rl.created_at DESC`;
  const listParams = [...params];
  if (limit != null) {
    listParams.push(limit, offset || 0);
    listSql += ` LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`;
  }

  const { rows } = await pool.query(listSql, listParams);
  return { rows: rows.map(mapReturnedAssetRow), total };
}

// "Assets with Customer" — derived from the authoritative inventory
// (vendor_serial_numbers), replacing the deprecated customer_inventory table.
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

    const counts = {
      active: await countCustomerActiveAssets(customerId),
      returned: await countCustomerReturnedAssets(customerId),
    };

    if (!paginate) {
      const { rows: active } = await queryCustomerActiveAssets(customerId);
      const { rows: returned } = await queryCustomerReturnedAssets(customerId);
      return res.json({
        success: true,
        laptops: active,
        active,
        returned,
        counts,
      });
    }

    const offset = (page - 1) * limit;
    const result = lifecycle === 'returned'
      ? await queryCustomerReturnedAssets(customerId, { search, limit, offset })
      : await queryCustomerActiveAssets(customerId, { search, limit, offset });

    return res.json({
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
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
        portalUrl: process.env.CUSTOMER_PORTAL_URL || 'http://localhost:3002',
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
    } else if (enabled === true) {
      await pool.query(
        `UPDATE customers SET portal_enabled = true, updated_at = NOW() WHERE customer_id = $1`,
        [customerId]
      );
    } else {
      return res.status(400).json({ success: false, message: 'Specify enabled, reset_password, or send_login_email' });
    }

    if (send_login_email && row.email) {
      await sendCustomerPortalWelcome({
        customerEmail: row.email,
        customerName: row.company_name || row.name,
        portalUrl: process.env.CUSTOMER_PORTAL_URL || 'http://localhost:3002',
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

exports.validateFinanceSpockContactFields = validateFinanceSpockContactFields;
exports.applyFinanceSpockDetails = applyFinanceSpockDetails;
