#!/usr/bin/env node
/**
 * Split deduped ERP vendors into separate CRM rows (116 ERP → 116 CRM vendors).
 * Keeps the first ERP id per crm_id; re-inserts additional ERP ids as new vendors.
 *
 * Usage: node tools/add-split-vendors.js [--apply]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, getErpPool, closePools } = require('../lib/db');
const { setCrmId } = require('../lib/id-map');
const { normalizeEmail, normalizeGst, str, bumpVendorSequence } = require('../lib/helpers');

function mapVendorStatus(erpStatus) {
  const s = str(erpStatus, 32, 'approved').toLowerCase();
  if (['approved', 'active', '1'].includes(s)) return 'approved';
  if (['pending', '0'].includes(s)) return 'pending';
  if (['rejected', 'blocked'].includes(s)) return 'rejected';
  return 'approved';
}

function splitName(row) {
  const first = str(row.f_name, 255, '') || str(row.business_name, 255, 'Vendor');
  const last = str(row.l_name, 255, '') || null;
  return { first, last };
}

async function insertVendorFromErp(crm, row) {
  const { first, last } = splitName(row);
  const businessName = str(row.business_name, 255, first);
  const email = normalizeEmail(row.email) || `erp-seller-${row.id}@migration.local`;
  const gst = normalizeGst(row.gst) || null;
  const passwordHash = str(row.password, 500, '$2y$10$migration.placeholder.not.for.login');
  const regDate = row.created_at ? new Date(row.created_at) : new Date();

  const { rows: ins } = await crm.query(
    `INSERT INTO vendors (
       status, first_name, last_name, business_name, email, phone, password_hash,
       address, business_type, registration_date, state, gst_number, brand_code,
       business_registration_number, tax_identification_number,
       bank_name, account_number, bank_ifsc_code, account_holder_name,
       image_url, licenses_url, remember_pass_plain,
       vendor_portal_password_hash, vendor_portal_enabled,
       contact_person_name, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,true,$24,$25,$26
     ) RETURNING vendor_id`,
    [
      mapVendorStatus(row.status),
      first,
      last,
      businessName,
      email.slice(0, 255),
      str(row.phone, 32, '0000000000'),
      passwordHash,
      str(row.address, 5000, 'N/A'),
      str(row.business_type, 255, 'Rental & Purchase'),
      regDate,
      str(row.state, 128, 'NA'),
      gst,
      str(row.brand_code, 64, null),
      str(row.business_registration_number, 128, null),
      str(row.tax_identification_number, 128, null),
      str(row.bank_name, 255, 'N/A'),
      str(row.account_no, 64, 'N/A'),
      str(row.bank_ifsc_code, 32, 'N/A'),
      str(row.account_holder_name || row.holder_name, 255, businessName),
      row.image && row.image !== 'def.png' ? str(row.image, 2000, null) : null,
      str(row.licenses_and_permits, 2000, null),
      str(row.remember_pass, 500, null),
      passwordHash,
      first,
      row.created_at || new Date(),
      row.updated_at || new Date(),
    ]
  );

  const vendorId = ins[0].vendor_id;
  await crm.query(
    `INSERT INTO vendor_shops (vendor_id, name, address, contact, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [vendorId, businessName, str(row.address, 5000, null), str(row.phone, 32, null)]
  );
  return vendorId;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const crm = getCrmPool();
  const erp = await getErpPool();

  const { rows: maps } = await crm.query(
    `SELECT m.erp_id, m.crm_id, v.business_name, v.gst_number
       FROM erp_id_map m
       JOIN vendors v ON v.vendor_id = m.crm_id
      WHERE m.entity = 'vendors'
      ORDER BY m.crm_id, m.erp_id`
  );

  const byCrm = {};
  for (const r of maps) {
    if (!byCrm[r.crm_id]) byCrm[r.crm_id] = [];
    byCrm[r.crm_id].push(r);
  }

  const toSplit = [];
  for (const group of Object.values(byCrm)) {
    if (group.length < 2) continue;
    for (let i = 1; i < group.length; i += 1) {
      toSplit.push(group[i]);
    }
  }

  console.log(`ERP vendors to split into new CRM rows: ${toSplit.length}`);
  for (const t of toSplit) {
    console.log(`  ERP ${t.erp_id} (currently crm_id=${t.crm_id} ${t.business_name})`);
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to insert vendors and update erp_id_map.');
    await closePools();
    return;
  }

  const sellerSql = `SELECT id, f_name, l_name, phone, email, password, status, business_name, address, state,
            business_type, brand_code, business_registration_number, tax_identification_number,
            bank_name, account_holder_name, bank_ifsc_code, account_no, holder_name, gst,
            remember_pass, image, licenses_and_permits, created_at, updated_at
       FROM sellers WHERE id = ?`;

  for (const t of toSplit) {
    const [rows] = await erp.query(sellerSql, [t.erp_id]);
    const row = rows[0];
    if (!row) {
      console.error(`ERP seller ${t.erp_id} not found`);
      continue;
    }
    const newVendorId = await insertVendorFromErp(crm, row);
    await setCrmId(crm, {
      entity: 'vendors',
      erpId: row.id,
      crmId: newVendorId,
      erpTable: 'sellers',
      crmTable: 'vendors',
    });
    console.log(`ERP ${row.id} → new CRM vendor_id=${newVendorId} (${row.business_name})`);
  }

  await bumpVendorSequence(crm);

  const crmTotal = (await crm.query('SELECT COUNT(*)::int c FROM vendors')).rows[0].c;
  const erpTotal = (await erp.query('SELECT COUNT(*) AS cnt FROM sellers'))[0][0].cnt;
  console.log(`\nDone. CRM vendors: ${crmTotal}  ERP sellers: ${erpTotal}`);

  await closePools();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
