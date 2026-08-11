'use strict';

const {
  nextFinancialYearNumber,
  resolveSupplyStateFromAddress,
  entityForQuotationType,
} = require('./salesManagementService');

function parseJsonSafe(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Resolve SO, billing/shipping addresses, GST for a support ticket + TTSPL. */
async function resolveTicketPartDcContext(client, ticketId, ttsplId = null) {
  const tkRes = await client.query(
    `SELECT st.*, c.name AS cust_name, c.company_name, c.email AS cust_email,
            c.phone AS cust_phone, c.gst_no,
            c.billing_address, c.billing_city, c.billing_state, c.billing_pincode,
            c.details AS customer_details
       FROM support_tickets st
       LEFT JOIN customers c ON c.customer_id = st.customer_id
      WHERE st.id = $1`,
    [ticketId]
  );
  const ticket = tkRes.rows[0];
  if (!ticket) throw Object.assign(new Error('Support ticket not found'), { status: 404 });

  let salesOrderNumber = ticket.sales_order_number || null;
  let outboundDc = ticket.dc_number || null;

  if (ttsplId) {
    const dcRes = await client.query(
      `SELECT dcl.dc_number, dcl.sales_order_number,
              dcl.customer_billing_address, dcl.customer_shipping_address,
              dcl.gst_number, dcl.supply_state, dcl.customer_name, dcl.email
         FROM delivery_challan_lines dcl
        WHERE COALESCE(dcl.movement_type, 'outbound') = 'outbound'
          AND dcl.customer_id = $1
          AND dcl.status = 'delivered'
          AND dcl.serial_number::text ILIKE '%' || $2 || '%'
        ORDER BY COALESCE(dcl.delivered_at, dcl.delivery_completed_at, dcl.created_at) DESC
        LIMIT 1`,
      [ticket.customer_id, ttsplId]
    );
    if (dcRes.rows[0]) {
      salesOrderNumber = salesOrderNumber || dcRes.rows[0].sales_order_number;
      outboundDc = outboundDc || dcRes.rows[0].dc_number;
    }
  }

  let billing = parseJsonSafe(ticket.pickup_address);
  let shipping = billing;

  const ecRes = await client.query(
    `SELECT billing_address, shipping_address, email, customer_name, contact_person_number
       FROM existing_customer WHERE customer_id = $1 LIMIT 1`,
    [ticket.customer_id]
  );
  const ec = ecRes.rows[0];
  if (ec) {
    const ecBilling = parseJsonSafe(ec.billing_address);
    const ecShipping = parseJsonSafe(ec.shipping_address);
    if (ecBilling?.address || ecBilling?.city) billing = ecBilling;
    if (ecShipping?.address || ecShipping?.city) shipping = ecShipping;
  }

  if (!billing?.address && ticket.billing_address) billing = parseJsonSafe(ticket.billing_address);
  if (!shipping?.address && ticket.ticket_address) {
    shipping = typeof ticket.ticket_address === 'string'
      ? { address: ticket.ticket_address, name: ticket.customer_name, phone: ticket.customer_phone }
      : parseJsonSafe(ticket.ticket_address);
  }

  if (!billing?.address && ticket.customer_id) {
    billing = {
      name: ticket.company_name || ticket.cust_name || ticket.customer_name,
      phone: ticket.cust_phone || ticket.customer_phone,
      gst_number: ticket.gst_no,
      address: typeof ticket.billing_address === 'string' ? ticket.billing_address : '',
      city: ticket.billing_city,
      state: ticket.billing_state,
      pincode: ticket.billing_pincode,
    };
  }
  if (!shipping?.address) shipping = billing;

  const customerName = ticket.customer_name
    || ticket.company_name
    || ticket.cust_name
    || ec?.customer_name
    || billing?.name
    || 'Customer';
  const email = ticket.ticket_email || ticket.cust_email || ec?.email || billing?.email || null;
  // existing_customer has no gst column — use customers.gst_no / address JSON
  const gstNumber = ticket.gst_no
    || billing?.gst_number
    || billing?.gst_no
    || shipping?.gst_number
    || shipping?.gst_no
    || null;

  let quotationType = 'rental';
  if (salesOrderNumber) {
    const qtRes = await client.query(
      `SELECT COALESCE(sol.quotation_type, 'rental') AS quotation_type
         FROM sales_order_lines sol
        WHERE sol.sales_order_number = $1 LIMIT 1`,
      [salesOrderNumber]
    );
    quotationType = qtRes.rows[0]?.quotation_type || 'rental';
  }

  return {
    ticket,
    salesOrderNumber,
    outboundDc,
    customerName,
    email,
    gstNumber,
    billing,
    shipping,
    supplyState: resolveSupplyStateFromAddress(shipping, billing?.state),
    entityCode: entityForQuotationType(quotationType),
    quotationType,
  };
}

/** Reserve a part instance for a pending support part request (shared logic). */
async function reservePartInstanceForRequest(client, reqRow, pickedInstances, actorUserId) {
  let instance = null;
  const chosenId = pickedInstances[reqRow.id] ?? pickedInstances[String(reqRow.id)];
  if (chosenId) {
    const chosenRes = await client.query(
      `SELECT * FROM part_instances WHERE instance_id = $1 FOR UPDATE`,
      [Number(chosenId)]
    );
    const chosen = chosenRes.rows[0];
    if (!chosen) throw new Error(`Selected unit not found for "${reqRow.part_name}"`);
    if (Number(chosen.part_id) !== Number(reqRow.part_id)) {
      throw new Error(`Selected unit does not match part "${reqRow.part_name}"`);
    }
    if (chosen.status !== 'in_stock') {
      throw new Error(`Selected unit for "${reqRow.part_name}" is '${chosen.status}', not available`);
    }
    instance = chosen;
  }

  if (!instance) {
    const instRes = await client.query(
      `SELECT * FROM part_instances
         WHERE part_id = $1 AND status = 'in_stock'
         ORDER BY received_at ASC LIMIT 1 FOR UPDATE`,
      [reqRow.part_id]
    );
    instance = instRes.rows[0];
  }

  if (!instance && Number(reqRow.quantity) > 0) {
    const partQtyRes = await client.query(
      'SELECT quantity, cost FROM parts WHERE part_id = $1', [reqRow.part_id]
    );
    if (Number(partQtyRes.rows[0]?.quantity || 0) > 0) {
      const { generatePrtId } = require('./partIdService');
      const prtId = await generatePrtId(new Date(), client);
      const newInst = await client.query(
        `INSERT INTO part_instances (prt_id, part_id, unit_cost, status, notes)
         VALUES ($1,$2,$3,'in_stock','Auto-created from legacy stock') RETURNING *`,
        [prtId, reqRow.part_id, Number(partQtyRes.rows[0]?.cost || 0)]
      );
      instance = newInst.rows[0];
    }
  }
  if (!instance) throw new Error(`Part "${reqRow.part_name}" is out of stock. Reject or escalate.`);

  await client.query(
    `UPDATE part_instances SET status = 'reserved', updated_at = NOW() WHERE instance_id = $1`,
    [instance.instance_id]
  );

  return instance;
}

/**
 * Create Part DC (PDC) rows in delivery_challan_lines and dispatch part to customer.
 * Returns { dcNumber, pdfPath, items }.
 */
async function createSupportPartCustomerDc(client, {
  requests,
  instanceMap = {},
  shipBy = 'by_courier',
  courierName = null,
  awbNumber = null,
  courierTrackingUrl = null,
  billingType = 'under_warranty',
  chargeAmount = 0,
  tamperedByCustomer = false,
  shippingOverride = null,
  billingOverride = null,
  addCourierLater = false,
  actorUserId,
}) {
  if (!requests.length) throw new Error('No part requests provided');

  const ticketId = requests[0].support_ticket_id;
  const ttsplId = requests[0].ttspl_id;
  const ctx = await resolveTicketPartDcContext(client, ticketId, ttsplId);

  const billing = billingOverride || ctx.billing;
  const shipping = shippingOverride || ctx.shipping;
  const supplyState = resolveSupplyStateFromAddress(shipping, ctx.supplyState);
  const dcNumber = await nextFinancialYearNumber('part_dc', client);
  const dispatchMode = shipBy === 'by_hand' ? 'inhouse' : 'courier';
  const hasCourierDetails = shipBy === 'by_courier' && Boolean(String(courierName || '').trim());
  const dcStatus = shipBy === 'by_hand' || hasCourierDetails ? 'in_transit' : 'processing';
  const partInstanceStatus = dcStatus === 'in_transit' ? 'in_transit' : 'reserved';
  const requestStatus = dcStatus === 'in_transit' ? 'dispatched' : 'approved';

  const serialTokens = [];
  const dcItems = [];
  let subtotalCharge = 0;

  for (const reqRow of requests) {
    const instance = await reservePartInstanceForRequest(
      client, reqRow, instanceMap, actorUserId
    );
    const unitCost = Number(instance.unit_cost || reqRow.unit_cost || 0);
    const lineCharge = billingType === 'charge_customer'
      ? Number(chargeAmount || reqRow.charge_amount || 0)
      : 0;
    subtotalCharge += lineCharge;

    const token = JSON.stringify({
      prt_id: instance.prt_id,
      part_name: reqRow.part_name,
      instance_id: instance.instance_id,
      support_part_request_id: reqRow.id,
      ttspl_id: reqRow.ttspl_id || ttsplId || null,
    });
    serialTokens.push(token);

    dcItems.push({
      requestId: reqRow.id,
      instance,
      partName: reqRow.part_name,
      unitCost,
      lineCharge,
    });

    await client.query(
      `UPDATE support_part_requests SET
         instance_id = $1,
         approved_by = $2,
         approved_at = NOW(),
         customer_dc_number = $3,
         sales_order_number = COALESCE($4, sales_order_number),
         billing_type = $5,
         charge_amount = $6,
         tampered_by_customer = $7,
         internal_unit_cost = $8,
         status = $9,
         dispatched_at = $10,
         updated_at = NOW()
       WHERE id = $11`,
      [
        instance.instance_id,
        actorUserId,
        dcNumber,
        ctx.salesOrderNumber,
        billingType,
        lineCharge,
        tamperedByCustomer,
        unitCost,
        requestStatus,
        requestStatus === 'dispatched' ? new Date() : null,
        reqRow.id,
      ]
    );

    await client.query(
      `UPDATE part_instances SET status = $2, updated_at = NOW() WHERE instance_id = $1`,
      [instance.instance_id, partInstanceStatus]
    );

    await client.query(
      `INSERT INTO support_part_laptop_costs (
         support_part_request_id, support_ticket_id, ttspl_id, serial_number,
         sales_order_number, part_id, part_name, prt_id, instance_id,
         unit_cost, billing_type, charge_amount, customer_dc_number
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        reqRow.id, ticketId, reqRow.ttspl_id || ttsplId, reqRow.serial_number,
        ctx.salesOrderNumber, reqRow.part_id, reqRow.part_name, instance.prt_id,
        instance.instance_id, unitCost, billingType, lineCharge, dcNumber,
      ]
    );
  }

  const partSummary = dcItems.length === 1
    ? dcItems[0].partName
    : `${dcItems.length} spare parts`;

  const remarksParts = [
    billingType === 'under_warranty' ? 'Under warranty — no charge' : 'Chargeable to customer',
    tamperedByCustomer ? 'Customer tampering noted' : null,
    ctx.salesOrderNumber ? `SO: ${ctx.salesOrderNumber}` : null,
    ttsplId ? `Laptop: ${ttsplId}` : null,
  ].filter(Boolean);

  await client.query(
    `INSERT INTO delivery_challan_lines (
       dc_number, movement_type, dc_purpose, support_ticket_id,
       sales_order_number, customer_id, customer_name, email, gst_number,
       supply_state, security_amount, shiping_charges, branch, entity_code,
       customer_billing_address, customer_shipping_address,
       brand, model_name, quantity, main_qty, serial_number,
       ship_by, courier_name, awb_number, courier_tracking_url,
       dispatch_mode, dispatched_at, remarks, status, created_by, hsn_code
     ) VALUES (
       $1, 'outbound', 'part_delivery', $2,
       $3, $4, $5, $6, $7,
       $8, 0, 0, $9, $10,
       $11::jsonb, $12::jsonb,
       'Spare Part', $13, $14, $15, $16::jsonb,
       $17, $18, $19, $20,
       $21, $22, $23, $24, $25, '847330'
     )`,
    [
      dcNumber,
      ticketId,
      ctx.salesOrderNumber,
      ctx.ticket.customer_id,
      ctx.customerName,
      ctx.email,
      ctx.gstNumber,
      supplyState,
      ctx.entityCode,
      ctx.entityCode,
      billing ? JSON.stringify(billing) : null,
      shipping ? JSON.stringify(shipping) : null,
      partSummary,
      dcItems.length,
      dcItems.length,
      JSON.stringify(serialTokens),
      shipBy,
      shipBy === 'by_courier' ? courierName : null,
      shipBy === 'by_courier' ? awbNumber : null,
      shipBy === 'by_courier' ? courierTrackingUrl : null,
      dispatchMode,
      dcStatus === 'in_transit' ? new Date() : null,
      remarksParts.join(' · '),
      dcStatus,
      actorUserId,
    ]
  );

  for (const item of dcItems) {
    await client.query(
      `UPDATE parts SET quantity = GREATEST(0, quantity - 1), updated_at = NOW() WHERE part_id = $1`,
      [requests.find((r) => r.id === item.requestId)?.part_id]
    );
  }

  return {
    dcNumber,
    ctx,
    dcItems,
    billingType,
    subtotalCharge,
    tamperedByCustomer,
    dcStatus,
    addCourierLater: addCourierLater || (shipBy === 'by_courier' && !hasCourierDetails),
  };
}

module.exports = {
  resolveTicketPartDcContext,
  reservePartInstanceForRequest,
  createSupportPartCustomerDc,
  parseJsonSafe,
};
