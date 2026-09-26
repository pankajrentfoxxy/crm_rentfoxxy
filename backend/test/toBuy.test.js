/**
 * Procure to stock step 2 — the To-buy queue. Runs against QA data and puts
 * back every row it touches (request links, part request status, activity rows).
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const svc = require('../services/toBuyService');

describe('to-buy queue', () => {
  const started = new Date();
  after(async () => {
    await pool.query(
      `DELETE FROM sales_order_activities WHERE created_at >= $1 AND action IN ('purchase_request_linked', 'purchase_request_unlinked')`,
      [started]
    );
    await pool.end();
  });

  it('lists parked orders with their shortfall and whether stock is ready', async () => {
    const rows = await svc.listLaptopShortfalls();
    for (const r of rows) {
      assert.ok(r.request_id);
      assert.equal(r.short, r.lines.reduce((n, l) => n + l.short, 0));
      assert.equal(typeof r.stock_ready, 'boolean');
    }
  });

  it('links a shortfall to an open PO, refuses a closed one, and unlinks', async (t) => {
    const rows = await svc.listLaptopShortfalls();
    const r = rows.find((x) => !x.po_id);
    const { purchase_orders: open } = await svc.linkablePurchaseOrders();
    const closed = (await pool.query(`SELECT po_id FROM vendor_purchase_orders WHERE status IN ('completed','rejected') AND deleted_at IS NULL LIMIT 1`)).rows[0];
    if (!r || !open.length) return t.skip('no parked order or open PO on this database');
    try {
      const out = await svc.linkLaptopRequest(r.request_id, open[0].po_id, { user_id: null });
      assert.equal(out.po_id, open[0].po_id);
      const row = (await pool.query('SELECT status, po_id FROM sales_order_procurement_requests WHERE id = $1', [r.request_id])).rows[0];
      assert.equal(row.status, 'Ordered');
      if (closed) await assert.rejects(svc.linkLaptopRequest(r.request_id, closed.po_id, null), /not open/);
    } finally {
      await svc.linkLaptopRequest(r.request_id, null, null);
    }
    const back = (await pool.query('SELECT status, po_id FROM sales_order_procurement_requests WHERE id = $1', [r.request_id])).rows[0];
    assert.equal(back.status, 'New');
    assert.equal(back.po_id, null);
  });

  it('will not move an order on when no matching laptop is in stock', async (t) => {
    const rows = await svc.listLaptopShortfalls();
    const r = rows.find((x) => !x.stock_ready);
    if (!r) return t.skip('every parked order has stock');
    await assert.rejects(svc.moveOrderOn(r.sales_order_number, null), /No matching laptop/);
  });

  it('refuses to move an order that is not parked', async () => {
    const so = (await pool.query(`SELECT sales_order_number FROM dispatch_workflow WHERE status = 'customer_asset' LIMIT 1`)).rows[0];
    if (so) await assert.rejects(svc.moveOrderOn(so.sales_order_number, null), /no longer waiting/);
  });

  it('links an escalated part request to an open spare PO', async (t) => {
    const pr = (await svc.listPartNeeds()).find((x) => x.status === 'escalated');
    const { spare_parts_orders: open } = await svc.linkablePurchaseOrders();
    if (!pr || !open.length) return t.skip('nothing escalated or no open spare PO');
    const before = (await pool.query('SELECT status, spo_id, updated_at FROM part_requests WHERE request_id = $1', [pr.request_id])).rows[0];
    try {
      const out = await svc.linkPartRequest(pr.request_id, open[0].spo_id, null);
      assert.equal(out.spo_id, open[0].spo_id);
      await assert.rejects(svc.linkPartRequest(pr.request_id, -1, null), /not open/);
    } finally {
      await pool.query('UPDATE part_requests SET status = $1, spo_id = $2, updated_at = $3 WHERE request_id = $4',
        [before.status, before.spo_id, before.updated_at, pr.request_id]);
    }
  });
});
