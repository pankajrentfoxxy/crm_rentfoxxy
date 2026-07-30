#!/usr/bin/env node
/**
 * Backfill vendor_serial_numbers.rent_monthly_rate from sales-order allocation
 * for customer-held assets (in_transit, rented, etc.) where rate is missing.
 *
 *   node scripts/backfill-customer-asset-rates.js              # dry-run
 *   node scripts/backfill-customer-asset-rates.js --commit   # apply
 *   node scripts/backfill-customer-asset-rates.js --commit --ttspl TTSPL7565
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { DEPLOYED_WITH_CUSTOMER_STATUSES } = require('../services/customerDeployedAssets');
const { resolveSerialRentRate } = require('../services/serialRentRateService');

const COMMIT = process.argv.includes('--commit');
const ttsplFilter = (() => {
  const i = process.argv.indexOf('--ttspl');
  return i >= 0 ? String(process.argv[i + 1] || '').trim() : '';
})();

async function main() {
  const params = [DEPLOYED_WITH_CUSTOMER_STATUSES];
  let where = `
    vsn.deleted_at IS NULL
    AND vsn.current_customer_id IS NOT NULL
    AND vsn.inventory_status = ANY($1::text[])
    AND (vsn.rent_monthly_rate IS NULL OR vsn.rent_monthly_rate = 0)
  `;
  if (ttsplFilter) {
    params.push(ttsplFilter);
    where += ` AND vsn.inventory_asset_code = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT vsn.serial_id, vsn.inventory_asset_code AS ttspl, vsn.current_dc_number,
            vsn.current_customer_id, c.company_name
       FROM vendor_serial_numbers vsn
       LEFT JOIN customers c ON c.customer_id = vsn.current_customer_id
      WHERE ${where}
      ORDER BY vsn.serial_id`,
    params
  );

  console.log(`Candidates: ${rows.length}${COMMIT ? ' (LIVE)' : ' (dry-run)'}`);

  const updates = [];
  for (const row of rows) {
    const rate = await resolveSerialRentRate(pool, row.serial_id, row.current_dc_number);
    if (!rate) continue;
    updates.push({ ...row, rate });
  }

  console.log(`Will update: ${updates.length}`);
  for (const u of updates.slice(0, 20)) {
    console.log(`  ${u.ttspl} customer #${u.current_customer_id} ${u.company_name || ''} -> ₹${u.rate}`);
  }
  if (updates.length > 20) console.log(`  ... and ${updates.length - 20} more`);

  if (!COMMIT || !updates.length) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of updates) {
      await client.query(
        `UPDATE vendor_serial_numbers
            SET rent_monthly_rate = $1, updated_at = NOW()
          WHERE serial_id = $2`,
        [u.rate, u.serial_id]
      );
    }
    await client.query('COMMIT');
    console.log(`Updated ${updates.length} serial(s).`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Failed:', e.message || e);
  process.exit(1);
});
