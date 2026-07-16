/**
 * Backfill null HSN/SAC on SO / DC / VRDC lines from transaction-type defaults.
 *
 * Usage:
 *   node scripts/backfill-hsn-by-txn-type.js           # dry-run (default)
 *   node scripts/backfill-hsn-by-txn-type.js --apply   # write updates
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');
const {
  resolveDefaultHsn,
  txnTypeFromQuotation,
  txnTypeFromEntity,
  HSN_DEFAULTS,
} = require('../constants/hsnDefaults');

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`[backfill-hsn] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('[backfill-hsn] defaults:', HSN_DEFAULTS);

  // Ensure columns exist
  await pool.query(`
    ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(12);
    ALTER TABLE delivery_challan_lines ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(12);
  `).catch(() => {});

  const soNull = await pool.query(
    `SELECT id, sales_order_number, quotation_type, entity_code, hsn_code
       FROM sales_order_lines
      WHERE hsn_code IS NULL OR TRIM(hsn_code) = ''
      ORDER BY id ASC`
  );
  console.log(`[backfill-hsn] SO lines missing HSN: ${soNull.rows.length}`);

  let soUpdated = 0;
  for (const row of soNull.rows) {
    const txn = row.quotation_type
      ? txnTypeFromQuotation(row.quotation_type)
      : txnTypeFromEntity(row.entity_code);
    const hsn = resolveDefaultHsn(txn);
    console.log(`  SO ${row.sales_order_number} #${row.id} → ${txn} / ${hsn}`);
    if (APPLY) {
      await pool.query(`UPDATE sales_order_lines SET hsn_code = $1 WHERE id = $2`, [hsn, row.id]);
      soUpdated += 1;
    }
  }

  const dcNull = await pool.query(
    `SELECT dcl.id, dcl.dc_number, dcl.sales_order_number, dcl.original_dc_number,
            dcl.entity_code, dcl.movement_type, dcl.hsn_code,
            sol.quotation_type
       FROM delivery_challan_lines dcl
       LEFT JOIN LATERAL (
         SELECT quotation_type FROM sales_order_lines
          WHERE sales_order_number = dcl.sales_order_number
          ORDER BY id ASC LIMIT 1
       ) sol ON TRUE
      WHERE dcl.hsn_code IS NULL OR TRIM(dcl.hsn_code) = ''
      ORDER BY dcl.id ASC`
  );
  console.log(`[backfill-hsn] DC/RDC lines missing HSN: ${dcNull.rows.length}`);

  let dcUpdated = 0;
  for (const row of dcNull.rows) {
    let txn;
    if (row.quotation_type) txn = txnTypeFromQuotation(row.quotation_type);
    else if (row.entity_code) txn = txnTypeFromEntity(row.entity_code);
    else txn = 'rental';
    const hsn = resolveDefaultHsn(txn);
    console.log(`  DC ${row.dc_number} #${row.id} (${row.movement_type || 'outbound'}) → ${txn} / ${hsn}`);
    if (APPLY) {
      await pool.query(`UPDATE delivery_challan_lines SET hsn_code = $1 WHERE id = $2`, [hsn, row.id]);
      dcUpdated += 1;
    }
  }

  let vrdcNull = { rows: [] };
  try {
    vrdcNull = await pool.query(
      `SELECT id, dc_number, ticket_id, hsn_code
         FROM vendor_repair_dc_items
        WHERE hsn_code IS NULL OR TRIM(hsn_code) = ''
        ORDER BY id ASC`
    );
  } catch (e) {
    console.log('[backfill-hsn] VRDC items table/column skipped:', e.message);
  }
  console.log(`[backfill-hsn] VRDC items missing HSN: ${vrdcNull.rows.length}`);
  let vrdcUpdated = 0;
  const repairHsn = resolveDefaultHsn('repair');
  for (const row of vrdcNull.rows) {
    console.log(`  VRDC ${row.dc_number} ticket #${row.ticket_id} → repair / ${repairHsn}`);
    if (APPLY) {
      await pool.query(`UPDATE vendor_repair_dc_items SET hsn_code = $1 WHERE id = $2`, [repairHsn, row.id]);
      vrdcUpdated += 1;
    }
  }

  console.log('[backfill-hsn] summary:', {
    so: APPLY ? soUpdated : `would_update=${soNull.rows.length}`,
    dc: APPLY ? dcUpdated : `would_update=${dcNull.rows.length}`,
    vrdc: APPLY ? vrdcUpdated : `would_update=${vrdcNull.rows.length}`,
  });
  if (!APPLY) console.log('[backfill-hsn] Re-run with --apply to write changes.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
