'use strict';
const pool = require('../config/db');
const path = require('path');
const fs   = require('fs');
const { generateChallanPdf } = require('../services/supportPartChallanPdfService');

// Display ticket number is derived from the support ticket id (no dedicated
// column exists on support_tickets), e.g. STK-0045.
const TICKET_NUMBER_SQL = `('STK-' || LPAD(st.id::text, 4, '0'))`;

// ── helpers ──────────────────────────────────────────────────────────────────

async function nextSprNumber(db = pool) {
  const r = await db.query(
    `UPDATE sm_document_sequences SET last_value = last_value + 1, updated_at = NOW()
     WHERE doc_type = 'support_part_request' RETURNING last_value`
  );
  return `SPR-${String(r.rows[0].last_value).padStart(4, '0')}`;
}

async function nextSpcNumber(db = pool) {
  const r = await db.query(
    `UPDATE sm_document_sequences SET last_value = last_value + 1, updated_at = NOW()
     WHERE doc_type = 'support_part_challan' RETURNING last_value`
  );
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `SPC-${dateStr}-${String(r.rows[0].last_value).padStart(4, '0')}`;
}

function saveEsignFile(base64Data, prefix) {
  const dir = path.join(__dirname, '../uploads/support-parts');
  fs.mkdirSync(dir, { recursive: true });
  const safePrefix = String(prefix).replace(/[^\w-]/g, '_');
  const filename = `${safePrefix}_esign_${Date.now()}.png`;
  const b64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(path.join(dir, filename), Buffer.from(b64, 'base64'));
  return `uploads/support-parts/${filename}`;
}

const OPEN_PART_REQUEST_STATUSES = [
  'pending', 'approved', 'challan_generated', 'issued', 'return_requested',
];

async function resolveAssignedTechForItem(client, supportItemId, ticketId, fallbackUserId) {
  if (!supportItemId) return fallbackUserId;
  const itemRes = await client.query(
    'SELECT assigned_to FROM support_ticket_items WHERE id = $1 AND ticket_id = $2',
    [supportItemId, ticketId]
  );
  return itemRes.rows[0]?.assigned_to || fallbackUserId;
}

async function userCanActOnPartRequest(client, spr, user) {
  if (['admin', 'support_lead', 'manager', 'super_admin'].includes(user.role)) return true;
  if (spr.assigned_to_tech === user.user_id) return true;
  if (spr.support_item_id) {
    const itemRes = await client.query(
      'SELECT assigned_to FROM support_ticket_items WHERE id = $1',
      [spr.support_item_id]
    );
    if (itemRes.rows[0]?.assigned_to === user.user_id) return true;
  }
  return false;
}

/** Keep part requests / draft challans aligned when a complaint assignee changes. */
async function syncPartRequestsTechForItem(client, itemId, techUserId) {
  if (!itemId || !techUserId) return;
  await client.query(
    `UPDATE support_part_requests
     SET assigned_to_tech = $2, updated_at = NOW()
     WHERE support_item_id = $1
       AND status = ANY($3::text[])`,
    [itemId, techUserId, OPEN_PART_REQUEST_STATUSES]
  );
  await client.query(
    `UPDATE support_part_challans spc
     SET issued_to = $2, updated_at = NOW()
     WHERE spc.status = 'draft'
       AND spc.id IN (
         SELECT DISTINCT challan_id FROM support_part_requests
         WHERE support_item_id = $1 AND challan_id IS NOT NULL
       )`,
    [itemId, techUserId]
  );
}

exports.syncPartRequestsTechForItem = syncPartRequestsTechForItem;

// ── RAISE PART REQUEST ────────────────────────────────────────────────────────

exports.raiseSupportPartRequest = async (req, res) => {
  const { support_ticket_id, support_item_id, ttspl_id, serial_number,
          part_id, quantity, reason,
          fulfillment_mode, billing_type, charge_amount, tampered_by_customer,
          collect_old_part, old_part_collection_method } = req.body;

  if (!support_ticket_id || !part_id || !quantity) {
    return res.status(400).json({ success: false,
      message: 'support_ticket_id, part_id, quantity are required' });
  }

  const mode = fulfillment_mode === 'courier_to_customer' ? 'courier_to_customer' : 'warehouse_handover';
  const billing = billing_type === 'charge_customer' ? 'charge_customer' : 'under_warranty';
  const charge = billing === 'charge_customer' ? Number(charge_amount || 0) : 0;
  const shouldCollectOld = collect_old_part !== false;
  let oldPartMethod = null;
  let oldPartStatus = 'not_applicable';
  if (shouldCollectOld) {
    oldPartMethod = old_part_collection_method === 'courier_pickup'
      ? 'courier_pickup'
      : 'tech_collection';
    oldPartStatus = 'pending';
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tkRes = await client.query(
      `SELECT id, sales_order_number FROM support_tickets WHERE id = $1`, [support_ticket_id]
    );
    if (!tkRes.rows.length)
      throw Object.assign(new Error('Support ticket not found'), { status: 404 });
    const ticket = tkRes.rows[0];

    const partRes = await client.query(
      `SELECT p.*, pi_count.available
       FROM parts p
       LEFT JOIN (
         SELECT part_id, COUNT(*) AS available
         FROM part_instances WHERE status = 'in_stock'
         GROUP BY part_id
       ) pi_count ON pi_count.part_id = p.part_id
       WHERE p.part_id = $1 AND NOT COALESCE(p.archived, FALSE)`,
      [part_id]
    );
    if (!partRes.rows.length)
      throw Object.assign(new Error('Part not found'), { status: 404 });
    const part = partRes.rows[0];

    const assignedTechId = await resolveAssignedTechForItem(
      client, support_item_id || null, support_ticket_id, req.user.user_id
    );

    const reqNumber = await nextSprNumber(client);
    const { rows } = await client.query(
      `INSERT INTO support_part_requests
         (request_number, support_ticket_id, support_item_id, ttspl_id,
          serial_number, requested_by, assigned_to_tech, part_id, quantity,
          reason, status, fulfillment_mode, billing_type, charge_amount,
          tampered_by_customer, sales_order_number,
          collect_old_part, old_part_collection_method, old_part_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [reqNumber, support_ticket_id, support_item_id || null, ttspl_id || null,
       serial_number || null, req.user.user_id, assignedTechId, part_id,
       Number(quantity), reason || null, mode, billing, charge,
       Boolean(tampered_by_customer), ticket.sales_order_number || null,
       shouldCollectOld, oldPartMethod, oldPartStatus]
    );
    const spr = rows[0];

    await client.query('COMMIT');
    // Stock is "available" if we have tracked part_instances OR legacy catalog
    // quantity (parts.quantity), since approval can issue from either source.
    const available = Math.max(Number(part.available || 0), Number(part.quantity || 0));
    res.status(201).json({
      success: true,
      request: { ...spr, part_name: part.part_name, stock_available: available },
      in_stock: available > 0,
      message: available > 0
        ? (mode === 'courier_to_customer'
          ? 'Request raised. Warehouse will dispatch part to customer via courier.'
          : 'Request raised. Awaiting warehouse approval.')
        : 'Request raised. Part is out of stock - warehouse will procure.'
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};

// ── CANCEL PART REQUEST (pending only — before warehouse approval) ────────────

exports.cancelSupportPartRequest = async (req, res) => {
  const reqId = parseInt(req.params.requestId, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'SELECT * FROM support_part_requests WHERE id = $1 FOR UPDATE',
      [reqId]
    );
    if (!r.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    const spr = r.rows[0];

    if (spr.status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Request is already cancelled' });
    }
    if (spr.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Cannot remove a request that is '${spr.status}'. Only awaiting-warehouse requests can be removed.`,
      });
    }

    const isWarehouse = ['warehouse', 'admin', 'support_lead', 'manager', 'super_admin'].includes(req.user.role);
    const isRequester = Number(spr.requested_by) === Number(req.user.user_id);
    const canAct = isWarehouse || isRequester || (await userCanActOnPartRequest(client, spr, req.user));
    if (!canAct) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'Not authorised to remove this request' });
    }

    await client.query(
      `UPDATE support_part_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [reqId]
    );
    await client.query('COMMIT');
    res.json({ success: true, message: 'Part request removed.' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('cancelSupportPartRequest:', e);
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
};

// ── LIST REQUESTS (warehouse queue + technician view) ─────────────────────────

exports.listSupportPartRequests = async (req, res) => {
  try {
    const { status, for_warehouse, assigned_to_tech, support_ticket_id } = req.query;

    let where = 'WHERE 1=1';
    const params = [];

    if (status) {
      where += ` AND spr.status = $${params.length + 1}`;
      params.push(status);
    }
    if (for_warehouse === 'true') {
      where += ` AND spr.status IN ('pending','approved','challan_generated')`;
    }
    if (assigned_to_tech) {
      where += ` AND spr.assigned_to_tech = $${params.length + 1}`;
      params.push(Number(assigned_to_tech));
    }
    if (support_ticket_id) {
      where += ` AND spr.support_ticket_id = $${params.length + 1}`;
      params.push(Number(support_ticket_id));
    }
    // Tech sees only own requests
    if (req.user.role === 'support_tech') {
      where += ` AND spr.assigned_to_tech = $${params.length + 1}`;
      params.push(req.user.user_id);
    }

    const { rows } = await pool.query(
      `SELECT spr.*,
              p.part_name, p.category, p.location_code, p.cost AS unit_cost,
              pi.prt_id, pi.location_code AS instance_location,
              tech.name AS tech_name, tech.email AS tech_email,
              approver.name AS approved_by_name,
              st.customer_name, ${TICKET_NUMBER_SQL} AS support_ticket_number,
              spc.challan_number, spc.tech_esign_url, spc.pdf_path
       FROM support_part_requests spr
       JOIN parts p ON p.part_id = spr.part_id
       LEFT JOIN part_instances pi ON pi.instance_id = spr.instance_id
       JOIN users tech ON tech.user_id = spr.assigned_to_tech
       LEFT JOIN users approver ON approver.user_id = spr.approved_by
       JOIN support_tickets st ON st.id = spr.support_ticket_id
       LEFT JOIN support_part_challans spc ON spc.id = spr.challan_id
       ${where}
       ORDER BY spr.created_at DESC`,
      params
    );

    res.json({ success: true, requests: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── WAREHOUSE: APPROVE + GENERATE CHALLAN ────────────────────────────────────

exports.approveAndGenerateChallan = async (req, res) => {
  const { request_ids, instance_map } = req.body;
  if (!Array.isArray(request_ids) || !request_ids.length) {
    return res.status(400).json({ success: false, message: 'request_ids required' });
  }
  // Optional { [request_id]: instance_id } — warehouse picks the exact unit/serial.
  const pickedInstances = instance_map && typeof instance_map === 'object' ? instance_map : {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reqRes = await client.query(
      `SELECT spr.*, p.part_name, p.cost AS unit_cost
       FROM support_part_requests spr
       JOIN parts p ON p.part_id = spr.part_id
       WHERE spr.id = ANY($1::int[]) AND spr.status = 'pending'
       FOR UPDATE OF spr`,
      [request_ids]
    );
    if (!reqRes.rows.length)
      throw new Error('No pending requests found for given IDs');

    const requests = reqRes.rows;
    for (const reqRow of requests) {
      const correctTech = await resolveAssignedTechForItem(
        client, reqRow.support_item_id, reqRow.support_ticket_id, reqRow.assigned_to_tech
      );
      if (correctTech !== reqRow.assigned_to_tech) {
        await client.query(
          `UPDATE support_part_requests SET assigned_to_tech = $2, updated_at = NOW() WHERE id = $1`,
          [reqRow.id, correctTech]
        );
        reqRow.assigned_to_tech = correctTech;
      }
    }
    const techIds = [...new Set(requests.map((r) => r.assigned_to_tech))];
    const ticketIds = [...new Set(requests.map((r) => r.support_ticket_id))];
    if (techIds.length > 1)
      throw new Error('All requests must belong to the same technician');
    if (ticketIds.length > 1)
      throw new Error('All requests must belong to the same support ticket');

    const techId   = techIds[0];
    const ticketId = ticketIds[0];
    const ttsplId  = requests[0].ttspl_id;

    const challanItems = [];
    for (const reqRow of requests) {
      let instance = null;

      // Warehouse explicitly chose a unit/serial for this request.
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
          const { generatePrtId } = require('../services/partIdService');
          const prtId = await generatePrtId(new Date(), client);
          const newInst = await client.query(
            `INSERT INTO part_instances (prt_id, part_id, unit_cost, status, notes)
             VALUES ($1,$2,$3,'in_stock','Auto-created from legacy stock') RETURNING *`,
            [prtId, reqRow.part_id, Number(partQtyRes.rows[0]?.cost || 0)]
          );
          instance = newInst.rows[0];
        }
      }
      if (!instance)
        throw new Error(`Part "${reqRow.part_name}" is out of stock. Reject or escalate.`);

      await client.query(
        `UPDATE part_instances SET status = 'reserved', updated_at = NOW()
         WHERE instance_id = $1`,
        [instance.instance_id]
      );
      await client.query(
        `UPDATE support_part_requests
         SET status = 'approved', instance_id = $1, approved_by = $2, approved_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [instance.instance_id, req.user.user_id, reqRow.id]
      );

      challanItems.push({
        part_request_id: reqRow.id,
        part_id: reqRow.part_id,
        instance_id: instance.instance_id,
        prt_id: instance.prt_id,
        part_name: reqRow.part_name,
        quantity: reqRow.quantity,
        unit_cost: Number(instance.unit_cost || reqRow.unit_cost || 0),
      });
    }

    const challanNumber = await nextSpcNumber(client);
    const challanRes = await client.query(
      `INSERT INTO support_part_challans
         (challan_number, support_ticket_id, ttspl_id, issued_to, issued_by, status)
       VALUES ($1,$2,$3,$4,$5,'draft')
       RETURNING *`,
      [challanNumber, ticketId, ttsplId || null, techId, req.user.user_id]
    );
    const challan = challanRes.rows[0];

    for (const item of challanItems) {
      await client.query(
        `INSERT INTO support_challan_items
           (challan_id, part_request_id, part_id, instance_id, prt_id,
            part_name, quantity, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [challan.id, item.part_request_id, item.part_id, item.instance_id,
         item.prt_id, item.part_name, item.quantity, item.unit_cost]
      );
      await client.query(
        `UPDATE support_part_requests SET challan_id = $1, status = 'challan_generated',
           updated_at = NOW() WHERE id = $2`,
        [challan.id, item.part_request_id]
      );
    }

    await client.query('COMMIT');

    generateChallanPdf(challan.id, challanNumber).catch((e) =>
      console.error('challan PDF error:', e.message)
    );

    res.status(201).json({
      success: true,
      challan_id: challan.id,
      challan_number: challanNumber,
      items: challanItems,
      message: `Challan ${challanNumber} created. Technician must come to sign.`
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};

// ── WAREHOUSE: APPROVE + GENERATE PART DC (COURIER TO CUSTOMER) ─────────────

exports.approveAndGenerateCustomerDc = async (req, res) => {
  const {
    request_ids, instance_map,
    ship_by, courier_name, awb_number, courier_tracking_url,
    billing_type, charge_amount, tampered_by_customer,
    customer_shipping_address, customer_billing_address,
  } = req.body;

  if (!Array.isArray(request_ids) || !request_ids.length) {
    return res.status(400).json({ success: false, message: 'request_ids required' });
  }
  const shipBy = ship_by || 'by_courier';
  if (!['by_courier', 'by_hand'].includes(shipBy)) {
    return res.status(400).json({ success: false, message: 'Invalid ship_by' });
  }
  const courierNameTrimmed = String(courier_name || '').trim();
  if (shipBy === 'by_courier' && !courierNameTrimmed && !req.body.add_courier_later) {
    return res.status(400).json({
      success: false,
      message: 'Courier name is required, or choose "Add courier details later"',
    });
  }

  const pickedInstances = instance_map && typeof instance_map === 'object' ? instance_map : {};
  const { createSupportPartCustomerDc } = require('../services/supportPartCustomerDcService');
  const { generatePartCustomerDcPdf } = require('../services/supportPartCustomerDcPdfService');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reqRes = await client.query(
      `SELECT spr.*, p.part_name, p.cost AS unit_cost
         FROM support_part_requests spr
         JOIN parts p ON p.part_id = spr.part_id
        WHERE spr.id = ANY($1::int[])
          AND spr.status = 'pending'
          AND spr.fulfillment_mode = 'courier_to_customer'
        FOR UPDATE OF spr`,
      [request_ids]
    );
    if (!reqRes.rows.length) {
      throw Object.assign(new Error('No pending courier part requests found'), { status: 400 });
    }
    const requests = reqRes.rows;
    const ticketIds = [...new Set(requests.map((r) => r.support_ticket_id))];
    if (ticketIds.length > 1) {
      throw new Error('All requests must belong to the same support ticket');
    }

    const result = await createSupportPartCustomerDc(client, {
      requests,
      instanceMap: pickedInstances,
      shipBy,
      courierName: courierNameTrimmed || null,
      awbNumber: awb_number,
      courierTrackingUrl: courier_tracking_url,
      billingType: billing_type === 'charge_customer' ? 'charge_customer' : 'under_warranty',
      chargeAmount: Number(charge_amount || 0),
      tamperedByCustomer: Boolean(tampered_by_customer),
      shippingOverride: customer_shipping_address || null,
      billingOverride: customer_billing_address || null,
      addCourierLater: Boolean(req.body.add_courier_later) && shipBy === 'by_courier' && !courierNameTrimmed,
      actorUserId: req.user.user_id,
    });

    // Old part courier pickup from customer (paired with outbound PDC)
    const courierPickupRequests = requests.filter(
      (r) => r.collect_old_part && r.old_part_collection_method === 'courier_pickup'
    );
    let rpdcNumber = null;
    if (courierPickupRequests.length && req.body.schedule_old_part_pickup !== false) {
      const { createSupportPartReturnDc } = require('../services/supportPartReturnDcService');
      const pickupCourierName = req.body.old_part_courier_name || courierNameTrimmed || null;
      const pickupAwb = req.body.old_part_awb_number || null;
      const pickupTracking = req.body.old_part_courier_tracking_url || null;
      const pickupShipBy = req.body.old_part_ship_by || (pickupCourierName ? 'by_courier' : 'by_courier');
      const rpdc = await createSupportPartReturnDc(client, {
        requests: courierPickupRequests.map((r) => ({ ...r, part_name: r.part_name })),
        returnMode: 'courier_pickup',
        outboundDcNumber: result.dcNumber,
        shipBy: pickupShipBy,
        courierName: pickupCourierName,
        awbNumber: pickupAwb,
        courierTrackingUrl: pickupTracking,
        actorUserId: req.user.user_id,
      });
      rpdcNumber = rpdc.rpdcNumber;
    }

    await client.query('COMMIT');

    let pdfPath = null;
    try {
      pdfPath = await generatePartCustomerDcPdf(result.dcNumber);
    } catch (pdfErr) {
      console.error('Part DC PDF error:', pdfErr.message);
    }

    res.status(201).json({
      success: true,
      dc_number: result.dcNumber,
      return_part_dc_number: rpdcNumber,
      pdf_path: pdfPath,
      sales_order_number: result.ctx.salesOrderNumber,
      billing_type: result.billingType,
      charge_amount: result.subtotalCharge,
      dc_status: result.dcStatus,
      add_courier_later: result.addCourierLater,
      message: result.addCourierLater
        ? `Part DC ${result.dcNumber} created. Add courier details to dispatch.`
        : `Part DC ${result.dcNumber} created${rpdcNumber ? ` · Old part pickup ${rpdcNumber} scheduled` : ''}.`,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
};

// ── GET PART CUSTOMER DC ─────────────────────────────────────────────────────

exports.getPartCustomerDc = async (req, res) => {
  try {
    const dcNumber = req.params.dcNumber;
    const dclRes = await pool.query(
      `SELECT dcl.*, st.id AS ticket_id,
              ('STK-' || LPAD(st.id::text, 4, '0')) AS ticket_number
         FROM delivery_challan_lines dcl
         LEFT JOIN support_tickets st ON st.id = dcl.support_ticket_id
        WHERE dcl.dc_number = $1 AND dcl.dc_purpose = 'part_delivery'
        LIMIT 1`,
      [dcNumber]
    );
    if (!dclRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Part DC not found' });
    }

    const partsRes = await pool.query(
      `SELECT spr.*, p.part_name, pi.prt_id
         FROM support_part_requests spr
         JOIN parts p ON p.part_id = spr.part_id
         LEFT JOIN part_instances pi ON pi.instance_id = spr.instance_id
        WHERE spr.customer_dc_number = $1
        ORDER BY spr.id`,
      [dcNumber]
    );

    const costsRes = await pool.query(
      `SELECT * FROM support_part_laptop_costs WHERE customer_dc_number = $1 ORDER BY id`,
      [dcNumber]
    );

    res.json({
      success: true,
      dc: dclRes.rows[0],
      parts: partsRes.rows,
      laptop_costs: costsRes.rows,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── MARK PART DC DELIVERED ───────────────────────────────────────────────────

exports.markPartCustomerDcDelivered = async (req, res) => {
  const dcNumber = req.params.dcNumber;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dclRes = await client.query(
      `SELECT dc_number, status FROM delivery_challan_lines
        WHERE dc_number = $1 AND dc_purpose = 'part_delivery' FOR UPDATE`,
      [dcNumber]
    );
    if (!dclRes.rows.length) {
      throw Object.assign(new Error('Part DC not found'), { status: 404 });
    }

    await client.query(
      `UPDATE delivery_challan_lines SET status = 'delivered', delivered_at = NOW(),
              delivery_completed_at = NOW(), updated_at = NOW()
        WHERE dc_number = $1`,
      [dcNumber]
    );
    await client.query(
      `UPDATE support_part_requests SET status = 'delivered', delivered_at = NOW(), updated_at = NOW()
        WHERE customer_dc_number = $1 AND status = 'dispatched'`,
      [dcNumber]
    );
    await client.query('COMMIT');
    res.json({ success: true, message: 'Part DC marked as delivered.' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
};

// ── UPDATE PART DC COURIER (warehouse adds tracking after PDC created) ───────

exports.updatePartCustomerDcCourier = async (req, res) => {
  const dcNumber = req.params.dcNumber;
  const courierName = String(req.body.courier_name || '').trim();
  const awbNumber = String(req.body.awb_number || '').trim() || null;
  const trackingUrl = String(req.body.courier_tracking_url || '').trim() || null;

  if (!courierName) {
    return res.status(400).json({ success: false, message: 'Courier name is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dclRes = await client.query(
      `SELECT dc_number, status, ship_by FROM delivery_challan_lines
        WHERE dc_number = $1 AND dc_purpose = 'part_delivery' FOR UPDATE`,
      [dcNumber]
    );
    if (!dclRes.rows.length) {
      throw Object.assign(new Error('Part DC not found'), { status: 404 });
    }
    const dcl = dclRes.rows[0];
    if (!['processing', 'in_transit'].includes(String(dcl.status || ''))) {
      throw Object.assign(new Error(`Cannot update courier on Part DC in status '${dcl.status}'`), { status: 400 });
    }
    if (String(dcl.ship_by || '') !== 'by_courier') {
      throw Object.assign(new Error('Courier details apply only to courier shipments'), { status: 400 });
    }

    await client.query(
      `UPDATE delivery_challan_lines
          SET courier_name = $2,
              awb_number = $3,
              courier_tracking_url = $4,
              status = 'in_transit',
              dispatched_at = COALESCE(dispatched_at, NOW()),
              updated_at = NOW()
        WHERE dc_number = $1`,
      [dcNumber, courierName, awbNumber, trackingUrl]
    );

    await client.query(
      `UPDATE support_part_requests
          SET status = 'dispatched',
              dispatched_at = COALESCE(dispatched_at, NOW()),
              updated_at = NOW()
        WHERE customer_dc_number = $1
          AND status IN ('approved', 'dispatched')`,
      [dcNumber]
    );

    await client.query(
      `UPDATE part_instances pi
          SET status = 'in_transit', updated_at = NOW()
        FROM support_part_requests spr
       WHERE spr.customer_dc_number = $1
         AND spr.instance_id = pi.instance_id
         AND pi.status = 'reserved'`,
      [dcNumber]
    );

    await client.query('COMMIT');
    res.json({
      success: true,
      message: 'Courier details saved. Part is now in transit to customer.',
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
};

// ── LIST PART CUSTOMER DCs (warehouse — awaiting courier) ────────────────────

exports.listPartCustomerDcsAwaitingCourier = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT dcl.dc_number, dcl.status, dcl.customer_name, dcl.created_at,
              dcl.ship_by, dcl.courier_name, dcl.awb_number,
              ('STK-' || LPAD(st.id::text, 4, '0')) AS ticket_number
         FROM delivery_challan_lines dcl
         LEFT JOIN support_tickets st ON st.id = dcl.support_ticket_id
        WHERE dcl.dc_purpose = 'part_delivery'
          AND dcl.ship_by = 'by_courier'
          AND dcl.status = 'processing'
        ORDER BY dcl.created_at ASC`
    );
    res.json({ success: true, dcs: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── RETURN PART DC (RPDC) — old part back to warehouse ───────────────────────

exports.submitOldPartRpdc = async (req, res) => {
  const { request_ids } = req.body;
  if (!Array.isArray(request_ids) || !request_ids.length) {
    return res.status(400).json({ success: false, message: 'request_ids required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqRes = await client.query(
      `SELECT spr.*, p.part_name, pi.prt_id AS old_part_prt_id
         FROM support_part_requests spr
         JOIN parts p ON p.part_id = spr.part_id
         LEFT JOIN part_instances pi ON pi.instance_id = spr.old_part_instance_id
        WHERE spr.id = ANY($1::int[])
          AND spr.old_part_status = 'with_tech'
        FOR UPDATE OF spr`,
      [request_ids]
    );
    if (!reqRes.rows.length) {
      throw Object.assign(new Error('No old parts ready for RPDC submit'), { status: 400 });
    }
    const requests = reqRes.rows;
    const techIds = [...new Set(requests.map((r) => r.assigned_to_tech))];
    if (techIds.length > 1) {
      throw new Error('All selected old parts must belong to the same technician');
    }
    if (req.user.role === 'support_tech' && Number(techIds[0]) !== Number(req.user.user_id)) {
      throw Object.assign(new Error('Not authorised'), { status: 403 });
    }

    const { createSupportPartReturnDc } = require('../services/supportPartReturnDcService');
    const result = await createSupportPartReturnDc(client, {
      requests,
      returnMode: 'tech_submit',
      shipBy: 'by_hand',
      actorUserId: req.user.user_id,
    });

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      return_part_dc_number: result.rpdcNumber,
      message: `Return Part DC ${result.rpdcNumber} created. Hand old part(s) to warehouse for receipt.`,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
};

exports.getPartReturnDc = async (req, res) => {
  try {
    const dcNumber = req.params.dcNumber;
    const dclRes = await pool.query(
      `SELECT dcl.*, ('STK-' || LPAD(st.id::text, 4, '0')) AS ticket_number
         FROM delivery_challan_lines dcl
         LEFT JOIN support_tickets st ON st.id = dcl.support_ticket_id
        WHERE dcl.dc_number = $1 AND dcl.dc_purpose = 'part_return'
        LIMIT 1`,
      [dcNumber]
    );
    if (!dclRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Return Part DC not found' });
    }
    const partsRes = await pool.query(
      `SELECT spr.*, p.part_name, pi.prt_id AS old_part_prt_id
         FROM support_part_requests spr
         JOIN parts p ON p.part_id = spr.part_id
         LEFT JOIN part_instances pi ON pi.instance_id = spr.old_part_instance_id
        WHERE spr.return_part_dc_number = $1
        ORDER BY spr.id`,
      [dcNumber]
    );
    res.json({ success: true, dc: dclRes.rows[0], parts: partsRes.rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.receivePartReturnDc = async (req, res) => {
  const dcNumber = req.params.dcNumber;
  const { items } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { receiveSupportPartReturnDc } = require('../services/supportPartReturnDcService');
    const result = await receiveSupportPartReturnDc(client, {
      rpdcNumber: dcNumber,
      items: Array.isArray(items) ? items : [],
      actorUserId: req.user.user_id,
    });
    await client.query('COMMIT');
    res.json({
      success: true,
      message: `Received ${result.received} old part(s) on ${result.rpdcNumber}.`,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
};

exports.updatePartReturnDcCourier = async (req, res) => {
  const dcNumber = req.params.dcNumber;
  const courierName = String(req.body.courier_name || '').trim();
  const awbNumber = String(req.body.awb_number || '').trim() || null;
  const trackingUrl = String(req.body.courier_tracking_url || '').trim() || null;
  if (!courierName) {
    return res.status(400).json({ success: false, message: 'Courier name is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dclRes = await client.query(
      `SELECT dc_number, status FROM delivery_challan_lines
        WHERE dc_number = $1 AND dc_purpose = 'part_return' FOR UPDATE`,
      [dcNumber]
    );
    if (!dclRes.rows.length) {
      throw Object.assign(new Error('Return Part DC not found'), { status: 404 });
    }
    if (!['processing', 'in_transit'].includes(String(dclRes.rows[0].status || ''))) {
      throw Object.assign(new Error('Cannot update courier on this RPDC'), { status: 400 });
    }

    await client.query(
      `UPDATE delivery_challan_lines SET
         courier_name = $2, awb_number = $3, courier_tracking_url = $4,
         ship_by = 'by_courier', status = 'in_transit',
         dispatched_at = COALESCE(dispatched_at, NOW()), updated_at = NOW()
       WHERE dc_number = $1`,
      [dcNumber, courierName, awbNumber, trackingUrl]
    );
    await client.query(
      `UPDATE support_part_requests SET old_part_status = 'courier_in_transit', updated_at = NOW()
        WHERE return_part_dc_number = $1`,
      [dcNumber]
    );
    await client.query('COMMIT');
    res.json({ success: true, message: 'Courier details saved. Old part pickup is in transit.' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
};

exports.listPartReturnDcsPendingReceive = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT dcl.dc_number, dcl.status, dcl.customer_name, dcl.courier_name, dcl.awb_number,
              dcl.created_at, ('STK-' || LPAD(st.id::text, 4, '0')) AS ticket_number
         FROM delivery_challan_lines dcl
         LEFT JOIN support_tickets st ON st.id = dcl.support_ticket_id
        WHERE dcl.dc_purpose = 'part_return'
          AND dcl.status IN ('processing', 'in_transit')
        ORDER BY dcl.created_at ASC`
    );
    res.json({ success: true, dcs: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── TECHNICIAN: E-SIGN CHALLAN → ISSUE PARTS ─────────────────────────────────

exports.signAndIssueChallan = async (req, res) => {
  const challanId = parseInt(req.params.challanId, 10);
  const { esign_data, signer_name } = req.body;

  if (!esign_data || !esign_data.startsWith('data:image'))
    return res.status(400).json({ success: false, message: 'e-sign image required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const chalRes = await client.query(
      `SELECT sc.*, u.name AS tech_name
       FROM support_part_challans sc
       JOIN users u ON u.user_id = sc.issued_to
       WHERE sc.id = $1 FOR UPDATE OF sc`,
      [challanId]
    );
    if (!chalRes.rows.length)
      throw Object.assign(new Error('Challan not found'), { status: 404 });
    const challan = chalRes.rows[0];

    if (!['draft', 'challan_generated'].includes(challan.status))
      throw new Error(`Challan is already ${challan.status}`);

    const esignUrl = saveEsignFile(esign_data, `challan_${challan.challan_number}`);

    await client.query(
      `UPDATE support_part_challans SET
         tech_esign_url = $1, tech_esign_at = NOW(), tech_esign_name = $2,
         issued_by = $3, issued_at = NOW(), status = 'issued', updated_at = NOW()
       WHERE id = $4`,
      [esignUrl, signer_name || challan.tech_name, req.user.user_id, challanId]
    );

    const itemsRes = await client.query(
      'SELECT * FROM support_challan_items WHERE challan_id = $1', [challanId]
    );
    for (const item of itemsRes.rows) {
      if (item.instance_id) {
        await client.query(
          `UPDATE part_instances SET status = 'with_technician', updated_at = NOW()
           WHERE instance_id = $1`,
          [item.instance_id]
        );
        await client.query(
          `UPDATE parts SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
           WHERE part_id = $2`,
          [item.quantity, item.part_id]
        );
      }
      await client.query(
        `UPDATE support_part_requests SET status = 'issued', issued_at = NOW(),
           updated_at = NOW() WHERE id = $1`,
        [item.part_request_id]
      );
    }

    await client.query('COMMIT');

    generateChallanPdf(challanId, challan.challan_number, esignUrl).catch((e) =>
      console.error('challan PDF error:', e.message)
    );

    res.json({
      success: true,
      challan_number: challan.challan_number,
      message: 'Parts issued to technician. Challan signed.'
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};

// ── MARK PART AS USED ─────────────────────────────────────────────────────────

exports.markPartUsed = async (req, res) => {
  const reqId = parseInt(req.params.requestId, 10);
  const {
    old_part_collected,
    old_part_condition,
    old_part_notes,
    old_part_serial,
  } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT spr.*, p.part_name FROM support_part_requests spr
        JOIN parts p ON p.part_id = spr.part_id
       WHERE spr.id = $1 FOR UPDATE OF spr`,
      [reqId]
    );
    if (!r.rows.length) throw Object.assign(new Error('Request not found'), { status: 404 });
    const spr = r.rows[0];

    if (!(await userCanActOnPartRequest(client, spr, req.user)))
      throw Object.assign(new Error('Not authorised'), { status: 403 });
    if (!['issued', 'dispatched', 'delivered'].includes(spr.status))
      throw new Error(`Cannot mark used: status is '${spr.status}'`);

    const needsOldPart = spr.collect_old_part
      && spr.old_part_collection_method === 'tech_collection'
      && spr.old_part_status === 'pending';

    if (needsOldPart && !old_part_collected) {
      throw Object.assign(
        new Error('Collect the old/damaged part from the laptop before marking the new part as used.'),
        { status: 400 }
      );
    }

    let oldPartInstance = null;
    if (needsOldPart && old_part_collected) {
      const { createSupportOldPartWithTech } = require('../services/supportPartReturnDcService');
      oldPartInstance = await createSupportOldPartWithTech(client, {
        supportPartRequest: spr,
        partId: spr.part_id,
        condition: old_part_condition || 'defective',
        serialNumber: old_part_serial || null,
        notes: old_part_notes || null,
        actorUserId: req.user.user_id,
      });
    }

    await client.query(
      `UPDATE support_part_requests SET
         status = 'used',
         used_at = NOW(),
         old_part_collected_at = CASE WHEN $2 THEN NOW() ELSE old_part_collected_at END,
         old_part_condition = COALESCE($3, old_part_condition),
         old_part_notes = COALESCE($4, old_part_notes),
         old_part_serial = COALESCE($5, old_part_serial),
         old_part_instance_id = COALESCE($6, old_part_instance_id),
         old_part_status = CASE
           WHEN $2 THEN 'with_tech'
           WHEN old_part_status = 'not_applicable' THEN old_part_status
           ELSE old_part_status
         END,
         updated_at = NOW()
       WHERE id = $1`,
      [
        reqId,
        Boolean(old_part_collected),
        old_part_condition || null,
        old_part_notes || null,
        old_part_serial || null,
        oldPartInstance?.instance_id || null,
      ]
    );
    if (spr.instance_id) {
      await client.query(
        `UPDATE part_instances SET status='installed',
           installed_ttspl_id=$1, installed_at=NOW(), updated_at=NOW()
         WHERE instance_id=$2`,
        [spr.ttspl_id, spr.instance_id]
      );
    }
    await client.query(
      `UPDATE support_challan_items SET return_status='used' WHERE part_request_id=$1`, [reqId]
    );

    await client.query('COMMIT');
    const msg = oldPartInstance
      ? `Part marked as used. Old part ${oldPartInstance.prt_id} is in your bucket — submit RPDC to warehouse.`
      : 'Part marked as used on laptop.';
    res.json({ success: true, message: msg, old_part: oldPartInstance });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};

// ── RETURN PART ───────────────────────────────────────────────────────────────

exports.returnPart = async (req, res) => {
  const reqId = parseInt(req.params.requestId, 10);
  const { method, esign_data, signer_name } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'SELECT * FROM support_part_requests WHERE id=$1 FOR UPDATE', [reqId]
    );
    if (!r.rows.length) throw Object.assign(new Error('Not found'), { status: 404 });
    const spr = r.rows[0];

    if (!['issued', 'return_requested'].includes(spr.status))
      throw new Error(`Cannot return: status is '${spr.status}'`);

    if (method === 'pickup_request') {
      await client.query(
        `UPDATE support_part_requests SET status='return_requested',
           return_requested_at=NOW(), updated_at=NOW() WHERE id=$1`, [reqId]
      );
      await client.query(
        `UPDATE support_challan_items SET return_status='held' WHERE part_request_id=$1`, [reqId]
      );
      await client.query('COMMIT');
      return res.json({ success: true, message: 'Return request raised. Warehouse will collect.' });
    }

    // method='self' — warehouse confirms with e-sign
    if (!esign_data || !esign_data.startsWith('data:image'))
      throw new Error('Warehouse e-sign required to confirm return');

    const whEsignUrl = saveEsignFile(esign_data, `return_${spr.request_number}`);

    if (spr.instance_id) {
      await client.query(
        `UPDATE part_instances SET status='in_stock', installed_ttspl_id=NULL,
           removed_at=NOW(), condition_on_removal='good', updated_at=NOW()
         WHERE instance_id=$1`,
        [spr.instance_id]
      );
      await client.query(
        `UPDATE parts SET quantity=quantity+$1, updated_at=NOW() WHERE part_id=$2`,
        [spr.quantity, spr.part_id]
      );
    }

    await client.query(
      `UPDATE support_part_requests SET status='returned', returned_at=NOW(),
         returned_to=$1, updated_at=NOW() WHERE id=$2`,
      [req.user.user_id, reqId]
    );
    await client.query(
      `UPDATE support_challan_items SET return_status='returned' WHERE part_request_id=$1`, [reqId]
    );

    let challanNumberForPdf = null;
    if (spr.challan_id) {
      const chRes = await client.query(
        `UPDATE support_part_challans SET
           wh_esign_url=$1, wh_esign_at=NOW(), wh_esign_name=$2,
           status = CASE
             WHEN NOT EXISTS (
               SELECT 1 FROM support_challan_items
               WHERE challan_id=$3 AND return_status='held'
             ) THEN 'fully_returned' ELSE 'partially_returned' END,
           updated_at=NOW()
         WHERE id=$3 RETURNING challan_number`,
        [whEsignUrl, signer_name || req.user.email || 'Warehouse', spr.challan_id]
      );
      challanNumberForPdf = chRes.rows[0]?.challan_number || null;
    }

    await client.query('COMMIT');

    if (spr.challan_id && challanNumberForPdf) {
      generateChallanPdf(spr.challan_id, challanNumberForPdf).catch((e) =>
        console.error('challan PDF error:', e.message)
      );
    }

    res.json({ success: true, message: 'Part returned to warehouse. Stock updated.' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};

// ── WAREHOUSE: ACCEPT RETURN (when pickup method) ─────────────────────────────

exports.acceptReturn = async (req, res) => {
  req.body.method = 'self';
  return exports.returnPart(req, res);
};

// ── TECHNICIAN BUCKET ─────────────────────────────────────────────────────────

exports.getTechnicianBucket = async (req, res) => {
  try {
    const isTech = req.user.role === 'support_tech';
    const params = [];
    let techFilter = '';
    if (isTech) {
      params.push(req.user.user_id);
      techFilter = `AND spr.assigned_to_tech = $1`;
    }

    const { rows } = await pool.query(`
      SELECT spr.*,
             p.part_name, p.category, p.location_code,
             pi.prt_id, pi.location_code AS instance_location,
             u.name AS tech_name, u.email AS tech_email,
             st.customer_name, ${TICKET_NUMBER_SQL} AS ticket_number,
             spc.challan_number, spc.pdf_path
      FROM support_part_requests spr
      JOIN parts p ON p.part_id = spr.part_id
      LEFT JOIN part_instances pi ON pi.instance_id = spr.instance_id
      JOIN users u ON u.user_id = spr.assigned_to_tech
      JOIN support_tickets st ON st.id = spr.support_ticket_id
      LEFT JOIN support_part_challans spc ON spc.id = spr.challan_id
      WHERE spr.status IN ('issued','return_requested')
      ${techFilter}
      ORDER BY spr.issued_at DESC NULLS LAST
    `, params);

    const grouped = {};
    rows.forEach((r) => {
      const key = r.assigned_to_tech;
      if (!grouped[key]) grouped[key] = { tech_id: key, tech_name: r.tech_name, parts: [] };
      grouped[key].parts.push(r);
    });

    // Challans awaiting signature (approved/challan_generated -> not yet issued).
    // Grouped by challan so the UI can show one "sign" card per challan.
    const awaitingRows = (await pool.query(`
      SELECT spr.challan_id, spr.assigned_to_tech,
             u.name AS tech_name,
             st.customer_name, ${TICKET_NUMBER_SQL} AS ticket_number,
             spc.challan_number, spc.ttspl_id, spc.status AS challan_status,
             json_agg(json_build_object(
               'part_name', p.part_name, 'quantity', spr.quantity, 'prt_id', pi.prt_id
             ) ORDER BY spr.id) AS items
      FROM support_part_requests spr
      JOIN parts p ON p.part_id = spr.part_id
      LEFT JOIN part_instances pi ON pi.instance_id = spr.instance_id
      JOIN users u ON u.user_id = spr.assigned_to_tech
      JOIN support_tickets st ON st.id = spr.support_ticket_id
      JOIN support_part_challans spc ON spc.id = spr.challan_id
      WHERE spr.status IN ('approved','challan_generated')
        AND spc.status IN ('draft')
        ${techFilter}
      GROUP BY spr.challan_id, spr.assigned_to_tech, u.name, st.customer_name, st.id,
               spc.challan_number, spc.ttspl_id, spc.status
      ORDER BY spr.challan_id DESC
    `, params)).rows;

    const oldPartRows = (await pool.query(`
      SELECT spr.*,
             p.part_name, p.category,
             opi.prt_id AS old_part_prt_id,
             u.name AS tech_name,
             st.customer_name, ${TICKET_NUMBER_SQL} AS ticket_number
      FROM support_part_requests spr
      JOIN parts p ON p.part_id = spr.part_id
      LEFT JOIN part_instances opi ON opi.instance_id = spr.old_part_instance_id
      JOIN users u ON u.user_id = spr.assigned_to_tech
      JOIN support_tickets st ON st.id = spr.support_ticket_id
      WHERE spr.old_part_status = 'with_tech'
      ${techFilter}
      ORDER BY spr.old_part_collected_at DESC NULLS LAST
    `, params)).rows;

    const oldPartsGrouped = {};
    oldPartRows.forEach((r) => {
      const key = r.assigned_to_tech;
      if (!oldPartsGrouped[key]) {
        oldPartsGrouped[key] = { tech_id: key, tech_name: r.tech_name, old_parts: [] };
      }
      oldPartsGrouped[key].old_parts.push(r);
    });

    res.json({
      success: true,
      bucket: Object.values(grouped),
      old_parts_bucket: Object.values(oldPartsGrouped),
      awaiting: awaitingRows,
      total: rows.length,
      old_parts_total: oldPartRows.length,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── GET CHALLAN ───────────────────────────────────────────────────────────────

exports.getChallan = async (req, res) => {
  try {
    const challanId = parseInt(req.params.challanId, 10);
    const challanRes = await pool.query(
      `SELECT sc.*, u.name AS tech_name, u.email AS tech_email,
              ist.name AS issued_by_name,
              st.customer_name, st.id AS ticket_id,
              ${TICKET_NUMBER_SQL} AS ticket_number
       FROM support_part_challans sc
       JOIN users u ON u.user_id = sc.issued_to
       LEFT JOIN users ist ON ist.user_id = sc.issued_by
       JOIN support_tickets st ON st.id = sc.support_ticket_id
       WHERE sc.id = $1`,
      [challanId]
    );
    if (!challanRes.rows.length)
      return res.status(404).json({ success: false, message: 'Challan not found' });

    const items = await pool.query(
      'SELECT * FROM support_challan_items WHERE challan_id = $1 ORDER BY id', [challanId]
    );

    res.json({ success: true, challan: challanRes.rows[0], items: items.rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── WAREHOUSE QUEUE ───────────────────────────────────────────────────────────

exports.getWarehouseQueue = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT spr.*,
             p.part_name, p.category, p.quantity AS stock_qty,
             p.location_code, p.cost AS unit_cost,
             COALESCE(pi_count.available, 0) AS instances_available,
             GREATEST(COALESCE(pi_count.available, 0), COALESCE(p.quantity, 0))::int AS available,
             u.name AS tech_name,
             st.customer_name, ${TICKET_NUMBER_SQL} AS ticket_number
      FROM support_part_requests spr
      JOIN parts p ON p.part_id = spr.part_id
      LEFT JOIN (
        SELECT part_id, COUNT(*) AS available
        FROM part_instances WHERE status='in_stock' GROUP BY part_id
      ) pi_count ON pi_count.part_id = p.part_id
      JOIN users u ON u.user_id = spr.assigned_to_tech
      JOIN support_tickets st ON st.id = spr.support_ticket_id
      WHERE spr.status IN ('pending','return_requested')
      ORDER BY spr.created_at ASC
    `);

    const pending = rows.filter((r) => r.status === 'pending');
    const returns = rows.filter((r) => r.status === 'return_requested');

    // Reassignment requests: part is still issued/held by the tech, but they
    // asked to move it to a different ticket. Warehouse approves the move.
    const reassignRes = await pool.query(`
      SELECT spr.id, spr.request_number, spr.quantity, spr.status,
             spr.reassign_reason, spr.reassign_requested_at,
             spr.reassign_to_ticket_id, spr.reassign_to_ttspl_id, spr.reassign_to_serial,
             p.part_name, pi.prt_id,
             u.name AS tech_name,
             ${TICKET_NUMBER_SQL} AS from_ticket_number, st.customer_name AS from_customer,
             spr.ttspl_id AS from_ttspl_id,
             ('STK-' || LPAD(stn.id::text, 4, '0')) AS to_ticket_number,
             stn.customer_name AS to_customer
      FROM support_part_requests spr
      JOIN parts p ON p.part_id = spr.part_id
      LEFT JOIN part_instances pi ON pi.instance_id = spr.instance_id
      JOIN users u ON u.user_id = spr.assigned_to_tech
      JOIN support_tickets st ON st.id = spr.support_ticket_id
      LEFT JOIN support_tickets stn ON stn.id = spr.reassign_to_ticket_id
      WHERE spr.reassign_requested_at IS NOT NULL
        AND spr.status IN ('issued','return_requested')
      ORDER BY spr.reassign_requested_at ASC
    `);
    const reassigns = reassignRes.rows;

    res.json({
      success: true,
      pending,
      returns,
      reassigns,
      total: rows.length + reassigns.length,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── PARTS MOVEMENT HISTORY (inventory ledger) ─────────────────────────────────
// Full audit of parts that left the warehouse to a technician: who took it,
// when, against which ticket/machine, the issue e-sign, and the return details.

exports.getPartsHistory = async (req, res) => {
  try {
    const { search, status, tech_id, from, to } = req.query;
    const params = [];
    let where = `WHERE spr.status IN ('issued','used','return_requested','returned')`;

    if (status) {
      params.push(status);
      where += ` AND spr.status = $${params.length}`;
    }
    if (tech_id) {
      params.push(Number(tech_id));
      where += ` AND spr.assigned_to_tech = $${params.length}`;
    }
    if (from) {
      params.push(from);
      where += ` AND spr.issued_at >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      where += ` AND spr.issued_at <= ($${params.length}::date + INTERVAL '1 day')`;
    }
    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      where += ` AND (
        p.part_name ILIKE $${i}
        OR spr.ttspl_id ILIKE $${i}
        OR spr.serial_number ILIKE $${i}
        OR spr.request_number ILIKE $${i}
        OR u.name ILIKE $${i}
        OR pi.prt_id ILIKE $${i}
        OR CAST(spr.support_ticket_id AS TEXT) LIKE $${i}
      )`;
    }

    const { rows } = await pool.query(`
      SELECT spr.id, spr.request_number, spr.quantity, spr.status,
             spr.ttspl_id, spr.serial_number,
             spr.issued_at, spr.used_at, spr.returned_at, spr.return_requested_at,
             ${TICKET_NUMBER_SQL} AS ticket_number, spr.support_ticket_id,
             st.customer_name,
             p.part_name, p.category, pi.prt_id,
             u.name AS tech_name,
             rb.name AS returned_to_name,
             spc.challan_number, spc.tech_esign_url, spc.wh_esign_url,
             spc.pdf_path, spc.return_pdf_path, spc.id AS challan_id
      FROM support_part_requests spr
      JOIN parts p ON p.part_id = spr.part_id
      LEFT JOIN part_instances pi ON pi.instance_id = spr.instance_id
      JOIN users u ON u.user_id = spr.assigned_to_tech
      LEFT JOIN users rb ON rb.user_id = spr.returned_to
      JOIN support_tickets st ON st.id = spr.support_ticket_id
      LEFT JOIN support_part_challans spc ON spc.id = spr.challan_id
      ${where}
      ORDER BY spr.issued_at DESC NULLS LAST, spr.id DESC
      LIMIT 500
    `, params);

    res.json({ success: true, history: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── TECHNICIAN: REQUEST REASSIGN TO ANOTHER TICKET ───────────────────────────

exports.requestReassign = async (req, res) => {
  const reqId = parseInt(req.params.requestId, 10);
  const { to_ticket_id, to_item_id, to_ttspl_id, to_serial, reason } = req.body;

  if (!to_ticket_id)
    return res.status(400).json({ success: false, message: 'to_ticket_id is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'SELECT * FROM support_part_requests WHERE id = $1 FOR UPDATE', [reqId]
    );
    if (!r.rows.length) throw Object.assign(new Error('Request not found'), { status: 404 });
    const spr = r.rows[0];

    if (spr.assigned_to_tech !== req.user.user_id &&
        !['admin', 'support_lead', 'manager', 'warehouse', 'super_admin'].includes(req.user.role))
      throw Object.assign(new Error('Not authorised'), { status: 403 });
    if (spr.status !== 'issued')
      throw new Error(`Only parts currently in your bucket can be moved (status: ${spr.status})`);
    if (spr.reassign_requested_at)
      throw new Error('A reassignment request is already pending for this part');
    if (Number(to_ticket_id) === Number(spr.support_ticket_id))
      throw new Error('Part is already assigned to this ticket');

    const tkt = await client.query('SELECT id FROM support_tickets WHERE id = $1', [Number(to_ticket_id)]);
    if (!tkt.rows.length) throw Object.assign(new Error('Target ticket not found'), { status: 404 });

    await client.query(
      `UPDATE support_part_requests SET
         reassign_to_ticket_id = $1, reassign_to_item_id = $2,
         reassign_to_ttspl_id = $3, reassign_to_serial = $4,
         reassign_reason = $5, reassign_requested_at = NOW(), reassign_requested_by = $6,
         updated_at = NOW()
       WHERE id = $7`,
      [Number(to_ticket_id), to_item_id || null, to_ttspl_id || null,
       to_serial || null, reason || null, req.user.user_id, reqId]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Reassignment requested. Warehouse will confirm the move.' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};

// ── WAREHOUSE: APPROVE / REJECT REASSIGN ─────────────────────────────────────

exports.resolveReassign = async (req, res) => {
  const reqId = parseInt(req.params.requestId, 10);
  const { action } = req.body; // 'approve' | 'reject'

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'SELECT * FROM support_part_requests WHERE id = $1 FOR UPDATE', [reqId]
    );
    if (!r.rows.length) throw Object.assign(new Error('Request not found'), { status: 404 });
    const spr = r.rows[0];
    if (!spr.reassign_requested_at)
      throw new Error('No reassignment request is pending for this part');

    if (action === 'reject') {
      await client.query(
        `UPDATE support_part_requests SET
           notes = COALESCE(notes || E'\\n', '') || $1,
           reassign_to_ticket_id = NULL, reassign_to_item_id = NULL,
           reassign_to_ttspl_id = NULL, reassign_to_serial = NULL,
           reassign_reason = NULL, reassign_requested_at = NULL, reassign_requested_by = NULL,
           updated_at = NOW()
         WHERE id = $2`,
        [`Reassignment to ticket #${spr.reassign_to_ticket_id} rejected by ${req.user.email || 'warehouse'}.`, reqId]
      );
      await client.query('COMMIT');
      return res.json({ success: true, message: 'Reassignment rejected. Part stays on the original ticket.' });
    }

    // approve -> re-point the request to the new ticket / machine
    const note = `Part moved from ticket #${spr.support_ticket_id} to #${spr.reassign_to_ticket_id} (approved by ${req.user.email || 'warehouse'}).`;
    await client.query(
      `UPDATE support_part_requests SET
         support_ticket_id = reassign_to_ticket_id,
         support_item_id   = reassign_to_item_id,
         ttspl_id          = COALESCE(reassign_to_ttspl_id, ttspl_id),
         serial_number     = COALESCE(reassign_to_serial, serial_number),
         notes = COALESCE(notes || E'\\n', '') || $1,
         reassign_to_ticket_id = NULL, reassign_to_item_id = NULL,
         reassign_to_ttspl_id = NULL, reassign_to_serial = NULL,
         reassign_reason = NULL, reassign_requested_at = NULL, reassign_requested_by = NULL,
         updated_at = NOW()
       WHERE id = $2`,
      [note, reqId]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Part reassigned to the new ticket.' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};
