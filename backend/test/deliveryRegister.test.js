/**
 * Part 0.3 — V2: the delivery register completes a delivery.
 *
 * The handler used to write status='delivered' and delivery_completed_at and
 * stop. It never set delivered_at and never called finalizeDeliveryInventory, so
 * the challan read delivered everywhere while the asset stayed in_transit,
 * rent_start_date was never set and no rental invoice was ever raised.
 *
 * Both completions now go through performDcDelivery, which is what these tests
 * exercise directly: it owns the row lock, the state refusals, the UPDATE and
 * the inventory finalisation, and it is the piece both HTTP handlers share.
 *
 * finalizeDeliveryInventory is stubbed — it is the collaborator whose CALL is
 * the defect, so what matters here is that it is invoked with the right challan,
 * not what it does internally.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });
const controller = require('../controllers/salesManagementController');

const { performDcDelivery } = controller;
const realFinalize = controller.finalizeDeliveryInventory;

const DC = 'DC/26-27/TEST1';

/** Records every statement so a test can assert on the UPDATE that was issued. */
function stubClient(statusRows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FOR UPDATE/i.test(sql)) return { rows: statusRows };
      if (/^\s*UPDATE delivery_challan_lines/i.test(sql)) {
        // No deliverable line when every row is already delivered or cancelled.
        const deliverable = statusRows.some(
          (r) => !['delivered', 'cancelled'].includes(r.status)
        );
        return { rows: [], rowCount: deliverable ? statusRows.length : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
    update() {
      return this.calls.find((c) => /^\s*UPDATE delivery_challan_lines/i.test(c.sql));
    },
  };
}

let finalizeCalls;
beforeEach(() => {
  finalizeCalls = [];
  controller.finalizeDeliveryInventory = async (_client, dcNumber, user) => {
    finalizeCalls.push({ dcNumber, user });
  };
});
afterEach(() => {
  controller.finalizeDeliveryInventory = realFinalize;
});

describe('0.3 V2 — a register delivery is a real delivery', () => {
  it('sets delivered_at, not just delivery_completed_at', async () => {
    const client = stubClient([{ status: 'in_transit' }]);
    const r = await performDcDelivery(client, {
      dcNumber: DC,
      user: { user_id: 7 },
      deliveredSerialNumbers: ['TTSPL1001'],
      rejectedSerialNumbers: [],
      submittedRemark: 'left at reception',
    });
    assert.equal(r.ok, true);
    const sql = client.update().sql;
    assert.match(sql, /delivered_at = NOW\(\)/, 'delivered_at must be stamped');
    assert.match(sql, /delivery_completed_at = NOW\(\)/);
    assert.match(sql, /status = 'delivered'/);
  });

  it('calls finalizeDeliveryInventory for the challan', async () => {
    const client = stubClient([{ status: 'in_transit' }]);
    await performDcDelivery(client, { dcNumber: DC, user: { user_id: 7 } });
    assert.equal(finalizeCalls.length, 1, 'inventory must be finalised exactly once');
    assert.equal(finalizeCalls[0].dcNumber, DC);
  });

  it('carries the register serial split and remark into the same UPDATE', async () => {
    const client = stubClient([{ status: 'in_transit' }]);
    await performDcDelivery(client, {
      dcNumber: DC,
      user: { user_id: 7 },
      deliveredSerialNumbers: ['TTSPL1001', 'TTSPL1002'],
      rejectedSerialNumbers: ['TTSPL1003'],
      submittedRemark: 'one unit refused',
    });
    const { sql, params } = client.update();
    assert.match(sql, /delivered_serial_numbers = CASE/);
    assert.equal(params[4], true, 'register fields are being written');
    assert.deepEqual(JSON.parse(params[5]), ['TTSPL1001', 'TTSPL1002']);
    assert.deepEqual(JSON.parse(params[6]), ['TTSPL1003']);
    assert.equal(params[7], 'one unit refused');
  });

  it('leaves the register fields alone when the caller is not the register', async () => {
    const client = stubClient([{ status: 'in_transit' }]);
    await performDcDelivery(client, {
      dcNumber: DC,
      user: { user_id: 7 },
      podImageUrl: '/uploads/pod/x.jpg',
    });
    const { params } = client.update();
    assert.equal(params[4], false, 'markDcDelivered must not blank the register split');
  });

  it('takes a row lock before deciding anything', async () => {
    const client = stubClient([{ status: 'in_transit' }]);
    await performDcDelivery(client, { dcNumber: DC, user: { user_id: 7 } });
    assert.match(client.calls[0].sql, /FOR UPDATE/, 'the lock is the first statement');
  });
});

describe('0.3 V2 — refusals, and no finalisation on a refusal', () => {
  it('refuses a cancelled challan', async () => {
    const client = stubClient([{ status: 'cancelled' }]);
    const r = await performDcDelivery(client, { dcNumber: DC, user: { user_id: 7 } });
    assert.equal(r.ok, false);
    assert.equal(r.statusCode, 409);
    assert.match(r.message, /cancelled/i);
    assert.equal(finalizeCalls.length, 0, 'a cancelled DC must not touch inventory');
  });

  it('refuses a challan that is already delivered', async () => {
    const client = stubClient([{ status: 'delivered' }]);
    const r = await performDcDelivery(client, { dcNumber: DC, user: { user_id: 7 } });
    assert.equal(r.ok, false);
    assert.equal(r.statusCode, 409);
    assert.match(r.message, /already/i);
    assert.equal(finalizeCalls.length, 0, 'no double invoice on a re-submit');
  });

  it('404s an unknown challan', async () => {
    const client = stubClient([]);
    const r = await performDcDelivery(client, { dcNumber: DC, user: { user_id: 7 } });
    assert.equal(r.ok, false);
    assert.equal(r.statusCode, 404);
    assert.equal(finalizeCalls.length, 0);
  });

  it('refuses when a cancelled line sits alongside a live one', async () => {
    const client = stubClient([{ status: 'in_transit' }, { status: 'cancelled' }]);
    const r = await performDcDelivery(client, { dcNumber: DC, user: { user_id: 7 } });
    assert.equal(r.ok, false, 'any cancelled line blocks the whole challan');
    assert.equal(finalizeCalls.length, 0);
  });
});
