/**
 * Procure-to-stock safety, batch B: receiving.
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });
const pool = require('../config/db');
const { assertUnitMayBeReceived } = require('../services/grnCaptureGateService');
const { allocateTtsplCodes } = require('../services/vendorInventoryAssetCodeService');

describe('D5 — only a laptop that will not power on may skip the configuration check', () => {
  const base = { poId: 1, lineIndex: 0, serialNumber: 'SN-TEST', captureToken: null };

  it('refuses "part missing" without a check, whatever the reason (the loophole)', async () => {
    await assert.rejects(
      assertUnitMayBeReceived(pool, { ...base, receivedCondition: 'part_missing', waiverReason: 'config differs, receive anyway' }),
      /must be verified/
    );
  });

  it('refuses "on" without a check', async () => {
    await assert.rejects(assertUnitMayBeReceived(pool, { ...base, receivedCondition: 'on', waiverReason: 'long enough reason' }), /must be verified/);
  });

  it('allows "not on" with a reason, recorded as a waiver', async () => {
    const r = await assertUnitMayBeReceived(pool, { ...base, receivedCondition: 'not_on', waiverReason: 'Dead on arrival, no display' });
    assert.equal(r.waived, true);
    assert.equal(r.tokenId, null);
  });

  it('still needs a real reason for "not on"', async () => {
    await assert.rejects(assertUnitMayBeReceived(pool, { ...base, receivedCondition: 'not_on', waiverReason: 'x' }), /reason/);
  });
});

describe('the one-time schema check never waits on a receipt', () => {
  it('finishes while another transaction holds a laptop row lock', async () => {
    const { ensureLockColumns } = require('../services/grnReceivedConfigService');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // Lock a row this transaction creates, so no other test is blocked.
      const g = (await c.query('SELECT grn_id, po_id FROM vendor_goods_received_notes WHERE po_id IS NOT NULL LIMIT 1')).rows[0];
      await c.query(
        `INSERT INTO vendor_serial_numbers (po_id, grn_id, serial_number, extra) VALUES ($1, $2, 'TEST-LOCK-ROW', '{}')`,
        [g.po_id, g.grn_id]
      );
      const timedOut = Symbol('timeout');
      const r = await Promise.race([
        ensureLockColumns(),
        new Promise((ok) => setTimeout(() => ok(timedOut), 3000)),
      ]);
      assert.notEqual(r, timedOut, 'it deadlocked against the open receipt (ALTER TABLE waiting on the row lock)');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});

describe('TTSPL codes are never re-issued', () => {
  after(async () => { await pool.end(); });

  it('skips a code still held by a deleted laptop', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const next = (await c.query('SELECT next_num FROM vendor_inventory_asset_sequence WHERE id = 1')).rows[0].next_num;
      const held = `TTSPL${String(next).padStart(4, '0')}`;
      const g = (await c.query('SELECT grn_id, po_id FROM vendor_goods_received_notes WHERE po_id IS NOT NULL LIMIT 1')).rows[0];
      await c.query(
        `INSERT INTO vendor_serial_numbers (po_id, grn_id, serial_number, inventory_asset_code, extra, deleted_at)
         VALUES ($1, $2, 'TEST-DELETED-TTSPL', $3, '{}', NOW())`,
        [g.po_id, g.grn_id, held]
      );
      const [code] = await allocateTtsplCodes(c, 1);
      assert.notEqual(code, held, 'a deleted laptop keeps its code');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
