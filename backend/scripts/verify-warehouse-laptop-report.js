/**
 * Read-only verification for Warehouse Laptop Report.
 */
require('dotenv').config();
const pool = require('../config/db');
const {
  getWarehouseSummary,
  getWarehouseLaptopListing,
  DEPLOYED_WITH_CUSTOMER_STATUSES,
} = require('../services/warehouseLaptopReportService');
const { DEPLOYED_WITH_CUSTOMER_STATUSES: DEPLOYED } = require('../services/customerDeployedAssets');
const { readyToRentOrSellMatchSql } = require('../services/inventoryManagementService');
const { buildInventorySerialListQuery } = require('../utils/inventoryListQuery');

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (cond) pass += 1;
  else fail += 1;
};

async function main() {
  console.log('\n===== Warehouse Laptop Report =====');
  check('deployed statuses shared', JSON.stringify(DEPLOYED_WITH_CUSTOMER_STATUSES) === JSON.stringify(DEPLOYED));

  const readySql = readyToRentOrSellMatchSql('s');
  const direct = (await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM vendor_serial_numbers s
      WHERE s.deleted_at IS NULL
        AND (
          NOT (s.inventory_status = ANY($1::text[]))
          OR (${readySql})
        )`,
    [[...DEPLOYED]]
  )).rows[0].n;

  const summary = await getWarehouseSummary({});
  check('summary.total === direct warehouse count', summary.total === direct, `${summary.total} vs ${direct}`);

  const { fromSql, params } = buildInventorySerialListQuery({
    segment: 'passed',
    includeTicketJoins: false,
    includeGrnJoin: false,
    inventoryTagAccess: 'all',
  });
  const invReady = (await pool.query(`SELECT COUNT(*)::int AS n ${fromSql}`, params)).rows[0].n;
  check(
    'ready_to_rent_sell === inventory ready-to-rent-or-sell',
    summary.ready_to_rent_sell === invReady,
    `${summary.ready_to_rent_sell} vs ${invReady}`
  );

  const named = ['qc1', 'qc2', 'diagnosis', 'hardware_software', 'final_testing',
    'ready_to_rent_sell', 'out_for_repair', 'dead_scrapped', 'pending_inventory'];
  const namedSum = named.reduce((s, k) => s + (summary[k] || 0), 0);
  const allSum = namedSum + (summary.other || 0);
  check('named buckets <= total', namedSum <= summary.total, `${namedSum} <= ${summary.total}`);
  check('named + other === total', allSum === summary.total, `${allSum} === ${summary.total}`);

  const rented = (await pool.query(
    `SELECT serial_id, serial_number, inventory_status
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND inventory_status IN ('rented', 'sold', 'on_demo')
      LIMIT 1`
  )).rows[0];
  if (rented) {
    const listing = await getWarehouseLaptopListing({ limit: 200, page: 1 });
    const found = listing.data.some((r) => Number(r.serial_id) === Number(rented.serial_id));
    check('customer-held serial excluded from listing', !found, `${rented.inventory_status} #${rented.serial_id}`);
  } else {
    check('customer-held serial excluded from listing', true, 'no deployed sample');
  }

  const scrapped = (await pool.query(
    `SELECT serial_id FROM vendor_serial_numbers
      WHERE deleted_at IS NULL AND inventory_status = 'scrapped' LIMIT 1`
  )).rows[0];
  if (scrapped) {
    const listing = await getWarehouseLaptopListing({ current_stage: 'dead_scrapped', limit: 100, page: 1 });
    const found = listing.data.some((r) => Number(r.serial_id) === Number(scrapped.serial_id));
    check('scrapped serial in dead_scrapped bucket', found || summary.dead_scrapped > 0, `count=${summary.dead_scrapped}`);
  } else {
    check('scrapped serial in dead_scrapped bucket', summary.dead_scrapped === 0, 'no scrapped sample');
  }

  const brandRow = (await pool.query(
    `SELECT DISTINCT COALESCE(t.brand, pa.brand) AS brand
       FROM vendor_serial_numbers s
       LEFT JOIN tickets t ON t.vendor_serial_id = s.serial_id AND t.status NOT IN ('completed','cancelled')
       LEFT JOIN production_assets pa ON pa.vendor_serial_id = s.serial_id AND pa.status = 'pending_inventory'
      WHERE s.deleted_at IS NULL
        AND NOT (s.inventory_status = ANY($1::text[]))
        AND COALESCE(t.brand, pa.brand, '') <> ''
      LIMIT 1`,
    [[...DEPLOYED]]
  )).rows[0];
  if (brandRow?.brand) {
    const brand = brandRow.brand;
    const s2 = await getWarehouseSummary({ brand });
    const l2 = await getWarehouseLaptopListing({ brand, limit: 1, page: 1 });
    check('brand filter summary/list consistent totals', s2.total === l2.pagination.total, `${s2.total} vs ${l2.pagination.total} (${brand})`);
  } else {
    check('brand filter summary/list consistent totals', true, 'no brand sample');
  }

  console.log(`\nWarehouse report checks: ${pass} passed, ${fail} failed`);
  console.log('Summary snapshot:', summary);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
