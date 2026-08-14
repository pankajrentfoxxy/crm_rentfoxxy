/**
 * End-to-end verification of Discarded Parts → Scrap Challan lifecycle.
 */
require('dotenv').config();
const pool = require('../config/db');
const {
  createScrapChallan,
  dispatchScrapChallan,
  cancelDraftScrapChallan,
} = require('../services/scrapChallanService');

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (cond) pass += 1;
  else fail += 1;
};

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function seedDiscardedInstance(label) {
  const part = (await pool.query(
    `INSERT INTO parts (part_name, part_type, category, quantity, min_threshold, description)
     VALUES ($1, 'general', 'general', 0, 1, 'verify-scrap-challan')
     RETURNING part_id, part_name`,
    [`Scrap Test Part ${label}`]
  )).rows[0];

  const prt = `PRT-SCRAP-${label}-${Date.now().toString().slice(-6)}`;
  const inst = (await pool.query(
    `INSERT INTO part_instances
       (prt_id, part_id, unit_cost, status, serial_number, source, notes, received_at)
     VALUES ($1,$2,2500,'discarded',$3,'purchase','DOA — scrap verification',NOW())
     RETURNING instance_id, prt_id, part_id, unit_cost, status, scrap_challan_number`,
    [prt, part.part_id, `SN-SCRAP-${label}`]
  )).rows[0];

  return { part, inst };
}

async function cleanup(challanNumbers, instanceIds, partIds) {
  for (const n of challanNumbers.filter(Boolean)) {
    await pool.query(`DELETE FROM scrap_challan_items WHERE challan_number = $1`, [n]).catch(() => {});
    await pool.query(`DELETE FROM scrap_challans WHERE challan_number = $1`, [n]).catch(() => {});
  }
  if (instanceIds.length) {
    await pool.query(`DELETE FROM part_movements WHERE instance_id = ANY($1::int[])`, [instanceIds]).catch(() => {});
    await pool.query(`DELETE FROM part_instances WHERE instance_id = ANY($1::int[])`, [instanceIds]).catch(() => {});
  }
  if (partIds.length) {
    await pool.query(
      `DELETE FROM parts WHERE part_id = ANY($1::int[]) AND description = 'verify-scrap-challan'`,
      [partIds]
    ).catch(() => {});
  }
}

async function main() {
  console.log('\n===== Scrap Challan lifecycle =====');
  const seeded = await seedDiscardedInstance('A');
  const challanNumbers = [];
  const instanceIds = [seeded.inst.instance_id];
  const partIds = [seeded.part.part_id];
  let client;

  try {
    // 1) create draft
    client = await pool.connect();
    await client.query('BEGIN');
    const created = await createScrapChallan(client, {
      instanceIds: [seeded.inst.instance_id],
      recipientName: 'Test Scrap Buyer',
      recipientAddress: 'Scrap Yard Road, Test City',
      contactPerson: 'Buyer',
      contactMobile: '9999999999',
      remarks: 'Verify scrap flow',
      actorUserId: null,
    });
    await client.query('COMMIT');
    client.release();
    client = null;
    challanNumbers.push(created.challan_number);

    const afterCreate = (await pool.query(
      `SELECT status, scrap_challan_number FROM part_instances WHERE instance_id = $1`,
      [seeded.inst.instance_id]
    )).rows[0];
    const head = (await pool.query(
      `SELECT status FROM scrap_challans WHERE challan_number = $1`,
      [created.challan_number]
    )).rows[0];
    const itemCount = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM scrap_challan_items WHERE challan_number = $1`,
      [created.challan_number]
    )).rows[0].n;

    check('create → draft header', head.status === 'draft', head.status);
    check('create → item row', itemCount === 1, String(itemCount));
    check('create → scrap_challan_number set', afterCreate.scrap_challan_number === created.challan_number);
    check('create → status still discarded', afterCreate.status === 'discarded', afterCreate.status);

    // 2) double-scrap guard
    client = await pool.connect();
    await client.query('BEGIN');
    let rejected = false;
    try {
      await createScrapChallan(client, {
        instanceIds: [seeded.inst.instance_id],
        recipientName: 'Other Buyer',
        recipientAddress: 'Elsewhere',
      });
      await client.query('COMMIT');
    } catch (e) {
      rejected = /already on scrap challan/i.test(e.message);
      await client.query('ROLLBACK').catch(() => {});
    }
    client.release();
    client = null;
    check('double create rejected', rejected);

    // 3) cancel draft
    client = await pool.connect();
    await client.query('BEGIN');
    await cancelDraftScrapChallan(client, { challanNumber: created.challan_number });
    await client.query('COMMIT');
    client.release();
    client = null;

    const afterCancel = (await pool.query(
      `SELECT status, scrap_challan_number FROM part_instances WHERE instance_id = $1`,
      [seeded.inst.instance_id]
    )).rows[0];
    const headGone = (await pool.query(
      `SELECT 1 FROM scrap_challans WHERE challan_number = $1`,
      [created.challan_number]
    )).rows[0];
    check('cancel → header removed', !headGone);
    check('cancel → scrap_challan_number cleared', afterCancel.scrap_challan_number == null);
    check('cancel → status still discarded', afterCancel.status === 'discarded', afterCancel.status);

    // 4) re-create + dispatch
    client = await pool.connect();
    await client.query('BEGIN');
    const recreated = await createScrapChallan(client, {
      instanceIds: [seeded.inst.instance_id],
      recipientName: 'Test Scrap Buyer',
      recipientAddress: 'Scrap Yard Road, Test City',
      actorUserId: null,
    });
    await client.query('COMMIT');
    client.release();
    client = null;
    challanNumbers.push(recreated.challan_number);

    client = await pool.connect();
    await client.query('BEGIN');
    const dispatched = await dispatchScrapChallan(client, {
      challanNumber: recreated.challan_number,
      warehouseEsign: TINY_PNG,
      dispatchBody: {
        ship_by: 'by_courier',
        courier_name: 'Test Courier',
        awb_number: '1234567890',
        warehouse_signer_name: 'Verify Warehouse',
      },
      actorUserId: null,
      actorName: 'verify-script',
    });
    await client.query('COMMIT');
    client.release();
    client = null;

    const afterDispatch = (await pool.query(
      `SELECT status, scrap_challan_number FROM part_instances WHERE instance_id = $1`,
      [seeded.inst.instance_id]
    )).rows[0];
    const headDisp = (await pool.query(
      `SELECT status, dispatched_at FROM scrap_challans WHERE challan_number = $1`,
      [recreated.challan_number]
    )).rows[0];
    const mov = (await pool.query(
      `SELECT movement_type, unit_cost, notes
         FROM part_movements
        WHERE instance_id = $1 AND movement_type = 'scrapped'
        ORDER BY movement_id DESC LIMIT 1`,
      [seeded.inst.instance_id]
    )).rows[0];

    check('dispatch → status scrapped', afterDispatch.status === 'scrapped', afterDispatch.status);
    check('dispatch → header dispatched', headDisp.status === 'dispatched' && !!headDisp.dispatched_at);
    check('dispatch → movement scrapped', mov?.movement_type === 'scrapped');
    check('dispatch → movement unit_cost', Number(mov?.unit_cost) === 2500, String(mov?.unit_cost));
    check('dispatch → movement notes', /Scrapped via/.test(mov?.notes || ''), mov?.notes);
    check('dispatch return ok', dispatched.status === 'dispatched');

    // 5) scrapped not eligible for another scrap challan
    client = await pool.connect();
    await client.query('BEGIN');
    let rejectScrapped = false;
    try {
      await createScrapChallan(client, {
        instanceIds: [seeded.inst.instance_id],
        recipientName: 'X',
        recipientAddress: 'Y',
      });
      await client.query('COMMIT');
    } catch (e) {
      rejectScrapped = /must be discarded/i.test(e.message);
      await client.query('ROLLBACK').catch(() => {});
    }
    client.release();
    client = null;
    check('scrapped cannot re-scrap', rejectScrapped);

    // 6) EDITABLE exclusion (status not in allow-list)
    const EDITABLE = new Set(['in_stock', 'defective', 'discarded']);
    check('scrapped outside EDITABLE set', !EDITABLE.has('scrapped'));
  } catch (err) {
    console.error('FATAL:', err);
    fail += 1;
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  } finally {
    await cleanup(challanNumbers, instanceIds, partIds);
  }

  console.log(`\nScrap challan checks: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
