/**
 * End-to-end verification of Vendor Parts Repair & Return lifecycle.
 * Uses the REAL service code paths (create → dispatch → receive → QC).
 */
require('dotenv').config();
const pool = require('../config/db');
const {
  createPartVendorReturnDc,
  dispatchPartVendorReturnDc,
  receivePartsFromVendor,
  passPartVendorRepairQc,
} = require('../services/partVendorRepairService');

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (cond) pass += 1;
  else fail += 1;
};

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function seedDefectiveInstance(label) {
  const part = (await pool.query(
    `INSERT INTO parts (part_name, part_type, category, quantity, min_threshold, description)
     VALUES ($1, 'general', 'general', 0, 1, 'verify-part-vendor-repair')
     RETURNING part_id, part_name`,
    [`PVR Test Part ${label}`]
  )).rows[0];

  let spoId = null;
  let vendorId = null;
  const spo = (await pool.query(
    `SELECT spo.spo_id, spo.vendor_id
       FROM vendor_spare_parts_purchase_orders spo
       JOIN vendors v ON v.vendor_id = spo.vendor_id AND v.deleted_at IS NULL
      WHERE COALESCE(NULLIF(TRIM(v.address), ''), NULLIF(TRIM(v.shipping_address), '')) IS NOT NULL
      ORDER BY spo.spo_id DESC LIMIT 1`
  )).rows[0];
  if (spo) {
    spoId = spo.spo_id;
    vendorId = spo.vendor_id;
  } else {
    const v = (await pool.query(
      `INSERT INTO vendors (business_name, address, status)
       VALUES ('PVR Test Vendor', 'Test Address Line 1', 1)
       RETURNING vendor_id`
    )).rows[0];
    vendorId = v.vendor_id;
    const spoIns = (await pool.query(
      `INSERT INTO vendor_spare_parts_purchase_orders
         (vendor_id, purchase_order_number, status, created_at, updated_at)
       VALUES ($1, $2, 'received', NOW(), NOW())
       RETURNING spo_id`,
      [vendorId, `SP-PO-PVR-${Date.now()}`]
    ).catch(async () => {
      // Minimal columns fallback if schema differs
      const cols = await pool.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'vendor_spare_parts_purchase_orders'`
      );
      const names = cols.rows.map((r) => r.column_name);
      if (names.includes('spo_number')) {
        return pool.query(
          `INSERT INTO vendor_spare_parts_purchase_orders (vendor_id, spo_number, status)
           VALUES ($1, $2, 'received') RETURNING spo_id`,
          [vendorId, `SP-PO-PVR-${Date.now()}`]
        );
      }
      throw new Error('Cannot create SPO for verification');
    })).rows[0];
    spoId = spoIns.spo_id;
  }

  const prt = `PRT-PVR-${label}-${Date.now().toString().slice(-6)}`;
  const inst = (await pool.query(
    `INSERT INTO part_instances
       (prt_id, part_id, spo_id, vendor_id, unit_cost, status, serial_number, source, received_at)
     VALUES ($1,$2,$3,$4,500,'defective',$5,'purchase',NOW())
     RETURNING instance_id, prt_id, part_id, unit_cost`,
    [prt, part.part_id, spoId, vendorId, `SN-PVR-${label}`]
  )).rows[0];

  return { part, inst, spoId, vendorId };
}

async function cleanup(dcNumbers, instanceIds, partIds) {
  for (const dc of dcNumbers.filter(Boolean)) {
    await pool.query(`DELETE FROM vendor_repair_dc_part_items WHERE dc_number = $1`, [dc]).catch(() => {});
    await pool.query(`DELETE FROM vendor_repair_delivery_challans WHERE dc_number = $1`, [dc]).catch(() => {});
  }
  if (instanceIds.length) {
    await pool.query(`DELETE FROM part_movements WHERE instance_id = ANY($1::int[])`, [instanceIds]).catch(() => {});
    await pool.query(`DELETE FROM part_instances WHERE instance_id = ANY($1::int[])`, [instanceIds]).catch(() => {});
  }
  if (partIds.length) {
    await pool.query(`DELETE FROM parts WHERE part_id = ANY($1::int[]) AND description = 'verify-part-vendor-repair'`, [partIds]).catch(() => {});
  }
}

async function scenarioRepaired() {
  console.log('\n===== A) Repaired receive + QC pass =====');
  const seeded = await seedDefectiveInstance('A');
  const dcNumbers = [];
  const instanceIds = [seeded.inst.instance_id];
  const partIds = [seeded.part.part_id];
  let client;

  try {
    const qtyBefore = Number((await pool.query(
      `SELECT quantity FROM parts WHERE part_id = $1`, [seeded.part.part_id]
    )).rows[0].quantity);

    client = await pool.connect();
    await client.query('BEGIN');
    const created = await createPartVendorReturnDc(client, {
      instanceIds: [seeded.inst.instance_id],
      remarks: 'Defective DOA unit for verification test',
      actorUserId: null,
      actorName: 'verify-script',
    });
    await client.query('COMMIT');
    client.release();
    client = null;
    dcNumbers.push(created.dc_number);

    const afterCreate = (await pool.query(
      `SELECT status, vendor_repair_dc_number FROM part_instances WHERE instance_id = $1`,
      [seeded.inst.instance_id]
    )).rows[0];
    check('status = with_vendor_repair', afterCreate.status === 'with_vendor_repair', afterCreate.status);
    check('vendor_repair_dc_number set', afterCreate.vendor_repair_dc_number === created.dc_number);

    const head = (await pool.query(
      `SELECT item_domain, status FROM vendor_repair_delivery_challans WHERE dc_number = $1`,
      [created.dc_number]
    )).rows[0];
    check('item_domain = part', head.item_domain === 'part');
    check('header draft', head.status === 'draft');

    const mov1 = (await pool.query(
      `SELECT movement_type FROM part_movements WHERE instance_id = $1 ORDER BY movement_id`,
      [seeded.inst.instance_id]
    )).rows.map((r) => r.movement_type);
    check('sent_to_vendor_repair movement', mov1.includes('sent_to_vendor_repair'), mov1.join(','));

    // Double-dispatch guard
    client = await pool.connect();
    await client.query('BEGIN');
    let rejected = false;
    try {
      await createPartVendorReturnDc(client, {
        instanceIds: [seeded.inst.instance_id],
        remarks: 'Should fail double dispatch guard xx',
        actorUserId: null,
        actorName: 'verify-script',
      });
    } catch (e) {
      rejected = /already on vendor repair/i.test(e.message);
    }
    await client.query('ROLLBACK');
    client.release();
    client = null;
    check('double-dispatch rejected', rejected);

    client = await pool.connect();
    await client.query('BEGIN');
    await dispatchPartVendorReturnDc(client, {
      dcNumber: created.dc_number,
      warehouseEsign: TINY_PNG,
      dispatchBody: {
        ship_by: 'by_courier',
        courier_name: 'BlueDart',
        awb_number: 'TESTAWB001',
      },
      actorName: 'verify-script',
    });
    await client.query('COMMIT');
    client.release();
    client = null;

    const afterDisp = (await pool.query(
      `SELECT status FROM vendor_repair_delivery_challans WHERE dc_number = $1`,
      [created.dc_number]
    )).rows[0];
    check('header dispatched', afterDisp.status === 'dispatched');

    client = await pool.connect();
    await client.query('BEGIN');
    await receivePartsFromVendor(client, {
      dcNumber: created.dc_number,
      receiveItems: [{ instance_id: seeded.inst.instance_id, receive_mode: 'repaired' }],
      actorName: 'verify-script',
    });
    await client.query('COMMIT');
    client.release();
    client = null;

    const afterRecv = (await pool.query(
      `SELECT status, vendor_repair_dc_number FROM part_instances WHERE instance_id = $1`,
      [seeded.inst.instance_id]
    )).rows[0];
    check('status = qc_pending after repaired receive', afterRecv.status === 'qc_pending', afterRecv.status);
    check('vendor_repair_dc_number cleared', afterRecv.vendor_repair_dc_number == null);

    client = await pool.connect();
    await client.query('BEGIN');
    await passPartVendorRepairQc(client, {
      instanceId: seeded.inst.instance_id,
      actorName: 'verify-script',
    });
    await client.query('COMMIT');
    client.release();
    client = null;

    const afterQc = (await pool.query(
      `SELECT status FROM part_instances WHERE instance_id = $1`,
      [seeded.inst.instance_id]
    )).rows[0];
    const qtyAfter = Number((await pool.query(
      `SELECT quantity FROM parts WHERE part_id = $1`, [seeded.part.part_id]
    )).rows[0].quantity);
    check('QC pass → in_stock', afterQc.status === 'in_stock', afterQc.status);
    check('parts.quantity +1', qtyAfter === qtyBefore + 1, `${qtyBefore} → ${qtyAfter}`);

    const movFinal = (await pool.query(
      `SELECT movement_type FROM part_movements WHERE instance_id = $1 ORDER BY movement_id`,
      [seeded.inst.instance_id]
    )).rows.map((r) => r.movement_type);
    const expectedOrder = ['sent_to_vendor_repair', 'received_from_vendor_repair', 'received'];
    const okOrder = expectedOrder.every((t, i) => movFinal.indexOf(t) >= 0
      && (i === 0 || movFinal.indexOf(t) > movFinal.indexOf(expectedOrder[i - 1])));
    check('movement order sent→from_vendor→received', okOrder, movFinal.join(' > '));
  } catch (e) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    check('scenario A completed without throw', false, e.message);
    console.error(e);
  } finally {
    await cleanup(dcNumbers, instanceIds, partIds);
  }
}

async function scenarioReplacement() {
  console.log('\n===== B) Replacement receive =====');
  const seeded = await seedDefectiveInstance('B');
  const dcNumbers = [];
  const instanceIds = [seeded.inst.instance_id];
  const partIds = [seeded.part.part_id];
  let client;
  let replacementId = null;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const created = await createPartVendorReturnDc(client, {
      instanceIds: [seeded.inst.instance_id],
      remarks: 'Wrong part shipped — replacement required',
      actorUserId: null,
      actorName: 'verify-script',
    });
    await dispatchPartVendorReturnDc(client, {
      dcNumber: created.dc_number,
      warehouseEsign: TINY_PNG,
      dispatchBody: { ship_by: 'by_courier', courier_name: 'Delhivery' },
      actorName: 'verify-script',
    });
    const recv = await receivePartsFromVendor(client, {
      dcNumber: created.dc_number,
      receiveItems: [{
        instance_id: seeded.inst.instance_id,
        receive_mode: 'replacement',
        replacement_serial: `SN-REPL-${Date.now()}`,
      }],
      actorName: 'verify-script',
    });
    await client.query('COMMIT');
    client.release();
    client = null;

    dcNumbers.push(created.dc_number);
    replacementId = recv.received?.[0]?.replacement_instance_id;
    if (replacementId) instanceIds.push(replacementId);

    const orig = (await pool.query(
      `SELECT status FROM part_instances WHERE instance_id = $1`,
      [seeded.inst.instance_id]
    )).rows[0];
    check('original discarded', orig.status === 'discarded', orig.status);

    const line = (await pool.query(
      `SELECT replacement_instance_id, item_status, receive_mode
         FROM vendor_repair_dc_part_items
        WHERE dc_number = $1 AND instance_id = $2`,
      [created.dc_number, seeded.inst.instance_id]
    )).rows[0];
    check('replacement_instance_id linked', Number(line.replacement_instance_id) === Number(replacementId));
    check('item_status replacement_received', line.item_status === 'replacement_received');

    const neu = (await pool.query(
      `SELECT status, part_id, unit_cost FROM part_instances WHERE instance_id = $1`,
      [replacementId]
    )).rows[0];
    check('replacement instance exists', !!neu);
    check('replacement same part_id', Number(neu?.part_id) === Number(seeded.inst.part_id));
    check('replacement qc_pending', neu?.status === 'qc_pending', neu?.status);
  } catch (e) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    check('scenario B completed without throw', false, e.message);
    console.error(e);
  } finally {
    await cleanup(dcNumbers, instanceIds, partIds);
  }
}

(async () => {
  await scenarioRepaired();
  await scenarioReplacement();
  console.log(`\nDone. ${pass} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
