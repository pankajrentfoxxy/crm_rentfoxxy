#!/usr/bin/env node
/**
 * One-off: bring open spare-parts POs' status in line with what was received.
 *
 * Spare POs never moved on receipt (the laptop PO did), so on QA 54 fully
 * received spare POs still read "approved" and 3 part-received ones too
 * (29 Sep 2026). Receiving now moves them approved → processing → completed
 * in the receipt transaction; this applies the same rule
 * (spareStatusAfterReceipt) to the ones already received. Audit row per PO.
 *
 *   node scripts/sync-spare-po-receive-status.js            # dry run: lists changes
 *   node scripts/sync-spare-po-receive-status.js --apply    # applies them
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const pool = require('../config/db');
const spo = require('../controllers/vendorManagement/sparePartsOrders.controller');
const { logVendorAudit } = require('../services/vendorAuditLogService');

(async () => {
  const apply = process.argv.includes('--apply');
  const rows = (await pool.query(
    `SELECT spo_id, purchase_order_number, status, vendor_id, line_items FROM vendor_spare_parts_purchase_orders
      WHERE deleted_at IS NULL AND LOWER(status) IN ('approved', 'vendor_accepted', 'sent', 'processing') ORDER BY spo_id`
  )).rows;
  const maps = await spo.buildReceivedQtyMapsForSpoIds(rows.map((r) => r.spo_id));
  const changes = [];
  for (const r of rows) {
    const lines = spo.enrichSpareLinesWithReceived(
      spo.parseLineItemsJson(r.line_items),
      maps.get(Number(r.spo_id)) || { byIdx: {}, byPd: {}, unalloc: 0 }
    );
    const next = spo.spareStatusAfterReceipt(r.status, lines);
    if (next) {
      const got = lines.reduce((n, l) => n + (Number(l.receivedQty) || 0), 0);
      const ordered = lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0);
      changes.push({ ...r, next, got, ordered });
    }
  }
  for (const c of changes) console.log(`${c.purchase_order_number}: ${c.status} -> ${c.next} (${c.got}/${c.ordered})`);
  console.log(`${changes.length} of ${rows.length} open spare POs ${apply ? 'updated' : 'would change (dry run; --apply to write)'}`);
  if (apply) {
    for (const c of changes) {
      // Guarded on the status we read, so a receipt in between is not overwritten.
      const u = await pool.query(
        'UPDATE vendor_spare_parts_purchase_orders SET status = $1, updated_at = NOW() WHERE spo_id = $2 AND status = $3 RETURNING spo_id',
        [c.next, c.spo_id, c.status]
      );
      if (u.rows.length) {
        await logVendorAudit({
          actorUserId: null,
          vendorId: c.vendor_id || null,
          entityType: 'spare_parts_po',
          entityId: String(c.spo_id),
          action: 'status_auto_receive_progress',
          payload: { from: c.status, to: c.next, source: 'sync-spare-po-receive-status' },
        });
      }
    }
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
