/**
 * Part repairs (Carret Stock setup, builder 5): a defective spare goes to its
 * vendor on a part repair challan, comes back (repaired or replaced) into QC,
 * and QC decides stock or discard. Plus cancelling a draft challan. Real
 * handlers inside one transaction that is rolled back; dispatch is simulated
 * in SQL so no e-sign file is written to uploads/.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/rollbackHarness');
const partCtrl = require('../controllers/partController');
const ctrl = require('../controllers/partVendorRepairController');

let db;
let user;
let spo;
const tag = `ZZREPAIR-${Date.now()}`;

async function defectiveUnits(n) {
  const r = await h.call(partCtrl.createPart, { user, body: { part_name: `${tag} ${Math.random()}`, category: 'power', cost: 900, quantity: n } });
  assert.equal(r.code, 201, JSON.stringify(r.body));
  const ids = r.body.units.map((u) => u.instance_id);
  await db.query(
    `UPDATE part_instances SET status = 'defective', spo_id = $2, vendor_id = $3 WHERE instance_id = ANY($1::int[])`,
    [ids, spo.spo_id, spo.vendor_id]
  );
  return { partId: r.body.part.part_id, ids };
}
const createDc = (ids, extra = {}) => h.call(ctrl.createPartVendorReturn, {
  user, body: { instance_ids: ids, remarks: 'Adapter dead on arrival', ...extra },
});
const unit = async (id) => (await db.query('SELECT status, vendor_repair_dc_number FROM part_instances WHERE instance_id = $1', [id])).rows[0];
async function markDispatched(dc) {
  await db.query("UPDATE vendor_repair_delivery_challans SET status = 'dispatched', dispatched_at = NOW() WHERE dc_number = $1", [dc]);
  await db.query("UPDATE vendor_repair_dc_part_items SET item_status = 'dispatched' WHERE dc_number = $1", [dc]);
}

describe('part repairs — challan, receive, QC, cancel', () => {
  before(async () => {
    db = await h.open();
    user = (await db.query("SELECT user_id, role, name, email FROM users WHERE role = 'super_admin' ORDER BY user_id LIMIT 1")).rows[0];
    spo = (await db.query(
      `SELECT spo.spo_id, spo.vendor_id FROM vendor_spare_parts_purchase_orders spo
         JOIN vendors v ON v.vendor_id = spo.vendor_id AND v.deleted_at IS NULL
        WHERE COALESCE(NULLIF(TRIM(v.shipping_address), ''), NULLIF(TRIM(v.address), '')) IS NOT NULL
        ORDER BY spo.spo_id DESC LIMIT 1`
    )).rows[0];
    assert.ok(user && spo, 'a super_admin and a spare PO with a vendor address exist');
  });
  after(async () => { await h.close(); });

  it('a draft challan can be cancelled with a reason; its units go back to defective', async () => {
    const { ids } = await defectiveUnits(2);
    const c = await createDc(ids);
    assert.equal(c.code, 201, JSON.stringify(c.body));
    const dc = c.body.dc_number;
    assert.equal((await unit(ids[0])).status, 'with_vendor_repair');

    const noWhy = await h.call(ctrl.cancelPartVendorReturn, { user, params: { dcNumber: dc }, body: { reason: ' ' } });
    assert.equal(noWhy.code, 400);
    const ok = await h.call(ctrl.cancelPartVendorReturn, { user, params: { dcNumber: dc }, body: { reason: 'raised for the wrong vendor' } });
    assert.equal(ok.code, 200, JSON.stringify(ok.body));
    for (const id of ids) assert.deepEqual(await unit(id), { status: 'defective', vendor_repair_dc_number: null });
    const head = (await db.query('SELECT status, cancel_reason FROM vendor_repair_delivery_challans WHERE dc_number = $1', [dc])).rows[0];
    assert.deepEqual(head, { status: 'cancelled', cancel_reason: 'raised for the wrong vendor' });
    // They can go on another challan straight away.
    const again = await createDc(ids);
    assert.equal(again.code, 201, JSON.stringify(again.body));
  });

  it('a challan that has gone out cannot be cancelled', async () => {
    const { ids } = await defectiveUnits(1);
    const dc = (await createDc(ids)).body.dc_number;
    await markDispatched(dc);
    const r = await h.call(ctrl.cancelPartVendorReturn, { user, params: { dcNumber: dc }, body: { reason: 'too late' } });
    assert.equal(r.code, 409);
    assert.equal((await unit(ids[0])).status, 'with_vendor_repair');
  });

  it('received back (repaired / replacement) waits for QC; pass = stock, fail = discarded', async () => {
    const { partId, ids } = await defectiveUnits(2);
    const dc = (await createDc(ids)).body.dc_number;
    await markDispatched(dc);
    const qty0 = Number((await db.query('SELECT quantity FROM parts WHERE part_id = $1', [partId])).rows[0].quantity);

    const rcv = await h.call(ctrl.receivePartsFromVendor, {
      user,
      params: { dcNumber: dc },
      body: {
        receive_items: [
          { instance_id: ids[0], receive_mode: 'repaired' },
          { instance_id: ids[1], receive_mode: 'replacement', replacement_serial: `${tag}-NEW` },
        ],
        warehouse_signer_name: 'Test',
      },
    });
    assert.equal(rcv.code, 200, JSON.stringify(rcv.body));
    assert.equal(rcv.body.status, 'returned');
    assert.equal((await unit(ids[0])).status, 'qc_pending');
    assert.equal((await unit(ids[1])).status, 'discarded');
    const replacementId = rcv.body.received.find((x) => x.receive_mode === 'replacement').replacement_instance_id;
    assert.equal((await unit(replacementId)).status, 'qc_pending');

    const pending = await h.call(ctrl.listQcPending, { user, query: { search: tag, limit: 50 } });
    assert.equal(pending.code, 200);

    assert.equal((await h.call(ctrl.passQc, { user, params: { instanceId: ids[0] }, body: { notes: 'works' } })).code, 200);
    assert.equal((await unit(ids[0])).status, 'in_stock');
    assert.equal((await h.call(ctrl.failQc, { user, params: { instanceId: replacementId }, body: { notes: 'dead again' } })).code, 200);
    assert.equal((await unit(replacementId)).status, 'discarded');
    // Passing twice is refused.
    assert.equal((await h.call(ctrl.passQc, { user, params: { instanceId: ids[0] }, body: {} })).code, 400);
    const qty1 = Number((await db.query('SELECT quantity FROM parts WHERE part_id = $1', [partId])).rows[0].quantity);
    assert.equal(qty1, qty0 + 1, 'only the QC-passed unit counts into stock');
  });
});
