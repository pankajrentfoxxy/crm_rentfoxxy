/**
 * Production safety D — the public QC2 check link (Q20–Q22). Rolled back.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('./helpers/rollbackHarness');
const qc2 = require('../services/qc2CaptureService');

describe('QC2 check link (rolled back)', () => {
  let C;
  let ticketId;
  let paId;
  const token = async (status, { ageHours = 0, access = null } = {}) => {
    const id = crypto.randomUUID();
    await C.query(
      `INSERT INTO qc2_capture_tokens (token_id, access_number, ticket_id, production_asset_id, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW() - interval '1 minute', NOW() - ($6 || ' hours')::interval)`,
      [id, access || String(crypto.randomInt(10000000, 99999999)), ticketId, paId, status, ageHours]
    );
    return id;
  };

  before(async () => {
    C = await h.open();
    const pa = (await C.query('SELECT production_asset_id, ticket_id FROM production_assets WHERE ticket_id IS NOT NULL ORDER BY production_asset_id DESC LIMIT 1')).rows[0];
    paId = pa.production_asset_id; ticketId = pa.ticket_id;
    const qc2Stage = (await C.query("SELECT stage_id FROM stages WHERE stage_name = 'QC2' ORDER BY (team_id IS NULL), stage_id LIMIT 1")).rows[0].stage_id;
    await C.query('UPDATE tickets SET current_stage_id = $1 WHERE ticket_id = $2', [qc2Stage, ticketId]);
    await C.query("UPDATE qc2_capture_tokens SET status = 'expired' WHERE ticket_id = $1 AND status = 'pending'", [ticketId]);
  });
  after(() => h.close());

  it('a failed check is final — it cannot be re-verified until it matches', async () => {
    const t = await token('failed');
    const r = await qc2.verifyQc2Configuration(t, { manufacturer: 'x' }, '127.0.0.1');
    assert.equal(r.ok, false);
    assert.equal(r.code, 409);
    assert.match(r.message, /new access number/);
  });

  it('an expired link revives only within 4 hours of being made', async () => {
    const old = await token('expired', { ageHours: 5 });
    const r = await qc2.verifyQc2Configuration(old, { manufacturer: 'x' }, '127.0.0.1');
    assert.equal(r.code, 410);
  });

  it('the link closes once the laptop has left QC2', async () => {
    const t = await token('pending');
    await C.query("UPDATE qc2_capture_tokens SET expires_at = NOW() + interval '30 minutes' WHERE token_id = $1", [t]);
    const qc1 = (await C.query("SELECT stage_id FROM stages WHERE stage_name = 'QC1' ORDER BY (team_id IS NULL), stage_id LIMIT 1")).rows[0].stage_id;
    await C.query('UPDATE tickets SET current_stage_id = $1 WHERE ticket_id = $2', [qc1, ticketId]);
    const r = await qc2.verifyQc2Configuration(t, { manufacturer: 'x' }, '127.0.0.1');
    assert.equal(r.code, 409);
    assert.match(r.message, /no longer at QC2/);
  });

  it('the public link does not hand out the expected configuration', async () => {
    const access = String(crypto.randomInt(10000000, 99999999));
    const t = await token('pending', { access });
    await C.query("UPDATE qc2_capture_tokens SET expires_at = NOW() + interval '30 minutes' WHERE token_id = $1", [t]);
    const r = await qc2.resolveByAccessNumber(access);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.expected_config, null);
    const s = await qc2.getPublicSession(t);
    assert.equal(s.expected_config, null);
  });
});
