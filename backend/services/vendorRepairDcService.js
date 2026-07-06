const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { closeOpenWorkLogs } = require('./ticketWorkLogService');
const { logTtsplEvent } = require('./ttsplAuditService');
const { generateVendorRepairPdf } = require('./vendorRepairPdfService');
const { appendDateRangeClauses } = require('../utils/dateRangeFilter');
const {
  pickSpecFilters,
  hasSpecFilters,
  buildTicketSpecFilter,
  appendRepairSpecClauses,
  vendorRepairSpecExpr,
  erpRepairSpecExpr,
} = require('../utils/inventorySpecFilter');

const WAREHOUSE_ROLES = new Set(['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead']);
const HW_SW_STAGES = new Set([
  'Diagnosis', 'Assembly & Software', 'Final Testing', 'Chip Level Repair', 'Body & Paint',
]);

let schemaEnsured = false;

function currentFinancialYearLabel(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const startYear = month >= 4 ? year : year - 1;
  const a = String(startYear % 100).padStart(2, '0');
  const b = String((startYear + 1) % 100).padStart(2, '0');
  return `${a}-${b}`;
}

async function ensureVendorRepairSchema() {
  if (schemaEnsured) return;
  for (const file of ['121_diagnosis_failed_vendor_repair.sql', '124_vendor_repair_enhancements.sql', '125_vendor_repair_dispatch.sql', '129_vendor_repair_dispatch_pod.sql']) {
    const migrationPath = path.join(__dirname, '../migrations', file);
    if (fs.existsSync(migrationPath)) {
      await pool.query(fs.readFileSync(migrationPath, 'utf8'));
    }
  }
  schemaEnsured = true;
}

function configString(ticket) {
  return [ticket.brand, ticket.model, ticket.processor, ticket.generation, ticket.ram, ticket.storage]
    .filter(Boolean).join(' · ');
}

function saveEsign(prefix, dcNumber, dataUrl) {
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const dir = path.join(__dirname, '../uploads/vendor-repair');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(dcNumber).replace(/[^\w-]+/g, '_');
  const filename = `${prefix}_${safe}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), Buffer.from(m[2], 'base64'));
  return `vendor-repair/${filename}`;
}

function saveDispatchPod(dcNumber, dataUrl) {
  return saveEsign('dispatch_pod', dcNumber, dataUrl);
}

async function logTicketActivity(client, { ticketId, userId, action, notes, stageId }) {
  await client.query(
    `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes, created_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
    [ticketId, stageId || null, userId || null, action, notes || null]
  );
}

async function nextReceiveDcNumber(client, dispatchDcNumber) {
  const r = await client.query(
    `SELECT COALESCE(MAX((regexp_match(receive_dc_number, '-R([0-9]+)$'))[1]::int), 0) + 1 AS n
       FROM vendor_repair_dc_items
      WHERE dc_number = $1 AND receive_dc_number IS NOT NULL`,
    [dispatchDcNumber]
  );
  const seq = String(r.rows[0]?.n || 1).padStart(2, '0');
  return `${dispatchDcNumber}-R${seq}`;
}

const { formatCompanyBlock } = require('../utils/companyDefaults');

function defaultBillingAddress() {
  return formatCompanyBlock();
}

function normalizeShipBy(shipBy, dispatchMode) {
  if (shipBy === 'by_hand' || shipBy === 'by_courier' || shipBy === 'by_porter') return shipBy;
  if (dispatchMode === 'inhouse') return 'by_hand';
  if (dispatchMode === 'porter') return 'by_porter';
  if (dispatchMode === 'courier') return 'by_courier';
  return null;
}

function shipByToDispatchMode(shipBy) {
  if (shipBy === 'by_hand') return 'inhouse';
  if (shipBy === 'by_porter') return 'porter';
  if (shipBy === 'courier') return 'courier';
  return null;
}

function validateDispatchDetails({ shipBy, courierName, porterTrackingId, deliveryPersonId }) {
  if (!shipBy) throw new Error('Send mode is required (By Hand, Courier, or Porter)');
  if (shipBy === 'by_courier' && !courierName?.trim()) {
    throw new Error('Courier name is required for By Courier dispatch');
  }
  if (shipBy === 'by_porter' && !porterTrackingId?.trim()) {
    throw new Error('Porter tracking / booking ID is required');
  }
  if (shipBy === 'by_hand' && !deliveryPersonId) {
    throw new Error('Delivery person is required for By Hand dispatch');
  }
}

function dispatchPayloadFromBody(body) {
  const shipBy = normalizeShipBy(body.ship_by || body.shipBy, body.dispatch_mode || body.dispatchMode);
  const dispatchMode = shipByToDispatchMode(shipBy) || body.dispatch_mode || body.dispatchMode;
  const rawDeliveryPersonId = body.delivery_person_id ?? body.deliveryPersonId;
  const deliveryPersonId = rawDeliveryPersonId != null && String(rawDeliveryPersonId).trim() !== ''
    ? Number(rawDeliveryPersonId)
    : null;
  validateDispatchDetails({
    shipBy,
    courierName: body.courier_name || body.courierName,
    porterTrackingId: body.porter_tracking_id || body.porterTrackingId,
    deliveryPersonId,
  });
  return {
    ship_by: shipBy,
    dispatch_mode: dispatchMode,
    courier_name: shipBy === 'by_courier' ? (body.courier_name || body.courierName || '').trim() || null : null,
    awb_number: shipBy === 'by_courier' ? (body.awb_number || body.awbNumber || '').trim() || null : null,
    courier_tracking_url: shipBy === 'by_courier' ? (body.courier_tracking_url || body.courierTrackingUrl || '').trim() || null : null,
    porter_tracking_id: shipBy === 'by_porter' ? (body.porter_tracking_id || body.porterTrackingId || '').trim() || null : null,
    porter_order_id: shipBy === 'by_porter' ? (body.porter_order_id || body.porterOrderId || '').trim() || null : null,
    porter_booking_url: shipBy === 'by_porter' ? (body.porter_booking_url || body.porterBookingUrl || '').trim() || null : null,
    delivery_person_id: shipBy === 'by_hand' && deliveryPersonId ? Number(deliveryPersonId) : null,
  };
}

async function nextVendorRepairDcNumber(client) {
  const fy = currentFinancialYearLabel();
  const r = await client.query(
    `SELECT COALESCE(MAX((regexp_match(dc_number, '/([0-9]+)$'))[1]::int), 0) + 1 AS n
       FROM vendor_repair_delivery_challans
      WHERE dc_number LIKE $1`,
    [`VRDC/${fy}/%`]
  );
  const seq = String(r.rows[0]?.n || 1).padStart(4, '0');
  return `VRDC/${fy}/${seq}`;
}

async function markDiagnosisFailed(client, {
  ticketId, reason, actorUserId, actorName,
}) {
  if (!reason?.trim()) throw new Error('Failure reason is required');

  const tRes = await client.query(
    `SELECT t.*, s.stage_name
       FROM tickets t
       LEFT JOIN stages s ON s.stage_id = t.current_stage_id
      WHERE t.ticket_id = $1 FOR UPDATE OF t`,
    [ticketId]
  );
  const ticket = tRes.rows[0];
  if (!ticket) throw new Error('Ticket not found');
  if (ticket.status === 'diagnosis_failed') return { already_failed: true };
  if (['completed', 'cancelled', 'out_for_repair'].includes(ticket.status)) {
    throw new Error(`Cannot mark diagnosis failed from status "${ticket.status}"`);
  }
  if (ticket.stage_name && !HW_SW_STAGES.has(ticket.stage_name) && ticket.stage_name !== 'Floor Manager') {
    throw new Error('Diagnosis Failed is only available during Hardware & Software / Diagnosis stages');
  }

  await closeOpenWorkLogs(client, ticketId);

  await client.query(
    `UPDATE tickets SET
        status = 'diagnosis_failed',
        diagnosis_failed_at = NOW(),
        diagnosis_failed_reason = $2,
        diagnosis_failed_by = $3,
        previous_technician_id = assigned_user_id,
        previous_stage_id = current_stage_id,
        assigned_user_id = NULL,
        assigned_team_id = NULL,
        current_location = COALESCE(current_location, 'Warehouse'),
        highlighted = TRUE,
        highlighted_reason = $2,
        updated_at = NOW()
      WHERE ticket_id = $1`,
    [ticketId, reason.trim(), actorUserId]
  );

  if (ticket.vendor_serial_id) {
    await client.query(
      `UPDATE vendor_serial_numbers SET qc_status = 'pending', updated_at = NOW() WHERE serial_id = $1`,
      [ticket.vendor_serial_id]
    );
  }

  await logTicketActivity(client, {
    ticketId,
    userId: actorUserId,
    stageId: ticket.current_stage_id,
    action: 'diagnosis_failed',
    notes: reason.trim(),
  });

  await logTtsplEvent({
    ttsplId: ticket.ttspl_id,
    vendorSerialId: ticket.vendor_serial_id,
    eventType: 'diagnosis_failed',
    description: `Diagnosis failed: ${reason.trim()}`,
    metadata: {
      previous_technician_id: ticket.assigned_user_id,
      previous_stage_id: ticket.current_stage_id,
      previous_stage: ticket.stage_name,
    },
    actorUserId,
    actorName,
    db: client,
  });

  return { ticket_id: ticketId, status: 'diagnosis_failed' };
}

async function listDiagnosisFailedTickets({
  dateFrom,
  dateTo,
  brand,
  model,
  processor,
  generation,
  ram,
  storage,
  screen_size,
  gpu,
} = {}) {
  const specFilters = pickSpecFilters({
    brand, model, processor, generation, ram, storage, screen_size, gpu,
  });
  const params = [];
  const specFilter = buildTicketSpecFilter(specFilters, params, 't');
  const ticketJoins = specFilter.joinSql || `
       LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = t.vendor_serial_id AND vsn.deleted_at IS NULL
       LEFT JOIN inventory inv ON LOWER(TRIM(inv.serial_number)) = LOWER(TRIM(t.serial_number))`;
  const dateClauses = appendDateRangeClauses({
    expr: 'COALESCE(t.diagnosis_failed_at, t.created_at)',
    dateFrom,
    dateTo,
    params,
  });
  const dateSql = dateClauses.length ? ` AND ${dateClauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT t.ticket_id, t.ttspl_id, t.serial_number, t.status, t.brand, t.model,
            t.processor, t.ram, t.storage, t.diagnosis_failed_at,
            t.diagnosis_failed_reason, t.current_location, t.created_at,
            t.previous_technician_id, t.previous_stage_id,
            COALESCE(NULLIF(TRIM(vsn.extra->>'generation'), ''), inv.generation, '') AS generation,
            ps.stage_name AS previous_stage_name,
            pu.name AS previous_technician_name
       FROM tickets t
       ${ticketJoins}
       LEFT JOIN stages ps ON ps.stage_id = t.previous_stage_id
       LEFT JOIN users pu ON pu.user_id = t.previous_technician_id
      WHERE t.status = 'diagnosis_failed'
        AND NOT EXISTS (
          SELECT 1 FROM vendor_repair_dc_items vi
          JOIN vendor_repair_delivery_challans vd ON vd.dc_number = vi.dc_number
          WHERE vi.ticket_id = t.ticket_id
            AND vd.status IN ('draft', 'dispatched', 'partially_returned')
        )${dateSql}${specFilter.whereSql}
      ORDER BY t.diagnosis_failed_at DESC NULLS LAST, t.ticket_id DESC`,
    params
  );
  return rows.map((r) => ({
    ...r,
    configuration: configString(r),
  }));
}

async function createOutForRepairDc(client, {
  ticketIds,
  vendorId,
  vendorName,
  vendorAddress,
  vendorBillingAddress,
  billingAddress,
  shippingAddress,
  contactPerson,
  contactMobile,
  expectedReturnDate,
  remarks,
  warehouseName,
  warehouseAddress,
  itemRemarks = {},
  ship_by,
  shipBy,
  dispatch_mode,
  courier_name,
  awb_number,
  courier_tracking_url,
  porter_tracking_id,
  porter_order_id,
  porter_booking_url,
  delivery_person_id,
  actorUserId,
  actorName,
}) {
  if (!Array.isArray(ticketIds) || !ticketIds.length) {
    throw new Error('Select at least one laptop');
  }
  if (!vendorName?.trim()) throw new Error('Vendor name is required');
  const vendorBillAddr = (vendorBillingAddress || vendorAddress)?.trim();
  const shipAddr = shippingAddress?.trim();
  if (!vendorBillAddr) throw new Error('Vendor billing address is required');
  if (!shipAddr) throw new Error('Vendor shipping address is required');
  const billAddr = defaultBillingAddress();
  const dispatch = dispatchPayloadFromBody({
    ship_by: ship_by || shipBy,
    dispatch_mode,
    courier_name,
    awb_number,
    courier_tracking_url,
    porter_tracking_id,
    porter_order_id,
    porter_booking_url,
    delivery_person_id,
  });

  const tRes = await client.query(
    `SELECT t.*, s.stage_name,
            COALESCE(NULLIF(TRIM(vsn.extra->>'generation'), ''), '') AS generation
       FROM tickets t
       LEFT JOIN stages s ON s.stage_id = t.current_stage_id
       LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = t.vendor_serial_id
      WHERE t.ticket_id = ANY($1::int[]) FOR UPDATE OF t`,
    [ticketIds]
  );
  if (tRes.rows.length !== ticketIds.length) {
    throw new Error('One or more tickets were not found');
  }
  const invalid = tRes.rows.filter((t) => t.status !== 'diagnosis_failed');
  if (invalid.length) {
    throw new Error('All selected laptops must be in Diagnosis Failed status');
  }

  const dcNumber = await nextVendorRepairDcNumber(client);
  await client.query(
    `INSERT INTO vendor_repair_delivery_challans (
        dc_number, vendor_id, vendor_name, vendor_address, billing_address, shipping_address,
        contact_person, contact_mobile,
        expected_return_date, remarks, warehouse_name, warehouse_address, status, created_by,
        items_dispatched_count, items_received_count,
        ship_by, dispatch_mode, courier_name, awb_number, courier_tracking_url,
        porter_tracking_id, porter_order_id, porter_booking_url, delivery_person_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',$13,0,0,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [
      dcNumber,
      vendorId || null,
      vendorName.trim(),
      vendorBillAddr,
      billAddr,
      shipAddr,
      contactPerson?.trim() || null,
      contactMobile?.trim() || null,
      expectedReturnDate || null,
      remarks?.trim() || null,
      warehouseName?.trim() || 'TRUETECH SERVICES PRIVATE LIMITED',
      warehouseAddress?.trim() || billAddr,
      actorUserId,
      dispatch.ship_by,
      dispatch.dispatch_mode,
      dispatch.courier_name,
      dispatch.awb_number,
      dispatch.courier_tracking_url,
      dispatch.porter_tracking_id,
      dispatch.porter_order_id,
      dispatch.porter_booking_url,
      dispatch.delivery_person_id,
    ]
  );

  for (const ticket of tRes.rows) {
    const configuration = configString(ticket);
    const itemRemark = itemRemarks[ticket.ticket_id]
      || itemRemarks[String(ticket.ticket_id)]
      || ticket.diagnosis_failed_reason
      || null;
    await client.query(
      `INSERT INTO vendor_repair_dc_items (
          dc_number, ticket_id, serial_id, ttspl_id, serial_number, configuration, item_remarks, item_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft')`,
      [dcNumber, ticket.ticket_id, ticket.vendor_serial_id, ticket.ttspl_id, ticket.serial_number, configuration, itemRemark]
    );
    await client.query(
      `UPDATE tickets SET vendor_repair_dc_number = $2, current_location = 'Warehouse — pending dispatch', updated_at = NOW()
        WHERE ticket_id = $1`,
      [ticket.ticket_id, dcNumber]
    );
    await logTtsplEvent({
      ttsplId: ticket.ttspl_id,
      vendorSerialId: ticket.vendor_serial_id,
      eventType: 'vendor_dc_generated',
      description: `Vendor repair DC ${dcNumber} created`,
      metadata: { dc_number: dcNumber, vendor_name: vendorName.trim() },
      actorUserId,
      actorName,
      db: client,
    });
    await logTtsplEvent({
      ttsplId: ticket.ttspl_id,
      vendorSerialId: ticket.vendor_serial_id,
      eventType: 'vendor_assigned',
      description: `Assigned to repair vendor: ${vendorName.trim()}`,
      metadata: { dc_number: dcNumber, vendor_name: vendorName.trim() },
      actorUserId,
      actorName,
      db: client,
    });
  }

  return { dc_number: dcNumber };
}

function vendorDisplayName(vendor) {
  if (!vendor) return '';
  return vendor.business_name
    || [vendor.first_name, vendor.last_name].filter(Boolean).join(' ').trim()
    || vendor.f_name
    || '';
}

function formatVendorBillingFromRow(vendor) {
  if (!vendor) return '';
  const lines = [vendorDisplayName(vendor)].filter(Boolean);
  const street = [vendor.address, vendor.city, vendor.state, vendor.pincode].filter(Boolean).join(', ');
  if (street) lines.push(street);
  return lines.join('\n');
}

function formatVendorShippingFromRow(vendor) {
  if (!vendor) return '';
  if (vendor.shipping_same !== false) return formatVendorBillingFromRow(vendor);
  const lines = [vendorDisplayName(vendor)].filter(Boolean);
  const street = [vendor.shipping_address, vendor.shipping_city, vendor.shipping_state, vendor.shipping_pincode]
    .filter(Boolean).join(', ');
  if (street) lines.push(street);
  return lines.join('\n');
}

async function getVendorRepairDc(dcNumber) {
  const headRes = await pool.query(
    `SELECT d.*,
            v.business_name AS vendor_business_name,
            v.first_name AS vendor_first_name,
            v.last_name AS vendor_last_name,
            v.address AS vendor_reg_address,
            v.city AS vendor_reg_city,
            v.state AS vendor_reg_state,
            v.pincode AS vendor_reg_pincode,
            v.shipping_same AS vendor_shipping_same,
            v.shipping_address AS vendor_ship_address,
            v.shipping_city AS vendor_ship_city,
            v.shipping_state AS vendor_ship_state,
            v.shipping_pincode AS vendor_ship_pincode,
            dt.first_name AS delivery_person_first_name,
            dt.last_name AS delivery_person_last_name,
            dt.phone AS delivery_person_phone
       FROM vendor_repair_delivery_challans d
       LEFT JOIN vendors v ON v.vendor_id = d.vendor_id AND v.deleted_at IS NULL
       LEFT JOIN delivery_technicians dt ON dt.technician_id = d.delivery_person_id
      WHERE d.dc_number = $1`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) return null;
  const itemsRes = await pool.query(
    `SELECT i.*, t.status AS ticket_status, t.diagnosis_failed_reason
       FROM vendor_repair_dc_items i
       JOIN tickets t ON t.ticket_id = i.ticket_id
      WHERE i.dc_number = $1
      ORDER BY i.id ASC`,
    [dcNumber]
  );
  const vendorMaster = head.vendor_id ? {
    business_name: head.vendor_business_name,
    first_name: head.vendor_first_name,
    last_name: head.vendor_last_name,
    address: head.vendor_reg_address,
    city: head.vendor_reg_city,
    state: head.vendor_reg_state,
    pincode: head.vendor_reg_pincode,
    shipping_same: head.vendor_shipping_same,
    shipping_address: head.vendor_ship_address,
    shipping_city: head.vendor_ship_city,
    shipping_state: head.vendor_ship_state,
    shipping_pincode: head.vendor_ship_pincode,
  } : null;
  const vendor_billing_display = formatVendorBillingFromRow(vendorMaster) || head.vendor_address || head.vendor_name;
  const vendor_shipping_display = formatVendorShippingFromRow(vendorMaster) || head.shipping_address || head.vendor_address;
  const delivery_person_name = [head.delivery_person_first_name, head.delivery_person_last_name]
    .filter(Boolean).join(' ').trim() || null;
  return {
    ...head,
    company_from_display: formatCompanyBlock(),
    vendor_billing_display,
    vendor_shipping_display,
    delivery_person_name,
    vendor_delivery_status: head.vendor_delivered_at ? 'delivered' : (head.dispatched_at ? 'in_transit' : 'pending'),
    items: itemsRes.rows,
  };
}

async function updateVendorRepairDispatchDetails(client, { dcNumber, body, actorUserId }) {
  const headRes = await client.query(
    `SELECT * FROM vendor_repair_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Vendor repair DC not found');
  if (head.status !== 'draft') throw new Error('Dispatch details can only be edited while DC is in draft');

  const dispatch = dispatchPayloadFromBody(body);
  await client.query(
    `UPDATE vendor_repair_delivery_challans SET
        ship_by = $2,
        dispatch_mode = $3,
        courier_name = $4,
        awb_number = $5,
        courier_tracking_url = $6,
        porter_tracking_id = $7,
        porter_order_id = $8,
        porter_booking_url = $9,
        delivery_person_id = $10,
        updated_at = NOW()
      WHERE dc_number = $1`,
    [
      dcNumber,
      dispatch.ship_by,
      dispatch.dispatch_mode,
      dispatch.courier_name,
      dispatch.awb_number,
      dispatch.courier_tracking_url,
      dispatch.porter_tracking_id,
      dispatch.porter_order_id,
      dispatch.porter_booking_url,
      dispatch.delivery_person_id,
    ]
  );
  return { dc_number: dcNumber, ...dispatch };
}

async function markDeliveredToVendor(client, { dcNumber, actorUserId, actorName }) {
  const headRes = await client.query(
    `SELECT * FROM vendor_repair_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Vendor repair DC not found');
  if (head.status === 'draft') throw new Error('DC must be dispatched before marking delivered to vendor');
  if (head.status === 'returned') throw new Error('DC already fully returned from vendor');
  if (head.vendor_delivered_at) return { already_delivered: true, dc_number: dcNumber };

  await client.query(
    `UPDATE vendor_repair_delivery_challans SET
        vendor_delivered_at = NOW(),
        vendor_delivered_by = $2,
        updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber, actorUserId]
  );

  const itemsRes = await client.query(
    `SELECT i.ticket_id, i.ttspl_id, t.vendor_serial_id, t.ttspl_id AS ticket_ttspl
       FROM vendor_repair_dc_items i
       JOIN tickets t ON t.ticket_id = i.ticket_id
      WHERE i.dc_number = $1`,
    [dcNumber]
  );

  for (const item of itemsRes.rows) {
    await logTtsplEvent({
      ttsplId: item.ttspl_id || item.ticket_ttspl,
      vendorSerialId: item.vendor_serial_id,
      eventType: 'delivered_to_vendor',
      description: `Delivered to vendor via ${dcNumber}`,
      metadata: { dc_number: dcNumber, vendor_name: head.vendor_name },
      actorUserId,
      actorName,
      db: client,
    });
    await logTicketActivity(client, {
      ticketId: item.ticket_id,
      userId: actorUserId,
      action: 'delivered_to_vendor',
      notes: `Confirmed delivered to ${head.vendor_name} (${dcNumber})`,
    });
  }

  const pdfPath = await generateVendorRepairPdf(dcNumber);
  if (pdfPath) {
    await client.query(
      `UPDATE vendor_repair_delivery_challans SET pdf_path = $2, updated_at = NOW() WHERE dc_number = $1`,
      [dcNumber, pdfPath]
    );
  }

  return { dc_number: dcNumber, vendor_delivered_at: new Date().toISOString(), pdf_path: pdfPath };
}

async function signDispatchDc(client, {
  dcNumber,
  warehouseEsign,
  vendorEsign,
  dispatchBody,
  dispatchPod,
  actorUserId,
  actorName,
}) {
  const headRes = await client.query(
    `SELECT * FROM vendor_repair_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Vendor repair DC not found');
  if (head.status === 'dispatched') return { already_dispatched: true };
  if (head.status === 'returned') throw new Error('DC already returned');
  if (head.status !== 'draft') throw new Error('DC must be in draft to dispatch');

  let dispatch = null;
  if (dispatchBody && (dispatchBody.ship_by || dispatchBody.shipBy || dispatchBody.dispatch_mode)) {
    dispatch = dispatchPayloadFromBody(dispatchBody);
  } else if (head.ship_by || head.dispatch_mode) {
    dispatch = {
      ship_by: head.ship_by,
      dispatch_mode: head.dispatch_mode,
      courier_name: head.courier_name,
      awb_number: head.awb_number,
      courier_tracking_url: head.courier_tracking_url,
      porter_tracking_id: head.porter_tracking_id,
      porter_order_id: head.porter_order_id,
      porter_booking_url: head.porter_booking_url,
      delivery_person_id: head.delivery_person_id,
    };
  } else {
    throw new Error('Send mode is required before dispatch (select By Hand, Courier, or Porter)');
  }

  const whUrl = warehouseEsign ? saveEsign('wh_dispatch', dcNumber, warehouseEsign) : head.warehouse_dispatch_esign_url;
  const vUrl = vendorEsign ? saveEsign('vendor_dispatch', dcNumber, vendorEsign) : head.vendor_dispatch_esign_url;
  if (!whUrl || !vUrl) throw new Error('Warehouse and vendor dispatch e-signatures are required');

  const podPath = dispatchPod ? saveDispatchPod(dcNumber, dispatchPod) : head.dispatch_pod_path || null;

  await client.query(
    `UPDATE vendor_repair_delivery_challans SET
        warehouse_dispatch_esign_url = $2,
        vendor_dispatch_esign_url = $3,
        ship_by = $4,
        dispatch_mode = $5,
        courier_name = $6,
        awb_number = $7,
        courier_tracking_url = $8,
        porter_tracking_id = $9,
        porter_order_id = $10,
        porter_booking_url = $11,
        delivery_person_id = $12,
        dispatch_pod_path = COALESCE($13, dispatch_pod_path),
        status = 'dispatched',
        dispatched_at = NOW(),
        items_dispatched_count = (SELECT COUNT(*)::int FROM vendor_repair_dc_items WHERE dc_number = $1),
        updated_at = NOW()
      WHERE dc_number = $1`,
    [
      dcNumber,
      whUrl,
      vUrl,
      dispatch.ship_by,
      dispatch.dispatch_mode,
      dispatch.courier_name,
      dispatch.awb_number,
      dispatch.courier_tracking_url,
      dispatch.porter_tracking_id,
      dispatch.porter_order_id,
      dispatch.porter_booking_url,
      dispatch.delivery_person_id,
      podPath,
    ]
  );

  await client.query(
    `UPDATE vendor_repair_dc_items SET item_status = 'dispatched' WHERE dc_number = $1`,
    [dcNumber]
  );

  const itemsRes = await client.query(
    `SELECT i.ticket_id, i.serial_id, i.ttspl_id, t.ttspl_id AS ticket_ttspl, t.vendor_serial_id
       FROM vendor_repair_dc_items i
       JOIN tickets t ON t.ticket_id = i.ticket_id
      WHERE i.dc_number = $1`,
    [dcNumber]
  );

  for (const item of itemsRes.rows) {
    await client.query(
      `UPDATE tickets SET status = 'out_for_repair', current_location = $2, updated_at = NOW()
        WHERE ticket_id = $1`,
      [item.ticket_id, `Out for repair — ${head.vendor_name}`]
    );
    if (item.vendor_serial_id || item.serial_id) {
      await client.query(
        `UPDATE vendor_serial_numbers SET
            qc_status = 'out_for_repair',
            extra = COALESCE(extra, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
          WHERE serial_id = $1`,
        [
          item.vendor_serial_id || item.serial_id,
          JSON.stringify({ location: 'out_for_repair', vendor_repair_dc: dcNumber }),
        ]
      );
    }
    await logTtsplEvent({
      ttsplId: item.ttspl_id || item.ticket_ttspl,
      vendorSerialId: item.vendor_serial_id || item.serial_id,
      eventType: 'dispatched_to_vendor',
      description: `Dispatched to vendor via ${dcNumber}`,
      metadata: { dc_number: dcNumber, vendor_name: head.vendor_name },
      actorUserId,
      actorName,
      db: client,
    });
    await logTtsplEvent({
      ttsplId: item.ttspl_id || item.ticket_ttspl,
      vendorSerialId: item.vendor_serial_id || item.serial_id,
      eventType: 'esign_completed',
      description: `Dispatch e-sign completed for ${dcNumber}`,
      metadata: { dc_number: dcNumber },
      actorUserId,
      actorName,
      db: client,
    });
    await logTicketActivity(client, {
      ticketId: item.ticket_id,
      userId: actorUserId,
      action: 'out_for_repair',
      notes: `Dispatched to ${head.vendor_name} (${dcNumber})`,
    });
  }

  const pdfPath = await generateVendorRepairPdf(dcNumber);
  if (pdfPath) {
    await client.query(
      `UPDATE vendor_repair_delivery_challans SET pdf_path = $2, updated_at = NOW() WHERE dc_number = $1`,
      [dcNumber, pdfPath]
    );
  }

  return { dc_number: dcNumber, status: 'dispatched', pdf_path: pdfPath };
}

async function receiveItemsFromVendor(client, {
  dcNumber,
  ticketIds = null,
  warehouseEsign,
  vendorEsign,
  actorUserId,
  actorName,
}) {
  const headRes = await client.query(
    `SELECT * FROM vendor_repair_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Vendor repair DC not found');
  if (!['dispatched', 'partially_returned'].includes(head.status)) {
    throw new Error('DC must be dispatched before receiving items back');
  }

  const whUrl = warehouseEsign ? saveEsign('wh_return', dcNumber, warehouseEsign) : head.warehouse_return_esign_url;
  const vUrl = vendorEsign ? saveEsign('vendor_return', dcNumber, vendorEsign) : head.vendor_return_esign_url;
  if (!whUrl || !vUrl) throw new Error('Warehouse and vendor return e-signatures are required');

  const fmStageRes = await client.query(`SELECT stage_id, team_id FROM stages WHERE stage_name = 'Floor Manager' LIMIT 1`);
  const fmStageId = fmStageRes.rows[0]?.stage_id || null;
  const fmTeamId = fmStageRes.rows[0]?.team_id || null;

  let itemsQuery = `
    SELECT i.*, t.*
      FROM vendor_repair_dc_items i
      JOIN tickets t ON t.ticket_id = i.ticket_id
     WHERE i.dc_number = $1 AND COALESCE(i.item_status, 'dispatched') = 'dispatched'`;
  const params = [dcNumber];
  if (Array.isArray(ticketIds) && ticketIds.length) {
    params.push(ticketIds.map(Number));
    itemsQuery += ` AND i.ticket_id = ANY($2::int[])`;
  }
  const itemsRes = await client.query(itemsQuery, params);
  if (!itemsRes.rows.length) throw new Error('No dispatched items selected for receive');

  const receiveDcNumber = await nextReceiveDcNumber(client, dcNumber);

  for (const item of itemsRes.rows) {
    await client.query(
      `UPDATE vendor_repair_dc_items SET
          item_status = 'received',
          returned_at = NOW(),
          receive_dc_number = $2
        WHERE id = $1`,
      [item.id, receiveDcNumber]
    );

    await client.query(
      `UPDATE tickets SET
          status = 'in_progress',
          current_stage_id = COALESCE($2, current_stage_id),
          assigned_user_id = NULL,
          assigned_team_id = $3,
          current_location = 'Warehouse — Floor Manager',
          highlighted = TRUE,
          highlighted_reason = 'Returned from vendor repair — Floor Manager triage',
          updated_at = NOW()
        WHERE ticket_id = $1`,
      [item.ticket_id, fmStageId, fmTeamId]
    );

    if (item.vendor_serial_id || item.serial_id) {
      await client.query(
        `UPDATE vendor_serial_numbers SET
            qc_status = 'pending',
            inventory_status = COALESCE(inventory_status, 'in_stock'),
            extra = COALESCE(extra, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
          WHERE serial_id = $1`,
        [
          item.vendor_serial_id || item.serial_id,
          JSON.stringify({ location: 'warehouse_floor', vendor_repair_dc: dcNumber, receive_dc: receiveDcNumber }),
        ]
      );
    }

    await logTicketActivity(client, {
      ticketId: item.ticket_id,
      userId: actorUserId,
      action: 'returned_from_vendor',
      notes: `Received from vendor via ${receiveDcNumber} (dispatch ${dcNumber}) — Floor Manager`,
      stageId: fmStageId,
    });

    await logTtsplEvent({
      ttsplId: item.ttspl_id,
      vendorSerialId: item.vendor_serial_id || item.serial_id,
      eventType: 'returned_from_vendor',
      description: `Returned from vendor repair (${receiveDcNumber}) — Floor Manager`,
      metadata: { dc_number: dcNumber, receive_dc_number: receiveDcNumber },
      actorUserId,
      actorName,
      db: client,
    });
  }

  const countsRes = await client.query(
    `SELECT
        COUNT(*) FILTER (WHERE COALESCE(item_status, 'draft') = 'dispatched')::int AS pending,
        COUNT(*) FILTER (WHERE item_status = 'received')::int AS received,
        COUNT(*)::int AS total
       FROM vendor_repair_dc_items WHERE dc_number = $1`,
    [dcNumber]
  );
  const { pending, received, total } = countsRes.rows[0] || { pending: 0, received: 0, total: 0 };
  const nextStatus = pending === 0 ? 'returned' : 'partially_returned';

  await client.query(
    `UPDATE vendor_repair_delivery_challans SET
        warehouse_return_esign_url = COALESCE(warehouse_return_esign_url, $2),
        vendor_return_esign_url = COALESCE(vendor_return_esign_url, $3),
        receive_dc_number = $4,
        status = $5,
        items_received_count = $6,
        returned_at = CASE WHEN $5 = 'returned' THEN NOW() ELSE returned_at END,
        updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber, whUrl, vUrl, receiveDcNumber, nextStatus, received]
  );

  const { generateVendorRepairReceivePdf } = require('./vendorRepairPdfService');
  const receivePdfPath = await generateVendorRepairReceivePdf(dcNumber, receiveDcNumber, itemsRes.rows.map((r) => r.id));
  if (receivePdfPath) {
    await client.query(
      `UPDATE vendor_repair_delivery_challans SET receive_pdf_path = $2, updated_at = NOW() WHERE dc_number = $1`,
      [dcNumber, receivePdfPath]
    );
  }

  return {
    dc_number: dcNumber,
    receive_dc_number: receiveDcNumber,
    status: nextStatus,
    tickets_updated: itemsRes.rows.length,
    items_received: received,
    items_total: total,
    items_pending: pending,
    receive_pdf_path: receivePdfPath,
  };
}

async function receiveFromVendor(client, {
  dcNumber,
  ticketIds,
  warehouseEsign,
  vendorEsign,
  actorUserId,
  actorName,
}) {
  return receiveItemsFromVendor(client, {
    dcNumber,
    ticketIds,
    warehouseEsign,
    vendorEsign,
    actorUserId,
    actorName,
  });
}

function effectiveQcStatusSql(alias = 'vsn') {
  return `COALESCE(
    NULLIF(TRIM(${alias}.qc_status), ''),
    NULLIF(TRIM(${alias}.extra->>'status'), ''),
    'pending'
  )`;
}

/** ERP / migrated laptops marked out_for_repare (not on an active vendor-repair DC). */
function erpOutForRepareSql(alias = 'vsn') {
  const eff = effectiveQcStatusSql(alias);
  return `${alias}.deleted_at IS NULL
    AND ${alias}.po_id IS NOT NULL
    AND (
      ${eff} = 'out_for_repare'
      OR ${alias}.inventory_status IN ('out_for_repare', 'in_repair')
      OR COALESCE(NULLIF(TRIM(${alias}.extra->>'action_status'), ''), '') = 'out_for_repare'
    )
    AND NOT EXISTS (
      SELECT 1
        FROM vendor_repair_dc_items vri
        JOIN vendor_repair_delivery_challans vrd ON vrd.dc_number = vri.dc_number
        JOIN tickets vt ON vt.ticket_id = vri.ticket_id
       WHERE vrd.status = 'dispatched'
         AND vt.status = 'out_for_repair'
         AND (
           vri.serial_id = ${alias}.serial_id
           OR vri.serial_number = ${alias}.serial_number
           OR vri.ttspl_id = ${alias}.inventory_asset_code
         )
    )`;
}

function mapErpOutForRepareRow(row) {
  const extra = typeof row.vsn_extra === 'object' && row.vsn_extra ? row.vsn_extra : {};
  const brand = extra.brand || row.pd_brand || null;
  const model = extra.model || extra.model_name || row.pd_model || null;
  return {
    id: `erp:${row.serial_id}`,
    source: 'erp',
    serial_id: row.serial_id,
    ticket_id: row.open_ticket_id || null,
    ttspl_id: row.ttspl_id || row.inventory_asset_code || null,
    serial_number: row.serial_number,
    brand,
    model,
    configuration: configString({
      brand,
      model,
      processor: extra.processor || row.pd_processor,
      generation: extra.generation || row.pd_generation,
      ram: extra.ram || row.pd_ram,
      storage: extra.storage || row.pd_storage,
    }),
    vendor_name: extra.vendor_name || row.vendor_name || 'External vendor',
    vendor_address: extra.vendor_address || row.vendor_address || null,
    dc_number: null,
    dc_label: 'ERP / Legacy',
    out_date: extra.repair_start_date || row.updated_at,
    expected_return_date: null,
    current_status: 'Out For Repare',
    remarks: row.remark || extra.action_remark || null,
    sort_ts: row.updated_at,
  };
}

function mapVendorDcRow(r) {
  const extra = typeof r.vsn_extra === 'object' && r.vsn_extra ? r.vsn_extra : {};
  return {
    id: `vdc:${r.id}`,
    source: 'vendor_dc',
    item_id: r.id,
    item_status: r.item_status || 'dispatched',
    serial_id: r.serial_id || null,
    ticket_id: r.ticket_id,
    ttspl_id: r.ttspl_id,
    serial_number: r.serial_number,
    brand: extra.brand || r.ticket_brand || null,
    model: extra.model || r.ticket_model || null,
    configuration: r.configuration || configString({
      brand: extra.brand || r.ticket_brand,
      model: extra.model || r.ticket_model,
      processor: extra.processor,
      generation: extra.generation,
      ram: extra.ram,
      storage: extra.storage,
    }),
    vendor_name: r.vendor_name,
    vendor_address: r.vendor_address,
    billing_address: r.billing_address,
    shipping_address: r.shipping_address,
    dc_number: r.dc_number,
    dc_label: r.dc_number,
    out_date: r.out_date,
    expected_return_date: r.expected_return_date,
    current_status: 'Out for Repair',
    remarks: r.item_remarks || r.remarks,
    item_remarks: r.item_remarks,
    items_received_count: r.items_received_count,
    items_dispatched_count: r.items_dispatched_count,
    sort_ts: r.dispatched_at,
  };
}

async function listOutForRepairInventory({
  search,
  vendor,
  dcNumber,
  page = 1,
  limit = 25,
  dateFrom,
  dateTo,
  brand,
  model,
  processor,
  generation,
  ram,
  storage,
  screen_size,
  gpu,
} = {}) {
  await ensureVendorRepairSchema();
  const specFilters = pickSpecFilters({
    brand, model, processor, generation, ram, storage, screen_size, gpu,
  });

  const vendorParams = [];
  let vendorWhere = `WHERE d.status IN ('dispatched', 'partially_returned')
    AND t.status = 'out_for_repair'
    AND COALESCE(i.item_status, 'dispatched') = 'dispatched'`;
  if (search?.trim()) {
    vendorParams.push(`%${search.trim()}%`);
    const i = vendorParams.length;
    vendorWhere += ` AND (
      COALESCE(i.ttspl_id, '') ILIKE $${i}
      OR COALESCE(i.serial_number, '') ILIKE $${i}
      OR COALESCE(d.vendor_name, '') ILIKE $${i}
      OR COALESCE(d.dc_number, '') ILIKE $${i}
      OR COALESCE(i.configuration, '') ILIKE $${i}
      OR COALESCE(t.brand, '') ILIKE $${i}
      OR COALESCE(t.model, '') ILIKE $${i}
    )`;
  }
  if (vendor?.trim()) {
    vendorParams.push(`%${vendor.trim()}%`);
    vendorWhere += ` AND d.vendor_name ILIKE $${vendorParams.length}`;
  }
  if (dcNumber?.trim()) {
    vendorParams.push(`%${dcNumber.trim()}%`);
    vendorWhere += ` AND d.dc_number ILIKE $${vendorParams.length}`;
  }
  const vendorDateClauses = appendDateRangeClauses({
    expr: 'COALESCE(d.dispatched_at, d.out_date, d.created_at)',
    dateFrom,
    dateTo,
    params: vendorParams,
  });
  if (vendorDateClauses.length) {
    vendorWhere += ` AND ${vendorDateClauses.join(' AND ')}`;
  }
  const vendorSpecClauses = appendRepairSpecClauses(specFilters, vendorParams, vendorRepairSpecExpr);
  if (vendorSpecClauses.length) {
    vendorWhere += ` AND ${vendorSpecClauses.join(' AND ')}`;
  }

  const erpParams = [];
  let erpSearchSql = '';
  if (search?.trim()) {
    erpParams.push(`%${search.trim()}%`);
    const i = erpParams.length;
    erpSearchSql = ` AND (
      COALESCE(vsn.inventory_asset_code, '') ILIKE $${i}
      OR vsn.serial_number ILIKE $${i}
      OR COALESCE(vsn.extra->>'vendor_name', '') ILIKE $${i}
      OR COALESCE(v.business_name, '') ILIKE $${i}
      OR COALESCE(vsn.extra->>'brand', vpd.brand, '') ILIKE $${i}
      OR COALESCE(vsn.extra->>'model', vpd.model, '') ILIKE $${i}
    )`;
  }
  if (vendor?.trim()) {
    erpParams.push(`%${vendor.trim()}%`);
    erpSearchSql += ` AND (
      COALESCE(vsn.extra->>'vendor_name', '') ILIKE $${erpParams.length}
      OR COALESCE(v.business_name, '') ILIKE $${erpParams.length}
    )`;
  }
  if (dcNumber?.trim()) {
    erpSearchSql += ' AND FALSE';
  }
  const erpDateClauses = appendDateRangeClauses({
    column: 'updated_at',
    dateFrom,
    dateTo,
    params: erpParams,
    tableAlias: 'vsn',
  });
  if (erpDateClauses.length) {
    erpSearchSql += ` AND ${erpDateClauses.join(' AND ')}`;
  }
  const erpSpecClauses = appendRepairSpecClauses(specFilters, erpParams, erpRepairSpecExpr);
  if (erpSpecClauses.length) {
    erpSearchSql += ` AND ${erpSpecClauses.join(' AND ')}`;
  }

  const vendorFrom = `
    FROM vendor_repair_dc_items i
    JOIN vendor_repair_delivery_challans d ON d.dc_number = i.dc_number
    JOIN tickets t ON t.ticket_id = i.ticket_id
    LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = COALESCE(i.serial_id, t.vendor_serial_id)
    ${vendorWhere}
  `;

  const erpFrom = `
    FROM vendor_serial_numbers vsn
    INNER JOIN vendor_purchase_orders p ON p.po_id = vsn.po_id AND p.deleted_at IS NULL
    LEFT JOIN vendor_product_details vpd
      ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id', '')::int
    LEFT JOIN vendors v ON v.vendor_id = COALESCE(
      NULLIF(vsn.extra->>'repair_vendor_id', '')::int,
      NULLIF(vsn.extra->>'seller_id', '')::int,
      p.vendor_id
    ) AND v.deleted_at IS NULL
    WHERE ${erpOutForRepareSql('vsn')}
    ${erpSearchSql}
  `;

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 25));
  const offset = (safePage - 1) * safeLimit;

  const [vendorCountR, erpCountR] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total ${vendorFrom}`, vendorParams),
    pool.query(`SELECT COUNT(*)::int AS total ${erpFrom}`, erpParams),
  ]);
  const total = (vendorCountR.rows[0]?.total || 0) + (erpCountR.rows[0]?.total || 0);

  const fetchEach = safePage === 1 ? safeLimit : safePage * safeLimit;
  const [vendorRowsR, erpRowsR] = await Promise.all([
    pool.query(
      `SELECT i.id, i.ticket_id, i.ttspl_id, i.serial_number, i.serial_id, i.configuration,
              i.item_remarks, i.item_status,
              t.status AS ticket_status,
              t.brand AS ticket_brand, t.model AS ticket_model,
              d.dc_number, d.vendor_name, d.vendor_address, d.billing_address, d.shipping_address,
              d.out_date, d.expected_return_date, d.remarks, d.dispatched_at,
              d.items_received_count, d.items_dispatched_count,
              vsn.extra AS vsn_extra
       ${vendorFrom}
       ORDER BY d.dispatched_at DESC NULLS LAST, i.id DESC
       LIMIT ${fetchEach}`,
      vendorParams
    ),
    pool.query(
      `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code, vsn.remark, vsn.updated_at,
              vsn.extra AS vsn_extra,
              COALESCE(vsn.inventory_asset_code, vsn.extra->>'unique_product_serial') AS ttspl_id,
              vpd.brand AS pd_brand, vpd.model AS pd_model,
              vpd.processor AS pd_processor, vpd.generation AS pd_generation,
              vpd.ram AS pd_ram, vpd.storage AS pd_storage,
              COALESCE(vsn.extra->>'vendor_name', v.business_name, v.first_name) AS vendor_name,
              v.address AS vendor_address,
              (SELECT t.ticket_id FROM tickets t
                WHERE t.vendor_serial_id = vsn.serial_id
                  AND t.status IN ('in_progress', 'on_hold')
                ORDER BY t.created_at DESC LIMIT 1) AS open_ticket_id
       ${erpFrom}
       ORDER BY vsn.updated_at DESC NULLS LAST, vsn.serial_id DESC
       LIMIT ${fetchEach}`,
      erpParams
    ),
  ]);

  const merged = [
    ...vendorRowsR.rows.map(mapVendorDcRow),
    ...erpRowsR.rows.map(mapErpOutForRepareRow),
  ].sort((a, b) => {
    const ta = a.sort_ts ? new Date(a.sort_ts).getTime() : 0;
    const tb = b.sort_ts ? new Date(b.sort_ts).getTime() : 0;
    return tb - ta;
  });

  const data = merged.slice(offset, offset + safeLimit).map(({ sort_ts, ...row }) => row);

  return {
    data,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
}

async function listVendorRepairDcs({
  search,
  status,
  page = 1,
  limit = 25,
  dateFrom,
  dateTo,
  brand,
  model,
  processor,
  generation,
  ram,
  storage,
  screen_size,
  gpu,
} = {}) {
  await ensureVendorRepairSchema();
  const specFilters = pickSpecFilters({
    brand, model, processor, generation, ram, storage, screen_size, gpu,
  });
  const params = [];
  const conditions = ['1=1'];
  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    const i = params.length;
    conditions.push(`(
      d.dc_number ILIKE $${i}
      OR d.vendor_name ILIKE $${i}
      OR COALESCE(d.contact_person, '') ILIKE $${i}
    )`);
  }
  if (status?.trim()) {
    params.push(status.trim());
    conditions.push(`d.status = $${params.length}`);
  }
  const dateClauses = appendDateRangeClauses({
    expr: 'COALESCE(d.dispatched_at, d.created_at)',
    dateFrom,
    dateTo,
    params,
  });
  if (dateClauses.length) {
    conditions.push(...dateClauses);
  }
  if (hasSpecFilters(specFilters)) {
    const specClauses = appendRepairSpecClauses(specFilters, params, vendorRepairSpecExpr);
    conditions.push(`EXISTS (
      SELECT 1
        FROM vendor_repair_dc_items i
        JOIN tickets t ON t.ticket_id = i.ticket_id
        LEFT JOIN vendor_serial_numbers vsn
          ON vsn.serial_id = COALESCE(i.serial_id, t.vendor_serial_id) AND vsn.deleted_at IS NULL
       WHERE i.dc_number = d.dc_number
         AND ${specClauses.join(' AND ')}
    )`);
  }
  const where = conditions.join(' AND ');
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const offset = (safePage - 1) * safeLimit;

  const countR = await pool.query(
    `SELECT COUNT(*)::int AS total FROM vendor_repair_delivery_challans d WHERE ${where}`,
    params
  );
  const total = countR.rows[0]?.total || 0;

  const listR = await pool.query(
    `SELECT d.*,
            (SELECT COUNT(*)::int FROM vendor_repair_dc_items i WHERE i.dc_number = d.dc_number) AS item_count,
            (SELECT COUNT(*)::int FROM vendor_repair_dc_items i
              WHERE i.dc_number = d.dc_number AND COALESCE(i.item_status, 'draft') = 'received') AS received_count,
            (SELECT COUNT(*)::int FROM vendor_repair_dc_items i
              WHERE i.dc_number = d.dc_number AND COALESCE(i.item_status, 'draft') = 'dispatched') AS pending_count
       FROM vendor_repair_delivery_challans d
      WHERE ${where}
      ORDER BY d.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, safeLimit, offset]
  );

  return {
    data: listR.rows,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
}

async function countOutForRepairInventory() {
  await ensureVendorRepairSchema();
  const [vendorR, erpR] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS c
         FROM vendor_repair_dc_items i
         JOIN vendor_repair_delivery_challans d ON d.dc_number = i.dc_number
         JOIN tickets t ON t.ticket_id = i.ticket_id
        WHERE d.status IN ('dispatched', 'partially_returned') AND t.status = 'out_for_repair'
          AND COALESCE(i.item_status, 'dispatched') = 'dispatched'`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c
         FROM vendor_serial_numbers vsn
        WHERE ${erpOutForRepareSql('vsn')}`
    ),
  ]);
  return (vendorR.rows[0]?.c || 0) + (erpR.rows[0]?.c || 0);
}

/** Receive an ERP / legacy out_for_repare laptop back to QC Process. */
async function receiveErpRepairBack(client, { serialId, actorUserId, actorName, createFloorTicket = true }) {
  const sid = Number(serialId);
  if (!sid) throw new Error('Invalid serial id');

  const cur = await client.query(
    `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code, vsn.qc_status, vsn.extra
       FROM vendor_serial_numbers vsn
      WHERE vsn.serial_id = $1 AND ${erpOutForRepareSql('vsn')}
      FOR UPDATE OF vsn`,
    [sid]
  );
  if (!cur.rows.length) {
    throw new Error('Serial is not in Out For Repare status or is already on a vendor repair DC');
  }
  const row = cur.rows[0];
  const extra = typeof row.extra === 'object' && row.extra ? { ...row.extra } : {};

  extra.status = 'pending';
  extra.action_status = 'repared';
  extra.status2 = 'repared';
  extra.came_from = extra.came_from || 'External vendor';
  extra.repair_received_at = new Date().toISOString();

  await client.query(
    `UPDATE vendor_serial_numbers
        SET qc_status = 'pending',
            inventory_status = 'in_stock',
            extra = $1::jsonb,
            updated_at = NOW()
      WHERE serial_id = $2`,
    [JSON.stringify(extra), sid]
  );

  const ttsplId = row.inventory_asset_code || row.serial_number;
  await logTtsplEvent({
    ttsplId,
    vendorSerialId: sid,
    eventType: 'repair_received',
    description: 'Received back from external repair — moved to QC Process',
    metadata: { previous_qc_status: row.qc_status },
    actorUserId,
    actorName,
    db: client,
  });

  let ticketId = null;
  if (createFloorTicket) {
    const { createProductionTicketForQcSerial } = require('./qcProcessIntakeService');
    const ticketResult = await createProductionTicketForQcSerial(
      client,
      { serialId: sid, serialNumber: row.serial_number },
      actorUserId
    );
    if (ticketResult.ok) ticketId = ticketResult.data?.ticket_id || null;
  }

  return {
    serial_id: sid,
    serial_number: row.serial_number,
    qc_status: 'pending',
    ticket_id: ticketId,
  };
}

module.exports = {
  ensureVendorRepairSchema,
  WAREHOUSE_ROLES,
  markDiagnosisFailed,
  listDiagnosisFailedTickets,
  createOutForRepairDc,
  getVendorRepairDc,
  updateVendorRepairDispatchDetails,
  markDeliveredToVendor,
  listVendorRepairDcs,
  signDispatchDc,
  receiveFromVendor,
  receiveItemsFromVendor,
  listOutForRepairInventory,
  countOutForRepairInventory,
  receiveErpRepairBack,
};
