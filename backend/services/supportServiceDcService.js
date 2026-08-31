/**
 * Service Delivery Challan (SDC) — send the same repaired unit back to the customer
 * from a support pickup/repair ticket without creating a new Sales Order.
 */
const { resolveHsnForPersist } = require('../constants/hsnDefaults');
const { resolveTxnTypeForDc } = require('../utils/hsnDocResolve');
const inventorySM = require('./inventoryStateMachine');
const {
  nextFinancialYearNumber,
  entityForQuotationType,
} = require('./salesManagementService');
const { loadDeliveryDefaults } = require('./supportReplacementFlowService');

const DC_PURPOSE = 'service_return';
const OPEN_SDC_STATUSES = new Set([
  'pending', 'processing', 'dispatch_ready', 'in_transit', 'shipped', 'reached',
]);

function sdcStatusRank(status) {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'cancelled') return -1;
  if (s === 'rejected') return 50;
  if (s === 'delivered') return 40;
  if (['in_transit', 'shipped', 'reached'].includes(s)) return 30;
  if (s === 'dispatch_ready') return 20;
  if (s === 'processing') return 15;
  return 10;
}

function buildSdcTracking(sdc, extras = {}) {
  const status = String(sdc.status || 'pending').toLowerCase();
  const rank = sdcStatusRank(status);
  const outwardAt = sdc.dispatched_at || extras.gateAt || null;
  const outwardBy = extras.gateName || null;
  const readyAt = extras.dispatchReadyAt || (status === 'dispatch_ready' ? sdc.updated_at : null);

  const steps = [
    {
      key: 'created',
      label: 'SDC created',
      done: status !== 'cancelled' || Boolean(sdc.created_at),
      current: rank < 20 && status !== 'cancelled' && status !== 'rejected',
      at: sdc.created_at || null,
      by: sdc.created_by_name || null,
    },
    {
      key: 'dispatch_ready',
      label: 'Dispatch ready',
      done: rank >= 20,
      current: status === 'dispatch_ready',
      at: rank >= 20 ? readyAt : null,
      by: null,
    },
    {
      key: 'outward',
      label: 'Outward (gate)',
      done: rank >= 30 || Boolean(outwardAt),
      current: false,
      at: outwardAt,
      by: outwardBy,
    },
    {
      key: 'in_transit',
      label: 'In transit',
      done: rank >= 30,
      current: ['in_transit', 'shipped', 'reached'].includes(status),
      at: outwardAt,
      by: null,
    },
    {
      key: 'delivered',
      label: 'Delivered',
      done: status === 'delivered',
      current: status === 'delivered',
      at: sdc.delivered_at || null,
      by: null,
    },
  ];
  if (status === 'rejected') {
    steps.push({
      key: 'rejected',
      label: 'Rejected',
      done: true,
      current: true,
      at: sdc.updated_at || null,
      by: null,
    });
    const delivered = steps.find((s) => s.key === 'delivered');
    if (delivered) delivered.current = false;
  }
  if (status === 'cancelled') {
    steps[0].current = false;
    steps[0].done = Boolean(sdc.created_at);
    steps.push({
      key: 'cancelled',
      label: 'Cancelled',
      done: true,
      current: true,
      at: sdc.updated_at || null,
      by: null,
    });
  }

  const current = steps.find((s) => s.current) || [...steps].reverse().find((s) => s.done) || steps[0];
  return {
    dc_number: sdc.dc_number,
    status,
    current_step: current?.key || 'created',
    steps,
    dispatch_mode: sdc.dispatch_mode || sdc.ship_by || null,
    courier_name: sdc.courier_name || null,
    awb_number: sdc.awb_number || null,
    porter_tracking_id: sdc.porter_tracking_id || null,
    porter_order_id: sdc.porter_order_id || null,
    courier_tracking_url: sdc.courier_tracking_url || null,
    pdf_path: sdc.pdf_path || null,
    sales_order_number: sdc.sales_order_number || null,
    original_dc_number: sdc.original_dc_number || null,
    dc_purpose: sdc.dc_purpose || DC_PURPOSE,
    created_at: sdc.created_at || null,
    dispatched_at: outwardAt,
    delivered_at: sdc.delivered_at || null,
    created_by_name: sdc.created_by_name || null,
    guard_name: outwardBy,
  };
}

async function loadSdcTrackingExtras(db, dcNumbers) {
  const extras = new Map();
  if (!dcNumbers.length) return extras;
  for (const n of dcNumbers) extras.set(n, {});

  try {
    const gate = await db.query(
      `SELECT DISTINCT ON (reference_number)
              reference_number, confirmed_at, guard_name
         FROM gate_movements
        WHERE direction = 'outward'
          AND reference_type IN ('sdc', 'dc')
          AND reference_number = ANY($1::text[])
          AND validation_result = 'valid'
          AND confirmed_at IS NOT NULL
        ORDER BY reference_number, confirmed_at ASC`,
      [dcNumbers]
    );
    for (const row of gate.rows) {
      extras.get(row.reference_number).gateAt = row.confirmed_at;
      extras.get(row.reference_number).gateName = row.guard_name || null;
    }
  } catch (_) { /* gate tables may not exist on older DBs */ }

  try {
    const sess = await db.query(
      `SELECT DISTINCT ON (reference_number)
              reference_number, confirmed_at
         FROM gate_scan_sessions
        WHERE direction = 'outward'
          AND reference_type IN ('sdc', 'dc')
          AND reference_number = ANY($1::text[])
          AND status = 'confirmed'
          AND confirmed_at IS NOT NULL
        ORDER BY reference_number, confirmed_at ASC`,
      [dcNumbers]
    );
    for (const row of sess.rows) {
      const slot = extras.get(row.reference_number);
      if (slot && !slot.gateAt) slot.gateAt = row.confirmed_at;
    }
  } catch (_) { /* ignore */ }

  try {
    const ready = await db.query(
      `SELECT DISTINCT ON (dc_number) dc_number, created_at
         FROM inventory_status_transitions
        WHERE dc_number = ANY($1::text[])
          AND to_status = 'dispatch_ready'
        ORDER BY dc_number, created_at ASC`,
      [dcNumbers]
    );
    for (const row of ready.rows) {
      extras.get(row.dc_number).dispatchReadyAt = row.created_at;
    }
  } catch (_) { /* ignore */ }

  return extras;
}

async function logServiceDcAudit(db, { itemId, ticketId, userId, action, detail }) {
  await db.query(
    `INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [itemId ?? null, ticketId, userId ?? null, action, detail ? JSON.stringify(detail) : null]
  );
}

const parseJson = (raw) => {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
};

const normalizeDispatch = (body = {}) => {
  const dispatchMode = String(body.dispatch_mode || '').trim();
  const hasDispatch = ['technician', 'courier', 'porter'].includes(dispatchMode);
  const techId = hasDispatch && dispatchMode === 'technician' && body.technician_user_id
    ? parseInt(body.technician_user_id, 10)
    : null;
  const dcDispatchMode = hasDispatch
    ? (dispatchMode === 'technician' ? 'inhouse' : dispatchMode)
    : null;
  return {
    dispatchMode,
    hasDispatch,
    techId,
    dcDispatchMode,
    courierName: hasDispatch && dispatchMode === 'courier' ? (body.courier_name || null) : null,
    awbNumber: hasDispatch && dispatchMode === 'courier' ? (body.awb_number || null) : null,
    porterTrackingId: hasDispatch && dispatchMode === 'porter' ? (body.porter_tracking_id || null) : null,
    porterOrderId: hasDispatch && dispatchMode === 'porter' ? (body.porter_order_id || null) : null,
    remarks: body.remarks != null ? String(body.remarks).trim() || null : null,
  };
};

async function resolveSerialForPickupItem(db, item) {
  const code = item.ttspl_id || item.unique_serial_number || item.serial_number;
  if (!code) return null;
  const r = await db.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status,
            rent_start_date, rent_end_date, rent_monthly_rate, rent_billed_until,
            current_customer_id, extra
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (
          inventory_asset_code = $1
          OR serial_number = $1
          OR extra->>'ttspl_id' = $1
        )
      ORDER BY
        CASE WHEN inventory_asset_code = $1 THEN 0 ELSE 1 END,
        serial_id ASC
      LIMIT 1`,
    [code]
  );
  return r.rows[0] || null;
}

async function loadOpenSdc(db, sdcNumber) {
  if (!sdcNumber) return null;
  const r = await db.query(
    `SELECT dc_number, status, dc_purpose, movement_type, support_ticket_id
       FROM delivery_challan_lines
      WHERE dc_number = $1
        AND movement_type = 'outbound'
        AND dc_purpose = $2
      LIMIT 1`,
    [sdcNumber, DC_PURPOSE]
  );
  return r.rows[0] || null;
}

function isRepairPickupItem(item) {
  const pickupType = item.pickup_type || (item.source_item_id ? 'repair' : 'return');
  return item.item_type === 'pickup' && pickupType === 'repair';
}

async function assertTicketRepairContext(db, ticket) {
  const categoryOk = ['pickup', 'repair'].includes(String(ticket.ticket_category || '').toLowerCase())
    || ['pickup', 'repair'].includes(String(ticket.complaint_type || '').toLowerCase());
  if (categoryOk) return;
  const r = await db.query(
    `SELECT 1 FROM support_ticket_items
      WHERE ticket_id = $1 AND item_type = 'pickup'
        AND warehouse_received_at IS NOT NULL
        AND COALESCE(pickup_type, CASE WHEN source_item_id IS NOT NULL THEN 'repair' END) = 'repair'
      LIMIT 1`,
    [ticket.id]
  );
  if (!r.rows.length) {
    throw Object.assign(new Error('Service Delivery Challan is only for repair pickup tickets'), { status: 400 });
  }
}

async function evaluatePickupItemEligibility(db, item, ticket) {
  const reasons = [];
  if (!isRepairPickupItem(item)) reasons.push('not a repair pickup item');
  if (!item.warehouse_received_at) reasons.push('warehouse receipt pending');
  if (!item.return_dc_number) reasons.push('return pickup not completed');
  if (item.service_dc_number) {
    const open = await loadOpenSdc(db, item.service_dc_number);
    if (open && OPEN_SDC_STATUSES.has(String(open.status || 'pending').toLowerCase())) {
      reasons.push(`open SDC ${item.service_dc_number} already exists`);
    }
    if (open && String(open.status || '').toLowerCase() === 'delivered') {
      reasons.push(`already delivered via ${item.service_dc_number}`);
    }
  }
  const serial = await resolveSerialForPickupItem(db, item);
  if (!serial) reasons.push('serial not found in inventory');
  else if (serial.inventory_status !== inventorySM.STATUS.IN_STOCK) {
    reasons.push(`serial must be in stock (current: ${serial.inventory_status || 'unknown'})`);
  }
  return {
    item,
    serial,
    eligible: reasons.length === 0,
    reasons,
    ticket,
  };
}

async function listEligibleItems(db, ticketId, itemIds = null) {
  const ticketRes = await db.query('SELECT * FROM support_tickets WHERE id = $1', [ticketId]);
  if (!ticketRes.rows.length) {
    throw Object.assign(new Error('Ticket not found'), { status: 404 });
  }
  const ticket = ticketRes.rows[0];
  await assertTicketRepairContext(db, ticket);

  let sql = `
    SELECT sti.*
      FROM support_ticket_items sti
     WHERE sti.ticket_id = $1
       AND sti.item_type = 'pickup'
       AND sti.warehouse_received_at IS NOT NULL
       AND COALESCE(sti.pickup_type, CASE WHEN sti.source_item_id IS NOT NULL THEN 'repair' END) = 'repair'
  `;
  const params = [ticketId];
  if (itemIds?.length) {
    params.push(itemIds.map((id) => parseInt(id, 10)).filter(Boolean));
    sql += ` AND sti.id = ANY($2::int[])`;
  }
  sql += ' ORDER BY sti.id ASC';
  const itemsRes = await db.query(sql, params);
  const evaluated = [];
  for (const item of itemsRes.rows) {
    evaluated.push(await evaluatePickupItemEligibility(db, item, ticket));
  }
  return { ticket, items: evaluated };
}

async function getServiceDcContext(db, ticketId) {
  const { ticket, items } = await listEligibleItems(db, ticketId);
  const sdcRes = await db.query(
    `SELECT dcl.dc_number, dcl.status, dcl.dc_purpose, dcl.pdf_path,
            dcl.sales_order_number, dcl.original_dc_number,
            dcl.dispatch_mode, dcl.ship_by, dcl.courier_name, dcl.awb_number,
            dcl.porter_tracking_id, dcl.porter_order_id, dcl.courier_tracking_url,
            dcl.created_at, dcl.updated_at, dcl.dispatched_at, dcl.delivered_at,
            u.name AS created_by_name
       FROM delivery_challan_lines dcl
       LEFT JOIN users u ON u.user_id = dcl.created_by
      WHERE (
            dcl.support_ticket_id = $1
            OR dcl.dc_number IN (
              SELECT sti.service_dc_number
                FROM support_ticket_items sti
               WHERE sti.ticket_id = $1
                 AND sti.service_dc_number IS NOT NULL
            )
          )
        AND dcl.movement_type = 'outbound'
        AND dcl.dc_purpose = $2
      ORDER BY dcl.id DESC`,
    [ticketId, DC_PURPOSE]
  );
  const extras = await loadSdcTrackingExtras(db, sdcRes.rows.map((r) => r.dc_number));
  const serviceDcs = sdcRes.rows.map((row) => buildSdcTracking(row, extras.get(row.dc_number) || {}));
  const deliveryDefaults = await loadDeliveryDefaults(db, ticket, items[0]?.item || null);
  return {
    ticket_id: ticket.id,
    eligible_items: items.map((row) => ({
      id: row.item.id,
      ttspl_id: row.item.ttspl_id || row.item.unique_serial_number,
      serial_number: row.item.serial_number,
      eligible: row.eligible,
      reasons: row.reasons,
      inventory_status: row.serial?.inventory_status || null,
      service_dc_number: row.item.service_dc_number || null,
    })),
    can_create: items.some((row) => row.eligible),
    service_dcs: serviceDcs,
    delivery_defaults: deliveryDefaults,
    ticket_service_dc_number: ticket.service_dc_number || null,
  };
}

async function resolveOriginalReferences(db, ticket, items, deliveryDefaults) {
  let originalDcNumber = deliveryDefaults.original_dc_number || ticket.dc_number || null;
  let salesOrderNumber = deliveryDefaults.sales_order_number || ticket.sales_order_number || null;
  for (const row of items) {
    const code = row.item.ttspl_id || row.item.unique_serial_number || row.item.serial_number;
    if (!code) continue;
    const outRes = await db.query(
      `SELECT dc_number, sales_order_number
         FROM delivery_challan_lines
        WHERE movement_type = 'outbound'
          AND COALESCE(dc_purpose, 'standard') NOT IN ('replacement')
          AND customer_id = $1
          AND serial_number::text ILIKE '%' || $2 || '%'
        ORDER BY created_at DESC NULLS LAST
        LIMIT 1`,
      [ticket.customer_id, code]
    );
    if (outRes.rows.length) {
      originalDcNumber = originalDcNumber || outRes.rows[0].dc_number || null;
      salesOrderNumber = salesOrderNumber || outRes.rows[0].sales_order_number || null;
    }
  }
  if (!salesOrderNumber) {
    throw Object.assign(new Error('Original sales order not found for this unit — cannot create Service DC without SO reference'), { status: 400 });
  }
  return { originalDcNumber, salesOrderNumber };
}

async function buildShippingAddress(db, ticket, deliveryDefaults, body = {}) {
  const fromBody = body.shipping_address || body.customer_shipping_address;
  if (fromBody && typeof fromBody === 'object') return fromBody;
  const addr = {
    name: deliveryDefaults.contact_name || ticket.customer_name || '',
    phone: deliveryDefaults.contact_phone || ticket.ticket_phone_override || '',
    address: deliveryDefaults.address || ticket.ticket_address || '',
    city: deliveryDefaults.city || '',
    state: deliveryDefaults.state || '',
    pincode: deliveryDefaults.pincode || '',
  };
  if (!addr.address) {
    const cust = await db.query(
      'SELECT billing_address, billing_city, billing_state, billing_pincode, phone FROM customers WHERE customer_id = $1',
      [ticket.customer_id]
    );
    const c = cust.rows[0] || {};
    addr.address = addr.address || c.billing_address || '';
    addr.city = addr.city || c.billing_city || '';
    addr.state = addr.state || c.billing_state || '';
    addr.pincode = addr.pincode || c.billing_pincode || '';
    addr.phone = addr.phone || c.phone || '';
  }
  if (!addr.address) {
    throw Object.assign(new Error('Customer delivery address is required'), { status: 400 });
  }
  return addr;
}

async function createServiceDc(db, { ticketId, itemIds, dispatch, actor }) {
  const ids = Array.isArray(itemIds) && itemIds.length
    ? itemIds.map((id) => parseInt(id, 10)).filter(Boolean)
    : null;
  const { ticket, items: evaluated } = await listEligibleItems(db, ticketId, ids);
  const selected = evaluated.filter((row) => row.eligible);
  if (!selected.length) {
    const msg = evaluated[0]?.reasons?.join('; ') || 'No eligible units for Service Delivery Challan';
    throw Object.assign(new Error(msg), { status: 400 });
  }

  const deliveryDefaults = await loadDeliveryDefaults(db, ticket, selected[0].item);
  const { originalDcNumber, salesOrderNumber } = await resolveOriginalReferences(db, ticket, selected, deliveryDefaults);
  const shippingAddress = await buildShippingAddress(db, ticket, deliveryDefaults, dispatch || {});
  const dispatchInfo = normalizeDispatch(dispatch || {});

  const sdcNumber = await nextFinancialYearNumber('service_dc', db);
  const entries = [];
  let firstSpec = {};
  const firstItem = selected[0].item;

  for (const row of selected) {
    const vsn = row.serial;
    const code = row.item.ttspl_id || row.item.unique_serial_number || row.item.serial_number;
    entries.push(`${vsn.serial_id}|${vsn.serial_number}|${vsn.inventory_asset_code || code}`);
    if (!firstSpec.brand) firstSpec = vsn.extra || {};
  }

  const txnType = await resolveTxnTypeForDc(db, { salesOrderNumber, originalDcNumber });
  const hsnCode = resolveHsnForPersist({ transactionType: 'repair', role: null });
  const entityCode = entityForQuotationType(txnType === 'sale' ? 'sales' : 'rental');
  // Pending until Dispatch QC passes; dispatch transitions happen via normal DC dispatch flow.
  const dcStatus = 'pending';

  await db.query(
    `INSERT INTO delivery_challan_lines
        (dc_number, movement_type, support_ticket_id, customer_id, customer_name, email,
         customer_shipping_address, brand, model_name, quantity, serial_number,
         dispatch_mode, delivery_person_id, courier_name, awb_number,
         porter_tracking_id, porter_order_id,
         sales_order_number, original_dc_number, dc_purpose, remarks,
         status, created_by, created_at, updated_at,
         entity_code, hsn_code, pre_dispatch_qc_passed)
     VALUES ($1,'outbound',$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,
             $17,$18,$19,$20,
             $21,$22,NOW(),NOW(),$23,$24,FALSE)`,
    [
      sdcNumber,
      ticketId,
      ticket.customer_id,
      ticket.customer_name,
      ticket.ticket_email || null,
      JSON.stringify(shippingAddress),
      firstItem.brand || firstSpec.brand || null,
      firstItem.model || firstSpec.model || firstSpec.model_name || null,
      Math.max(1, entries.length),
      JSON.stringify(entries),
      dispatchInfo.dcDispatchMode,
      dispatchInfo.techId,
      dispatchInfo.courierName,
      dispatchInfo.awbNumber,
      dispatchInfo.porterTrackingId,
      dispatchInfo.porterOrderId,
      salesOrderNumber,
      originalDcNumber,
      DC_PURPOSE,
      dispatchInfo.remarks || `Service return for support ticket #${ticketId}`,
      dcStatus,
      actor?.user_id || null,
      entityCode,
      hsnCode,
    ]
  );

  const itemIdsStamped = [];
  for (const row of selected) {
    await db.query(
      `UPDATE support_ticket_items
          SET service_dc_number = $1, updated_at = NOW()
        WHERE id = $2`,
      [sdcNumber, row.item.id]
    );
    itemIdsStamped.push(row.item.id);

    await inventorySM.reserveForDc(db, row.serial.serial_id, {
      dcNumber: sdcNumber,
      customerId: ticket.customer_id,
      entityCode,
      actorUserId: actor?.user_id,
      actorName: actor?.name,
    });
  }

  await db.query(
    `UPDATE support_tickets
        SET service_dc_number = COALESCE(service_dc_number, $1),
            sales_order_number = COALESCE(sales_order_number, $3),
            dc_number = COALESCE(dc_number, $4),
            status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
            updated_at = NOW()
      WHERE id = $2`,
    [sdcNumber, ticketId, salesOrderNumber, originalDcNumber]
  );

  return {
    sdcNumber,
    service_dc_number: sdcNumber,
    sales_order_number: salesOrderNumber,
    original_dc_number: originalDcNumber,
    item_ids: itemIdsStamped,
    status: dcStatus,
    dispatch_mode: dispatchInfo.dcDispatchMode,
  };
}

async function resolveBillingBranch(db, serialRow, pickupItem) {
  let passivated = false;
  if (pickupItem.customer_inventory_id) {
    const ci = await db.query(
      'SELECT passivated_at, monthly_rate FROM customer_inventory WHERE id = $1',
      [pickupItem.customer_inventory_id]
    );
    passivated = !!ci.rows[0]?.passivated_at;
  }
  const rentPaused = passivated
    || !!serialRow.rent_end_date
    || serialRow.inventory_status === inventorySM.STATUS.IN_STOCK
    || serialRow.inventory_status === inventorySM.STATUS.RETURNED;
  const preservedRate = serialRow.rent_monthly_rate != null
    ? Number(serialRow.rent_monthly_rate)
    : null;
  return {
    rentPaused,
    preservedRate,
    billingBranch: rentPaused ? 'resume_after_repair' : 'preserve_existing_rent',
    existingRentStartDate: serialRow.rent_start_date || null,
  };
}

async function deliverServiceDcSerial(db, {
  serialId,
  pickupItem,
  dcNumber,
  customerId,
  entityCode,
  dispatchMode,
  actor,
}) {
  const sr = await db.query(
    `SELECT serial_id, inventory_status, rent_start_date, rent_end_date, rent_monthly_rate
       FROM vendor_serial_numbers WHERE serial_id = $1`,
    [serialId]
  );
  const serialRow = sr.rows[0];
  if (!serialRow) return { skipped: true };

  const billing = await resolveBillingBranch(db, serialRow, pickupItem);

  if (pickupItem.customer_inventory_id) {
    await db.query(
      `UPDATE customer_inventory
          SET passivated_at = NULL,
              passivated_reason = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [pickupItem.customer_inventory_id]
    );
  }

  if (billing.rentPaused) {
    await inventorySM.markDelivered(db, serialId, {
      quotationType: 'rental',
      dcNumber,
      customerId,
      entityCode,
      dispatchMode: dispatchMode || 'inhouse',
      deliveredAt: new Date(),
      rentMonthlyRate: billing.preservedRate,
      actorUserId: actor?.user_id,
      actorName: actor?.name,
    });
  } else {
    await inventorySM.transitionAsset(db, {
      serialId,
      toStatus: inventorySM.STATUS.RENTED,
      dcNumber,
      customerId,
      entityCode,
      dispatchMode: dispatchMode || 'inhouse',
      rentStartDate: billing.existingRentStartDate
        ? new Date(billing.existingRentStartDate).toISOString().slice(0, 10)
        : null,
      rentMonthlyRate: billing.preservedRate,
      reason: `Service return delivered on ${dcNumber} (${billing.billingBranch})`,
      actorUserId: actor?.user_id,
      actorName: actor?.name,
      allowOverride: true,
    });
  }

  return { delivered: true, billingBranch: billing.billingBranch };
}

async function tryCloseServiceDcTicket(db, ticketId, actor) {
  const pending = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM support_ticket_items sti
       LEFT JOIN delivery_challan_lines dcl
         ON dcl.dc_number = sti.service_dc_number
        AND dcl.movement_type = 'outbound'
        AND dcl.dc_purpose = $2
      WHERE sti.ticket_id = $1
        AND sti.item_type = 'pickup'
        AND sti.warehouse_received_at IS NOT NULL
        AND COALESCE(sti.pickup_type, CASE WHEN sti.source_item_id IS NOT NULL THEN 'repair' END) = 'repair'
        AND (
          sti.service_dc_number IS NULL
          OR COALESCE(dcl.status, '') <> 'delivered'
        )`,
    [ticketId, DC_PURPOSE]
  );
  if (pending.rows[0]?.n > 0) return false;

  await db.query(
    `UPDATE support_ticket_items
        SET status = 'resolved',
            resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
      WHERE ticket_id = $1
        AND item_type IN ('complaint', 'pickup')
        AND status NOT IN ('resolved', 'closed', 'inventory_updated')`,
    [ticketId]
  );
  await db.query(
    `UPDATE support_ticket_items
        SET status = 'inventory_updated',
            resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
      WHERE ticket_id = $1
        AND item_type = 'pickup'
        AND status = 'awaiting_service_return'`,
    [ticketId]
  );
  await db.query(
    `UPDATE support_tickets
        SET status = 'closed',
            closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [ticketId]
  );
  return true;
}

async function collectSerialIdsFromSdc(db, dcNumber) {
  const r = await db.query(
    `SELECT serial_number FROM delivery_challan_lines WHERE dc_number = $1`,
    [dcNumber]
  );
  const ids = new Set();
  for (const row of r.rows) {
    const entries = parseJson(row.serial_number);
    const list = Array.isArray(entries) ? entries : [entries];
    for (const entry of list) {
      const parts = String(entry || '').split('|');
      const sid = parts[0] && /^\d+$/.test(parts[0]) ? Number(parts[0]) : null;
      if (sid) ids.add(sid);
    }
  }
  return [...ids];
}

async function onServiceDcDelivered(db, dcNumber, actor = {}) {
  const meta = await db.query(
    `SELECT dc_purpose, support_ticket_id, dispatch_mode, entity_code, customer_id
       FROM delivery_challan_lines
      WHERE dc_number = $1 AND movement_type = 'outbound'
      LIMIT 1`,
    [dcNumber]
  );
  const row = meta.rows[0];
  if (!row || row.dc_purpose !== DC_PURPOSE) return { handled: false };

  const serialIds = await collectSerialIdsFromSdc(db, dcNumber);
  const billingLog = [];

  for (const serialId of serialIds) {
    const itemRes = await db.query(
      `SELECT sti.*
         FROM support_ticket_items sti
        WHERE sti.service_dc_number = $1
          AND sti.item_type = 'pickup'
        ORDER BY sti.id ASC
        LIMIT 1`,
      [dcNumber]
    );
    const pickupItem = itemRes.rows[0];
    if (!pickupItem) continue;
    const result = await deliverServiceDcSerial(db, {
      serialId,
      pickupItem,
      dcNumber,
      customerId: row.customer_id,
      entityCode: row.entity_code || 'rentfoxxy',
      dispatchMode: row.dispatch_mode,
      actor,
    });
    if (result.billingBranch) billingLog.push({ serialId, branch: result.billingBranch });
    await logServiceDcAudit(db, {
      itemId: pickupItem.id,
      ticketId: row.support_ticket_id,
      userId: actor?.user_id,
      action: 'service_dc_delivered',
      detail: {
        service_dc_number: dcNumber,
        serial_id: serialId,
        billing_branch: result.billingBranch || null,
      },
    });
  }

  let closed = false;
  if (row.support_ticket_id) {
    closed = await tryCloseServiceDcTicket(db, row.support_ticket_id, actor);
    if (closed) {
      await logServiceDcAudit(db, {
        ticketId: row.support_ticket_id,
        userId: actor?.user_id,
        action: 'ticket_closed',
        detail: { reason: 'service_dc_delivered', service_dc_number: dcNumber, billing_log: billingLog },
      });
    }
  }

  return { handled: true, closed, billingLog };
}

module.exports = {
  DC_PURPOSE,
  OPEN_SDC_STATUSES,
  getServiceDcContext,
  createServiceDc,
  onServiceDcDelivered,
  tryCloseServiceDcTicket,
  listEligibleItems,
};
