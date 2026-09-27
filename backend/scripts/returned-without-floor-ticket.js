#!/usr/bin/env node
/**
 * Returned laptops with no open floor ticket never move back to stock (41 on QA,
 * 27 Sep 2026). Give each one a return QC ticket — the same one a return POD
 * creates (grnTicketService.createTicketFromReturn).
 *
 *   node scripts/returned-without-floor-ticket.js            → dry run
 *   node scripts/returned-without-floor-ticket.js --commit
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const pool = require('../config/db');
const { createTicketFromReturn } = require('../services/grnTicketService');

(async () => {
  const commit = process.argv.includes('--commit');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(
      `SELECT v.serial_id, v.serial_number, v.inventory_asset_code, v.extra, v.current_dc_number,
              COALESCE(cu.company_name, cu.name) AS customer_name
         FROM vendor_serial_numbers v
         LEFT JOIN customers cu ON cu.customer_id = v.current_customer_id
        WHERE v.deleted_at IS NULL AND v.po_id IS NOT NULL AND v.spo_id IS NULL
          AND v.inventory_status = 'returned'
          AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.vendor_serial_id = v.serial_id
                            AND t.status IN ('in_progress', 'on_hold', 'diagnosis_failed', 'out_for_repair'))`
    );
    const out = { found: rows.length, created: 0, skipped: {} };
    for (const r of rows) {
      const ex = r.extra || {};
      const res = await createTicketFromReturn(c, {
        serialId: r.serial_id,
        serialNumber: r.serial_number,
        inventoryAssetCode: r.inventory_asset_code,
        customerLabel: r.customer_name || 'customer',
        dcNumber: r.current_dc_number,
        reason: 'Returned laptop had no floor ticket (clean-up 27 Sep 2026)',
        specs: { brand: ex.brand, model: ex.model || ex.model_name, processor: ex.processor, generation: ex.generation, ram: ex.ram, storage: ex.storage },
        actorUserId: null,
      });
      if (res?.ok) out.created += 1;
      else out.skipped[res?.reason || 'unknown'] = (out.skipped[res?.reason || 'unknown'] || 0) + 1;
    }
    console.log(JSON.stringify(out));
    await c.query(commit ? 'COMMIT' : 'ROLLBACK');
    console.log(commit ? 'COMMITTED' : 'Dry run — rolled back. Add --commit to keep it.');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error(e);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
