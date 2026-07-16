/**
 * Support replacement: Sales Order (config only) + Return DC at initiate.
 * Outbound delivery DC is created later via normal SO attach → Dispatch QC → Create DC.
 */
const { nextFinancialYearNumber, generateToken } = require('./salesManagementService');
const inventorySM = require('./inventoryStateMachine');

function parseExtra(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

async function loadOldDeployedSerial(client, src, customerId) {
  const code = src.ttspl_id || src.unique_serial_number || src.serial_number;
  if (!code || !customerId) return null;
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

/** Build replacement laptop config from complaint item + deployed serial. */
async function resolveConfigFromComplaint(client, src, customerId) {
  const oldSerial = await loadOldDeployedSerial(client, src, customerId);
  const extra = parseExtra(oldSerial?.extra);
  return {
    brand: src.brand || extra.brand || '',
    model: src.model || extra.model || extra.model_name || src.inv_model_name || '',
    processor: src.processor || extra.processor || src.inv_processor || '',
    generation: src.generation || extra.generation || src.inv_generation || '',
    ram: src.ram || extra.ram || src.inv_ram || '',
    storage: src.storage || extra.storage || src.inv_storage || '',
    gpu: src.gpu || extra.gpu || src.inv_gpu || '',
    screen_size: src.screen_size || extra.screen_size || src.inv_screen_size || '',
    monthly_rate: oldSerial?.rent_monthly_rate != null ? Number(oldSerial.rent_monthly_rate) : 0,
    old_serial_id: oldSerial?.serial_id || null,
    old_machine_serial: src.ttspl_id || src.unique_serial_number || src.serial_number || '',
    old_customer_inventory_id: src.customer_inventory_id || null,
  };
}

async function loadDeliveryDefaults(db, ticket, referenceItem) {
  const code = referenceItem?.ttspl_id || referenceItem?.unique_serial_number || referenceItem?.serial_number;
  if (code && ticket.customer_id) {
    const r = await db.query(
      `SELECT dcl.customer_shipping_address, dcl.customer_name, dcl.dc_number, dcl.sales_order_number,
              c.phone AS customer_phone, c.company_name, c.name
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
      return {
        contact_name: addr.name || row.customer_name || row.company_name || row.name || ticket.customer_name || '',
        contact_phone: addr.phone || row.customer_phone || ticket.ticket_phone_override || '',
        address: addr.address || addr.line1 || '',
        city: addr.city || '',
        state: addr.state || '',
        pincode: addr.pincode || addr.postal_code || '',
        original_dc_number: row.dc_number,
        sales_order_number: row.sales_order_number,
      };
    }
  }
  return {
    contact_name: ticket.customer_name || '',
    contact_phone: ticket.ticket_phone_override || '',
    address: ticket.ticket_address || '',
    city: '',
    state: '',
    pincode: '',
  };
}

async function listEligibleComplaintItems(client, ticketId) {
  const r = await client.query(
    `SELECT i.* FROM support_ticket_items i
      WHERE i.ticket_id = $1
        AND i.item_type = 'complaint'
        AND i.outcome = 'replacement_required'
        AND i.status NOT IN ('resolved', 'closed')
        AND NOT EXISTS (
          SELECT 1 FROM support_replacement_orders ro
           WHERE ro.source_item_id = i.id
             AND ro.status NOT IN ('completed', 'cancelled')
        )
      ORDER BY i.id ASC`,
    [ticketId]
  );
  return r.rows;
}

async function buildTicketReplacementContext(db, ticket, items) {
  const eligible = [];
  for (const src of items || []) {
    const config = await resolveConfigFromComplaint(db, src, ticket.customer_id);
    eligible.push({
      id: src.id,
      ttspl_id: src.ttspl_id || src.unique_serial_number || src.serial_number,
      serial_number: src.serial_number,
      model: config.model,
      brand: config.brand,
      processor: config.processor,
      generation: config.generation,
      ram: config.ram,
      storage: config.storage,
      rent_monthly_rate: config.monthly_rate,
      replacement_flag_reason: src.replacement_flag_reason,
    });
  }
  const ref = items?.[0] || null;
  const delivery_defaults = await loadDeliveryDefaults(db, ticket, ref);
  const activeSo = await db.query(
    `SELECT sales_order_number, return_dc_number, COUNT(*)::int AS unit_count
       FROM support_replacement_orders
      WHERE ticket_id = $1 AND status NOT IN ('completed','cancelled')
      GROUP BY sales_order_number, return_dc_number
      ORDER BY MAX(id) DESC LIMIT 1`,
    [ticket.id]
  );
  return {
    eligible_items: eligible,
    delivery_defaults,
    active_order: activeSo.rows[0] || null,
  };
}

/** One SO with one line per faulty laptop (config + rent from old unit). */
async function createConfigSalesOrder(client, {
  customerId,
  customerName,
  customerEmail,
  customerMobile,
  shippingAddress,
  billingAddress,
  gstNumber,
  supplyState,
  lineConfigs,
  userId,
}) {
  const salesOrderNumber = await nextFinancialYearNumber('sales_order', client);
  const token = generateToken();
  const shippingJson = shippingAddress ? JSON.stringify(shippingAddress) : null;
  const billingJson = billingAddress ? JSON.stringify(billingAddress) : null;
  const lineIds = [];

  for (const cfg of lineConfigs) {
    const { resolveHsnForPersist } = require('../constants/hsnDefaults');
    const lineHsn = resolveHsnForPersist({ quotationType: 'rental' });
    const ins = await client.query(
      `INSERT INTO sales_order_lines (
         sales_order_number, quotation_number, customer_id, customer_name, customer_email, customer_mobile,
         customer_shipping_address, customer_billing_address, gst_number, supply_state, security_amount,
         shiping_charges, quotation_type, branch, brand, model_name, processor, generation, ram, storage,
         gpu, screen_size, quantity, main_qty, rate, locking_period, battery_charger_warranty,
         technical_warranty, remark, status, token, created_by, hsn_code
       ) VALUES (
         $1,'N/A',$2,$3,$4,$5,$6,$7,$8,$9,0,0,'rental','rentfoxxy',
         $10,$11,$12,$13,$14,$15,$16,$17,1,1,$18,0,0,0,
         'Support replacement','pending',$19,$20,$21
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
        cfg.brand,
        cfg.model,
        cfg.processor,
        cfg.generation,
        cfg.ram,
        cfg.storage,
        cfg.gpu,
        cfg.screen_size,
        cfg.monthly_rate || 0,
        token,
        userId,
        lineHsn,
      ]
    );
    lineIds.push(ins.rows[0].id);
  }

  return { salesOrderNumber, lineIds, token };
}

function formatConfigLabel(cfg) {
  return [cfg.brand, cfg.model, cfg.processor, cfg.generation, cfg.ram, cfg.storage]
    .filter(Boolean)
    .join(' · ');
}

async function findReplacementOrderForSerial(client, serialId) {
  const r = await client.query(
    `SELECT ro.*
       FROM sales_order_serials sos
       JOIN support_replacement_orders ro ON ro.sales_order_line_id = sos.line_id
      WHERE sos.serial_id = $1
        AND ro.status NOT IN ('completed','cancelled')
      ORDER BY ro.id DESC
      LIMIT 1`,
    [serialId]
  );
  return r.rows[0] || null;
}

async function tryCloseReplacementTicket(client, ticketId) {
  const ordRes = await client.query(
    `SELECT * FROM support_replacement_orders
      WHERE ticket_id = $1 AND status NOT IN ('completed','cancelled')
      ORDER BY id ASC`,
    [ticketId]
  );
  const orders = ordRes.rows;
  if (!orders.length) return false;
  if (!orders.every((o) => o.delivery_completed_at)) return false;
  if (!orders.some((o) => o.pickup_completed_at)) return false;

  await client.query(
    `UPDATE support_ticket_items
        SET status = 'resolved',
            resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
      WHERE ticket_id = $1 AND item_type = 'complaint'
        AND status NOT IN ('resolved', 'closed', 'inventory_updated')`,
    [ticketId]
  );
  await client.query(
    `UPDATE support_ticket_items
        SET status = 'inventory_updated', updated_at = CURRENT_TIMESTAMP
      WHERE ticket_id = $1 AND item_type = 'replacement'
        AND status NOT IN ('inventory_updated', 'closed')`,
    [ticketId]
  );
  await client.query(
    `UPDATE support_replacement_orders
        SET status = 'completed', inventory_updated_at = COALESCE(inventory_updated_at, CURRENT_TIMESTAMP)
      WHERE ticket_id = $1 AND status NOT IN ('completed','cancelled')`,
    [ticketId]
  );
  await client.query(
    `UPDATE support_tickets
        SET status = 'closed', closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [ticketId]
  );
  return true;
}

async function collectSerialIdsFromDc(client, dcNumber) {
  const r = await client.query(
    `SELECT serial_number FROM delivery_challan_lines WHERE dc_number = $1`,
    [dcNumber]
  );
  const ids = new Set();
  for (const row of r.rows) {
    let raw = row.serial_number;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { raw = [raw]; }
    }
    const entries = Array.isArray(raw) ? raw : [raw];
    for (const entry of entries) {
      const text = String(entry || '');
      const parts = text.split('|');
      const sid = parts[0] && /^\d+$/.test(parts[0]) ? Number(parts[0]) : null;
      if (sid) {
        ids.add(sid);
        continue;
      }
      const code = parts[2] || parts[1] || parts[0];
      if (!code) continue;
      const sr = await client.query(
        `SELECT serial_id FROM vendor_serial_numbers
          WHERE deleted_at IS NULL
            AND (inventory_asset_code = $1 OR serial_number = $1)
          LIMIT 1`,
        [code]
      );
      if (sr.rows[0]?.serial_id) ids.add(sr.rows[0].serial_id);
    }
  }
  return [...ids];
}

/** Outbound DC delivered — one unit per SO line. */
async function onReplacementOutboundDelivered(client, dcNumber, actor = {}) {
  const meta = await client.query(
    `SELECT dc_purpose, support_ticket_id, sales_order_number
       FROM delivery_challan_lines WHERE dc_number = $1 AND movement_type = 'outbound' LIMIT 1`,
    [dcNumber]
  );
  const row = meta.rows[0];
  if (!row) return { handled: false };

  const hasReplacementSo = row.sales_order_number && (await client.query(
    `SELECT 1 FROM support_replacement_orders
      WHERE sales_order_number = $1 AND status NOT IN ('completed','cancelled') LIMIT 1`,
    [row.sales_order_number]
  )).rows.length;

  if (row.dc_purpose !== 'replacement' && !hasReplacementSo) return { handled: false };

  const serialIds = await collectSerialIdsFromDc(client, dcNumber);
  let handledAny = false;

  for (const serialId of serialIds) {
    const order = await findReplacementOrderForSerial(client, serialId);
    if (!order || order.delivery_completed_at) continue;

    const ticketRes = await client.query('SELECT customer_id FROM support_tickets WHERE id = $1', [order.ticket_id]);

    await inventorySM.markDelivered(client, serialId, {
      quotationType: 'rental',
      dcNumber,
      customerId: ticketRes.rows[0]?.customer_id,
      entityCode: 'rentfoxxy',
      dispatchMode: 'inhouse',
      deliveredAt: new Date(),
      rentMonthlyRate: order.old_rent_monthly_rate != null ? Number(order.old_rent_monthly_rate) : null,
      actorUserId: actor.user_id,
      actorName: actor.name,
    });

    await client.query(
      `UPDATE support_replacement_orders
          SET status = 'delivered',
              delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP),
              delivery_completed_at = CURRENT_TIMESTAMP,
              new_serial_id = $2,
              dc_number = $3
        WHERE id = $1`,
      [order.id, serialId, dcNumber]
    );
    await client.query(
      `UPDATE support_ticket_items SET status = 'delivered', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [order.item_id]
    );
    handledAny = true;
  }

  if (handledAny && row.support_ticket_id) {
    await tryCloseReplacementTicket(client, row.support_ticket_id);
  }
  return { handled: handledAny };
}

async function onReplacementReturnPickedUp(client, { supportTicketId, returnDcNumber }) {
  const ordRes = await client.query(
    `SELECT id FROM support_replacement_orders
      WHERE ticket_id = $1 AND return_dc_number = $2 AND status NOT IN ('completed','cancelled')`,
    [supportTicketId, returnDcNumber]
  );
  if (!ordRes.rows.length) return { handled: false };
  return { handled: true };
}

async function onReplacementWarehouseReceived(client, pickupItemId) {
  const itemRes = await client.query(
    'SELECT ticket_id, return_dc_number FROM support_ticket_items WHERE id = $1',
    [pickupItemId]
  );
  if (!itemRes.rows.length) return { handled: false };
  const it = itemRes.rows[0];

  const ordRes = await client.query(
    `SELECT id FROM support_replacement_orders
      WHERE ticket_id = $1 AND return_dc_number = $2 AND status NOT IN ('completed','cancelled')`,
    [it.ticket_id, it.return_dc_number]
  );
  if (!ordRes.rows.length) return { handled: false };

  await client.query(
    `UPDATE support_replacement_orders
        SET pickup_completed_at = CURRENT_TIMESTAMP
      WHERE ticket_id = $1 AND return_dc_number = $2`,
    [it.ticket_id, it.return_dc_number]
  );
  await tryCloseReplacementTicket(client, it.ticket_id);
  return { handled: true };
}

/** Tag outbound DC as replacement when created from a support replacement SO. */
async function tagReplacementOutboundDc(client, dcNumber, salesOrderNumber) {
  const r = await client.query(
    `SELECT ticket_id, id FROM support_replacement_orders
      WHERE sales_order_number = $1 AND status NOT IN ('completed','cancelled')
      ORDER BY id ASC LIMIT 1`,
    [salesOrderNumber]
  );
  if (!r.rows.length) return;
  await client.query(
    `UPDATE delivery_challan_lines
        SET dc_purpose = 'replacement',
            support_ticket_id = COALESCE(support_ticket_id, $2),
            support_replacement_order_id = COALESCE(support_replacement_order_id, $3)
      WHERE dc_number = $1 AND movement_type = 'outbound'`,
    [dcNumber, r.rows[0].ticket_id, r.rows[0].id]
  );
}

/**
 * Default Return DC remarks for replacement pickups — names the laptop(s) being replaced.
 */
function buildReplacementRdcRemarks(machines = []) {
  const blocks = (machines || [])
    .map((m) => {
      const ttspl = String(m.ttspl_id || m.unique_serial_number || m.ttspl || '').trim();
      const serial = String(m.serial_number || m.serial || '').trim();
      if (!ttspl && !serial) return null;
      const lines = [];
      if (ttspl) lines.push(`TTSPL: ${ttspl}`);
      if (serial) lines.push(`Serial No: ${serial}`);
      return lines.join('\n');
    })
    .filter(Boolean);

  if (!blocks.length) {
    return 'Replacement against:\n\n(TTSPL / Serial not available)';
  }
  return `Replacement against:\n\n${blocks.join('\n\n')}`;
}

module.exports = {
  buildReplacementRdcRemarks,
  resolveConfigFromComplaint,
  listEligibleComplaintItems,
  buildTicketReplacementContext,
  createConfigSalesOrder,
  formatConfigLabel,
  onReplacementOutboundDelivered,
  onReplacementReturnPickedUp,
  onReplacementWarehouseReceived,
  tryCloseReplacementTicket,
  tagReplacementOutboundDc,
  loadDeliveryDefaults,
};
