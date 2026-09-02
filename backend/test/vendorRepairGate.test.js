const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ESIGN = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ACTOR = { user_id: 2, id: 2, name: 'Admin User', role: 'admin' };
const EXTRA = {
  brand: 'Dell',
  model: 'Latitude 5420',
  processor: 'i5-1135G7',
  generation: '11',
  ram: '8GB',
  storage: '256GB',
  gpu: 'Intel Iris Xe',
};

const created = {
  serialIds: [],
  ticketIds: [],
  dcNumbers: [],
  receiveNumbers: [],
};

describe('vendorRepairGate', { concurrency: 1 }, () => {
  let pool;
  let vr;
  let gate;
  let capture;

  before(async () => {
    require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
    process.env.DB_SSL = process.env.DB_SSL || 'false';
    pool = require('../config/db');
    vr = require('../services/vendorRepairDcService');
    gate = require('../services/guardGateValidationService');
    capture = require('../services/vendorReturnCaptureService');
    await vr.ensureVendorRepairSchema();
  });

  after(async () => {
    if (!pool) return;
    try {
      const leftoverTickets = await pool.query(
        `SELECT ticket_id, vendor_repair_dc_number FROM tickets WHERE serial_number LIKE 'VRGATE-SN-%'`
      );
      const leftoverSerials = await pool.query(
        `SELECT serial_id FROM vendor_serial_numbers WHERE serial_number LIKE 'VRGATE-SN-%'`
      );
      const ticketIds = [...new Set([...created.ticketIds, ...leftoverTickets.rows.map((r) => r.ticket_id)])];
      const serialIds = [...new Set([...created.serialIds, ...leftoverSerials.rows.map((r) => r.serial_id)])];
      const dcNumbers = [...new Set([
        ...created.dcNumbers,
        ...leftoverTickets.rows.map((r) => r.vendor_repair_dc_number).filter(Boolean),
      ])];
      if (dcNumbers.length) {
        await pool.query(`DELETE FROM vendor_return_capture_tokens WHERE dc_number = ANY($1::text[])`, [dcNumbers]).catch(() => {});
        await pool.query(`DELETE FROM vendor_repair_receive_challans WHERE dc_number = ANY($1::text[])`, [dcNumbers]).catch(() => {});
        await pool.query(`DELETE FROM vendor_repair_dc_items WHERE dc_number = ANY($1::text[])`, [dcNumbers]).catch(() => {});
        await pool.query(`DELETE FROM vendor_repair_delivery_challans WHERE dc_number = ANY($1::text[])`, [dcNumbers]).catch(() => {});
        await pool.query(`DELETE FROM gate_movements WHERE reference_number = ANY($1::text[])`, [dcNumbers]).catch(() => {});
        await pool.query(`DELETE FROM gate_scan_sessions WHERE reference_number = ANY($1::text[])`, [dcNumbers]).catch(() => {});
      }
      if (created.receiveNumbers.length) {
        await pool.query(`DELETE FROM gate_movements WHERE reference_number = ANY($1::text[])`, [created.receiveNumbers]).catch(() => {});
        await pool.query(`DELETE FROM gate_scan_sessions WHERE reference_number = ANY($1::text[])`, [created.receiveNumbers]).catch(() => {});
        await pool.query(`DELETE FROM gate_document_tokens WHERE document_number = ANY($1::text[])`, [created.receiveNumbers]).catch(() => {});
      }
      if (ticketIds.length) {
        await pool.query(`DELETE FROM vendor_repair_dc_items WHERE ticket_id = ANY($1::int[])`, [ticketIds]).catch(() => {});
        await pool.query(`DELETE FROM activities WHERE ticket_id = ANY($1::int[])`, [ticketIds]).catch(() => {});
        await pool.query(`DELETE FROM tickets WHERE ticket_id = ANY($1::int[])`, [ticketIds]).catch(() => {});
      }
      if (serialIds.length) {
        await pool.query(`DELETE FROM inventory_status_transitions WHERE serial_id = ANY($1::int[])`, [serialIds]).catch(() => {});
        await pool.query(`DELETE FROM ttspl_audit_log WHERE vendor_serial_id = ANY($1::int[])`, [serialIds]).catch(() => {});
        await pool.query(`DELETE FROM vendor_serial_numbers WHERE serial_id = ANY($1::int[])`, [serialIds]).catch(() => {});
      }
      await pool.query(`DELETE FROM vendor_repair_delivery_challans WHERE dc_number LIKE '%PARTGATE%'`).catch(() => {});
    } finally {
      await pool.end();
    }
  });

  async function insertLaptop({ suffix, ram = '8GB' }) {
    const serialNumber = `VRGATE-SN-${suffix}`;
    const ttspl = `TTSPL88${String(suffix).replace(/\D/g, '').slice(-4).padStart(4, '0')}`;
    const extra = { ...EXTRA, ram, ttspl_id: ttspl };
    const s = await pool.query(
      `INSERT INTO vendor_serial_numbers
         (serial_number, inventory_asset_code, inventory_status, qc_status, extra, grn_id, po_id, missing_parts, received_condition)
       VALUES ($1,$2,'in_stock','pending',$3::jsonb,9315,222,'[]'::jsonb,'on')
       RETURNING serial_id`,
      [serialNumber, ttspl, JSON.stringify(extra)]
    );
    const serialId = s.rows[0].serial_id;
    created.serialIds.push(serialId);
    const t = await pool.query(
      `INSERT INTO tickets
         (serial_number, ttspl_id, vendor_serial_id, status, ticket_type, brand, model, processor, ram, storage, current_stage_id)
       VALUES ($1,$2,$3,'diagnosis_failed','grn_qc','Dell','Latitude 5420','i5-1135G7',$4,'256GB',2)
       RETURNING ticket_id`,
      [serialNumber, ttspl, serialId, ram]
    );
    const ticketId = t.rows[0].ticket_id;
    created.ticketIds.push(ticketId);
    return { serialId, ticketId, serialNumber, ttspl };
  }

  async function createSignedDc(laptop, { shipBy = 'by_courier' } = {}) {
    const client = await pool.connect();
    let dcNumber;
    try {
      await client.query('BEGIN');
      const createdDc = await vr.createOutForRepairDc(client, {
        ticketIds: [laptop.ticketId],
        vendorId: 104,
        vendorName: 'AK LAPTOP SOLUTION',
        vendorAddress: 'Vendor billing address for gate test',
        shippingAddress: 'Vendor shipping address for gate test',
        actorUserId: ACTOR.user_id,
        actorName: ACTOR.name,
        actorRole: 'admin',
        itemVerifications: {
          [laptop.ticketId]: { ttspl: laptop.ttspl, serial: laptop.serialNumber },
        },
        ship_by: shipBy,
        courier_name: 'Test Courier',
        awb_number: `AWB${laptop.ticketId}GATE`,
      });
      dcNumber = createdDc.dc_number || createdDc.dcNumber;
      const signed = await vr.signDispatchDc(client, {
        dcNumber,
        warehouseEsign: ESIGN,
        dispatchBody: {
          ship_by: shipBy,
          courier_name: 'Test Courier',
          awb_number: `AWB${laptop.ticketId}GATE`,
          warehouse_signer_name: ACTOR.name,
        },
        actorUserId: ACTOR.user_id,
        actorName: ACTOR.name,
      });
      await client.query('COMMIT');
      created.dcNumbers.push(dcNumber);
      return { dcNumber, signed };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async function confirmOutward(dcNumber) {
    const resolved = await gate.resolveScan({ direction: 'outward', scan: dcNumber, user: ACTOR });
    assert.equal(resolved.ok, true, resolved.message);
    assert.ok(resolved.session_id, 'expected a gate session');
    const confirmed = await gate.confirmSession({
      sessionId: resolved.session_id,
      remarks: 'test outward',
      user: ACTOR,
    });
    assert.equal(confirmed.ok, true, confirmed.message);
    return confirmed;
  }

  it('1. e-signing a VRDC sets dispatch_ready and changes no ticket or serial state', async () => {
    const laptop = await insertLaptop({ suffix: `${Date.now()}1` });
    const { dcNumber } = await createSignedDc(laptop);
    const head = await pool.query(`SELECT status, dispatched_at FROM vendor_repair_delivery_challans WHERE dc_number = $1`, [dcNumber]);
    const item = await pool.query(`SELECT item_status, dispatch_config_snapshot FROM vendor_repair_dc_items WHERE dc_number = $1`, [dcNumber]);
    const ticket = await pool.query(`SELECT status FROM tickets WHERE ticket_id = $1`, [laptop.ticketId]);
    const serial = await pool.query(`SELECT inventory_status, qc_status FROM vendor_serial_numbers WHERE serial_id = $1`, [laptop.serialId]);
    assert.equal(head.rows[0].status, 'dispatch_ready');
    assert.equal(head.rows[0].dispatched_at, null);
    assert.equal(item.rows[0].item_status, 'dispatch_ready');
    assert.ok(item.rows[0].dispatch_config_snapshot);
    assert.equal(item.rows[0].dispatch_config_snapshot.ssd, '256GB');
    assert.equal(ticket.rows[0].status, 'diagnosis_failed');
    assert.equal(serial.rows[0].inventory_status, 'in_stock');
  });

  it('2. guard outward confirm dispatches head, ticket, serial, and one transition', async () => {
    const laptop = await insertLaptop({ suffix: `${Date.now()}2` });
    const { dcNumber } = await createSignedDc(laptop);
    await confirmOutward(dcNumber);
    const head = await pool.query(`SELECT status, dispatched_at FROM vendor_repair_delivery_challans WHERE dc_number = $1`, [dcNumber]);
    const ticket = await pool.query(`SELECT status FROM tickets WHERE ticket_id = $1`, [laptop.ticketId]);
    const serial = await pool.query(`SELECT inventory_status, qc_status FROM vendor_serial_numbers WHERE serial_id = $1`, [laptop.serialId]);
    const trans = await pool.query(
      `SELECT COUNT(*)::int AS n FROM inventory_status_transitions WHERE serial_id = $1 AND to_status = 'in_repair'`,
      [laptop.serialId]
    );
    assert.equal(head.rows[0].status, 'dispatched');
    assert.ok(head.rows[0].dispatched_at);
    assert.equal(ticket.rows[0].status, 'out_for_repair');
    assert.equal(serial.rows[0].inventory_status, 'in_repair');
    assert.equal(serial.rows[0].qc_status, 'out_for_repair');
    assert.equal(trans.rows[0].n, 1);
  });

  it('3. a second outward confirm on the same DC is rejected', async () => {
    const laptop = await insertLaptop({ suffix: `${Date.now()}3` });
    const { dcNumber } = await createSignedDc(laptop);
    await confirmOutward(dcNumber);
    const again = await gate.resolveScan({ direction: 'outward', scan: dcNumber, user: ACTOR });
    assert.equal(again.valid, false);
    assert.match(String(again.message || ''), /already gone out|no longer active|waiting for guard outward/i);
  });

  it('4. scanning a laptop that is not on the DC fails and cannot be confirmed', async () => {
    const onDc = await insertLaptop({ suffix: `${Date.now()}4` });
    const stranger = await insertLaptop({ suffix: `${Date.now()}41` });
    const { dcNumber } = await createSignedDc(onDc);
    const opened = await gate.resolveScan({ direction: 'outward', scan: dcNumber, user: ACTOR });
    const scanned = await gate.scanUnit({
      sessionId: opened.session_id,
      scan: stranger.ttspl,
      user: ACTOR,
    });
    assert.equal(scanned.valid, false);
    assert.match(String(scanned.message || ''), /not expected|does not match/i);
  });

  it('5. GAP-3: mutating extra.ram after dispatch fails the inward configuration check', async () => {
    const laptop = await insertLaptop({ suffix: `${Date.now()}5` });
    const { dcNumber } = await createSignedDc(laptop);
    await confirmOutward(dcNumber);
    await pool.query(
      `UPDATE vendor_serial_numbers
          SET extra = extra || '{"ram":"32GB"}'::jsonb
        WHERE serial_id = $1`,
      [laptop.serialId]
    );
    const opened = await gate.resolveScan({ direction: 'inward', scan: dcNumber, user: ACTOR });
    assert.equal(opened.ok, true, opened.message);
    const scanned = await gate.scanUnit({
      sessionId: opened.session_id,
      scan: laptop.ttspl,
      user: ACTOR,
    });
    assert.equal(scanned.checks?.configuration?.ok, false);
    await pool.query(
      `UPDATE vendor_serial_numbers
          SET extra = extra || '{"ram":"8GB"}'::jsonb
        WHERE serial_id = $1`,
      [laptop.serialId]
    );
  });

  it('6. guard inward confirm sets gate_received and mints a capture token; serial stays in_repair', async () => {
    const laptop = await insertLaptop({ suffix: `${Date.now()}6` });
    const { dcNumber } = await createSignedDc(laptop);
    await confirmOutward(dcNumber);
    const opened = await gate.resolveScan({ direction: 'inward', scan: dcNumber, user: ACTOR });
    assert.equal(opened.ok, true, opened.message);
    const confirmed = await gate.confirmSession({
      sessionId: opened.session_id,
      remarks: 'test inward',
      user: ACTOR,
    });
    assert.equal(confirmed.ok, true, confirmed.message);
    const item = await pool.query(
      `SELECT item_status, gate_inward_at, receive_dc_number FROM vendor_repair_dc_items WHERE dc_number = $1`,
      [dcNumber]
    );
    const serial = await pool.query(
      `SELECT inventory_status FROM vendor_serial_numbers WHERE serial_id = $1`,
      [laptop.serialId]
    );
    const tok = await pool.query(
      `SELECT status, expected_config FROM vendor_return_capture_tokens WHERE dc_number = $1`,
      [dcNumber]
    );
    assert.equal(item.rows[0].item_status, 'gate_received');
    assert.ok(item.rows[0].gate_inward_at);
    assert.ok(item.rows[0].receive_dc_number);
    created.receiveNumbers.push(item.rows[0].receive_dc_number);
    assert.equal(serial.rows[0].inventory_status, 'in_repair');
    assert.equal(tok.rows[0].status, 'pending');
    assert.equal(tok.rows[0].expected_config.ssd, '256GB');
  });

  it('7. receiveItemsFromVendor throws when gate_inward_at is NULL', async () => {
    const laptop = await insertLaptop({ suffix: `${Date.now()}7` });
    const { dcNumber } = await createSignedDc(laptop);
    await pool.query(
      `UPDATE vendor_repair_delivery_challans SET status = 'dispatched', dispatched_at = NOW() WHERE dc_number = $1`,
      [dcNumber]
    );
    await pool.query(
      `UPDATE vendor_repair_dc_items SET item_status = 'dispatched' WHERE dc_number = $1`,
      [dcNumber]
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assert.rejects(
        () => vr.receiveItemsFromVendor(client, {
          dcNumber,
          receiveItems: [{
            ticket_id: laptop.ticketId,
            receive_mode: 'repaired',
            verified_serial: laptop.serialNumber,
            wh_esign: ESIGN,
            wh_signer_name: ACTOR.name,
          }],
          actorUserId: ACTOR.user_id,
          actorName: ACTOR.name,
        }),
        /Guard has not passed/i
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('8. ON receive throws until the capture script verifies specs and serial', async () => {
    const laptop = await insertLaptop({ suffix: `${Date.now()}8` });
    const { dcNumber } = await createSignedDc(laptop);
    await pool.query(
      `UPDATE vendor_repair_delivery_challans SET status = 'dispatched', dispatched_at = NOW() WHERE dc_number = $1`,
      [dcNumber]
    );
    await pool.query(
      `UPDATE vendor_repair_dc_items
          SET item_status = 'gate_received', gate_inward_at = NOW(), return_config_verified_at = NULL
        WHERE dc_number = $1`,
      [dcNumber]
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assert.rejects(
        () => vr.receiveItemsFromVendor(client, {
          dcNumber,
          receiveItems: [{
            ticket_id: laptop.ticketId,
            receive_mode: 'repaired',
            laptop_condition: 'on',
            wh_esign: ESIGN,
            wh_signer_name: ACTOR.name,
          }],
          actorUserId: ACTOR.user_id,
          actorName: ACTOR.name,
        }),
        /Configuration check has not passed/i
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('9. after a passing capture, receive succeeds and serial returns to in_stock', async () => {
    const laptop = await insertLaptop({ suffix: `${Date.now()}9` });
    const { dcNumber } = await createSignedDc(laptop);
    await confirmOutward(dcNumber);
    const opened = await gate.resolveScan({ direction: 'inward', scan: dcNumber, user: ACTOR });
    await gate.confirmSession({ sessionId: opened.session_id, remarks: 'in', user: ACTOR });
    const tok = await pool.query(
      `SELECT token_id, receive_dc_number FROM vendor_return_capture_tokens
        WHERE dc_number = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
      [dcNumber]
    );
    created.receiveNumbers.push(tok.rows[0].receive_dc_number);
    const verified = await capture.verifyVendorReturnConfiguration(tok.rows[0].token_id, {
      manufacturer: 'Dell',
      model: 'Latitude 5420',
      processor: 'i5-1135G7',
      generation: '11',
      ram: '8',
      ssd: '256',
      gpu: 'Intel Iris Xe',
    }, '127.0.0.1');
    assert.equal(verified.configurationMatched, true, JSON.stringify(verified.errors || []));
    const serialSubmit = await capture.submitVendorReturnSerial(tok.rows[0].token_id, laptop.serialNumber);
    assert.equal(serialSubmit.ok, true, serialSubmit.message);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const received = await vr.receiveItemsFromVendor(client, {
        dcNumber,
        receiveItems: [{
          ticket_id: laptop.ticketId,
          receive_mode: 'repaired',
          laptop_condition: 'on',
          wh_esign: ESIGN,
          wh_signer_name: ACTOR.name,
        }],
        actorUserId: ACTOR.user_id,
        actorName: ACTOR.name,
      });
      await client.query('COMMIT');
      assert.equal(received.status, 'returned');
    } finally {
      client.release();
    }
    const serial = await pool.query(
      `SELECT inventory_status, qc_status FROM vendor_serial_numbers WHERE serial_id = $1`,
      [laptop.serialId]
    );
    const ticket = await pool.query(
      `SELECT status, current_stage_id FROM tickets WHERE ticket_id = $1`,
      [laptop.ticketId]
    );
    assert.equal(serial.rows[0].inventory_status, 'in_stock');
    assert.equal(serial.rows[0].qc_status, 'pending');
    assert.equal(ticket.rows[0].status, 'in_progress');
    assert.equal(ticket.rows[0].current_stage_id, 1);
  });

  it('10. gate_legacy = TRUE bypasses both new preconditions', async () => {
    const laptop = await insertLaptop({ suffix: `${Date.now()}0` });
    const { dcNumber } = await createSignedDc(laptop);
    await pool.query(
      `UPDATE vendor_repair_delivery_challans
          SET status = 'dispatched', dispatched_at = NOW(), gate_legacy = TRUE
        WHERE dc_number = $1`,
      [dcNumber]
    );
    await pool.query(
      `UPDATE vendor_repair_dc_items SET item_status = 'dispatched', gate_inward_at = NULL, return_config_verified_at = NULL
        WHERE dc_number = $1`,
      [dcNumber]
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const received = await vr.receiveItemsFromVendor(client, {
        dcNumber,
        receiveItems: [{
          ticket_id: laptop.ticketId,
          receive_mode: 'repaired',
          verified_serial: laptop.serialNumber,
          wh_esign: ESIGN,
          wh_signer_name: ACTOR.name,
        }],
        actorUserId: ACTOR.user_id,
        actorName: ACTOR.name,
      });
      await client.query('COMMIT');
      assert.equal(received.status, 'returned');
      if (received.receive_dc_number) created.receiveNumbers.push(received.receive_dc_number);
    } finally {
      client.release();
    }
  });

  it('12. Not ON receive skips config capture and stamps received_condition', async () => {
    const laptop = await insertLaptop({ suffix: `${Date.now()}2` });
    const { dcNumber } = await createSignedDc(laptop);
    await pool.query(
      `UPDATE vendor_repair_delivery_challans SET status = 'dispatched', dispatched_at = NOW() WHERE dc_number = $1`,
      [dcNumber]
    );
    await pool.query(
      `UPDATE vendor_repair_dc_items
          SET item_status = 'gate_received', gate_inward_at = NOW(), return_config_verified_at = NULL
        WHERE dc_number = $1`,
      [dcNumber]
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const received = await vr.receiveItemsFromVendor(client, {
        dcNumber,
        receiveItems: [{
          ticket_id: laptop.ticketId,
          receive_mode: 'repaired',
          laptop_condition: 'not_on',
          verified_serial: laptop.serialNumber,
          wh_esign: ESIGN,
          wh_signer_name: ACTOR.name,
        }],
        actorUserId: ACTOR.user_id,
        actorName: ACTOR.name,
      });
      await client.query('COMMIT');
      assert.equal(received.status, 'returned');
      if (received.receive_dc_number) created.receiveNumbers.push(received.receive_dc_number);
    } finally {
      client.release();
    }
    const ticket = await pool.query(
      `SELECT received_condition, highlighted_reason FROM tickets WHERE ticket_id = $1`,
      [laptop.ticketId]
    );
    const item = await pool.query(
      `SELECT receive_laptop_condition FROM vendor_repair_dc_items WHERE dc_number = $1`,
      [dcNumber]
    );
    assert.equal(ticket.rows[0].received_condition, 'not_on');
    assert.match(String(ticket.rows[0].highlighted_reason || ''), /NOT ON/i);
    assert.equal(item.rows[0].receive_laptop_condition, 'not_on');
  });

  it('13. Not ON still requires a typed serial that matches', async () => {
    const laptop = await insertLaptop({ suffix: `${Date.now()}3` });
    const { dcNumber } = await createSignedDc(laptop);
    await pool.query(
      `UPDATE vendor_repair_delivery_challans SET status = 'dispatched', dispatched_at = NOW() WHERE dc_number = $1`,
      [dcNumber]
    );
    await pool.query(
      `UPDATE vendor_repair_dc_items
          SET item_status = 'gate_received', gate_inward_at = NOW()
        WHERE dc_number = $1`,
      [dcNumber]
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assert.rejects(
        () => vr.receiveItemsFromVendor(client, {
          dcNumber,
          receiveItems: [{
            ticket_id: laptop.ticketId,
            receive_mode: 'repaired',
            laptop_condition: 'not_on',
            verified_serial: '',
            wh_esign: ESIGN,
            wh_signer_name: ACTOR.name,
          }],
          actorUserId: ACTOR.user_id,
          actorName: ACTOR.name,
        }),
        /Serial verification failed/i
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('14. super_admin bypass skips gate inward and config check', async () => {
    const laptop = await insertLaptop({ suffix: `${Date.now()}4` });
    const { dcNumber } = await createSignedDc(laptop);
    await pool.query(
      `UPDATE vendor_repair_delivery_challans SET status = 'dispatched', dispatched_at = NOW() WHERE dc_number = $1`,
      [dcNumber]
    );
    await pool.query(
      `UPDATE vendor_repair_dc_items
          SET item_status = 'dispatched', gate_inward_at = NULL, return_config_verified_at = NULL
        WHERE dc_number = $1`,
      [dcNumber]
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assert.rejects(
        () => vr.receiveItemsFromVendor(client, {
          dcNumber,
          receiveItems: [{
            ticket_id: laptop.ticketId,
            receive_mode: 'repaired',
            laptop_condition: 'on',
            bypass_gate_flow: true,
            verified_serial: laptop.serialNumber,
            wh_esign: ESIGN,
            wh_signer_name: ACTOR.name,
          }],
          actorUserId: ACTOR.user_id,
          actorName: ACTOR.name,
          actorRole: 'admin',
          bypassGateFlow: true,
        }),
        /Guard has not passed/i
      );
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      const received = await vr.receiveItemsFromVendor(client, {
        dcNumber,
        receiveItems: [{
          ticket_id: laptop.ticketId,
          receive_mode: 'repaired',
          laptop_condition: 'on',
          bypass_gate_flow: true,
          verified_serial: laptop.serialNumber,
          wh_esign: ESIGN,
          wh_signer_name: ACTOR.name,
        }],
        actorUserId: ACTOR.user_id,
        actorName: ACTOR.name,
        actorRole: 'super_admin',
        bypassGateFlow: true,
      });
      await client.query('COMMIT');
      assert.equal(received.status, 'returned');
      if (received.receive_dc_number) created.receiveNumbers.push(received.receive_dc_number);
    } finally {
      client.release();
    }
  });

  it('11. a part-domain DC is not picked up by any laptop gate branch', async () => {
    const dcNumber = `VRDC/26-27/PARTGATE${Date.now() % 10000}`;
    await pool.query(
      `INSERT INTO vendor_repair_delivery_challans
         (dc_number, vendor_name, status, item_domain, vendor_address, shipping_address)
       VALUES ($1, 'Part Vendor', 'dispatch_ready', 'part', 'x', 'y')`,
      [dcNumber]
    );
    created.dcNumbers.push(dcNumber);
    const resolved = await gate.resolveScan({ direction: 'outward', scan: dcNumber, user: ACTOR });
    assert.equal(resolved.valid, false);
    assert.match(String(resolved.message || ''), /No VRDC found|not expected|not recognised|could not be found/i);
  });
});
