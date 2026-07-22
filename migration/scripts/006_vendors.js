/**
 * 006 — ERP sellers → CRM vendors (+ vendor_shops)
 * Additive: match by email/GST; never truncate.
 */
const { progress, writeLog } = require('../lib/logger');
const {
  getCrmId,
  setCrmId,
  normalizeEmail,
  normalizeGst,
  str,
  findExistingByEmailOrGst,
  bumpVendorSequence,
} = require('../lib/helpers');

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

module.exports = {
  id: '006',
  name: 'vendors',
  async run({ erp, crm, batchSize }) {
    const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM `sellers`');
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let inserted = 0;
    let mapped = 0;
    let shopsCreated = 0;

    const [sellers] = await erp.query(
      `SELECT id, f_name, l_name, phone, email, password, status, business_name, address, state,
              business_type, brand_code, business_registration_number, tax_identification_number,
              bank_name, account_holder_name, bank_ifsc_code, account_no, holder_name, gst,
              remember_pass, image, licenses_and_permits, created_at, updated_at
         FROM \`sellers\` ORDER BY id`
    );

    for (const row of sellers) {
      processed += 1;

      const existingMap = await getCrmId(crm, 'vendors', row.id);
      if (existingMap != null) {
        if (processed % batchSize === 0 || processed === total) progress('vendors', processed, total);
        continue;
      }

      const email = normalizeEmail(row.email) || `erp-seller-${row.id}@migration.local`;
      const gst = normalizeGst(row.gst);
      let crmVendorId = await findExistingByEmailOrGst(crm, {
        table: 'vendors',
        emailCol: 'email',
        gstCol: 'gst_number',
        email,
        gst,
        idCol: 'vendor_id',
      });

      if (crmVendorId) {
        await setCrmId(crm, {
          entity: 'vendors',
          erpId: row.id,
          crmId: crmVendorId,
          erpTable: 'sellers',
          crmTable: 'vendors',
        });
        mapped += 1;
      } else {
        const { first, last } = splitName(row);
        const businessName = str(row.business_name, 255, first);
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
            gst || null,
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

        crmVendorId = ins[0].vendor_id;
        await setCrmId(crm, {
          entity: 'vendors',
          erpId: row.id,
          crmId: crmVendorId,
          erpTable: 'sellers',
          crmTable: 'vendors',
        });
        inserted += 1;
      }

      const { rows: shopExists } = await crm.query(
        'SELECT shop_id FROM vendor_shops WHERE vendor_id = $1 LIMIT 1',
        [crmVendorId]
      );
      if (!shopExists.length) {
        await crm.query(
          `INSERT INTO vendor_shops (vendor_id, name, address, contact, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          [
            crmVendorId,
            str(row.business_name, 255, str(row.f_name, 255, 'Shop')),
            str(row.address, 5000, null),
            str(row.phone, 32, null),
          ]
        );
        shopsCreated += 1;
      }

      if (processed % batchSize === 0 || processed === total) {
        progress('vendors', processed, total);
      }
    }

    await bumpVendorSequence(crm);
    writeLog('migration', `006 complete: inserted=${inserted} mapped=${mapped} shops=${shopsCreated} total=${total}`);
    return inserted + mapped;
  },
};
