#!/usr/bin/env node
/**
 * Backfill vendor_serial_numbers.extra.line_index for migrated GRN serials.
 *
 * ERP keys received units & laptop config by product_id (pro_id): the GRN view
 * joins serial_numbers.product_id -> product_details for specs, and counts
 * received per (po_id, product_id). The CRM stores the laptop config in
 * vendor_purchase_orders.line_items (parallel to product_details_legacy_ids,
 * which is the ERP product_details_id order) and resolves a serial's line via
 * extra.line_index. Migrated serials carry extra.product_id but no line_index,
 * so getGrnReceivedProducts() can't find the laptop (shows "Laptop"/"—") and
 * enrichLineItemsWithReceived() can't attribute the unit (received_qty=0,
 * remaining shows the full order qty).
 *
 * This computes line_index per serial (data-only, no code change):
 *   1. index of extra.product_id within the PO's product_details_legacy_ids
 *   2. else, single-line PO -> 0
 *   3. else skip (PO has no line items -> nothing to map)
 *
 * Reversible: prior extra is saved in grn_serial_lineidx_backup.
 *
 *   node tools/fix-grn-serial-line-index.js            # apply
 *   node tools/fix-grn-serial-line-index.js --rollback # undo
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');

const BACKUP_TABLE = 'grn_serial_lineidx_backup';
const arr = (v) => (Array.isArray(v) ? v
  : (typeof v === 'string' ? (() => { try { return JSON.parse(v || '[]'); } catch { return []; } })() : []));

async function ensureBackup(crm) {
  await crm.query(`
    CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
      serial_id   BIGINT PRIMARY KEY,
      old_extra   JSONB,
      line_index  INT,
      changed_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function apply(crm) {
  await ensureBackup(crm);
  const { rows } = await crm.query(`
    SELECT s.serial_id, s.extra, s.extra->>'product_id' AS pid,
           p.product_details_legacy_ids AS legacy,
           jsonb_array_length(COALESCE(NULLIF(p.line_items,'null'::jsonb),'[]'::jsonb)) AS li_count
      FROM vendor_serial_numbers s
      JOIN vendor_purchase_orders p ON p.po_id = s.po_id
     WHERE s.deleted_at IS NULL
       AND s.extra ? 'product_id'
       AND NOT (s.extra ? 'line_index')`);

  let viaPid = 0; let viaSingle = 0; let skipped = 0;
  await crm.query('BEGIN');
  try {
    for (const r of rows) {
      const legacy = arr(r.legacy).map(String);
      const liCount = Number(r.li_count) || 0;
      if (liCount === 0) { skipped += 1; continue; } // PO has no line items to map to
      const posIdx = legacy.indexOf(String(r.pid));
      let idx;
      let how;
      // Positional mapping is only valid when legacy ids align 1:1 with line_items
      // (true for every multi-line PO). Legacy POs carry a cumulative/garbage id
      // list with a single real line — fall back to the sole line in that case.
      if (posIdx >= 0 && posIdx < liCount) {
        idx = posIdx; how = 'pid';
      } else if (liCount === 1) {
        idx = 0; how = 'single';
      } else {
        skipped += 1; continue;
      }

      await crm.query(
        `INSERT INTO ${BACKUP_TABLE} (serial_id, old_extra, line_index)
         VALUES ($1, $2, $3) ON CONFLICT (serial_id) DO NOTHING`,
        [r.serial_id, r.extra, idx],
      );
      await crm.query(
        `UPDATE vendor_serial_numbers
            SET extra = COALESCE(extra,'{}'::jsonb) || jsonb_build_object('line_index', $2::int),
                updated_at = NOW()
          WHERE serial_id = $1`,
        [r.serial_id, idx],
      );
      if (how === 'pid') viaPid += 1; else viaSingle += 1;
    }
    await crm.query('COMMIT');
  } catch (e) {
    await crm.query('ROLLBACK');
    throw e;
  }
  console.log(`Candidates           : ${rows.length}`);
  console.log(`Set via product_id   : ${viaPid}`);
  console.log(`Set via single-line  : ${viaSingle}`);
  console.log(`Skipped (no line)    : ${skipped}`);
}

async function rollback(crm) {
  const exists = await crm.query(`SELECT to_regclass($1) AS t`, [BACKUP_TABLE]);
  if (!exists.rows[0].t) { console.log('No backup table — nothing to roll back.'); return; }
  await crm.query('BEGIN');
  try {
    const upd = await crm.query(
      `UPDATE vendor_serial_numbers s
          SET extra = b.old_extra, updated_at = NOW()
         FROM ${BACKUP_TABLE} b
        WHERE s.serial_id = b.serial_id`,
    );
    await crm.query(`DELETE FROM ${BACKUP_TABLE}`);
    await crm.query('COMMIT');
    console.log(`Reverted: ${upd.rowCount} serial(s)`);
  } catch (e) {
    await crm.query('ROLLBACK');
    throw e;
  }
}

(async () => {
  const crm = getCrmPool();
  try {
    if (process.argv.includes('--rollback')) await rollback(crm);
    else await apply(crm);
  } finally {
    await closePools();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
