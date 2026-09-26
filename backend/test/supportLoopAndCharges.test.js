/**
 * Support build step 1 (claude/carret-support.md): the repair loop (S7), the
 * replacement's deal (S9), part charges (Support marks, warehouse prices,
 * Accounts bills) and the WFH delivery charge. One rolled-back transaction.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const hx = require('./helpers/rollbackHarness');

describe('support loop and charges', () => {
  let C; let sm; let charges; let repl;
  const lead = { user_id: null, role: 'support_lead', name: 'Test Lead' };
  before(async () => {
    C = await hx.open();
    sm = require('../services/inventoryStateMachine');
    charges = require('../services/supportChargesService');
    repl = require('../services/supportReplacementFlowService');
    lead.user_id = (await C.query('SELECT user_id FROM users ORDER BY user_id LIMIT 1')).rows[0].user_id;
  });
  after(async () => { await hx.close(); });

  it('S7: the floor finishing the repair marks the customer laptop ready to return', async () => {
    const it0 = (await C.query(
      `SELECT i.id, i.floor_ticket_id FROM support_ticket_items i JOIN tickets t ON t.ticket_id = i.floor_ticket_id
        WHERE i.item_type = 'pickup' AND i.status = 'awaiting_service_return' AND i.repair_ready_at IS NULL AND t.status <> 'completed' LIMIT 1`
    )).rows[0];
    if (!it0) return;
    await C.query("UPDATE tickets SET status = 'completed' WHERE ticket_id = $1", [it0.floor_ticket_id]);
    const r = (await C.query('SELECT repair_ready_at FROM support_ticket_items WHERE id = $1', [it0.id])).rows[0];
    assert.ok(r.repair_ready_at, 'stamped ready');
    const a = (await C.query("SELECT 1 FROM support_ticket_item_audit WHERE item_id = $1 AND action = 'repair_ready'", [it0.id])).rows;
    assert.equal(a.length, 1);
  });

  it('S7: a customer laptop due back on a Service DC cannot be reserved for a sale', async () => {
    const row = (await C.query(
      `SELECT vsn.serial_id FROM support_ticket_items i
         JOIN vendor_serial_numbers vsn ON UPPER(vsn.inventory_asset_code) = UPPER(i.ttspl_id)
        WHERE i.item_type = 'pickup' AND i.status = 'awaiting_service_return' LIMIT 1`
    )).rows[0];
    if (!row) return;
    await C.query("UPDATE vendor_serial_numbers SET inventory_status = 'in_stock' WHERE serial_id = $1", [row.serial_id]);
    await C.query('SAVEPOINT g');
    await assert.rejects(sm.transitionAsset(C, { serialId: row.serial_id, toStatus: sm.STATUS.RESERVED, caller: 'test' }), /in for repair/);
    await C.query('ROLLBACK TO SAVEPOINT g');
  });

  it('S9: the replacement takes the replaced laptop\'s own deal', async () => {
    const sale = (await C.query(
      `SELECT dcl.customer_id, dcl.serial_number::text AS s FROM delivery_challan_lines dcl
         JOIN sales_order_lines sol ON sol.sales_order_number = dcl.sales_order_number
        WHERE COALESCE(dcl.movement_type,'outbound') = 'outbound' AND LOWER(dcl.status) = 'delivered'
          AND sol.quotation_type ILIKE '%sale%' AND dcl.serial_number::text ~ 'TTSPL[0-9]+' LIMIT 1`
    )).rows[0];
    if (sale) {
      const code = sale.s.match(/TTSPL[0-9]+/)[0];
      const d = await repl.resolveOriginalDeal(C, { code, customerId: sale.customer_id });
      assert.equal(d.quotation_type, 'sale');
    }
    const none = await repl.resolveOriginalDeal(C, { code: 'NO-SUCH-LAPTOP', customerId: 1 });
    assert.deepEqual([none.quotation_type, none.entity_code], ['rental', 'rentfoxxy']);
  });

  it('parts: free unless Support marks them (with a reason); only a priced, used part becomes a charge', async () => {
    const spr = (await C.query("SELECT id FROM support_part_requests WHERE status = 'issued' ORDER BY id DESC LIMIT 1")).rows[0];
    assert.ok(spr);
    await C.query('SAVEPOINT p1');
    await assert.rejects(charges.markPartChargeable(C, { requestId: spr.id, chargeable: true, reason: '', user: lead }), /why/);
    await C.query('ROLLBACK TO SAVEPOINT p1');
    await C.query('SAVEPOINT p2');
    await assert.rejects(charges.setPartPrice(C, { requestId: spr.id, amount: 1500, user: lead }), /not marked this part chargeable/);
    await C.query('ROLLBACK TO SAVEPOINT p2');
    const m = await charges.markPartChargeable(C, { requestId: spr.id, chargeable: true, reason: 'Screen broken by the user', user: lead });
    assert.equal(m.status, 'WAITING_FOR_PRICE', 'marked chargeable, the warehouse has not priced it');
    await C.query('SAVEPOINT p3');
    await assert.rejects(charges.setPartPrice(C, { requestId: spr.id, amount: 0, user: lead }), /price/);
    await C.query('ROLLBACK TO SAVEPOINT p3');
    await charges.setPartPrice(C, { requestId: spr.id, amount: 1500, user: lead });
    await C.query("UPDATE support_part_requests SET status = 'used' WHERE id = $1", [spr.id]);
    const s = await charges.syncPartCharge(C, spr.id, lead);
    assert.deepEqual(s, { status: 'APPROVED', amount: 1500 });
    const line = (await C.query('SELECT * FROM customer_invoice_extra_lines WHERE source_part_request_id = $1', [spr.id])).rows[0];
    assert.equal(Number(line.amount), 1500);
    // Unmark → waived, never billed.
    await charges.markPartChargeable(C, { requestId: spr.id, chargeable: false, user: lead });
    assert.equal((await C.query('SELECT status FROM customer_invoice_extra_lines WHERE source_part_request_id = $1', [spr.id])).rows[0].status, 'WAIVED');
    // Re-mark and bill it on a draft invoice of that customer.
    await charges.markPartChargeable(C, { requestId: spr.id, chargeable: true, reason: 'Screen broken by the user', user: lead });
    await charges.setPartPrice(C, { requestId: spr.id, amount: 1500, user: lead });
    const inv = (await C.query(
      `SELECT ci.invoice_id, ci.subtotal, ci.grand_total FROM customer_invoices ci
        WHERE ci.customer_id = $1 AND LOWER(ci.status) = 'draft' LIMIT 1`, [line.customer_id]
    )).rows[0];
    if (inv) {
      const out = await charges.addChargesToDraftInvoice(C, { invoiceId: inv.invoice_id, extraLineIds: [line.extra_line_id], user: lead });
      assert.equal(Math.round(out.subtotal - Number(inv.subtotal)), 1500);
      assert.equal((await C.query('SELECT status FROM customer_invoice_extra_lines WHERE extra_line_id = $1', [line.extra_line_id])).rows[0].status, 'BILLED');
      await C.query('SAVEPOINT p4');
      await assert.rejects(charges.markPartChargeable(C, { requestId: spr.id, chargeable: false, user: lead }), /Already billed/);
      await C.query('ROLLBACK TO SAVEPOINT p4');
    }
  });

  it('WFH: detected from the allocation; a non-WFH laptop cannot be charged', async () => {
    const w = (await C.query(
      `SELECT sos.ttspl_id, sol.customer_id FROM sales_order_serials sos JOIN sales_order_lines sol ON sol.id = sos.line_id
        WHERE sos.is_wfh AND sos.ttspl_id IS NOT NULL LIMIT 1`
    )).rows[0];
    if (w) assert.equal((await charges.laptopWfh(C, { code: w.ttspl_id, customerId: w.customer_id })).is_wfh, true);
    const item = (await C.query(
      `SELECT i.id FROM support_ticket_items i WHERE i.item_type = 'pickup' AND i.return_dc_number IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM sales_order_serials s WHERE s.is_wfh AND UPPER(s.ttspl_id) = UPPER(i.ttspl_id)) LIMIT 1`
    )).rows[0];
    await C.query('SAVEPOINT w1');
    await assert.rejects(charges.chargeWfhDelivery(C, { itemId: item.id, user: lead }), /not with the customer as work-from-home/);
    await C.query('ROLLBACK TO SAVEPOINT w1');
    await C.query('SAVEPOINT w2');
    await assert.rejects(charges.chargeWfhDelivery(C, { itemId: item.id, user: { user_id: 1, role: 'support_tech' } }), /support lead/);
    await C.query('ROLLBACK TO SAVEPOINT w2');
  });
});
