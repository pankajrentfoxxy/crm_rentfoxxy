#!/usr/bin/env node
/**
 * Clone customer #207 (Carrum) into state-wise entities via existing GST lookup.
 * Usage:
 *   node scripts/create-carrum-state-entities.js [--dry-run]
 *   node scripts/create-carrum-state-entities.js --only=29AALCC8489R1Z9
 */
const pool = require('../config/db');
const { lookupGstin, sanitizeGstin } = require('../services/gstinLookupService');

const SOURCE_CUSTOMER_ID = 207;

const ENTITIES = [
  { gstin: '27AALCC8489R1ZD', suffix: 'MH' },
  { gstin: '29AALCC8489R1Z9', suffix: 'KA' },
  { gstin: '36AALCC8489R1ZE', suffix: 'TS' },
  { gstin: '07AALCC8489R1ZF', suffix: 'DL' },
];

const dryRun = process.argv.includes('--dry-run');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const onlyGstin = onlyArg ? sanitizeGstin(onlyArg.split('=')[1]) : null;

function companyDisplayName(suffix) {
  return `CARRUM MOBILITY SOLUTIONS PRIVATE LIMITED(${suffix})`;
}

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

async function createEntity(source, sourceDetails, { gstin, suffix }) {
  const targetCompanyName = companyDisplayName(suffix);
  const dup = await findDuplicate(gstin, targetCompanyName);
  if (dup.gst) {
    console.log(`SKIP ${gstin} — GSTIN exists:`, dup.gst);
    return { skipped: true, reason: 'gstin', row: dup.gst };
  }
  if (dup.name) {
    console.log(`SKIP ${suffix} — name exists:`, dup.name);
    return { skipped: true, reason: 'name', row: dup.name };
  }

  console.log(`\nFetching GST for ${gstin} (${suffix})…`);
  const gst = await lookupGstin(gstin);

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

  const payload = {
    name: source.name,
    company_name: targetCompanyName,
    trade_name: gst.trade_name || targetCompanyName,
    email: source.email,
    phone: source.phone,
    gst_no: gst.gstin,
    address: gst.address,
    type: source.type,
    customer_type: source.customer_type,
    details: JSON.stringify(details),
    billing_address: gst.address,
    billing_city: gst.city,
    billing_state: gst.state,
    billing_pincode: gst.pincode,
    shipping_same: false,
    shipping_address: gst.address,
    shipping_city: gst.city,
    shipping_state: gst.state,
    shipping_pincode: gst.pincode,
    pan_number: gst.pan_number,
    company_type: gst.company_type || source.company_type,
    industry: source.industry,
    whatsapp_number: source.whatsapp_number,
    designation: source.designation,
    notes: source.notes,
    kyc_verified: source.kyc_verified,
    kyc_status: source.kyc_status,
    portal_enabled: source.portal_enabled,
  };

  if (dryRun) {
    console.log('[DRY RUN] Would create:', {
      company_name: payload.company_name,
      gst_no: payload.gst_no,
      billing_state: payload.billing_state,
      billing_city: payload.billing_city,
      billing_pincode: payload.billing_pincode,
      pan_number: payload.pan_number,
    });
    return { skipped: false, dryRun: true, payload };
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
        payload.name,
        payload.company_name,
        payload.trade_name,
        payload.email,
        payload.phone,
        payload.gst_no,
        payload.address,
        payload.type,
        payload.customer_type,
        payload.details,
        payload.billing_address,
        payload.billing_city,
        payload.billing_state,
        payload.billing_pincode,
        payload.shipping_same,
        payload.shipping_address,
        payload.shipping_city,
        payload.shipping_state,
        payload.shipping_pincode,
        payload.pan_number,
        payload.company_type,
        payload.industry,
        payload.whatsapp_number,
        payload.designation,
        payload.notes,
        payload.kyc_verified,
        payload.kyc_status,
        payload.portal_enabled,
      ]
    );
    const newId = ins.rows[0].customer_id;

    await client.query(
      `INSERT INTO customer_addresses (
         customer_id, concern_person, mobile_no, address, city, state, pincode,
         is_head_office, address_type, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 'billing', NOW(), NOW())`,
      [newId, targetCompanyName, source.phone, gst.address, gst.city, gst.state, gst.pincode]
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
    console.log('Created:', ins.rows[0]);
    return { skipped: false, row: ins.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const sourceRes = await pool.query('SELECT * FROM customers WHERE customer_id = $1', [SOURCE_CUSTOMER_ID]);
  if (!sourceRes.rows.length) throw new Error(`Source customer ${SOURCE_CUSTOMER_ID} not found`);
  const source = sourceRes.rows[0];
  const sourceDetails = parseDetails(source.details);

  const targets = ENTITIES.filter((e) => !onlyGstin || sanitizeGstin(e.gstin) === onlyGstin);
  const results = [];
  for (const entity of targets) {
    results.push(await createEntity(source, sourceDetails, entity));
  }

  console.log('\nSummary:');
  for (const r of results) {
    if (r.skipped) console.log('  skipped', r.row);
    else if (r.dryRun) console.log('  dry-run ok');
    else console.log('  created', r.row);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
