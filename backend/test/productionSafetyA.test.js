/**
 * Production safety A — QC gates and the way into stock (Q1–Q8, Q13, F3–F5).
 * Pure rules first, then real handlers on a rolled-back transaction.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/rollbackHarness');
const { assertQcGate } = require('../services/stageTransitionService');
const gate = require('../services/qcGateService');
const sm = require('../services/inventoryStateMachine');

describe('QC and stock gate (pure)', () => {
  const ok = (from, to, qcGate = null) => assert.doesNotThrow(() => assertQcGate({ from, to, qcGate }));
  const no = (from, to, qcGate = null, re = /./) => assert.throws(() => assertQcGate({ from, to, qcGate }), re);

  it('QC1 / QC2 pass only through the checklist or a manager override with a reason', () => {
    no('QC1', 'QC2', null, /QC checklist/);
    no('QC2', 'Pending Inventory', null, /QC checklist/);
    ok('QC1', 'QC2', { kind: 'checklist' });
    ok('QC2', 'Pending Inventory', { kind: 'override', reason: 'Checklist printer broken, verified by hand' });
    no('QC1', 'QC2', { kind: 'override', reason: 'ok' });
  });
  it('stock only by the serial-scan receive (or a sales-order Dispatch QC pass)', () => {
    no('Pending Inventory', 'Inventory', null, /carret slot/);
    no('Dismantle', 'Inventory', null, /carret slot/);
    no('Pending Inventory', 'Inventory', { kind: 'checklist' }, /carret slot/);
    ok('Pending Inventory', 'Inventory', { kind: 'receive' });
    ok('Dispatch QC', 'Inventory');
  });
  it('failures and ordinary moves are untouched', () => {
    ok('QC1', 'Assembly & Software');
    ok('Diagnosis', 'Assembly & Software');
  });
  it('only a manager overrides, with a sentence', () => {
    assert.throws(() => gate.overrideFrom({ role: 'qc' }, 'long enough reason here'), /Only a manager/);
    assert.throws(() => gate.overrideFrom({ role: 'manager' }, 'short'), /at least 10/);
    assert.equal(gate.overrideFrom({ role: 'manager' }, ''), null);
    assert.equal(gate.overrideFrom({ role: 'floor_manager' }, 'Verified the config by hand').kind, 'override');
  });
});

describe('against the database (rolled back)', () => {
  let C;
  let poId;
  let grnId;
  let seq = 0;
  const serial = async (status) => {
    seq += 1;
    const r = await C.query(
      `INSERT INTO vendor_serial_numbers (po_id, grn_id, serial_number, inventory_status, extra)
       VALUES ($1, $2, $3, $4, '{}'::jsonb) RETURNING serial_id`,
      [poId, grnId, `TESTPSA-${seq}`, status]
    );
    return r.rows[0].serial_id;
  };

  before(async () => {
    C = await h.open();
    const g = (await C.query('SELECT grn_id, po_id FROM vendor_goods_received_notes WHERE po_id IS NOT NULL ORDER BY grn_id DESC LIMIT 1')).rows[0];
    poId = g.po_id; grnId = g.grn_id;
  });
  after(() => h.close());

  it('enterStock takes a laptop from production, not a failed, rented or returned one (Q7)', async () => {
    const good = await serial('in_repair');
    const r = await sm.enterStock(C, { serialId: good, reason: 'test', caller: 'test' });
    assert.equal(r.to, 'in_stock');
    const again = await sm.enterStock(C, { serialId: good, reason: 'test', caller: 'test' });
    assert.equal(again.unchanged, true);
    for (const st of ['qc_failed', 'rented', 'sold', 'returned_to_vendor', 'scrapped']) {
      const sid = await serial(st);
      await assert.rejects(sm.enterStock(C, { serialId: sid, reason: 'test', caller: 'test' }), /can't be put into stock/, st);
    }
  });

  it('PD2: a technician, or whoever repaired it, cannot pass QC', async () => {
    const t = (await C.query(
      `SELECT ticket_id FROM production_ticket_history
        WHERE previous_stage = 'Assembly & Software' AND performed_by IS NOT NULL LIMIT 1`
    )).rows[0];
    await assert.rejects(gate.assertMayPassQc(C, { ticketId: 1, user: { user_id: 1, role: 'technician' }, stageName: 'QC1' }), /Technicians can't pass/);
    if (t) {
      const who = (await C.query(
        `SELECT performed_by FROM production_ticket_history WHERE ticket_id = $1 AND previous_stage = 'Assembly & Software' AND performed_by IS NOT NULL LIMIT 1`,
        [t.ticket_id]
      )).rows[0].performed_by;
      await assert.rejects(gate.assertMayPassQc(C, { ticketId: t.ticket_id, user: { user_id: who, role: 'qc' }, stageName: 'QC1' }), /You worked on this laptop/);
    }
  });

  it('PD3: QC2 needs the configuration check to have matched', async () => {
    await assert.rejects(gate.assertQc2Matched(C, { ticketId: -1 }), /Run the QC2 configuration check/);
    const matched = (await C.query("SELECT ticket_id FROM qc2_capture_tokens t WHERE status = 'matched' AND NOT EXISTS (SELECT 1 FROM qc2_capture_tokens n WHERE n.ticket_id = t.ticket_id AND n.created_at > t.created_at) LIMIT 1")).rows[0];
    if (matched) await gate.assertQc2Matched(C, { ticketId: matched.ticket_id });
  });

  it('QC Management "passed" no longer puts a laptop into stock (PD6)', async () => {
    const qcm = require('../controllers/qcManagement/orders.controller');
    const sid = await serial('in_repair');
    const r = await h.call(qcm.qcCheck, { body: { serial_number_id: sid, serial_number: `TESTPSA-${seq}`, selected_value: 'passed' }, user: { user_id: null, role: 'admin' } });
    assert.equal(r.code, 409);
    assert.equal(r.body.code, 'QC_VIA_FLOOR');
    const st = (await C.query('SELECT inventory_status FROM vendor_serial_numbers WHERE serial_id = $1', [sid])).rows[0].inventory_status;
    assert.equal(st, 'in_repair');
  });

  it('qcCheckService works again and a failed laptop leaves stock (Q13)', async () => {
    const { applySerialQcUpdate } = require('../services/qcCheckService');
    const sid = await serial('in_stock');
    const row = (await C.query('SELECT serial_number FROM vendor_serial_numbers WHERE serial_id = $1', [sid])).rows[0];
    await C.query("UPDATE vendor_serial_numbers SET extra = '{}'::jsonb WHERE serial_id = $1", [sid]);
    const out = await applySerialQcUpdate(C, { serialId: sid, serialNumber: row.serial_number, selected: 'send_to_qc_check', remark: 'test' });
    assert.notEqual(out?.ok, false, JSON.stringify(out));
    const st = (await C.query('SELECT inventory_status FROM vendor_serial_numbers WHERE serial_id = $1', [sid])).rows[0].inventory_status;
    assert.equal(st, 'qc_failed');
  });

  it('end to end: the QC1 pass button is refused, and a floor-failed laptop cannot be received', async () => {
    const po = require('../controllers/vendorManagement/purchaseOrders.controller');
    const phase2 = require('../controllers/ticketPhase2Controller');
    const pas = require('../services/productionAssetService');
    const mgr = { user_id: (await C.query("SELECT user_id FROM users ORDER BY user_id LIMIT 1")).rows[0].user_id, name: 'Test Mgr', role: 'manager' };
    const v = (await C.query("SELECT vendor_id FROM vendors WHERE deleted_at IS NULL AND status = 'approved' LIMIT 1")).rows[0];
    const line = { brand: 'Dell', model: 'Latitude 5410', processor: 'Intel Core i5', generation: '10th Gen', ram: '8GB RAM', storage: '256GB SSD', quantity: 1, rate: 1500, allowed_conditions: ['on', 'not_on'] };
    const p2 = (await C.query(
      `INSERT INTO vendor_purchase_orders (purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, po_state, sub_total_amount, total_amount, line_items, status)
       VALUES ('TEST-PSA-1', CURRENT_DATE, 'direct_purchase', $1, 'haryana', 1500, 1770, $2::jsonb, 'approved') RETURNING po_id`,
      [v.vendor_id, JSON.stringify([line])]
    )).rows[0].po_id;
    const r = await h.call(po.receivePoLineUnit, {
      params: { poId: String(p2) },
      body: { line_index: 0, rental_start_date: '2026-09-26', serial_number: 'TESTPSA-E2E', received_condition: 'not_on', config_capture_waiver_reason: 'No power at all on arrival' },
      user: mgr, validators: po.receivePoLineUnitValidators,
    });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    const sid = r.body.data.created.serial_id;
    const tk = (await C.query('SELECT ticket_id FROM tickets WHERE vendor_serial_id = $1', [sid])).rows[0].ticket_id;
    const qc1 = (await C.query("SELECT stage_id FROM stages WHERE stage_name = 'QC1' ORDER BY (team_id IS NULL), stage_id LIMIT 1")).rows[0].stage_id;
    await C.query('UPDATE tickets SET current_stage_id = $1 WHERE ticket_id = $2', [qc1, tk]);

    const btn = await h.call(phase2.moveToStage, { params: { id: String(tk) }, body: { to_stage_name: 'QC2' }, user: mgr });
    assert.equal(btn.code, 409, JSON.stringify(btn.body));
    assert.match(btn.body.message, /QC checklist/);

    // Put the asset in Pending Inventory, then the floor manager fails it.
    const pa = await pas.getByTicket(C, tk);
    await C.query("UPDATE production_assets SET status = 'pending_inventory' WHERE production_asset_id = $1", [pa.production_asset_id]);
    const f = await h.call(phase2.markQcFailed, { params: { id: String(tk) }, body: { reason: 'Motherboard dead' }, user: mgr });
    assert.equal(f.code, 200, JSON.stringify(f.body));
    const paAfter = (await C.query('SELECT status FROM production_assets WHERE production_asset_id = $1', [pa.production_asset_id])).rows[0];
    assert.equal(paAfter.status, 'qc_failed');
    await C.query("UPDATE production_assets SET status = 'pending_inventory' WHERE production_asset_id = $1", [pa.production_asset_id]);
    await assert.rejects(
      pas.receiveIntoInventory(C, pa.production_asset_id, { serialNumber: 'TESTPSA-E2E', warehouseCarret: 1, warehouseCarretSlot: 1, actorUserId: mgr.user_id }),
      /failed by the floor manager|can't be received/
    );
  });
});
