/**
 * Procure screens 1 — vendor record rules: GSTIN/PAN/IFSC checked on new or
 * changed values only (imported placeholders don't block unrelated edits),
 * GSTIN unique among active vendors, "hidden" bank values keep what is stored.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const { vendorIdProblems, bankDetailsLookValid, keepHidden } = require('../controllers/vendorManagement/vendors.controller');

describe('vendor identifiers', () => {
  after(() => pool.end());

  it('rejects bad formats on a new vendor', async () => {
    const p = await vendorIdProblems({ gst_number: '06ABC', pan_number: 'ABC', bank_ifsc_code: 'ABSI12345' });
    assert.equal(p.length, 3);
  });

  it('accepts good formats on a new vendor', async () => {
    const p = await vendorIdProblems({ gst_number: '99ZZZZZ9999Z9ZZ', pan_number: 'ABCDE1234F', bank_ifsc_code: 'HDFC0001234' });
    assert.deepEqual(p, []);
  });

  it('does not block an edit that leaves a placeholder IFSC untouched', async () => {
    const prev = { vendor_id: 1, bank_ifsc_code: 'ABSI12345', gst_number: '', pan_number: '' };
    assert.deepEqual(await vendorIdProblems({ bank_ifsc_code: 'absi12345', phone: '1' }, prev), []);
    assert.equal((await vendorIdProblems({ bank_ifsc_code: 'ABSI123456' }, prev)).length, 1);
  });

  it('refuses a GSTIN that another active vendor holds', async () => {
    const other = (await pool.query(
      `SELECT vendor_id, gst_number FROM vendors WHERE deleted_at IS NULL AND gst_number ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' LIMIT 1`
    )).rows[0];
    if (!other) return;
    const p = await vendorIdProblems({ gst_number: other.gst_number.toLowerCase() }, { vendor_id: -1, gst_number: '' });
    assert.match(p.join(' '), /already belongs/);
    assert.deepEqual(await vendorIdProblems({ gst_number: other.gst_number }, other), []);
  });

  it('keeps stored values posted back as "hidden"', () => {
    const body = { account_number: 'hidden', pan_number: 'ABCDE1234F' };
    keepHidden(body, { account_number: '123456789', pan_number: 'OLD' });
    assert.equal(body.account_number, '123456789');
    assert.equal(body.pan_number, 'ABCDE1234F');
  });

  it('flags placeholder bank details', () => {
    assert.equal(bankDetailsLookValid({ bank_ifsc_code: 'ABSI12345', account_number: '1234567' }), false);
    assert.equal(bankDetailsLookValid({ bank_ifsc_code: 'HDFC0001234', account_number: '50100012345678' }), true);
  });
});
