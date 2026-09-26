#!/usr/bin/env node
/**
 * One-off: bring open POs' status in line with what was actually received.
 *
 * A PO moves approved → processing → completed only when a laptop is received
 * through receive-unit. POs whose laptops came in through older paths or the
 * ERP import stayed "approved" with everything received (47 of 54 open POs on
 * QA, 26 Sep 2026), so they sat in "With vendor" and the gate's expected list.
 * This runs the same sync receive-unit runs (audit + activity rows included).
 *
 *   node scripts/sync-po-receive-status.js            # dry run: lists changes
 *   node scripts/sync-po-receive-status.js --apply    # applies them
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const pool = require('../config/db');
const po = require('../controllers/vendorManagement/purchaseOrders.controller');

(async () => {
  const apply = process.argv.includes('--apply');
  const rows = (await pool.query(
    `SELECT po_id, purchase_order_number, status, line_items FROM vendor_purchase_orders
      WHERE deleted_at IS NULL AND LOWER(status) IN ('approved', 'vendor_accepted', 'sent', 'processing') ORDER BY po_id`
  )).rows;
  const maps = await po.buildReceivedQtyMapsForPoIds(rows.map((r) => r.po_id));
  const changes = [];
  for (const r of rows) {
    const lines = po.enrichLineItemsWithReceived(po.parseLineItemsJson(r.line_items), maps.get(r.po_id));
    const ordered = lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0);
    const got = lines.reduce((n, l) => n + (Number(l.receivedQty) || 0), 0);
    let next = null;
    if (ordered > 0 && got >= ordered) next = 'completed';
    else if (ordered > 0 && got > 0) next = 'processing';
    if (next && next !== String(r.status).toLowerCase()) changes.push({ ...r, next, got, ordered });
  }
  for (const c of changes) console.log(`${c.purchase_order_number}: ${c.status} -> ${c.next} (${c.got}/${c.ordered})`);
  console.log(`${changes.length} of ${rows.length} open POs ${apply ? 'updated' : 'would change (dry run; --apply to write)'}`);
  if (apply) for (const c of changes) await po.syncPoReceiveProgressStatus(c.po_id, null);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
