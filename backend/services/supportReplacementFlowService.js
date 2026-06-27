/**
 * Support replacement orchestration: SO + outbound replacement DC + Return DC pickup.
 */
const {
  nextFinancialYearNumber,
  entityForQuotationType,
  generateToken,
} = require('./salesManagementService');
const inventorySM = require('./inventoryStateMachine');

function parseExtra(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

async function loadOldDeployedSerial(client, src, customerId) {
  const code = src.ttspl_id || src.unique_serial_number || src.serial_number;
  if (!code) return null;
  const r = await client.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status,
            rent_monthly_rate, current_customer_id, extra
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND current_customer_id = $2
        AND (inventory_asset_code = $1 OR serial_number = $1 OR extra->>'ttspl_id' = $1)
      LIMIT 1`,
    [code, customerId]
  );
  return r.rows[0] || null;
}

async function loadNewStockSerial(client, serialId) {
  const r = await client.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, qc_status, extra
       FROM vendor_serial_numbers
      WHERE serial_id = $1 AND deleted_at IS NULL`,
    [serialId]
  );
  if (!r.rows.length) throw Object.assign(new Error('Replacement machine not found'), { status: 404 });
  const vsn = r.rows[0];
  if (vsn.inventory_status !== 'in_stock') {
    throw Object.assign(new Error('Selected machine is no longer available in stock'), { status: 400 });
  }
  const extra = parseExtra(vsn.extra);
  return {
    serial_id: vsn.serial_id,
    serial_number: vsn.serial_number,
    asset_code: vsn.inventory_asset_code || extra.ttspl_id || vsn.serial_number,
    brand: extra.brand || '',
    model: extra.model || extra.model_name || '',
    processor: extra.processor || '',
    generation: extra.generation || '',
    ram: extra.ram || '',
    storage: extra.storage || '',
    gpu: extra.gpu || '',
    screen_size: extra.screen_size || '',
  };
}

function normalizeShipBy(dispatchMode) {
  const m = String(dispatchMode || 'technician').toLowerCase();
  if (m === 'courier') return 'by_courier';
  if (m === 'porter') return 'by_porter';
  return 'by_hand';
}

function outboundDispatchMode(shipBy) {
  if (shipBy === 'by_courier') return 'courier';
  if (shipBy === 'by_porter') return 'porter';
  return 'inhouse';
}

async function createReplacementSalesOrder(client, {
  customerId,
  customerName,
  customerEmail,
  customerMobile,
  shippingAddress,
  billingAddress,
  gstNumber,
  supplyState,
  monthlyRate,
  newAsset,
  userId,
}) {
  const salesOrderNumber = await nextFinancialYearNumber('sales_order', client);
  const token = generateToken();
  const shippingJson = shippingAddress ? JSON.stringify(shippingAddress) : null;
  const billingJson = billingAddress ? JSON.stringify(billingAddress) : null;

  const lineRes = await client.query(
    `INSERT INTO sales_order_lines (
       sales_order_number, quotation_number, customer_id, customer_name, customer_email, customer_mobile,
       customer_shipping_address, customer_billing_address, gst_number, supply_state, security_amount,
       shiping_charges, quotation_type, branch, brand, model_name, processor, generation, ram, storage,
       gpu, screen_size, quantity, main_qty, rate, locking_period, battery_charger_warranty,
       technical_warranty, remark, status, token, created_by
     ) VALUES (
       $1,'N/A',$2,$3,$4,$5,$6,$7,$8,$9,0,0,'rental','rentfoxxy',
       $10,$11,$12,$13,$14,$15,$16,$17,1,1,$18,0,0,0,
       'Support replacement','pending',$19,$20
     ) RETURNING id`,
    [
      salesOrderNumber,
      customerId,
      customerName,
      customerEmail || null,
      customerMobile || null,
      shippingJson,
      billingJson,
      gstNumber || null,
      supplyState || null,
      newAsset.brand,
      newAsset.model,
      newAsset.processor,
      newAsset.generation,
      newAsset.ram,
      newAsset.storage,
      newAsset.gpu,
      newAsset.screen_size,
      monthlyRate,
      token,
      userId,
    ]
  );

  return { salesOrderNumber, lineId: lineRes.rows[0].id, token };
}

async function attachSerialToReplacementSo(client, {
  salesOrderNumber,
  lineId,
  newAsset,
  entityCode,
  userId,
}) {
  await inventorySM.transitionAsset(client, {
    serialId: newAsset.serial_id,
    toStatus: inventorySM.STATUS.RESERVED,
    reason: `Reserved for replacement SO ${salesOrderNumber}`,
    actorUserId: userId,
  });

  const ins = await client.query(
    `INSERT INTO sales_order_serials (
       sales_order_number, line_id, serial_id, ttspl_id, serial_number,
       qc_status, status, entity_code, created_by, delivery_address
     ) VALUES ($1,$2,$3,$4,$5,'passed','attached',$6,$7,$8)
     RETURNING allocation_id`,
    [
      salesOrderNumber,
      lineId,
      newAsset.serial_id,
      newAsset.asset_code,
      newAsset.serial_number,
      entityCode,
      userId,
      null,
    ]
  );
  return ins.rows[0].allocation_id;
}

async function createReplacementOutboundDc(client, {
  salesOrderNumber,
  soHead,
  newAsset,
  shippingAddress,
  shipBy,
  deliveryPersonId,
  courierName,
  awbNumber,
  porterTrackingId,
  porterOrderId,
  ticketId,
  replacementOrderId,
  userId,
}) {
  const dcNumber = await nextFinancialYearNumber('delivery_challan', client);
  const entityCode = soHead.entity_code || entityForQuotationType('rental');
  const dispatchMode = outboundDispatchMode(shipBy);
  const serialToken = `${newAsset.serial_id}|${newAsset.serial_number}|${newAsset.asset_code}`;

  await client.query(
    `INSERT INTO delivery_challan_lines (
       dc_number, sales_order_number, quotation_number, customer_id, customer_name,
       email, gst_number, supply_state, security_amount, shiping_charges, branch,
       entity_code, customer_billing_address, customer_shipping_address,
       brand, model_name, quantity, main_qty, serial_number,
       ship_by, courier_name, awb_number, porter_tracking_id, porter_order_id,
       delivery_person_id, dispatch_mode, dispatched_at,
       movement_type, dc_purpose, support_ticket_id, support_replacement_order_id,
       status, created_by, created_at, updated_at
     ) VALUES (
       $1,$2,'N/A',$3,$4,$5,$6,$7,0,0,$8,$8,$9,$10,
       $11,$12,1,1,$13::jsonb,
       $14,$15,$16,$17,$18,
       $19,$20,NOW(),
       'outbound','replacement',$21,$22,
       'in_transit',$23,NOW(),NOW()
     )`,
    [
      dcNumber,
      salesOrderNumber,
      soHead.customer_id,
      soHead.customer_name,
      soHead.customer_email,
      soHead.gst_number,
      soHead.supply_state,
      entityCode,
      soHead.customer_billing_address,
      shippingAddress ? JSON.stringify(shippingAddress) : soHead.customer_shipping_address,
      newAsset.brand,
      newAsset.model,
      JSON.stringify([serialToken]),
      shipBy,
      shipBy === 'by_courier' ? (courierName || null) : null,
      shipBy === 'by_courier' ? (awbNumber || null) : null,
      shipBy === 'by_porter' ? (porterTrackingId || null) : null,
      shipBy === 'by_porter' ? (porterOrderId || null) : null,
      shipBy === 'by_hand' && deliveryPersonId ? Number(deliveryPersonId) : null,
      dispatchMode,
      ticketId,
      replacementOrderId,
      userId,
    ]
  );

  await inventorySM.markDispatched(client, newAsset.serial_id, {
    dcNumber,
    customerId: soHead.customer_id,
    entityCode,
    dispatchMode,
    actorUserId: userId,
  });

  await client.query(
    `UPDATE sales_order_serials
        SET status = 'dispatched', dc_number = $1, updated_at = NOW()
      WHERE sales_order_number = $2 AND serial_id = $3 AND status = 'attached'`,
    [dcNumber, salesOrderNumber, newAsset.serial_id]
  );

  return dcNumber;
}

async function tryCloseReplacementTicket(client, ticketId) {
  const ordRes = await client.query(
    `SELECT * FROM support_replacement_orders
      WHERE ticket_id = $1
      ORDER BY id DESC LIMIT 1`,
    [ticketId]
  );
  if (!ordRes.rows.length) return false;
  const order = ordRes.rows[0];
  if (!order.delivery_completed_at || !order.pickup_completed_at) return false;

  await client.query(
    `UPDATE support_ticket_items
        SET status = 'resolved',
            resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
      WHERE ticket_id = $1
        AND item_type = 'complaint'
        AND status NOT IN ('resolved', 'closed', 'inventory_updated')`,
    [ticketId]
  );
  await client.query(
    `UPDATE support_ticket_items
        SET status = 'inventory_updated',
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status <> 'inventory_updated'`,
    [order.item_id]
  );
  await client.query(
    `UPDATE support_replacement_orders
        SET status = 'completed', inventory_updated_at = COALESCE(inventory_updated_at, CURRENT_TIMESTAMP)
      WHERE id = $1`,
    [order.id]
  );
  await client.query(
    `UPDATE support_tickets
        SET status = 'closed',
            closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [ticketId]
  );
  return true;
}

/**
 * Outbound replacement DC delivered (My Deliveries POD / admin deliver).
 */
async function onReplacementOutboundDelivered(client, dcNumber, actor = {}) {
  const meta = await client.query(
    `SELECT dc_purpose, support_replacement_order_id, support_ticket_id, sales_order_number
       FROM delivery_challan_lines
      WHERE dc_number = $1 AND movement_type = 'outbound'
      LIMIT 1`,
    [dcNumber]
  );
  const row = meta.rows[0];
  if (!row || row.dc_purpose !== 'replacement' || !row.support_replacement_order_id) {
    return { handled: false };
  }

  const ordRes = await client.query(
    'SELECT * FROM support_replacement_orders WHERE id = $1',
    [row.support_replacement_order_id]
  );
  if (!ordRes.rows.length) return { handled: false };
  const order = ordRes.rows[0];
  if (order.delivery_completed_at) return { handled: true, already: true };

  const newRow = order.new_serial_id
    ? (await client.query(
      'SELECT serial_id, inventory_asset_code, dispatch_mode, dispatched_at FROM vendor_serial_numbers WHERE serial_id = $1',
      [order.new_serial_id]
    )).rows[0]
    : null;

  if (newRow?.serial_id) {
    await inventorySM.markDelivered(client, newRow.serial_id, {
      quotationType: 'rental',
      dcNumber,
      customerId: (await client.query('SELECT customer_id FROM support_tickets WHERE id = $1', [order.ticket_id])).rows[0]?.customer_id,
      entityCode: 'rentfoxxy',
      dispatchMode: newRow.dispatch_mode || 'inhouse',
      dispatchedAt: newRow.dispatched_at || new Date(),
      deliveredAt: new Date(),
      rentMonthlyRate: order.old_rent_monthly_rate != null ? Number(order.old_rent_monthly_rate) : null,
      actorUserId: actor.user_id,
      actorName: actor.name,
    });
  }

  await client.query(
    `UPDATE support_replacement_orders
        SET status = 'delivered',
            delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP),
            delivery_completed_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [order.id]
  );
  await client.query(
    `UPDATE support_ticket_items
        SET status = 'delivered', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [order.item_id]
  );

  await tryCloseReplacementTicket(client, order.ticket_id);
  return { handled: true, orderId: order.id };
}

/**
 * Return DC picked up at customer (billing stops on old unit via processReturnedSerials).
 */
async function onReplacementReturnPickedUp(client, { supportTicketId, returnDcNumber }) {
  const ordRes = await client.query(
    `SELECT * FROM support_replacement_orders
      WHERE ticket_id = $1 AND return_dc_number = $2
      ORDER BY id DESC LIMIT 1`,
    [supportTicketId, returnDcNumber]
  );
  if (!ordRes.rows.length) return { handled: false };

  const order = ordRes.rows[0];
  await client.query(
    `UPDATE support_replacement_orders
        SET status = CASE WHEN delivery_completed_at IS NOT NULL THEN 'pickup_in_transit' ELSE status END
      WHERE id = $1`,
    [order.id]
  );
  return { handled: true, orderId: order.id };
}

/**
 * Warehouse received old laptop on replacement Return DC.
 */
async function onReplacementWarehouseReceived(client, pickupItemId) {
  const itemRes = await client.query(
    'SELECT ticket_id, return_dc_number FROM support_ticket_items WHERE id = $1',
    [pickupItemId]
  );
  if (!itemRes.rows.length) return { handled: false };
  const it = itemRes.rows[0];

  const ordRes = await client.query(
    `SELECT * FROM support_replacement_orders
      WHERE ticket_id = $1 AND return_dc_number = $2
      ORDER BY id DESC LIMIT 1`,
    [it.ticket_id, it.return_dc_number]
  );
  if (!ordRes.rows.length) return { handled: false };

  const order = ordRes.rows[0];
  await client.query(
    `UPDATE support_replacement_orders
        SET pickup_completed_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [order.id]
  );
  await tryCloseReplacementTicket(client, it.ticket_id);
  return { handled: true, orderId: order.id };
}

async function buildReplacementContext(db, ticket, sourceItem) {
  const code = sourceItem.ttspl_id || sourceItem.unique_serial_number || sourceItem.serial_number;
  const oldSerial = ticket.customer_id ? await loadOldDeployedSerial(db, sourceItem, ticket.customer_id) : null;
  let ctx = null;
  if (code && ticket.customer_id) {
    const r = await db.query(
      `SELECT dcl.customer_shipping_address, dcl.customer_name, dcl.email,
              c.phone AS customer_phone, c.company_name, c.name, c.gst_no
         FROM delivery_challan_lines dcl
         LEFT JOIN customers c ON c.customer_id = dcl.customer_id
        WHERE dcl.movement_type = 'outbound'
          AND dcl.customer_id = $1
          AND dcl.serial_number::text ILIKE '%' || $2 || '%'
        ORDER BY dcl.created_at DESC NULLS LAST
        LIMIT 1`,
      [ticket.customer_id, code]
    );
    if (r.rows.length) {
      const row = r.rows[0];
      let addr = {};
      try {
        addr = typeof row.customer_shipping_address === 'object'
          ? row.customer_shipping_address
          : JSON.parse(row.customer_shipping_address || '{}');
      } catch { addr = {}; }
      ctx = {
        contact_name: addr.name || row.customer_name || row.company_name || row.name || ticket.customer_name || '',
        contact_phone: addr.phone || row.customer_phone || ticket.ticket_phone_override || '',
        address: addr.address || addr.line1 || '',
        city: addr.city || '',
        state: addr.state || '',
        pincode: addr.pincode || addr.postal_code || '',
        gst_number: row.gst_no || null,
      };
    }
  }
  return {
    old_machine: {
      ttspl_id: code,
      serial_number: sourceItem.serial_number,
      model: sourceItem.model,
      rent_monthly_rate: oldSerial?.rent_monthly_rate ?? null,
    },
    delivery_defaults: ctx || {
      contact_name: ticket.customer_name || '',
      contact_phone: ticket.ticket_phone_override || '',
      address: ticket.ticket_address || '',
      city: '',
      state: '',
      pincode: '',
    },
  };
}

module.exports = {
  loadOldDeployedSerial,
  loadNewStockSerial,
  normalizeShipBy,
  outboundDispatchMode,
  createReplacementSalesOrder,
  attachSerialToReplacementSo,
  createReplacementOutboundDc,
  onReplacementOutboundDelivered,
  onReplacementReturnPickedUp,
  onReplacementWarehouseReceived,
  tryCloseReplacementTicket,
  buildReplacementContext,
};
