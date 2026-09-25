/**
 * The delivery register's POD upload goes through the one delivery routine.
 *
 * It used to write status itself: a mixed POD marked the challan delivered and
 * left every laptop in transit for ever, and a delivery needed no proof file.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });
const pool = require('../config/db');
const ctrl = require('../controllers/deliveryRegisterController');

const handler = ctrl.submitPod[ctrl.submitPod.length - 1];
const call = async (body) => {
  const res = { code: 200, body: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  await handler({ body, params: {}, files: [], user: { user_id: 1, role: 'super_admin', name: 'test' } }, res);
  return res;
};

describe('register POD upload', () => {
  const dc = `TEST-REGPOD-${Date.now()}`;
  before(async () => {
    await pool.query(
      `INSERT INTO delivery_challan_lines (dc_number, customer_name, status, movement_type, serial_number, d_otp_verified_at)
       VALUES ($1, 'test', 'in_transit', 'outbound', '["SNA","SNB"]', NOW())`,
      [dc]
    );
  });
  after(async () => {
    await pool.query('DELETE FROM delivery_challan_lines WHERE dc_number = $1', [dc]);
    await pool.end();
  });
  const status = async () => (await pool.query('SELECT status FROM delivery_challan_lines WHERE dc_number = $1', [dc])).rows[0].status;

  it('refuses a mixed delivered/refused POD instead of stranding the laptops', async () => {
    const r = await call({ dc_number: dc, delivered_products: '["SNA"]', rejected_products: '["SNB"]', remark: 'one refused' });
    assert.equal(r.code, 409);
    assert.equal(r.body.code, 'PARTIAL_DELIVERY_UNSUPPORTED');
    assert.equal(await status(), 'in_transit');
  });

  it('refuses a delivery with no POD file — the proof rule applies here too', async () => {
    const r = await call({ dc_number: dc, delivered_products: '["SNA","SNB"]', remark: 'ok' });
    assert.equal(r.code, 400, JSON.stringify(r.body));
    assert.equal(r.body.code, 'DELIVERY_PROOF_REJECTED');
    assert.equal(await status(), 'in_transit', 'nothing was written');
  });

  it('requires a reason to refuse', async () => {
    const r = await call({ dc_number: dc, rejected_products: '["SNA","SNB"]', remark: '' });
    assert.equal(r.code, 400);
    assert.equal(await status(), 'in_transit');
  });
});
