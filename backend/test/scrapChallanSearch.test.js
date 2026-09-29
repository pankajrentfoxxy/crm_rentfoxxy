/**
 * Scrap challans in the new UI (Stock → Scrap → challan record, Builder 6).
 *
 * The Carret challan list searches by a laptop's TTSPL (a laptop line's
 * part_name is "Laptop <TTSPL> <model>"), sale values are stored per line and
 * totalled, a laptop can't be on two challans, and cancel keeps the record
 * and frees the laptop. No backend change — this pins what the new screens rely on.
 * Everything runs in one rolled-back transaction.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/rollbackHarness');
const svc = require('../services/scrapChallanService');

describe('scrap challan list search + cancel', () => {
  let db;
  let lap;
  let challan;

  before(async () => {
    db = await h.open();
    const r = await db.query(
      `SELECT serial_id, COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND COALESCE(inventory_asset_code, extra->>'ttspl_id') LIKE 'TTSPL%'
          AND scrap_challan_number IS NULL
        ORDER BY serial_id DESC LIMIT 1`
    );
    lap = r.rows[0];
    assert.ok(lap, 'needs one laptop with a TTSPL code');
    // Test fixture only (rolled back): make it an approved scrap waiting for a challan.
    await db.query(`UPDATE vendor_serial_numbers SET inventory_status = 'scrapped' WHERE serial_id = $1`, [lap.serial_id]);
    const out = await svc.createScrapChallan(db, {
      instanceIds: [],
      serialIds: [lap.serial_id],
      saleValues: { [`laptop:${lap.serial_id}`]: '1500.456' },
      recipientName: 'Test recycler',
      recipientAddress: 'Somewhere',
    });
    challan = out.challan_number;
  });
  after(() => h.close());

  it('finds the challan by the laptop TTSPL', async () => {
    const res = await svc.listScrapChallans({ search: lap.ttspl, limit: 100 });
    assert.ok(res.data.some((d) => d.challan_number === challan), `${challan} not found by ${lap.ttspl}`);
  });

  it('stores the sale value rounded to 2 dp and totals it on the head', async () => {
    const c = await svc.getScrapChallan(challan);
    assert.equal(c.status, 'draft');
    assert.equal(Number(c.items[0].sale_value), 1500.46);
    assert.equal(Number(c.sale_total), 1500.46);
    assert.equal(c.items[0].ttspl_id, lap.ttspl);
  });

  it('a laptop on a challan cannot go on a second one', async () => {
    await assert.rejects(
      () => svc.createScrapChallan(db, { serialIds: [lap.serial_id], recipientName: 'X', recipientAddress: 'Y' }),
      /already on scrap challan/
    );
  });

  it('cancel keeps the record (cancelled, with reason) and frees the laptop', async () => {
    await svc.cancelDraftScrapChallan(db, { challanNumber: challan, reason: 'buyer backed out' });
    const c = await svc.getScrapChallan(challan);
    assert.equal(c.status, 'cancelled');
    assert.equal(c.cancel_reason, 'buyer backed out');
    const v = await db.query('SELECT scrap_challan_number FROM vendor_serial_numbers WHERE serial_id = $1', [lap.serial_id]);
    assert.equal(v.rows[0].scrap_challan_number, null);
    await assert.rejects(() => svc.cancelDraftScrapChallan(db, { challanNumber: challan }), /Only draft/);
  });
});
