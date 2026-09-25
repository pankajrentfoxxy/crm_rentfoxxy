/**
 * Part 3.4 wired in: the hardened OTP against the database.
 *
 * Runs inside one transaction that is rolled back, so the throwaway challan and
 * the events it writes (the events table is append-only) never persist.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });
const pool = require('../config/db');
const otp = require('../services/deliveryOtpService');

describe('delivery OTP — hashed, expiring, attempt-limited', () => {
  let client;
  const dc = `TEST-OTP-${Date.now()}`;

  before(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO delivery_challan_lines (dc_number, customer_name, status, movement_type, otp_code, d_otp)
       VALUES ($1, 'test', 'in_transit', 'outbound', '111111', '111111')`,
      [dc]
    );
  });
  after(async () => {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  });

  const row = async () => (await client.query(
    'SELECT otp_hash, otp_code, d_otp, otp_attempts, otp_verified_at, d_otp_verified_at FROM delivery_challan_lines WHERE dc_number = $1', [dc]
  )).rows[0];

  it('issuing stores only a hash and clears any old plaintext', async () => {
    const r = await otp.issueOtp(client, { dcNumber: dc });
    assert.equal(r.ok, true);
    assert.match(r.code, /^\d{6}$/);
    const x = await row();
    assert.equal(x.otp_hash, otp.hashOtp(dc, r.code));
    assert.equal(x.otp_code, null);
    assert.equal(x.d_otp, null);
  });

  it('the old plaintext code no longer works', async () => {
    const r = await otp.verifyOtp(client, { dcNumber: dc, code: '111111' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'mismatch');
  });

  it('locks after five wrong attempts, and a new code resets the count', async () => {
    const issued = await otp.issueOtp(client, { dcNumber: dc });
    const wrong = issued.code === '000000' ? '000001' : '000000';
    let last;
    for (let i = 0; i < otp.MAX_ATTEMPTS; i += 1) last = await otp.verifyOtp(client, { dcNumber: dc, code: wrong });
    assert.equal(last.reason, 'locked');
    const blocked = await otp.verifyOtp(client, { dcNumber: dc, code: issued.code });
    assert.equal(blocked.reason, 'locked', 'even the right code is refused once locked');
    assert.equal(otp.verifyFailureStatus(blocked), 429);

    const fresh = await otp.issueOtp(client, { dcNumber: dc });
    assert.equal(Number((await row()).otp_attempts), 0);
    const ok = await otp.verifyOtp(client, { dcNumber: dc, code: fresh.code });
    assert.equal(ok.ok, true);
    const x = await row();
    assert.ok(x.otp_verified_at && x.d_otp_verified_at, 'both verification columns are set');
  });

  it('an expired code is refused', async () => {
    const issued = await otp.issueOtp(client, { dcNumber: dc });
    await client.query(`UPDATE delivery_challan_lines SET otp_expires_at = NOW() - interval '1 minute' WHERE dc_number = $1`, [dc]);
    const r = await otp.verifyOtp(client, { dcNumber: dc, code: issued.code });
    assert.equal(r.reason, 'expired');
  });

  it('a delivered challan cannot be issued a code', async () => {
    await client.query(`UPDATE delivery_challan_lines SET status = 'delivered' WHERE dc_number = $1`, [dc]);
    const r = await otp.issueOtp(client, { dcNumber: dc });
    assert.equal(r.ok, false);
  });
});
