#!/usr/bin/env node
/**
 * Update existing customers from Excel export (match by GST Number).
 *
 * Usage:
 *   node scripts/import-customer-master-update.js [--dry-run] [path/to/file.xlsx]
 *
 * Default file path: backend/data/Updated Customer Data.xlsx
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const pool = require('../config/db');
const {
  normalizeIndianMobile,
  isValidIndianMobile,
} = require('../utils/phoneValidation');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_FILE = path.join(__dirname, '../data/Updated_Customer_Data.xlsx');
const MAX_BILLING = 3;
const MAX_SHIPPING = 9;

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const fileArg = argv.find((a) => !a.startsWith('-') && a.endsWith('.xlsx'));
  return { dryRun, filePath: fileArg || DEFAULT_FILE };
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeGst(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function isBlank(value) {
  return value == null || String(value).trim() === '';
}

function cell(row, ...labels) {
  const wanted = new Set(labels.map(normalizeHeader));
  for (const [key, value] of Object.entries(row)) {
    if (wanted.has(normalizeHeader(key))) return value;
  }
  return undefined;
}

function addressSlots(row, kind, count) {
  const prefix = kind === 'billing' ? 'Billing' : 'Shipping';
  const out = [];
  for (let i = 1; i <= count; i += 1) {
    const address = cell(row, `${prefix} Address ${i}`);
    const concern_person = cell(row, `${prefix} Contact Person ${i}`);
    const mobile_no = cell(row, `${prefix} Contact Mobile ${i}`);
    if (isBlank(address) && isBlank(concern_person) && isBlank(mobile_no)) continue;
    out.push({ index: i - 1, address, concern_person, mobile_no });
  }
  return out;
}

function parsePhone(value, label) {
  if (isBlank(value)) return { ok: true, value: null };
  if (!isValidIndianMobile(value)) {
    return { ok: false, error: `${label} must be a 10-digit number (${value})` };
  }
  return { ok: true, value: normalizeIndianMobile(value) };
}

function parseEmail(value, label, { required = false } = {}) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    if (required) return { ok: false, error: `${label} is required` };
    return { ok: true, value: null };
  }
  if (!EMAIL_RE.test(trimmed)) {
    return { ok: false, error: `${label} is invalid (${trimmed})` };
  }
  return { ok: true, value: trimmed };
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

function parseRow(row) {
  const gst = normalizeGst(cell(row, 'GST Number', 'GST No', 'gst_no', 'gst_number'));
  if (!gst) return { skip: true, reason: 'blank GST' };

  const billing = addressSlots(row, 'billing', MAX_BILLING);
  const shipping = addressSlots(row, 'shipping', MAX_SHIPPING);

  return {
    skip: false,
    gst,
    companyName: String(cell(row, 'Company Name') || '').trim() || null,
    contact_person_name: String(cell(row, 'Contact Person') || '').trim() || null,
    phone: cell(row, 'Phone Number', 'Phone'),
    email: cell(row, 'Email'),
    finance_contact_name: String(cell(row, 'Finance Contact Name') || '').trim() || null,
    finance_contact_email: cell(row, 'Finance Contact Email'),
    finance_contact_mobile: cell(row, 'Finance Contact Mobile Number', 'Finance Contact Mobile'),
    spock_person_name: String(
      cell(row, 'SPOC Person Name', 'Spoke Person Name', 'Spock Person Name') || ''
    ).trim() || null,
    spock_person_email: cell(row, 'SPOC Person Email', 'Spoke Person Email', 'Spock Person Email'),
    spock_person_mobile: cell(
      row,
      'SPOC Person Contact Number',
      'Spoke Person Mobile Number',
      'Spock Person Mobile Number',
      'SPOC Person Mobile'
    ),
    billing,
    shipping,
  };
}

function validateParsed(parsed) {
  const errors = [];
  const phone = parsePhone(parsed.phone, 'Phone Number');
  if (!phone.ok) errors.push(phone.error);
  const email = parseEmail(parsed.email, 'Email');
  if (!email.ok) errors.push(email.error);
  const financeEmail = parseEmail(parsed.finance_contact_email, 'Finance Contact Email');
  if (!financeEmail.ok) errors.push(financeEmail.error);
  const financeMobile = parsePhone(parsed.finance_contact_mobile, 'Finance Contact Mobile Number');
  if (!financeMobile.ok) errors.push(financeMobile.error);
  const spocEmail = parseEmail(parsed.spock_person_email, 'SPOC Person Email');
  if (!spocEmail.ok) errors.push(spocEmail.error);
  const spocMobile = parsePhone(parsed.spock_person_mobile, 'SPOC Person Contact Number');
  if (!spocMobile.ok) errors.push(spocMobile.error);

  for (const addr of [...parsed.billing, ...parsed.shipping]) {
    const mobile = parsePhone(addr.mobile_no, `Contact Mobile ${addr.index + 1}`);
    if (!mobile.ok) errors.push(mobile.error);
  }

  return { ok: errors.length === 0, errors, phone, email, financeEmail, financeMobile, spocEmail, spocMobile };
}

async function loadCustomerByGst(client, gst) {
  const r = await client.query(
    `SELECT * FROM customers
      WHERE UPPER(REPLACE(TRIM(COALESCE(gst_no, '')), ' ', '')) = $1
        AND COALESCE(status, 1) = 1
      LIMIT 1`,
    [gst]
  );
  return r.rows[0] || null;
}

async function loadAddresses(client, customerId) {
  const r = await client.query(
    `SELECT customer_address_id, customer_id, concern_person, mobile_no, address, city, state, pincode,
            is_head_office, address_type
       FROM customer_addresses
      WHERE customer_id = $1
      ORDER BY customer_address_id ASC`,
    [customerId]
  );
  return r.rows;
}

function splitAddresses(addresses) {
  const billing = addresses.filter((a) => String(a.address_type || '').toLowerCase() === 'billing');
  const shipping = addresses.filter((a) => String(a.address_type || '').toLowerCase() !== 'billing');
  return { billing, shipping };
}

async function ensureEmailAvailable(client, email, customerId) {
  if (!email) return null;
  const r = await client.query(
    `SELECT customer_id FROM customers
      WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
        AND customer_id <> $2
      LIMIT 1`,
    [email, customerId]
  );
  if (r.rows.length) {
    return `Email already used by customer_id ${r.rows[0].customer_id}`;
  }
  return null;
}

async function patchAddress(client, addressId, patch) {
  const sets = [];
  const vals = [];
  let idx = 1;
  for (const [key, value] of Object.entries(patch)) {
    sets.push(`${key} = $${idx}`);
    vals.push(value);
    idx += 1;
  }
  sets.push('updated_at = NOW()');
  vals.push(addressId);
  await client.query(
    `UPDATE customer_addresses SET ${sets.join(', ')} WHERE customer_address_id = $${idx}`,
    vals
  );
}

async function insertAddress(client, customerId, addressType, patch) {
  await client.query(
    `INSERT INTO customer_addresses
      (customer_id, concern_person, mobile_no, address, city, state, pincode, is_head_office, address_type)
     VALUES ($1, $2, $3, $4, NULL, NULL, NULL, $5, $6)`,
    [
      customerId,
      patch.concern_person || null,
      patch.mobile_no || null,
      patch.address,
      addressType === 'billing',
      addressType,
    ]
  );
}

async function applyAddressSlots(client, customerId, existingList, addressType, slots) {
  for (const slot of slots) {
    const existing = existingList[slot.index];
    const patch = {};
    if (!isBlank(slot.address)) patch.address = String(slot.address).trim();
    if (!isBlank(slot.concern_person)) patch.concern_person = String(slot.concern_person).trim();
    if (!isBlank(slot.mobile_no)) patch.mobile_no = normalizeIndianMobile(slot.mobile_no);
    if (!Object.keys(patch).length) continue;

    if (existing) {
      await patchAddress(client, existing.customer_address_id, patch);
    } else if (patch.address) {
      await insertAddress(client, customerId, addressType, {
        address: patch.address,
        concern_person: patch.concern_person || null,
        mobile_no: patch.mobile_no || null,
      });
    }
  }
}

async function applyUpdate(client, customerRow, parsed, validated) {
  const customerId = customerRow.customer_id;
  const details = parseDetails(customerRow.details);
  const emailErr = await ensureEmailAvailable(client, validated.email.value, customerId);
  if (emailErr) throw new Error(emailErr);

  const customerPatch = {};
  if (parsed.contact_person_name) {
    details.contact_person_name = parsed.contact_person_name;
  }
  if (validated.phone.value) {
    customerPatch.phone = validated.phone.value;
    details.contact_person_number = validated.phone.value;
  }
  if (validated.email.value) customerPatch.email = validated.email.value;
  if (parsed.finance_contact_name) details.finance_contact_name = parsed.finance_contact_name;
  if (validated.financeEmail.value) details.finance_contact_email = validated.financeEmail.value;
  if (validated.financeMobile.value) details.finance_contact_mobile = validated.financeMobile.value;
  if (parsed.spock_person_name) details.spock_person_name = parsed.spock_person_name;
  if (validated.spocEmail.value) details.spock_person_email = validated.spocEmail.value;
  if (validated.spocMobile.value) details.spock_person_mobile = validated.spocMobile.value;
  delete details.expox_person_name;
  delete details.expox_person_email;
  delete details.expox_person_mobile;

  const primaryBilling = parsed.billing[0];
  if (primaryBilling && !isBlank(primaryBilling.address)) {
    customerPatch.billing_address = String(primaryBilling.address).trim();
    details.billing_address = {
      ...(typeof details.billing_address === 'object' ? details.billing_address : {}),
      address: customerPatch.billing_address,
      phone: validated.phone.value || customerRow.phone || '',
      name: parsed.contact_person_name || customerRow.name || customerRow.company_name || '',
    };
  }

  if (parsed.shipping.length) {
    details.shipping_address = parsed.shipping.map((slot) => ({
      address: String(slot.address || '').trim(),
      name: String(slot.concern_person || '').trim() || null,
      phone: slot.mobile_no ? normalizeIndianMobile(slot.mobile_no) : null,
    })).filter((item) => item.address);
    if (details.shipping_address.length) {
      customerPatch.shipping_same = false;
      customerPatch.shipping_address = details.shipping_address[0].address;
    }
  }

  const customerSets = ['details = $1', 'updated_at = NOW()'];
  const customerVals = [JSON.stringify(details)];
  let paramIdx = 2;
  for (const [key, value] of Object.entries(customerPatch)) {
    customerSets.push(`${key} = $${paramIdx}`);
    customerVals.push(value);
    paramIdx += 1;
  }
  customerVals.push(customerId);
  await client.query(
    `UPDATE customers SET ${customerSets.join(', ')} WHERE customer_id = $${paramIdx}`,
    customerVals
  );

  const addresses = await loadAddresses(client, customerId);
  const { billing, shipping } = splitAddresses(addresses);
  await applyAddressSlots(client, customerId, billing, 'billing', parsed.billing);
  await applyAddressSlots(client, customerId, shipping, 'Shipping', parsed.shipping);
}

async function main() {
  const { dryRun, filePath } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    console.error('Upload the Excel file to backend/data/Updated Customer Data.xlsx and rerun.');
    process.exit(1);
  }

  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
  if (!rows.length) {
    console.error('Excel sheet is empty.');
    process.exit(1);
  }

  const summary = {
    total: rows.length,
    skippedBlankGst: 0,
    skippedNoMatch: 0,
    validationFailed: 0,
    updated: 0,
    dryRun,
    errors: [],
    updatedCustomers: [],
  };

  const client = await pool.connect();
  try {
    for (let i = 0; i < rows.length; i += 1) {
      const rowNum = i + 2;
      const parsed = parseRow(rows[i]);
      if (parsed.skip) {
        summary.skippedBlankGst += 1;
        continue;
      }

      const customer = await loadCustomerByGst(client, parsed.gst);
      if (!customer) {
        summary.skippedNoMatch += 1;
        summary.errors.push({ row: rowNum, gst: parsed.gst, error: 'No matching customer' });
        continue;
      }

      const validated = validateParsed(parsed);
      if (!validated.ok) {
        summary.validationFailed += 1;
        summary.errors.push({ row: rowNum, gst: parsed.gst, customer_id: customer.customer_id, error: validated.errors.join('; ') });
        continue;
      }

      if (dryRun) {
        summary.updated += 1;
        summary.updatedCustomers.push({
          row: rowNum,
          customer_id: customer.customer_id,
          gst: parsed.gst,
          company: customer.company_name || customer.name,
        });
        continue;
      }

      await client.query('BEGIN');
      try {
        await applyUpdate(client, customer, parsed, validated);
        await client.query('COMMIT');
        summary.updated += 1;
        summary.updatedCustomers.push({
          row: rowNum,
          customer_id: customer.customer_id,
          gst: parsed.gst,
          company: customer.company_name || customer.name,
        });
      } catch (err) {
        await client.query('ROLLBACK');
        summary.validationFailed += 1;
        summary.errors.push({
          row: rowNum,
          gst: parsed.gst,
          customer_id: customer.customer_id,
          error: err.message,
        });
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
