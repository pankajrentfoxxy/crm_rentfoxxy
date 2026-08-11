'use strict';

const { nextFinancialYearNumber } = require('./salesManagementService');
const { parseJsonSafe, resolveTicketPartDcContext } = require('./supportPartCustomerDcService');
const { generatePrtId } = require('./partIdService');

/**
 * Create an old/damaged part instance held by the technician until RPDC submit.
 */
async function createSupportOldPartWithTech(client, {
  supportPartRequest,
  partId,
  condition = 'defective',
  serialNumber = null,
  notes = null,
  actorUserId,
}) {
  const prtId = await generatePrtId(new Date(), client);
  const isReusable = condition === 'good';
  const ins = await client.query(
    `INSERT INTO part_instances
       (prt_id, part_id, unit_cost, status, notes, serial_number,
        source, origin_support_part_request_id,
        removed_from_ttspl_id, removed_from_ticket_id,
        condition_on_removal, removed_at, received_at, received_by, created_at, updated_at)
     VALUES ($1,$2,0,'with_technician',$3,$4,'support_old_part_return',$5,$6,$7,$8,NOW(),NOW(),$9,NOW(),NOW())
     RETURNING instance_id, prt_id, status`,
    [
      prtId,
      Number(partId),
      notes || `Old part from ${supportPartRequest.ttspl_id || 'laptop'}`,
      serialNumber || null,
      supportPartRequest.id,
      supportPartRequest.ttspl_id || null,
      supportPartRequest.support_ticket_id,
      condition || 'defective',
      actorUserId || null,
    ]
  );
  return { ...ins.rows[0], isReusable };
}

/**
 * Create RPDC (Return Part DC) — inbound part return document.
 * Used for: tech submitting old part to warehouse, or courier pickup from customer.
 */
async function createSupportPartReturnDc(client, {
  requests,
  returnMode = 'tech_submit',
  outboundDcNumber = null,
  shipBy = 'by_hand',
  courierName = null,
  awbNumber = null,
  courierTrackingUrl = null,
  actorUserId,
}) {
  if (!requests.length) throw new Error('No part requests provided');

  const ticketId = requests[0].support_ticket_id;
  const ctx = await resolveTicketPartDcContext(client, ticketId, requests[0].ttspl_id);
  const rpdcNumber = await nextFinancialYearNumber('part_return_dc', client);
  const dispatchMode = shipBy === 'by_courier' ? 'courier' : 'inhouse';
  const hasCourier = shipBy === 'by_courier' && Boolean(String(courierName || '').trim());
  const dcStatus = returnMode === 'courier_pickup'
    ? (hasCourier ? 'in_transit' : 'processing')
    : 'in_transit';

  const serialTokens = [];
  for (const reqRow of requests) {
    const token = reqRow.old_part_instance_id
      ? JSON.stringify({
        prt_id: reqRow.old_part_prt_id || reqRow.prt_id || null,
        part_name: reqRow.part_name,
        instance_id: reqRow.old_part_instance_id,
        support_part_request_id: reqRow.id,
        ttspl_id: reqRow.ttspl_id || null,
        condition: reqRow.old_part_condition || 'defective',
      })
      : JSON.stringify({
        part_name: reqRow.part_name,
        support_part_request_id: reqRow.id,
        ttspl_id: reqRow.ttspl_id || null,
        expected: 'old_part_from_customer',
      });
    serialTokens.push(token);
  }

  const partSummary = requests.length === 1
    ? `Old: ${requests[0].part_name}`
    : `${requests.length} old/damaged parts`;

  const remarksParts = [
    returnMode === 'courier_pickup' ? 'Courier pickup — old part from customer' : 'Technician return — old part to warehouse',
    outboundDcNumber ? `Replacement PDC: ${outboundDcNumber}` : null,
    ctx.salesOrderNumber ? `SO: ${ctx.salesOrderNumber}` : null,
    requests[0].ttspl_id ? `Laptop: ${requests[0].ttspl_id}` : null,
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
       $1, 'return', 'part_return', $2,
       $3, $4, $5, $6, $7,
       $8, 0, 0, $9, $9,
       $10, $11,
       'Old Spare Part', $12, $13, $13, $14::jsonb,
       $15, $16, $17, $18,
       $19, CASE WHEN $20 IN ('in_transit','delivered') THEN NOW() ELSE NULL END,
       $21, $20, $22, '847330'
     )`,
    [
      rpdcNumber, ticketId,
      ctx.salesOrderNumber, ctx.ticket.customer_id, ctx.customerName,
      ctx.email, ctx.gstNumber,
      ctx.supplyState, ctx.entityCode,
      ctx.billing ? JSON.stringify(ctx.billing) : null,
      ctx.shipping ? JSON.stringify(ctx.shipping) : null,
      partSummary, requests.length,
      JSON.stringify(serialTokens),
      shipBy,
      shipBy === 'by_courier' ? courierName : null,
      shipBy === 'by_courier' ? awbNumber : null,
      shipBy === 'by_courier' ? courierTrackingUrl : null,
      dispatchMode, dcStatus, remarksParts.join(' · '), actorUserId,
    ]
  );

  const newOldPartStatus = returnMode === 'courier_pickup'
    ? (hasCourier ? 'courier_in_transit' : 'courier_requested')
    : 'rpdc_submitted';

  for (const reqRow of requests) {
    await client.query(
      `UPDATE support_part_requests SET
         return_part_dc_number = $2,
         old_part_status = $3,
         updated_at = NOW()
       WHERE id = $1`,
      [reqRow.id, rpdcNumber, newOldPartStatus]
    );
  }

  return { rpdcNumber, ctx, dcStatus, returnMode };
}

/**
 * Warehouse receives old part(s) on an RPDC — finalize stock.
 */
async function receiveSupportPartReturnDc(client, {
  rpdcNumber,
  items = [],
  actorUserId,
}) {
  const dclRes = await client.query(
    `SELECT dc_number, status, support_ticket_id FROM delivery_challan_lines
      WHERE dc_number = $1 AND dc_purpose = 'part_return' FOR UPDATE`,
    [rpdcNumber]
  );
  if (!dclRes.rows.length) throw Object.assign(new Error('Return Part DC not found'), { status: 404 });
  const dcl = dclRes.rows[0];
  if (dcl.status === 'delivered') throw Object.assign(new Error('RPDC already received'), { status: 400 });

  const sprRes = await client.query(
    `SELECT spr.*, p.part_name, pi.prt_id AS old_part_prt_id
       FROM support_part_requests spr
       JOIN parts p ON p.part_id = spr.part_id
       LEFT JOIN part_instances pi ON pi.instance_id = spr.old_part_instance_id
      WHERE spr.return_part_dc_number = $1
      FOR UPDATE OF spr`,
    [rpdcNumber]
  );
  const requests = sprRes.rows;
  if (!requests.length) throw new Error('No part requests linked to this RPDC');

  for (const reqRow of requests) {
    const itemOverride = items.find((i) => Number(i.request_id) === Number(reqRow.id)) || {};
    const condition = itemOverride.condition || reqRow.old_part_condition || 'defective';
    const isReusable = condition === 'good';
    const targetStatus = isReusable ? 'in_stock' : 'defective';

    if (reqRow.old_part_instance_id) {
      await client.query(
        `UPDATE part_instances SET status = $2, condition_on_removal = $3, updated_at = NOW()
          WHERE instance_id = $1`,
        [reqRow.old_part_instance_id, targetStatus, condition]
      );
      if (isReusable) {
        await client.query(
          `UPDATE parts SET quantity = COALESCE(quantity, 0) + 1, updated_at = NOW() WHERE part_id = $1`,
          [reqRow.part_id]
        );
      }
    } else {
      const prtId = await generatePrtId(new Date(), client);
      await client.query(
        `INSERT INTO part_instances
           (prt_id, part_id, unit_cost, status, source, origin_support_part_request_id,
            removed_from_ttspl_id, removed_from_ticket_id, condition_on_removal,
            removed_at, received_at, received_by, notes, created_at, updated_at)
         VALUES ($1,$2,0,$3,'support_old_part_return',$4,$5,$6,$7,NOW(),NOW(),$8,$9,NOW(),NOW())`,
        [
          prtId, reqRow.part_id, targetStatus, reqRow.id,
          reqRow.ttspl_id, reqRow.support_ticket_id, condition, actorUserId,
          `Received via ${rpdcNumber}`,
        ]
      );
      if (isReusable) {
        await client.query(
          `UPDATE parts SET quantity = COALESCE(quantity, 0) + 1, updated_at = NOW() WHERE part_id = $1`,
          [reqRow.part_id]
        );
      }
      await client.query(
        `UPDATE support_part_requests SET old_part_instance_id = (
           SELECT instance_id FROM part_instances WHERE prt_id = $2 LIMIT 1
         )
         WHERE id = $1`,
        [reqRow.id, prtId]
      );
    }

    await client.query(
      `UPDATE support_part_requests SET
         old_part_status = 'received_wh',
         old_part_received_at = NOW(),
         old_part_condition = COALESCE($2, old_part_condition),
         updated_at = NOW()
       WHERE id = $1`,
      [reqRow.id, condition]
    );
  }

  await client.query(
    `UPDATE delivery_challan_lines SET status = 'delivered', delivered_at = NOW(),
            delivery_completed_at = NOW(), updated_at = NOW()
      WHERE dc_number = $1`,
    [rpdcNumber]
  );

  return { rpdcNumber, received: requests.length };
}

module.exports = {
  createSupportOldPartWithTech,
  createSupportPartReturnDc,
  receiveSupportPartReturnDc,
};
