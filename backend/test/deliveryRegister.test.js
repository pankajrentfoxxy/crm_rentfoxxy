/**
 * Part 0.3 (V2) — the delivery register completes a delivery.
 *
 * The handler used to write status='delivered' and delivery_completed_at and
 * stop. It never set delivered_at and never called finalizeDeliveryInventory,
 * so the challan read delivered everywhere while the asset stayed in_transit,
 * rent_start_date was never set and no rental invoice was ever raised.
 *
 * WHERE THIS MOVED. Part 0 extracted the completion routine into
 * performDcDelivery so the register stopped being a sixth variation. Part 3.3
 * finished the job: the body now lives in deliveryCompletionService and all
 * five delivery paths share it. These tests moved with it, and they assert the
 * same four properties Part 0 cared about — delivered_at is stamped, inventory
 * is finalised, the register's serial split is carried, and a row lock is taken
 * before anything is decided.
 *
 * finalizeDeliveryInventory is stubbed: it is the collaborator whose CALL is
 * the defect, so what matters is that it is invoked for the right challan.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });

const controller = require('../controllers/salesManagementController');
const { completeDelivery, MODE, ProofRejected } = require('../services/deliveryCompletionService');

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
        const deliverable = statusRows.some((r) => !['delivered', 'cancelled'].includes(r.status));
        return { rows: [], rowCount: deliverable ? statusRows.length : 0 };
      }
      // recordEvent
      if (/INSERT INTO events/i.test(sql)) return { rows: [{ event_id: 1 }] };
      return { rows: [], rowCount: 0 };
    },
    update() {
      return this.calls.find((c) => /^\s*UPDATE delivery_challan_lines/i.test(c.sql));
    },
  };
}

/** The proof an override needs, so these tests exercise completion not refusal. */
const OVERRIDE_PROOF = { podImageUrl: '/uploads/pod/test.jpg', reason: 'register submission' };

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
    const r = await completeDelivery(client, {
      dcNumber: DC,
      mode: MODE.ADMIN_OVERRIDE,
      proof: OVERRIDE_PROOF,
      actor: { user_id: 7 },
      deliveredSerialNumbers: ['TTSPL1001'],
      rejectedSerialNumbers: [],
      submittedRemark: 'left at reception',
    });
    assert.equal(r.ok, true);
    const sql = client.update().sql;
    assert.match(sql, /delivered_at = COALESCE/, 'delivered_at must be stamped');
    assert.match(sql, /delivery_completed_at = COALESCE/);
    assert.match(sql, /status = 'delivered'/);
  });

  it('calls finalizeDeliveryInventory for the challan', async () => {
    const client = stubClient([{ status: 'in_transit' }]);
    await completeDelivery(client, {
      dcNumber: DC, mode: MODE.ADMIN_OVERRIDE, proof: OVERRIDE_PROOF, actor: { user_id: 7 },
    });
    assert.equal(finalizeCalls.length, 1, 'inventory must be finalised exactly once');
    assert.equal(finalizeCalls[0].dcNumber, DC);
  });

  it('carries the register serial split and remark into the same UPDATE', async () => {
    const client = stubClient([{ status: 'in_transit' }]);
    await completeDelivery(client, {
      dcNumber: DC, mode: MODE.ADMIN_OVERRIDE, proof: OVERRIDE_PROOF, actor: { user_id: 7 },
      deliveredSerialNumbers: ['TTSPL1001', 'TTSPL1002'],
      rejectedSerialNumbers: ['TTSPL1003'],
      submittedRemark: 'one unit refused',
    });
    const { sql, params } = client.update();
    assert.match(sql, /delivered_serial_numbers = CASE/);
    assert.equal(params[8], true, 'register fields are being written');
    assert.deepEqual(JSON.parse(params[9]), ['TTSPL1001', 'TTSPL1002']);
    assert.deepEqual(JSON.parse(params[10]), ['TTSPL1003']);
    assert.equal(params[11], 'one unit refused');
  });

  it('leaves the register fields alone when the caller is not the register', async () => {
    const client = stubClient([{ status: 'in_transit' }]);
    await completeDelivery(client, {
      dcNumber: DC, mode: MODE.ADMIN_OVERRIDE, proof: OVERRIDE_PROOF, actor: { user_id: 7 },
    });
    assert.equal(client.update().params[8], false, 'a non-register caller must not blank the split');
  });

  it('takes a row lock before deciding anything', async () => {
    const client = stubClient([{ status: 'in_transit' }]);
    await completeDelivery(client, {
      dcNumber: DC, mode: MODE.ADMIN_OVERRIDE, proof: OVERRIDE_PROOF, actor: { user_id: 7 },
    });
    const firstDcQuery = client.calls.find((c) => /delivery_challan_lines/i.test(c.sql));
    assert.match(firstDcQuery.sql, /FOR UPDATE/, 'the lock comes before the decision');
  });
});

describe('0.3 V2 — refusals, and no finalisation on a refusal', () => {
  const cases = [
    ['cancelled', [{ status: 'cancelled' }], 409, /cancelled/i],
    ['already delivered', [{ status: 'delivered' }], 409, /already/i],
    ['unknown challan', [], 404, /not found/i],
    ['a cancelled line beside a live one', [{ status: 'in_transit' }, { status: 'cancelled' }], 409, /cancelled/i],
  ];

  for (const [name, rows, code, msg] of cases) {
    it(`refuses ${name}`, async () => {
      const client = stubClient(rows);
      const r = await completeDelivery(client, {
        dcNumber: DC, mode: MODE.ADMIN_OVERRIDE, proof: OVERRIDE_PROOF, actor: { user_id: 7 },
      });
      assert.equal(r.ok, false);
      assert.equal(r.statusCode, code);
      assert.match(r.message, msg);
      assert.equal(finalizeCalls.length, 0, 'a refusal must not touch inventory');
    });
  }
});

describe('3.3 — the register can no longer deliver without proof', () => {
  it('refuses an override with no POD and no reason', async () => {
    // This is the tightening. markDcDelivered previously accepted a bare
    // pod_image_url string with no OTP (V3), and submitDeliveryRegister
    // accepted nothing at all. Both now go through the override rules.
    const client = stubClient([{ status: 'in_transit' }]);
    await assert.rejects(
      () => completeDelivery(client, {
        dcNumber: DC, mode: MODE.ADMIN_OVERRIDE, proof: {}, actor: { user_id: 7 },
      }),
      (err) => {
        assert.ok(err instanceof ProofRejected);
        assert.equal(err.statusCode, 400);
        assert.equal(err.missing.length, 2, 'both the POD and the reason are named');
        return true;
      }
    );
    assert.equal(finalizeCalls.length, 0, 'nothing is finalised when the proof is refused');
  });
});
