#!/usr/bin/env node
/**
 * One-off: clone customer #207 (Carrum) as Maharashtra entity using existing GST lookup.
 * Usage: node scripts/create-carrum-mh-customer.js [--dry-run]
 */
const pool = require('../config/db');
const { lookupGstin, sanitizeGstin } = require('../services/gstinLookupService');

const SOURCE_CUSTOMER_ID = 207;
const TARGET_GSTIN = '27AALCC8489R1ZD';
const TARGET_COMPANY_NAME = 'CARRUM MOBILITY SOLUTIONS PRIVATE LIMITED(MH)';

const dryRun = process.argv.includes('--dry-run');

function parseDetails(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return { ...raw };
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function findDuplicate(gstin, companyName) {
  const gst = await pool.query(
    `SELECT customer_id, company_name, gst_no, billing_state
       FROM customers
      WHERE UPPER(REPLACE(COALESCE(gst_no, ''), ' ', '')) = $1
      LIMIT 1`,
    [sanitizeGstin(gstin)]
  );
  const name = await pool.query(
    `SELECT customer_id, company_name, gst_no, billing_state
       FROM customers
      WHERE company_name = $1
      LIMIT 1`,
    [companyName]
  );
  return { gst: gst.rows[0] || null, name: name.rows[0] || null };
}

async function main() {
  const dup = await findDuplicate(TARGET_GSTIN, TARGET_COMPANY_NAME);
  if (dup.gst) {
    console.log('GSTIN already exists — not creating duplicate:');
    console.log(JSON.stringify(dup.gst, null, 2));
    process.exit(0);
  }
  if (dup.name) {
    console.log('Company name already exists — not creating duplicate:');
    console.log(JSON.stringify(dup.name, null, 2));
    process.exit(0);
  }

  const sourceRes = await pool.query('SELECT * FROM customers WHERE customer_id = $1', [SOURCE_CUSTOMER_ID]);
  if (!sourceRes.rows.length) {
    throw new Error(`Source customer ${SOURCE_CUSTOMER_ID} not found`);
  }
  const source = sourceRes.rows[0];
  const sourceDetails = parseDetails(source.details);

  console.log('Fetching GST details via existing lookupGstin…');
  const gst = await lookupGstin(TARGET_GSTIN);
  console.log('GST API response:', JSON.stringify(gst, null, 2));

  const billingAddressObj = {
    name: source.name,
    phone: source.phone,
    country: 'India',
    state: gst.state,
    city: gst.city,
    zip_code: gst.pincode,
    address: gst.address,
  };

  const shippingAddresses = [{
    name: sourceDetails.contact_person_name || source.name,
    phone: sourceDetails.contact_person_number || source.phone,
    country: 'India',
    state: gst.state,
    city: gst.city,
    zip_code: gst.pincode,
    address: gst.address,
  }];

  const details = {
    ...sourceDetails,
    cloned_from_customer_id: SOURCE_CUSTOMER_ID,
    business_type: sourceDetails.business_type || 'regular',
    billing_address: billingAddressObj,
    shipping_address: shippingAddresses,
    gst_lookup: {
      gstin: gst.gstin,
      status: gst.status,
      taxpayer_type: gst.taxpayer_type,
      registered_date: gst.registered_date,
      is_einvoice_enabled: gst.is_einvoice_enabled,
      state_code: gst.gstin.slice(0, 2),
      legal_name: gst.company_name,
      trade_name: gst.trade_name,
      fetched_at: new Date().toISOString(),
    },
  };
  delete details.erp_customer_id;
  delete details.migrated_from;

  const insertParams = [
    source.name,
    TARGET_COMPANY_NAME,
    gst.trade_name || TARGET_COMPANY_NAME,
    source.email,
    source.phone,
    gst.gstin,
    gst.address,
    source.type,
    source.customer_type,
    JSON.stringify(details),
    gst.address,
    gst.city,
    gst.state,
    gst.pincode,
    false,
    gst.address,
    gst.city,
    gst.state,
    gst.pincode,
    gst.pan_number,
    gst.company_type || source.company_type,
    source.industry,
    source.whatsapp_number,
    source.designation,
    source.notes,
  ];

  if (dryRun) {
    console.log('\n[DRY RUN] Would insert customer with:');
    console.log(JSON.stringify({
      name: insertParams[0],
      company_name: insertParams[1],
      trade_name: insertParams[2],
      email: insertParams[3],
      phone: insertParams[4],
      gst_no: insertParams[5],
      billing_state: insertParams[12],
      billing_city: insertParams[11],
      billing_pincode: insertParams[13],
      pan_number: insertParams[19],
      customer_type: insertParams[8],
    }, null, 2));
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO customers (
         name, company_name, trade_name, email, phone, gst_no, address, type, customer_type, details,
         billing_address, billing_city, billing_state, billing_pincode,
         shipping_same, shipping_address, shipping_city, shipping_state, shipping_pincode,
         pan_number, company_type, industry, whatsapp_number, designation, notes,
         status, kyc_verified, kyc_status, portal_enabled, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
         $11, $12, $13, $14,
         $15, $16, $17, $18, $19,
         $20, $21, $22, $23, $24, $25,
         1, $26, $27, $28, NOW(), NOW()
       )
       RETURNING customer_id, company_name, gst_no, billing_state, billing_city, billing_pincode, pan_number`,
      [
        ...insertParams,
        source.kyc_verified,
        source.kyc_status,
        source.portal_enabled,
      ]
    );
    const newId = ins.rows[0].customer_id;

    await client.query(
      `INSERT INTO customer_addresses (
         customer_id, concern_person, mobile_no, address, city, state, pincode,
         is_head_office, address_type, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 'billing', NOW(), NOW())`,
      [newId, TARGET_COMPANY_NAME, source.phone, gst.address, gst.city, gst.state, gst.pincode]
    );
    await client.query(
      `INSERT INTO customer_addresses (
         customer_id, concern_person, mobile_no, address, city, state, pincode,
         is_head_office, address_type, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, 'shipping', NOW(), NOW())`,
      [
        newId,
        sourceDetails.contact_person_name || source.name,
        sourceDetails.contact_person_number || source.phone,
        gst.address,
        gst.city,
        gst.state,
        gst.pincode,
      ]
    );

    await client.query('COMMIT');
    console.log('\nCreated Maharashtra Carrum entity:');
    console.log(JSON.stringify(ins.rows[0], null, 2));
    console.log(`View: /lead-crm/customers/${newId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
