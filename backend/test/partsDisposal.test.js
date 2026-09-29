/**
 * Parts disposal in the new UI (Builder 9, wave 2):
 *   Movement → Dead parts — in & out: inward → outward request → warehouse
 *   approves (Part DC) → guard gate → out; cancel a draft.
 *   Stock → Scrap → Discarded parts: only parts not yet on a scrap challan.
 *
 * Fixes pinned here:
 *   - PIN / POUT / DP numbers are taken under an advisory lock (MAX()+1 raced).
 *   - Validation failures are 400, not 500.
 *   - Approve / cancel need a warehouse role or physical_dead_parts edit
 *     (the API let any creator approve their own request).
 *   - Vehicle number and pickup person/mobile are kept on the Part DC
 *     (migration 399) instead of being validated and thrown away.
 *   - Cancel keeps a reason and a per-part "released" trail; a second cancel or
 *     a second approve is a no-op, not an error or a double posting.
 * Everything runs in one rolled-back transaction.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./helpers/rollbackHarness');
const svc = require('../services/physicalDeadPartService');
const ctrl = require('../controllers/physicalDeadPartController');
const { searchPartUnits } = require('../controllers/partUnitController');

const PHOTO_DIR = path.join(__dirname, '..', 'uploads', 'physical-parts');
const PHOTO = `physical-parts/pp_test_builder9_${process.pid}.jpg`;
const ACTOR = { userId: null, name: 'Parts disposal test' };

async function runMiddleware(mw, user) {
  let passed = false;
  const res = { code: 200, body: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  await new Promise((resolve, reject) => {
    const r = mw({ user, permissionCache: {} }, res, (err) => { if (err) reject(err); else { passed = true; resolve(); } });
    if (r && typeof r.then === 'function') r.then(() => resolve(), reject);
    else if (!passed) setImmediate(resolve);
  });
  return { passed, res };
}

describe('dead parts — in & out', () => {
  let db;
  let parts;
  let outward;

  before(async () => {
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    fs.writeFileSync(path.join(PHOTO_DIR, path.basename(PHOTO)), 'x');
    db = await h.open();
  });
  after(async () => {
    try { fs.unlinkSync(path.join(PHOTO_DIR, path.basename(PHOTO))); } catch (_) { /* gone */ }
    await h.close();
  });

  it('records an inward with DP numbers, under the numbering lock', async () => {
    const res = await h.call(ctrl.createInward, {
      user: { user_id: null, name: 'Parts disposal test', role: 'warehouse' },
      body: {
        warehouse: 'Main Warehouse',
        inward_reason: 'Found in warehouse — no CRM record',
        units: [1, 2, 3].map((n) => ({ part_name: `Dead RAM ${n}`, category: 'ram', condition: 'dead', inward_photo_paths: [PHOTO] })),
      },
    });
    assert.equal(res.code, 201, JSON.stringify(res.body));
    parts = res.body.parts;
    assert.equal(parts.length, 3);
    assert.ok(parts.every((p) => /^DP-\d{4,}$/.test(p.dp_number) && p.status === 'available'));
    assert.equal(new Set(parts.map((p) => p.dp_number)).size, 3);
    const locks = await db.query(
      `SELECT COUNT(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`
    );
    assert.ok(locks.rows[0].n >= 2, 'inward + DP series are taken under advisory locks');
  });

  it('bad input is a 400, not a 500', async () => {
    const res = await h.call(ctrl.createOutward, {
      user: { user_id: null, role: 'warehouse' },
      body: { part_ids: [], receiver_type: 'scrap_buyer', receiver_name: 'X', receiver_contact: '9876543210', purpose: 'Scrap', photo_paths: [PHOTO] },
    });
    assert.equal(res.code, 400);
    const bad = await h.call(ctrl.createInward, {
      user: { user_id: null, role: 'warehouse' },
      body: { warehouse: 'W', inward_reason: 'R', units: [{ part_name: 'x', category: 'ram', condition: 'melted', inward_photo_paths: [PHOTO] }] },
    });
    assert.equal(bad.code, 400);
  });

  it('creates an outward request; the same parts cannot go on a second one', async () => {
    const out = await svc.createOutward(db, {
      partIds: [parts[0].part_id, parts[1].part_id],
      receiverType: 'scrap_buyer',
      receiverName: 'Test scrap buyer',
      receiverContact: '98765 43210',
      purpose: 'Sold as scrap',
      photoPaths: [PHOTO],
      actor: ACTOR,
    });
    outward = out.outward;
    assert.equal(outward.status, 'draft');
    assert.match(outward.outward_number, /^POUT\/\d{2}-\d{2}\/\d{4,}$/);
    assert.equal(out.parts.length, 2);
    assert.ok(out.parts.every((p) => p.status === 'pending'));
    await assert.rejects(
      () => svc.createOutward(db, {
        partIds: [parts[0].part_id], receiverType: 'vendor', receiverName: 'V', receiverContact: '9876543210', purpose: 'P', photoPaths: [PHOTO], actor: ACTOR,
      }),
      (e) => e.status === 409 && /Already outwarded/.test(e.message)
    );
  });

  it('approve / cancel need a warehouse role or physical_dead_parts edit', async () => {
    const ok = await runMiddleware(ctrl.requireWarehouse, { user_id: -1, role: 'warehouse' });
    assert.equal(ok.passed, true);
    const no = await runMiddleware(ctrl.requireWarehouse, { user_id: -1, role: 'sales_executive' });
    assert.equal(no.passed, false);
    assert.equal(no.res.code, 403);
  });

  it('approve without a send mode is a 400; with vendor pickup keeps the pickup details', async () => {
    await db.query(
      `UPDATE physical_part_outwards SET warehouse_dispatch_esign_url = 'vendor-repair/test.png' WHERE outward_id = $1`,
      [outward.outward_id]
    );
    await assert.rejects(
      () => svc.dispatchOutward(db, { outwardNumber: outward.outward_number, dispatchBody: {}, actor: ACTOR }),
      (e) => e.status === 400
    );
    const r = await svc.dispatchOutward(db, {
      outwardNumber: outward.outward_number,
      dispatchBody: {
        ship_by: 'by_vendor_pickup', vendor_pickup_person: 'Ravi', vendor_pickup_mobile: '9876543210', vehicle_number: 'dl 01 ab 1234',
        warehouse_signer_name: 'Store keeper',
      },
      actor: ACTOR,
    });
    assert.equal(r.status, 'dispatch_ready');
    const head = (await db.query('SELECT * FROM physical_part_outwards WHERE outward_id = $1', [outward.outward_id])).rows[0];
    assert.equal(head.status, 'dispatch_ready');
    assert.equal(head.vendor_pickup_person, 'Ravi');
    assert.equal(head.vendor_pickup_mobile, '9876543210');
    assert.equal(head.vehicle_number, 'DL01AB1234');
    assert.ok(head.approved_at);
    const again = await svc.dispatchOutward(db, { outwardNumber: outward.outward_number, dispatchBody: {}, actor: ACTOR });
    assert.equal(again.already_dispatched, false, 'a second approve is a no-op');
    await assert.rejects(
      () => svc.cancelDraftOutward(db, { outwardNumber: outward.outward_number, actor: ACTOR }),
      (e) => e.status === 409
    );
  });

  it('guard gate outward marks the parts out', async () => {
    await svc.confirmGateOutward(db, { outwardNumber: outward.outward_number, actor: ACTOR });
    const d = await svc.getOutward(outward.outward_number);
    assert.equal(d.outward.status, 'dispatched');
    assert.ok(d.parts.every((p) => p.status === 'out'));
  });

  it('cancel keeps the reason and which parts were released; twice is a no-op', async () => {
    const out = await svc.createOutward(db, {
      partIds: [parts[2].part_id], receiverType: 'vendor', receiverName: 'V', receiverContact: '9876543210', purpose: 'Back to vendor', photoPaths: [PHOTO], actor: ACTOR,
    });
    const no = out.outward.outward_number;
    await svc.cancelDraftOutward(db, { outwardNumber: no, reason: 'Wrong part picked', actor: ACTOR });
    const d = await svc.getOutward(no);
    assert.equal(d.outward.status, 'cancelled');
    assert.equal(d.outward.cancel_reason, 'Wrong part picked');
    assert.equal(d.parts.length, 0);
    assert.deepEqual(d.released_parts.map((p) => p.dp_number), [parts[2].dp_number]);
    assert.equal(d.released_parts[0].status, 'available');
    assert.ok(d.movements.some((m) => m.event_type === 'released' && m.dp_number === parts[2].dp_number));
    const again = await svc.cancelDraftOutward(db, { outwardNumber: no, actor: ACTOR });
    assert.equal(again.already, true);
  });

  it('Stock → Scrap → Discarded parts: scrap_challan=none lists only parts not yet on a challan', async () => {
    const res = await h.call(searchPartUnits, { query: { status: 'discarded', scrap_challan: 'none', limit: 200 } });
    assert.equal(res.code, 200);
    assert.ok(res.body.units.every((u) => u.status === 'discarded' && !u.scrap_challan_number));
    const all = await h.call(searchPartUnits, { query: { status: 'discarded', scrap_challan: 'any', limit: 200 } });
    assert.ok(all.body.units.every((u) => u.scrap_challan_number));
  });
});
