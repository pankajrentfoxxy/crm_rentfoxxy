#!/usr/bin/env node
/**
 * Audit TTSPL sequence gaps and investigate a specific code (e.g. TTSPL7482).
 *
 *   node scripts/audit-ttspl-sequence.js
 *   node scripts/audit-ttspl-sequence.js --code=TTSPL7482 --po=153
 */
require('dotenv').config();
const pool = require('../config/db');
const { findTtsplGaps, formatTtspl } = require('../services/vendorInventoryAssetCodeService');

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? true];
    })
  );
  const code = String(args.code || 'TTSPL7482').toUpperCase();
  const poId = args.po ? Number(args.po) : null;

  const gaps = await findTtsplGaps(pool);
  console.log('\n=== TTSPL sequence audit ===');
  console.log(`Highest active TTSPL: ${formatTtspl(gaps.max)}`);
  console.log(`Sequence next_num:    ${gaps.next_num}`);
  console.log(`Gaps (1..max):        ${gaps.gap_count}`);
  if (gaps.gaps.length) {
    const preview = gaps.gaps.slice(0, 20).map(formatTtspl).join(', ');
    console.log(`  ${preview}${gaps.gaps.length > 20 ? ` … +${gaps.gaps.length - 20} more` : ''}`);
  }

  const codeRes = await pool.query(
    `SELECT serial_id, serial_number, inventory_asset_code, po_id, grn_id,
            deleted_at, qc_status, inventory_status, created_at
       FROM vendor_serial_numbers
      WHERE inventory_asset_code ILIKE $1
         OR extra->>'unique_product_serial' ILIKE $1
      ORDER BY created_at`,
    [code]
  );
  console.log(`\n=== Rows matching ${code} ===`);
  if (!codeRes.rows.length) {
    console.log('  (none — code was reserved but no laptop row was saved, or never allocated)');
  } else {
    for (const row of codeRes.rows) {
      console.log(
        `  serial_id=${row.serial_id} sn=${row.serial_number} po_id=${row.po_id} grn=${row.grn_id}`
        + ` deleted=${row.deleted_at ? 'yes' : 'no'} status=${row.inventory_status} created=${row.created_at}`
      );
    }
  }

  if (poId) {
    const poRes = await pool.query(
      `SELECT po_id, purchase_order_number FROM vendor_purchase_orders WHERE po_id = $1`,
      [poId]
    );
    const poLabel = poRes.rows[0]?.purchase_order_number || `po_id=${poId}`;
    const rows = await pool.query(
      `SELECT serial_id, serial_number, inventory_asset_code, grn_id, created_at
         FROM vendor_serial_numbers
        WHERE po_id = $1 AND deleted_at IS NULL
        ORDER BY CAST(SUBSTRING(inventory_asset_code FROM 6) AS INTEGER)`,
      [poId]
    );
    console.log(`\n=== Laptops on ${poLabel} (po_id=${poId}) ===`);
    for (const row of rows.rows) {
      console.log(`  ${row.inventory_asset_code}  ${row.serial_number}  grn=${row.grn_id}  created=${row.created_at}`);
    }
  }

  const auditRes = await pool.query(
    `SELECT created_at, action, payload
       FROM vendor_audit_log
      WHERE payload::text ILIKE $1
      ORDER BY created_at DESC
      LIMIT 10`,
    [`%${code.replace('TTSPL', '')}%`]
  ).catch(() => ({ rows: [] }));

  if (auditRes.rows?.length) {
    console.log(`\n=== Recent vendor audit mentioning ${code} ===`);
    for (const row of auditRes.rows) {
      console.log(`  ${row.created_at}  ${row.action}`);
    }
  }

  console.log('');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
