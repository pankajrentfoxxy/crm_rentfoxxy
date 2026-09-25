/**
 * Migration 328 — the warehouse-return OTP is hashed, expires and is
 * attempt-limited, like the delivery OTP. Uses a throwaway refused challan
 * (committed, then deleted; this path writes no events).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });
const pool = require('../config/db');
const svc = require('../services/deliveryRejectionService');

describe('warehouse-return OTP', () => {
  const dc = `TEST-WHOTP-${Date.now()}`;
  before(async () => {
    await pool.query(
      `INSERT INTO delivery_challan_lines (dc_number, customer_name, status, movement_type, warehouse_return_otp)
       VALUES ($1, 'test', 'rejected', 'outbound', '123456')`,
      [dc]
    );
  });
  after(async () => {
    await pool.query('DELETE FROM delivery_challan_lines WHERE dc_number = $1', [dc]);
    await pool.end();
  });
  const row = async () => (await pool.query(
    `SELECT warehouse_return_otp, warehouse_return_otp_hash, warehouse_return_otp_attempts FROM delivery_challan_lines WHERE dc_number = $1`, [dc]
  )).rows[0];

  it('issuing stores only a hash and clears the old plaintext', async () => {
    const r = await svc.sendWarehouseReturnOtp(dc, { user: { role: 'super_admin' } });
    assert.equal(r.otp_sent, true);
    const x = await row();
    assert.equal(x.warehouse_return_otp, null);
    assert.equal(x.warehouse_return_otp_hash, svc.warehouseOtpHash(dc, r.otp_visible));
  });

  it('the old plaintext code no longer works', async () => {
    const r = await svc.checkWarehouseReturnOtp(dc, '123456');
    assert.equal(r.ok, false);
  });

  it('locks after five wrong tries; a new code resets; the right code passes', async () => {
    const issued = await svc.sendWarehouseReturnOtp(dc, { user: { role: 'super_admin' } });
    const wrong = issued.otp_visible === '000000' ? '000001' : '000000';
    let last;
    for (let i = 0; i < svc.WAREHOUSE_OTP_MAX_ATTEMPTS; i += 1) last = await svc.checkWarehouseReturnOtp(dc, wrong);
    assert.equal(last.reason, 'locked');
    assert.equal((await svc.checkWarehouseReturnOtp(dc, issued.otp_visible)).reason, 'locked');

    const fresh = await svc.sendWarehouseReturnOtp(dc, { user: { role: 'super_admin' } });
    assert.equal(Number((await row()).warehouse_return_otp_attempts), 0);
    assert.equal((await svc.checkWarehouseReturnOtp(dc, fresh.otp_visible)).ok, true);
  });

  it('an expired code is refused', async () => {
    const issued = await svc.sendWarehouseReturnOtp(dc, { user: { role: 'super_admin' } });
    await pool.query(`UPDATE delivery_challan_lines SET warehouse_return_otp_expires_at = NOW() - interval '1 minute' WHERE dc_number = $1`, [dc]);
    assert.equal((await svc.checkWarehouseReturnOtp(dc, issued.otp_visible)).reason, 'expired');
  });
});
