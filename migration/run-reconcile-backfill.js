#!/usr/bin/env node
/**
 * ERP ↔ CRM gap backfill: QC resync, missing SO/DC rows, split duplicate PO map.
 *
 * Usage:
 *   MIGRATION_APPROVED=true node run-reconcile-backfill.js
 *   MIGRATION_APPROVED=true node run-reconcile-backfill.js --force
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const config = require('./lib/config');
const { initMigrationInfrastructure, runModule, closePools } = require('./lib/runner');
const { createErpSource } = require('./lib/erpSource');
const { getCrmPool } = require('./lib/db');
const { str, parseJson, setCrmId, getCrmId } = require('./lib/helpers');
const { mapPoStatus, mapPoType } = (() => {
  const VALID = new Set(['rental_purchase', 'rent_to_own', 'direct_purchase']);
  return {
    mapPoStatus(raw) {
      const s = str(raw, 64, 'pending').toLowerCase();
      const map = { pending: 'draft', processing: 'processing', completed: 'completed', void: 'void', approved: 'approved' };
      return map[s] || s;
    },
    mapPoType(raw) {
      const t = str(raw, 64, 'direct_purchase').toLowerCase();
      if (VALID.has(t)) return t;
      if (t.includes('rental')) return 'rental_purchase';
      if (t.includes('rent_to_own') || t.includes('rto')) return 'rent_to_own';
      return 'direct_purchase';
    },
  };
})();
const { parseLaravelAssetsDetailsPayload } = require('./lib/laravelAssets');
const { mapRequired } = require('./lib/id-map');
const { writeLog } = require('./lib/logger');

const mod031 = require('./scripts/031_qc_process_resync');
const mod017 = require('./scripts/017_sales_orders');
const mod020 = require('./scripts/020_delivery_challans');
const mod024 = require('./scripts/024_return_delivery_challans');

async function splitDuplicatePo28(crm, erp) {
  const dup = await crm.query(`
    SELECT crm_id, array_agg(erp_id ORDER BY erp_id) AS erp_ids
    FROM erp_id_map WHERE entity = 'purchase_orders'
    GROUP BY crm_id HAVING COUNT(*) > 1
  `);
  if (!dup.rows.length) {
    console.log('No duplicate PO maps to split.');
    return 0;
  }

  let fixed = 0;
  for (const row of dup.rows) {
    const erpIds = row.erp_ids.filter((id) => id !== row.erp_ids[0]);
    for (const erpId of erpIds) {
      const [erpRows] = await erp.query(
        'SELECT * FROM purchase_orders WHERE id = ?',
        [erpId]
      );
      const erpRow = erpRows?.[0] || (erp.getTableRows
        ? erp.getTableRows('purchase_orders').find((r) => String(r.id) === String(erpId))
        : null);
      if (!erpRow) continue;

      let crmVendorId;
      try {
        crmVendorId = await mapRequired(crm, 'vendors', erpRow.vendor_id);
      } catch {
        writeLog('migration', `036 skip split PO ${erpId}: vendor not mapped`);
        continue;
      }

      const poNumber = `${str(erpRow.purchase_order_number, 64, `PO-ERP-${erpId}`)}-ERP${erpId}`;
      const assetsRaw = parseJson(erpRow.assets_details, null);
      const lineItems = parseLaravelAssetsDetailsPayload(assetsRaw ?? erpRow.assets_details);

      const { rows: ins } = await crm.query(
        `INSERT INTO vendor_purchase_orders (
           purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, po_state,
           is_same_state, sub_total_amount, total_amount, line_items, assets_details,
           product_details_legacy_ids, remarks, status, invoice_created, invoice_path,
           rental_period, bill_name, bill_files, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20
         ) RETURNING po_id`,
        [
          poNumber,
          erpRow.purchase_order_date,
          mapPoType(erpRow.purchase_order_type),
          crmVendorId,
          str(erpRow.state, 128, 'NA'),
          Boolean(erpRow.isSameState),
          Number(erpRow.sub_total_amount) || 0,
          Number(erpRow.total_amount) || 0,
          JSON.stringify(lineItems),
          JSON.stringify(assetsRaw ?? []),
          JSON.stringify(parseJson(erpRow.product_details_id, [])),
          str(erpRow.remarks, 10000, null),
          mapPoStatus(erpRow.status),
          String(erpRow.invoice_created || '').toLowerCase() === 'completed',
          str(erpRow.invoice_path, 2000, null),
          str(erpRow.locking_period, 128, null),
          str(erpRow.bill_name, 255, null),
          JSON.stringify(parseJson(erpRow.bill_files, [])),
          erpRow.created_at || new Date(),
          erpRow.updated_at || new Date(),
        ]
      );

      await crm.query(
        `UPDATE erp_id_map SET crm_id = $2 WHERE entity = 'purchase_orders' AND erp_id = $1`,
        [String(erpId), String(ins[0].po_id)]
      );
      fixed += 1;
      writeLog('migration', `036 split PO erp_id=${erpId} -> crm po_id=${ins[0].po_id} number=${poNumber}`);
      console.log(`Split PO ERP ${erpId} -> CRM po_id ${ins[0].po_id} (${poNumber})`);
    }
  }
  return fixed;
}

async function main() {
  const force = process.argv.includes('--force');
  if (!config.approved) {
    console.error('Set MIGRATION_APPROVED=true');
    process.exit(1);
  }

  await initMigrationInfrastructure();

  console.log('\n=== Split duplicate PO maps ===');
  const erp = await createErpSource();
  const crm = getCrmPool();
  await splitDuplicatePo28(crm, erp);

  console.log('\n=== Module 031 QC resync ===');
  await runModule(mod031, { force: true });

  console.log('\n=== Module 017 sales orders (missing lines) ===');
  await runModule(mod017, { force });

  console.log('\n=== Module 020 delivery challans (missing rows) ===');
  await runModule(mod020, { force });

  console.log('\n=== Module 024 return delivery challans ===');
  await runModule(mod024, { force });

  console.log('\n=== Module 037 DC status resync ===');
  await runModule(require('./scripts/037_dc_status_resync'), { force: true });

  console.log('\n=== Module 038 DC JSON fields resync ===');
  await runModule(require('./scripts/038_dc_json_fields_resync'), { force: true });

  console.log('\n=== Module 039 delivery person remap ===');
  await runModule(require('./scripts/039_delivery_person_remap'), { force: true });

  console.log('\n=== Module 040 delivery person ERP sync ===');
  await runModule(require('./scripts/040_delivery_person_erp_sync'), { force: true });

  await erp.close();
  await closePools();

  console.log('\nBackfill complete. Run: node tools/reconcile-erp-crm-all.js --fix-report');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
