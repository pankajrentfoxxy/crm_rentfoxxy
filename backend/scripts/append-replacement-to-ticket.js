#!/usr/bin/env node
/**
 * Append eligible complaint items to an existing support replacement SO + Return DC.
 * Usage: node scripts/append-replacement-to-ticket.js <ticketId> [sourceItemId ...]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const pool = require('../config/db');
const replacementFlow = require('../services/supportReplacementFlowService');

const USER_ID = parseInt(process.env.SUPPORT_SCRIPT_USER_ID || '14', 10);

function parseAddressJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function appendMachinesToReturnDc(client, ticket, ticketId, userId, opts) {
  const {
    return_dc_number: returnDcNumber,
    pickup_type,
    pickup_address,
    machines: machinesRaw,
    remarks: remarksOpt,
  } = opts;

  const rdc = String(returnDcNumber || ticket.return_dc_number || '').trim();
  if (!rdc) throw new Error('Return DC number is required');

  const machines = (Array.isArray(machinesRaw) ? machinesRaw : [])
    .filter((m) => m.serial_number || m.ttspl_id || m.unique_serial_number);
  if (!machines.length) throw new Error('No machines to append');

  for (const m of machines) {
    if (!m.source_item_id) continue;
    const linked = await client.query(
      `SELECT id FROM support_ticket_items
        WHERE source_item_id = $1 AND item_type = 'pickup'
          AND status NOT IN ('resolved', 'closed', 'inventory_updated')
        LIMIT 1`,
      [m.source_item_id]
    );
    if (linked.rows.length) {
      throw new Error(`Pickup already exists for source item ${m.source_item_id}`);
    }
  }

  const dclRes = await client.query(
    `SELECT dc_number, serial_number, quantity, remarks, dispatch_mode, delivery_person_id, status
       FROM delivery_challan_lines
      WHERE dc_number = $1 AND movement_type = 'return'
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE`,
    [rdc]
  );
  if (!dclRes.rows.length) throw new Error(`Return DC ${rdc} not found`);
  const dcl = dclRes.rows[0];

  const existingPickupRes = await client.query(
    `SELECT pickup_method, assigned_to, pickup_courier_name, pickup_awb,
            porter_tracking_id, porter_order_id, status
       FROM support_ticket_items
      WHERE ticket_id = $1 AND return_dc_number = $2 AND item_type = 'pickup'
      ORDER BY id ASC
      LIMIT 1`,
    [ticketId, rdc]
  );
  const existingPickup = existingPickupRes.rows[0] || null;

  let pickupAddr = pickup_address || parseAddressJson(ticket.pickup_address);
  if (pickupAddr) pickupAddr = parseAddressJson(pickupAddr);

  const inheritedDispatch = existingPickup?.pickup_method || dcl.dispatch_mode;
  const resolvedDispatch = inheritedDispatch === 'inhouse' ? 'technician' : inheritedDispatch;
  const hasDispatch = ['technician', 'courier', 'porter'].includes(String(resolvedDispatch || ''))
    || (existingPickup && ['assigned', 'in_transit', 'picked_up'].includes(existingPickup.status));
  const techId = hasDispatch
    ? (existingPickup?.assigned_to || dcl.delivery_person_id || null)
    : null;
  const pickupStatus = hasDispatch ? (existingPickup?.status === 'assigned' ? 'assigned' : 'pending_dispatch') : 'pending_dispatch';
  const customerOtp = generateOtp();
  const pickupItemIds = [];

  for (const m of machines) {
    const insertRes = await client.query(
      `INSERT INTO support_ticket_items
          (ticket_id, customer_inventory_id, serial_number, unique_serial_number,
           ttspl_id, brand, model, ram, storage, generation,
           item_type, pickup_type, status, source_item_id,
           assigned_to, pickup_method, pickup_assigned_to, pickup_courier_name, pickup_awb,
           porter_tracking_id, porter_order_id,
           otp_code, customer_otp_code, customer_otp_sent_at, return_dc_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
               'pickup',$11,$12,$13,
               $14,$15,$14,$16,$17,$18,$19,
               $20,$20,NOW(),$21)
       RETURNING id`,
      [
        ticketId, m.customer_inventory_id, m.serial_number, m.ttspl_id || m.unique_serial_number,
        m.ttspl_id || m.unique_serial_number, m.brand, m.model, m.ram, m.storage, m.generation,
        pickup_type, pickupStatus, m.source_item_id,
        techId, hasDispatch ? resolvedDispatch : null,
        hasDispatch && resolvedDispatch === 'courier' ? (existingPickup?.pickup_courier_name || null) : null,
        hasDispatch && resolvedDispatch === 'courier' ? (existingPickup?.pickup_awb || null) : null,
        hasDispatch && resolvedDispatch === 'porter' ? (existingPickup?.porter_tracking_id || null) : null,
        hasDispatch && resolvedDispatch === 'porter' ? (existingPickup?.porter_order_id || null) : null,
        customerOtp,
        rdc,
      ]
    );
    pickupItemIds.push(insertRes.rows[0].id);
  }

  const entries = [];
  let rawSerial = dcl.serial_number;
  if (typeof rawSerial === 'string') {
    try { rawSerial = JSON.parse(rawSerial); } catch { rawSerial = [rawSerial]; }
  }
  if (Array.isArray(rawSerial)) entries.push(...rawSerial.filter(Boolean));

  for (const m of machines) {
    const serialCode = m.ttspl_id || m.unique_serial_number || m.serial_number;
    if (!serialCode) continue;
    const vsnRes = await client.query(
      `SELECT serial_id, serial_number, inventory_asset_code
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND (inventory_asset_code = $1 OR serial_number = $1 OR extra->>'ttspl_id' = $1)
        LIMIT 1`,
      [serialCode]
    );
    const vsn = vsnRes.rows[0];
    if (vsn) {
      entries.push(`${vsn.serial_id}|${vsn.serial_number}|${vsn.inventory_asset_code || serialCode}`);
    } else {
      entries.push(`|${serialCode}|${serialCode}`);
    }
  }

  const dcRemarks = remarksOpt != null && String(remarksOpt).trim()
    ? String(remarksOpt).trim()
    : replacementFlow.buildReplacementRdcRemarks(machines);

  await client.query(
    `UPDATE delivery_challan_lines
        SET serial_number = $2::jsonb,
            quantity = $3,
            remarks = $4,
            updated_at = NOW()
      WHERE dc_number = $1 AND movement_type = 'return'`,
    [rdc, JSON.stringify(entries), Math.max(1, entries.length), dcRemarks]
  );

  if (pickupAddr && Object.keys(pickupAddr).length) {
    await client.query(
      'UPDATE support_tickets SET pickup_address = $1::jsonb, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(pickupAddr), ticketId]
    );
  }

  return { pickupItemIds, rdc, machines };
}

async function main() {
  const ticketId = parseInt(process.argv[2], 10);
  const sourceIdsArg = process.argv.slice(3).map((id) => parseInt(id, 10)).filter((n) => Number.isFinite(n) && n > 0);

  if (!Number.isFinite(ticketId)) {
    console.error('Usage: node scripts/append-replacement-to-ticket.js <ticketId> [sourceItemId ...]');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ticketRes = await client.query('SELECT * FROM support_tickets WHERE id = $1 FOR UPDATE', [ticketId]);
    if (!ticketRes.rows.length) throw new Error(`Ticket ${ticketId} not found`);
    const ticket = ticketRes.rows[0];

    if (!ticket.return_dc_number || !ticket.sales_order_number) {
      throw new Error('Ticket has no existing replacement SO + Return DC — use Initiate replacement in CRM');
    }

    const outboundDc = await client.query(
      `SELECT dc_number FROM delivery_challan_lines
        WHERE sales_order_number = $1 AND movement_type = 'outbound'
          AND COALESCE(status, '') NOT IN ('cancelled')
        LIMIT 1`,
      [ticket.sales_order_number]
    );
    if (outboundDc.rows.length) {
      throw new Error(`Outbound DC ${outboundDc.rows[0].dc_number} already exists — cannot append`);
    }

    let sourceItems;
    if (sourceIdsArg.length) {
      const srcRes = await client.query(
        `SELECT * FROM support_ticket_items
          WHERE ticket_id = $1 AND id = ANY($2::int[]) AND item_type = 'complaint'`,
        [ticketId, sourceIdsArg]
      );
      sourceItems = srcRes.rows;
    } else {
      sourceItems = await replacementFlow.listEligibleComplaintItems(client, ticketId);
    }

    if (!sourceItems.length) {
      throw new Error('No eligible complaint items to append');
    }

    for (const src of sourceItems) {
      const dup = await client.query(
        `SELECT id FROM support_replacement_orders
          WHERE source_item_id = $1 AND status NOT IN ('completed','cancelled') LIMIT 1`,
        [src.id]
      );
      if (dup.rows.length) {
        throw new Error(`Replacement already exists for item ${src.id}`);
      }
    }

    const defaults = await replacementFlow.loadDeliveryDefaults(client, ticket, sourceItems[0]);
    const shippingAddress = {
      name: defaults.contact_name || ticket.customer_name || '',
      phone: defaults.contact_phone || '',
      address: defaults.address || '',
      city: defaults.city || '',
      state: defaults.state || '',
      pincode: defaults.pincode || '',
    };
    if (!String(shippingAddress.address || '').trim()) {
      const pa = parseAddressJson(ticket.pickup_address);
      Object.assign(shippingAddress, {
        name: pa.name || shippingAddress.name,
        phone: pa.phone || shippingAddress.phone,
        address: pa.address || shippingAddress.address,
        city: pa.city || shippingAddress.city,
        state: pa.state || shippingAddress.state,
        pincode: pa.pincode || shippingAddress.pincode,
      });
    }

    const custRes = await client.query(
      `SELECT customer_id, name, company_name, email, phone, gst_no, billing_state,
              billing_address, billing_city, billing_pincode
         FROM customers WHERE customer_id = $1`,
      [ticket.customer_id]
    );
    const cust = custRes.rows[0] || {};
    const customerName = ticket.customer_name || cust.company_name || cust.name || '';
    const billingAddress = {
      name: customerName,
      phone: cust.phone || shippingAddress.phone,
      address: cust.billing_address || shippingAddress.address,
      city: cust.billing_city || shippingAddress.city,
      state: cust.billing_state || shippingAddress.state,
      pincode: cust.billing_pincode || shippingAddress.pincode,
      gst_number: cust.gst_no || null,
    };

    const lineConfigs = [];
    for (const src of sourceItems) {
      lineConfigs.push(await replacementFlow.resolveConfigFromComplaint(client, src, ticket.customer_id));
    }

    const { salesOrderNumber, lineIds } = await replacementFlow.appendConfigSalesOrderLines(client, {
      salesOrderNumber: ticket.sales_order_number,
      customerId: ticket.customer_id,
      customerName,
      customerEmail: ticket.ticket_email || cust.email,
      customerMobile: shippingAddress.phone || cust.phone,
      shippingAddress,
      billingAddress,
      gstNumber: cust.gst_no,
      supplyState: cust.billing_state,
      lineConfigs,
      userId: USER_ID,
    });

    const replacementOrderIds = [];
    for (let i = 0; i < sourceItems.length; i += 1) {
      const src = sourceItems[i];
      const cfg = lineConfigs[i];
      const lineId = lineIds[i];
      const sharedReason = src.replacement_flag_reason || 'Replacement required';

      const itemIns = await client.query(
        `INSERT INTO support_ticket_items (
            ticket_id, brand, model, processor, generation, ram, storage,
            item_type, remarks, status, source_item_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'replacement',$8,'order_placed',$9) RETURNING id`,
        [
          ticketId, cfg.brand, cfg.model, cfg.processor, cfg.generation, cfg.ram, cfg.storage,
          sharedReason, src.id,
        ]
      );
      const replacementItemId = itemIns.rows[0].id;

      const orderIns = await client.query(
        `INSERT INTO support_replacement_orders (
            ticket_id, item_id, source_item_id, complaint_item_id,
            sales_order_number, sales_order_line_id,
            old_customer_inventory_id, old_machine_serial,
            old_serial_id, old_rent_monthly_rate,
            delivery_address, contact_name, contact_phone,
            status, created_by, notes, approved_at
        ) VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,'order_placed',$13,$14,CURRENT_TIMESTAMP)
        RETURNING id`,
        [
          ticketId, replacementItemId, src.id,
          salesOrderNumber, lineId,
          cfg.old_customer_inventory_id, cfg.old_machine_serial, cfg.old_serial_id,
          cfg.monthly_rate || null,
          JSON.stringify(shippingAddress), shippingAddress.name, shippingAddress.phone,
          USER_ID, sharedReason,
        ]
      );
      replacementOrderIds.push(orderIns.rows[0].id);

      await client.query(
        `UPDATE support_ticket_items SET replacement_approved_by = $2, replacement_approved_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [src.id, USER_ID]
      );
    }

    const machines = sourceItems.map((src) => ({
      source_item_id: src.id,
      serial_number: src.serial_number,
      unique_serial_number: src.ttspl_id || src.unique_serial_number,
      ttspl_id: src.ttspl_id || src.unique_serial_number,
      brand: src.brand,
      model: src.model,
      ram: src.ram,
      storage: src.storage,
      generation: src.generation,
      customer_inventory_id: src.customer_inventory_id,
    }));

    const pickupResult = await appendMachinesToReturnDc(client, ticket, ticketId, USER_ID, {
      return_dc_number: ticket.return_dc_number,
      pickup_type: 'return',
      pickup_address: shippingAddress,
      machines,
      remarks: replacementFlow.buildReplacementRdcRemarks(machines),
    });

    for (let i = 0; i < replacementOrderIds.length; i += 1) {
      await client.query(
        `UPDATE support_replacement_orders SET return_dc_number = $2, pickup_item_id = $3 WHERE id = $1`,
        [replacementOrderIds[i], pickupResult.rdc, pickupResult.pickupItemIds[i]]
      );
    }

    await client.query('COMMIT');

    console.log(JSON.stringify({
      ticket_id: ticketId,
      sales_order_number: salesOrderNumber,
      return_dc_number: pickupResult.rdc,
      appended_items: sourceItems.map((s) => ({ id: s.id, ttspl: s.ttspl_id, serial: s.serial_number })),
      replacement_order_ids: replacementOrderIds,
      pickup_item_ids: pickupResult.pickupItemIds,
      so_line_ids: lineIds,
    }, null, 2));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err.message || err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
