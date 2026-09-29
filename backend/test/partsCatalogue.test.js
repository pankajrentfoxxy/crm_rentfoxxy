/**
 * Parts Catalogue (Carret Stock setup, builder 5): the part master and units
 * added by hand. Real handlers inside one transaction that is rolled back.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/rollbackHarness');
const partCtrl = require('../controllers/partController');
const prCtrl = require('../controllers/partRequestController');

let db;
let user;
const tag = `ZZTEST-${Date.now()}`;

async function newPart(extra = {}) {
  const r = await h.call(partCtrl.createPart, { user, body: { part_name: `${tag} ${Math.random()}`, category: 'ram', cost: 1200, ...extra } });
  assert.equal(r.code, 201, JSON.stringify(r.body));
  return r.body;
}
const ledger = async (partId) => (await db.query(
  'SELECT movement_type, instance_id, quantity, notes FROM part_movements WHERE part_id = $1 ORDER BY movement_id', [partId]
)).rows;

describe('parts catalogue — part master and hand-added units', () => {
  before(async () => {
    db = await h.open();
    const u = await db.query("SELECT user_id, role, name, email FROM users WHERE role = 'super_admin' ORDER BY user_id LIMIT 1");
    user = u.rows[0];
    assert.ok(user, 'a super_admin user exists');
  });
  after(async () => { await h.close(); });

  it('the catalogue list returns every part and the fields the edit form needs', async () => {
    await newPart({ min_threshold: 9, warranty_months: 6, is_consumable: true, notes: 'n1' });
    const total = Number((await db.query('SELECT count(*) FROM parts')).rows[0].count);
    const r = await h.call(partCtrl.getAllParts, { user, query: { limit: 2000 } });
    assert.equal(r.code, 200);
    assert.equal(r.body.parts.length, total, 'no part is cut off');
    const mine = r.body.parts.find((p) => String(p.part_name).startsWith(tag));
    assert.equal(mine.min_threshold, 9);
    assert.equal(mine.warranty_months, 6);
    assert.equal(mine.is_consumable, true);
    assert.equal(mine.notes, 'n1');
    for (const k of ['in_stock_count', 'reserved_count', 'installed_count', 'defective_count', 'unit_count']) assert.ok(k in mine, k);
  });

  it('opening quantity creates tracked units with ledger rows, not a bare number', async () => {
    const { part, units } = await newPart({ quantity: 3, location_code: 'SHELF-T' });
    assert.equal(units.length, 3);
    const rows = (await db.query('SELECT status, source, location_code, prt_id FROM part_instances WHERE part_id = $1', [part.part_id])).rows;
    assert.equal(rows.length, 3);
    assert.ok(rows.every((x) => x.status === 'in_stock' && x.source === 'manual' && x.location_code === 'SHELF-T' && x.prt_id));
    const q = (await db.query('SELECT quantity FROM parts WHERE part_id = $1', [part.part_id])).rows[0].quantity;
    assert.equal(Number(q), 3);
    assert.equal((await ledger(part.part_id)).filter((m) => m.movement_type === 'received').length, 3);
  });

  it('refuses a blank name, a bad opening quantity and a duplicate part', async () => {
    assert.equal((await h.call(partCtrl.createPart, { user, body: { part_name: '  ' } })).code, 400);
    assert.equal((await h.call(partCtrl.createPart, { user, body: { part_name: `${tag} q`, quantity: -1 } })).code, 400);
    assert.equal((await h.call(partCtrl.createPart, { user, body: { part_name: `${tag} q`, quantity: 1.5 } })).code, 400);
    assert.equal((await h.call(partCtrl.createPart, { user, body: { part_name: `${tag} c`, cost: -5 } })).code, 400);
    await newPart({ part_name: `${tag} DUP`, model_number: 'M1' });
    const dup = await h.call(partCtrl.createPart, { user, body: { part_name: ` ${tag} dup `, category: 'RAM', model_number: 'm1' } });
    assert.equal(dup.code, 409);
    assert.ok(dup.body.part_id);
    // Same name, different model number is a different part.
    await newPart({ part_name: `${tag} DUP`, model_number: 'M2' });
  });

  it('add units by hand: serials, source manual, ledger, count; duplicates and archived refused', async () => {
    const { part } = await newPart();
    const twice = await h.call(prCtrl.addPartInstances, { user, body: { part_id: part.part_id, serial_numbers: ['A1', 'a1'] } });
    assert.equal(twice.code, 400);
    const bad = await h.call(prCtrl.addPartInstances, { user, body: { part_id: part.part_id, serial_numbers: ['A1'], unit_cost: -1 } });
    assert.equal(bad.code, 400);
    const ok = await h.call(prCtrl.addPartInstances, { user, body: { part_id: part.part_id, serial_numbers: ['A1', 'A2'], location_code: 'B-2' } });
    assert.equal(ok.code, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.count, 2);
    const units = (await db.query('SELECT serial_number, source, unit_cost FROM part_instances WHERE part_id = $1 ORDER BY serial_number', [part.part_id])).rows;
    assert.deepEqual(units.map((u) => u.serial_number), ['A1', 'A2']);
    assert.ok(units.every((u) => u.source === 'manual' && Number(u.unit_cost) === 1200));
    assert.equal((await ledger(part.part_id)).filter((m) => m.movement_type === 'received').length, 2);

    await db.query('UPDATE parts SET archived = true WHERE part_id = $1', [part.part_id]);
    const arch = await h.call(prCtrl.addPartInstances, { user, body: { part_id: part.part_id, quantity: 1 } });
    assert.equal(arch.code, 409);
  });

  it('marking a unit defective / discarded writes the ledger and moves the count', async () => {
    const { part, units } = await newPart({ quantity: 2 });
    const id = units[0].instance_id;
    const r = await h.call(prCtrl.updatePartInstance, { user, params: { instanceId: id }, body: { status: 'discarded' } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const m = (await ledger(part.part_id)).filter((x) => x.instance_id === id).map((x) => x.movement_type);
    assert.deepEqual(m, ['received', 'discarded']);
    assert.equal(Number((await db.query('SELECT quantity FROM parts WHERE part_id = $1', [part.part_id])).rows[0].quantity), 1);
  });

  it('count adjustment (consumables): whole non-zero change, never below zero, logged', async () => {
    const { part } = await newPart({ is_consumable: true });
    const q = (b) => h.call(partCtrl.updatePartQuantity, { user, params: { id: part.part_id }, body: b });
    assert.equal((await q({ quantity: 'abc' })).code, 400);
    assert.equal((await q({ quantity: 0 })).code, 400);
    assert.equal((await q({ quantity: -1 })).code, 400);
    const up = await q({ quantity: 5, reason: 'opening count' });
    assert.equal(up.code, 200);
    assert.equal(Number(up.body.part.quantity), 5);
    assert.equal((await q({ quantity: -6 })).code, 400);
    assert.equal(Number((await q({ quantity: -2 })).body.part.quantity), 3);
    const adj = (await ledger(part.part_id)).filter((x) => x.movement_type === 'adjusted');
    assert.equal(adj.length, 2);
    assert.match(adj[0].notes, /0 → 5 — opening count/);
  });
});
