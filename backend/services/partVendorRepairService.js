/**
 * Vendor Parts Repair & Return — parallel to laptop VRDC, operating on part_instances.
 * Reuses VRDC header table (item_domain='part') + vendorRepairDcShared helpers.
 * Does NOT touch vendor_repair_dc_items / receiveItemsFromVendor.
 */
const pool = require('../config/db');
const { formatCompanyBlock } = require('../utils/companyDefaults');
const { appendDateRangeClauses } = require('../utils/dateRangeFilter');
const {
  resolveDefaultHsn: defaultHsnForTxn,
  resolveHsnForPersist,
} = require('../constants/hsnDefaults');
const {
  parseItemPrice,
  validateEwayForConsignment,
  saveEsign,
  saveDispatchPod,
  dispatchPayloadFromBody,
  nextVendorRepairDcNumber,
} = require('./vendorRepairDcShared');
const { receiveUnitsIntoInventory, getPartMeta } = require('./partInventoryService');
const { recordMovement, MOVEMENT } = require('./partMovementService');

const WAREHOUSE_ROLES = new Set(['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead', 'procurement']);

function mapById(map, id) {
  if (!map || typeof map !== 'object') return undefined;
  return map[id] ?? map[String(id)];
}

async function createPartVendorReturnDc(client, {
  instanceIds,
  vendorId,
  vendorName,
  vendorAddress,
  vendorBillingAddress,
  shippingAddress,
  contactPerson,
  contactMobile,
  expectedReturnDate,
  remarks,
  warehouseName,
  warehouseAddress,
  itemRemarks = {},
  itemPrices = {},
  itemHsnCodes = {},
  ewayBillNumber,
  ewayBillDate,
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
  actorRole,
}) {
  if (!Array.isArray(instanceIds) || !instanceIds.length) {
    throw new Error('Select at least one defective part');
  }

  const ids = instanceIds.map((id) => Number(id)).filter((n) => Number.isFinite(n));
  const instRes = await client.query(
    `SELECT pi.*, p.part_name, p.category,
            COALESCE(pi.vendor_id, spo.vendor_id) AS resolved_vendor_id,
            v.business_name AS spo_vendor_name,
            COALESCE(NULLIF(TRIM(v.shipping_address), ''), NULLIF(TRIM(v.address), '')) AS spo_vendor_address,
            v.contact_person_name AS spo_contact_person,
            COALESCE(v.contact_person_phone, v.phone) AS spo_contact_mobile
       FROM part_instances pi
       JOIN parts p ON p.part_id = pi.part_id
       LEFT JOIN vendor_spare_parts_purchase_orders spo ON spo.spo_id = pi.spo_id
       LEFT JOIN vendors v ON v.vendor_id = COALESCE(pi.vendor_id, spo.vendor_id) AND v.deleted_at IS NULL
      WHERE pi.instance_id = ANY($1::int[])
      FOR UPDATE OF pi`,
    [ids]
  );
  if (instRes.rows.length !== ids.length) {
    throw new Error('One or more part instances were not found');
  }

  for (const inst of instRes.rows) {
    if (inst.vendor_repair_dc_number) {
      throw new Error(
        `Part ${inst.prt_id || `#${inst.instance_id}`} is already on vendor repair DC ${inst.vendor_repair_dc_number}`
      );
    }
    if (inst.status !== 'defective') {
      throw new Error(
        `Part ${inst.prt_id || `#${inst.instance_id}`} must be defective (current: ${inst.status})`
      );
    }
    if (!inst.spo_id) {
      throw new Error(
        `Part ${inst.prt_id || `#${inst.instance_id}`} has no SPO link — cannot return to vendor`
      );
    }
  }

  const autoVendor = instRes.rows.find((r) => r.spo_vendor_name || r.resolved_vendor_id) || instRes.rows[0];
  const resolvedName = (vendorName || autoVendor?.spo_vendor_name || '').trim();
  if (!resolvedName) throw new Error('Vendor name is required');
  const vendorBillAddr = (vendorBillingAddress || vendorAddress || autoVendor?.spo_vendor_address || '').trim();
  const shipAddr = (shippingAddress || vendorBillAddr).trim();
  if (!vendorBillAddr) throw new Error('Vendor billing address is required');
  if (!shipAddr) throw new Error('Vendor shipping address is required');
  const billAddr = formatCompanyBlock();

  // Default dispatch: by_hand requires delivery person — allow draft create without full
  // dispatch when ship fields omitted (dispatch step will collect them).
  let dispatch;
  try {
    dispatch = dispatchPayloadFromBody({
      ship_by: ship_by || shipBy || 'by_courier',
      dispatch_mode,
      courier_name: courier_name || 'TBD',
      awb_number,
      courier_tracking_url,
      porter_tracking_id,
      porter_order_id,
      porter_booking_url,
      delivery_person_id,
    });
  } catch {
    dispatch = {
      ship_by: null,
      dispatch_mode: null,
      courier_name: null,
      awb_number: null,
      courier_tracking_url: null,
      porter_tracking_id: null,
      porter_order_id: null,
      porter_booking_url: null,
      delivery_person_id: null,
    };
  }

  const defaultHsn = defaultHsnForTxn('repair');
  let totalDeclared = 0;
  const itemFieldMap = {};
  for (const inst of instRes.rows) {
    const iid = inst.instance_id;
    const price = parseItemPrice(mapById(itemPrices, iid) ?? inst.unit_cost ?? null);
    const hsn = resolveHsnForPersist({
      transactionType: 'repair',
      override: mapById(itemHsnCodes, iid) ?? null,
      role: actorRole,
    });
    if (price != null) totalDeclared += price;
    itemFieldMap[iid] = { price, hsn };
  }

  const eway = validateEwayForConsignment({
    totalValue: totalDeclared,
    ewayBillNumber,
    ewayBillDate,
  });

  const resolvedVendorId = vendorId
    || autoVendor?.resolved_vendor_id
    || null;

  const dcNumber = await nextVendorRepairDcNumber(client);
  await client.query(
    `INSERT INTO vendor_repair_delivery_challans (
        dc_number, vendor_id, vendor_name, vendor_address, billing_address, shipping_address,
        contact_person, contact_mobile,
        expected_return_date, remarks, warehouse_name, warehouse_address, status, created_by,
        items_dispatched_count, items_received_count,
        ship_by, dispatch_mode, courier_name, awb_number, courier_tracking_url,
        porter_tracking_id, porter_order_id, porter_booking_url, delivery_person_id,
        eway_bill_number, eway_bill_date, item_domain
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',$13,0,0,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'part')`,
    [
      dcNumber,
      resolvedVendorId,
      resolvedName,
      vendorBillAddr,
      billAddr,
      shipAddr,
      (contactPerson || autoVendor?.spo_contact_person || '').trim() || null,
      (contactMobile || autoVendor?.spo_contact_mobile || '').trim() || null,
      expectedReturnDate || null,
      remarks?.trim() || null,
      warehouseName?.trim() || 'TRUETECH SERVICES PRIVATE LIMITED',
      warehouseAddress?.trim() || billAddr,
      actorUserId || null,
      dispatch.ship_by,
      dispatch.dispatch_mode,
      dispatch.courier_name,
      dispatch.awb_number,
      dispatch.courier_tracking_url,
      dispatch.porter_tracking_id,
      dispatch.porter_order_id,
      dispatch.porter_booking_url,
      dispatch.delivery_person_id,
      eway.eway_bill_number,
      eway.eway_bill_date,
    ]
  );

  for (const inst of instRes.rows) {
    const itemRemark = mapById(itemRemarks, inst.instance_id) || remarks || null;
    const fields = itemFieldMap[inst.instance_id] || { price: null, hsn: defaultHsn };
    await client.query(
      `INSERT INTO vendor_repair_dc_part_items (
          dc_number, instance_id, prt_id, part_id, part_name, serial_number,
          item_remarks, item_status, price, hsn_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9)`,
      [
        dcNumber,
        inst.instance_id,
        inst.prt_id,
        inst.part_id,
        inst.part_name,
        inst.serial_number,
        itemRemark,
        fields.price,
        fields.hsn,
      ]
    );
    await client.query(
      `UPDATE part_instances
          SET status = 'with_vendor_repair',
              vendor_repair_dc_number = $2,
              notes = COALESCE($3, notes),
              updated_at = NOW()
        WHERE instance_id = $1`,
      [inst.instance_id, dcNumber, itemRemark]
    );
    await recordMovement(client, {
      type: MOVEMENT.SENT_TO_VENDOR_REPAIR,
      partId: inst.part_id,
      instanceId: inst.instance_id,
      prtId: inst.prt_id,
      serialNumber: inst.serial_number,
      category: inst.category,
      partName: inst.part_name,
      unitCost: inst.unit_cost,
      spoId: inst.spo_id,
      grnId: inst.grn_id,
      vendorId: resolvedVendorId || inst.resolved_vendor_id,
      notes: itemRemark || `Sent to vendor on ${dcNumber}`,
      actorUserId,
      actorName,
    });
  }

  return { dc_number: dcNumber, item_count: instRes.rows.length };
}

async function dispatchPartVendorReturnDc(client, {
  dcNumber,
  warehouseEsign,
  vendorEsign,
  dispatchBody,
  dispatchPod,
  actorUserId,
  actorName,
}) {
  void actorUserId;
  void actorName;
  const headRes = await client.query(
    `SELECT * FROM vendor_repair_delivery_challans
      WHERE dc_number = $1 AND COALESCE(item_domain, 'laptop') = 'part'
      FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Part vendor repair DC not found');
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
  const vUrl = vendorEsign ? saveEsign('vendor_dispatch', dcNumber, vendorEsign) : head.vendor_dispatch_esign_url || null;
  if (!whUrl) throw new Error('Warehouse dispatch e-signature is required');

  const whSignerName = (dispatchBody?.warehouse_signer_name || dispatchBody?.warehouseSignerName || '').trim() || null;
  const vendorSignerName = (dispatchBody?.vendor_signer_name || dispatchBody?.vendorSignerName || '').trim() || null;
  const podPath = dispatchPod ? saveDispatchPod(dcNumber, dispatchPod) : head.dispatch_pod_path || null;

  await client.query(
    `UPDATE vendor_repair_delivery_challans SET
        warehouse_dispatch_esign_url = $2,
        vendor_dispatch_esign_url = $3,
        warehouse_dispatch_signer_name = COALESCE($14, warehouse_dispatch_signer_name),
        vendor_dispatch_signer_name = COALESCE($15, vendor_dispatch_signer_name),
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
        items_dispatched_count = (
          SELECT COUNT(*)::int FROM vendor_repair_dc_part_items WHERE dc_number = $1
        ),
        updated_at = NOW()
      WHERE dc_number = $1`,
    [
      dcNumber, whUrl, vUrl,
      dispatch.ship_by, dispatch.dispatch_mode, dispatch.courier_name,
      dispatch.awb_number, dispatch.courier_tracking_url,
      dispatch.porter_tracking_id, dispatch.porter_order_id, dispatch.porter_booking_url,
      dispatch.delivery_person_id, podPath, whSignerName, vendorSignerName,
    ]
  );

  await client.query(
    `UPDATE vendor_repair_dc_part_items SET item_status = 'dispatched' WHERE dc_number = $1`,
    [dcNumber]
  );

  return { dc_number: dcNumber, status: 'dispatched' };
}

async function recomputePartDcHeaderStatus(client, dcNumber) {
  const counts = await client.query(
    `SELECT
        COUNT(*) FILTER (WHERE item_status = 'dispatched')::int AS pending,
        COUNT(*) FILTER (WHERE item_status IN ('received', 'replacement_received'))::int AS received
       FROM vendor_repair_dc_part_items
      WHERE dc_number = $1`,
    [dcNumber]
  );
  const pending = counts.rows[0]?.pending || 0;
  const received = counts.rows[0]?.received || 0;
  const nextStatus = pending === 0 ? 'returned' : 'partially_returned';
  await client.query(
    `UPDATE vendor_repair_delivery_challans SET
        status = $2::varchar,
        items_received_count = $3::int,
        returned_at = CASE WHEN $2::text = 'returned' THEN COALESCE(returned_at, NOW()) ELSE returned_at END,
        updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber, nextStatus, received]
  );
  return nextStatus;
}

async function receivePartsFromVendor(client, {
  dcNumber,
  receiveItems,
  warehouseEsign,
  warehouseSignerName,
  actorUserId,
  actorName,
}) {
  const headRes = await client.query(
    `SELECT * FROM vendor_repair_delivery_challans
      WHERE dc_number = $1 AND COALESCE(item_domain, 'laptop') = 'part'
      FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Part vendor repair DC not found');
  if (!['dispatched', 'partially_returned'].includes(head.status)) {
    throw new Error(`Cannot receive parts on DC with status "${head.status}"`);
  }

  const items = Array.isArray(receiveItems) ? receiveItems : [];
  if (!items.length) throw new Error('Select at least one part to receive');

  const whUrl = warehouseEsign ? saveEsign('wh_receive', dcNumber, warehouseEsign) : null;
  const signer = (warehouseSignerName || '').trim() || actorName || null;
  const receiveDcNumber = `${dcNumber}-RCV`;

  const results = [];
  for (const item of items) {
    const instanceId = Number(item.instance_id ?? item.instanceId);
    const mode = String(item.receive_mode || item.receiveMode || '').toLowerCase();
    if (!['repaired', 'replacement'].includes(mode)) {
      throw new Error('receive_mode must be repaired or replacement');
    }

    const lineRes = await client.query(
      `SELECT i.*, pi.status AS instance_status, pi.prt_id AS live_prt, pi.serial_number AS live_serial,
              pi.part_id AS live_part_id, pi.unit_cost, pi.spo_id, pi.grn_id, pi.vendor_id, pi.location_code,
              p.part_name, p.category
         FROM vendor_repair_dc_part_items i
         JOIN part_instances pi ON pi.instance_id = i.instance_id
         JOIN parts p ON p.part_id = pi.part_id
        WHERE i.dc_number = $1 AND i.instance_id = $2
        FOR UPDATE OF i, pi`,
      [dcNumber, instanceId]
    );
    const line = lineRes.rows[0];
    if (!line) throw new Error(`Part instance #${instanceId} is not on DC ${dcNumber}`);
    if (line.item_status !== 'dispatched') {
      throw new Error(`Part ${line.prt_id || instanceId} is already ${line.item_status}`);
    }

    const verified = String(item.verified_serial || item.verifiedSerial || item.verified_prt || '').trim();
    if (verified) {
      const expected = String(line.serial_number || line.prt_id || '').trim().toLowerCase();
      if (expected && verified.toLowerCase() !== expected && verified.toLowerCase() !== String(line.prt_id || '').toLowerCase()) {
        throw new Error(`Verified identity mismatch for ${line.prt_id || instanceId}`);
      }
    }

    let replacementInstanceId = null;
    let itemStatus = 'received';

    if (mode === 'repaired') {
      await client.query(
        `UPDATE part_instances
            SET status = 'qc_pending',
                vendor_repair_dc_number = NULL,
                notes = COALESCE($2, notes),
                updated_at = NOW()
          WHERE instance_id = $1`,
        [instanceId, item.remarks || null]
      );
      await recordMovement(client, {
        type: MOVEMENT.RECEIVED_FROM_VENDOR_REPAIR,
        partId: line.live_part_id,
        instanceId,
        prtId: line.prt_id || line.live_prt,
        serialNumber: line.serial_number || line.live_serial,
        category: line.category,
        partName: line.part_name,
        unitCost: line.unit_cost,
        spoId: line.spo_id,
        grnId: line.grn_id,
        vendorId: head.vendor_id || line.vendor_id,
        condition: 'repaired',
        notes: item.remarks || `Repaired and returned on ${dcNumber}`,
        actorUserId,
        actorName,
      });
    } else {
      // replacement — create new instance via GRN receive path, then QC-gate it
      const created = await receiveUnitsIntoInventory(client, {
        partId: line.live_part_id,
        units: [{
          serialNumber: item.replacement_serial || item.replacementSerial || null,
        }],
        unitCost: line.unit_cost || line.price || 0,
        locationCode: line.location_code || null,
        spoId: null,
        grnId: null,
        vendorId: head.vendor_id || line.vendor_id,
        batchNumber: null,
        receivedBy: actorUserId,
        actorName,
        notes: `Vendor replacement for ${line.prt_id} on ${dcNumber}`,
      });
      const neu = created[0];
      if (!neu) throw new Error('Failed to create replacement part instance');
      replacementInstanceId = neu.instance_id;

      // Safer default: hold replacement in qc_pending (undo auto in_stock qty bump until QC)
      await client.query(
        `UPDATE part_instances
            SET status = 'qc_pending',
                source = 'defective_return',
                notes = COALESCE(notes, '') || CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE ' | ' END
                  || $2,
                updated_at = NOW()
          WHERE instance_id = $1`,
        [replacementInstanceId, `Replacement for ${line.prt_id} via ${dcNumber}`]
      );
      await client.query(
        `UPDATE parts SET quantity = GREATEST(0, COALESCE(quantity, 0) - 1), updated_at = NOW()
          WHERE part_id = $1`,
        [line.live_part_id]
      );

      await client.query(
        `UPDATE part_instances
            SET status = 'discarded',
                vendor_repair_dc_number = NULL,
                notes = COALESCE($2, notes),
                updated_at = NOW()
          WHERE instance_id = $1`,
        [instanceId, item.remarks || `Replaced by vendor on ${dcNumber} → ${neu.prt_id}`]
      );
      await recordMovement(client, {
        type: MOVEMENT.DISCARDED,
        partId: line.live_part_id,
        instanceId,
        prtId: line.prt_id || line.live_prt,
        serialNumber: line.serial_number || line.live_serial,
        category: line.category,
        partName: line.part_name,
        unitCost: line.unit_cost,
        spoId: line.spo_id,
        vendorId: head.vendor_id || line.vendor_id,
        notes: `Replaced by ${neu.prt_id} on ${dcNumber}`,
        actorUserId,
        actorName,
      });
      await recordMovement(client, {
        type: MOVEMENT.RECEIVED_FROM_VENDOR_REPAIR,
        partId: line.live_part_id,
        instanceId: replacementInstanceId,
        prtId: neu.prt_id,
        serialNumber: neu.serial_number,
        category: line.category,
        partName: line.part_name,
        unitCost: neu.unit_cost,
        vendorId: head.vendor_id || line.vendor_id,
        condition: 'replacement',
        notes: `Replacement received for ${line.prt_id} on ${dcNumber}`,
        actorUserId,
        actorName,
      });
      itemStatus = 'replacement_received';
    }

    await client.query(
      `UPDATE vendor_repair_dc_part_items SET
          item_status = $3::varchar,
          receive_mode = $4::varchar,
          receive_dc_number = $5::varchar,
          replacement_dc_number = CASE WHEN $4::text = 'replacement' THEN $5::varchar ELSE replacement_dc_number END,
          replacement_instance_id = $6,
          receive_verified_serial = $7::varchar,
          receive_wh_esign_url = COALESCE($8::text, receive_wh_esign_url),
          receive_wh_signer_name = COALESCE($9::varchar, receive_wh_signer_name),
          receive_wh_signed_at = CASE WHEN $8::text IS NOT NULL THEN NOW() ELSE receive_wh_signed_at END,
          item_remarks = COALESCE($10::text, item_remarks),
          returned_at = NOW()
        WHERE dc_number = $1 AND instance_id = $2`,
      [
        dcNumber,
        instanceId,
        itemStatus,
        mode,
        receiveDcNumber,
        replacementInstanceId,
        verified || null,
        whUrl,
        signer,
        item.remarks || null,
      ]
    );

    results.push({
      instance_id: instanceId,
      receive_mode: mode,
      item_status: itemStatus,
      replacement_instance_id: replacementInstanceId,
    });
  }

  const status = await recomputePartDcHeaderStatus(client, dcNumber);
  return { dc_number: dcNumber, status, received: results };
}

/**
 * QC gate for parts returned from vendor (instance-keyed; grn_qc tickets require vendor_serial_id).
 */
async function passPartVendorRepairQc(client, { instanceId, actorUserId, actorName, notes }) {
  const r = await client.query(
    `SELECT pi.*, p.part_name, p.category
       FROM part_instances pi
       JOIN parts p ON p.part_id = pi.part_id
      WHERE pi.instance_id = $1
      FOR UPDATE OF pi`,
    [instanceId]
  );
  const inst = r.rows[0];
  if (!inst) throw new Error('Part instance not found');
  if (inst.status !== 'qc_pending') {
    throw new Error(`Part ${inst.prt_id} is not qc_pending (current: ${inst.status})`);
  }

  await client.query(
    `UPDATE part_instances SET status = 'in_stock', updated_at = NOW() WHERE instance_id = $1`,
    [instanceId]
  );
  await client.query(
    `UPDATE parts SET quantity = COALESCE(quantity, 0) + 1, updated_at = NOW() WHERE part_id = $1`,
    [inst.part_id]
  );
  await recordMovement(client, {
    type: MOVEMENT.RECEIVED,
    partId: inst.part_id,
    instanceId,
    prtId: inst.prt_id,
    serialNumber: inst.serial_number,
    category: inst.category,
    partName: inst.part_name,
    unitCost: inst.unit_cost,
    spoId: inst.spo_id,
    grnId: inst.grn_id,
    vendorId: inst.vendor_id,
    notes: notes || 'QC passed after vendor repair/replacement',
    actorUserId,
    actorName,
  });
  return { instance_id: instanceId, status: 'in_stock' };
}

async function failPartVendorRepairQc(client, { instanceId, actorUserId, actorName, notes }) {
  const r = await client.query(
    `SELECT pi.*, p.part_name, p.category
       FROM part_instances pi
       JOIN parts p ON p.part_id = pi.part_id
      WHERE pi.instance_id = $1
      FOR UPDATE OF pi`,
    [instanceId]
  );
  const inst = r.rows[0];
  if (!inst) throw new Error('Part instance not found');
  if (inst.status !== 'qc_pending') {
    throw new Error(`Part ${inst.prt_id} is not qc_pending (current: ${inst.status})`);
  }

  await client.query(
    `UPDATE part_instances SET status = 'discarded', updated_at = NOW() WHERE instance_id = $1`,
    [instanceId]
  );
  await recordMovement(client, {
    type: MOVEMENT.DISCARDED,
    partId: inst.part_id,
    instanceId,
    prtId: inst.prt_id,
    serialNumber: inst.serial_number,
    category: inst.category,
    partName: inst.part_name,
    unitCost: inst.unit_cost,
    notes: notes || 'QC failed after vendor repair/replacement',
    actorUserId,
    actorName,
  });
  return { instance_id: instanceId, status: 'discarded' };
}

async function getPartVendorReturnDc(dcNumber) {
  const head = await pool.query(
    `SELECT d.*
       FROM vendor_repair_delivery_challans d
      WHERE d.dc_number = $1 AND COALESCE(d.item_domain, 'laptop') = 'part'`,
    [dcNumber]
  );
  if (!head.rows[0]) return null;
  const items = await pool.query(
    `SELECT i.*,
            pi.status AS instance_status,
            pi.spo_id,
            pi.vendor_id AS instance_vendor_id,
            ri.prt_id AS replacement_prt_id,
            ri.serial_number AS replacement_serial_number,
            ri.status AS replacement_status
       FROM vendor_repair_dc_part_items i
       LEFT JOIN part_instances pi ON pi.instance_id = i.instance_id
       LEFT JOIN part_instances ri ON ri.instance_id = i.replacement_instance_id
      WHERE i.dc_number = $1
      ORDER BY i.id ASC`,
    [dcNumber]
  );
  return { ...head.rows[0], items: items.rows };
}

async function listPartVendorReturns({
  search,
  status,
  vendorId,
  page = 1,
  limit = 25,
  dateFrom,
  dateTo,
} = {}) {
  const params = [];
  const conditions = [`COALESCE(d.item_domain, 'laptop') = 'part'`];

  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    const i = params.length;
    conditions.push(`(
      d.dc_number ILIKE $${i}
      OR d.vendor_name ILIKE $${i}
      OR COALESCE(d.contact_person, '') ILIKE $${i}
      OR EXISTS (
        SELECT 1 FROM vendor_repair_dc_part_items i
         WHERE i.dc_number = d.dc_number
           AND (i.prt_id ILIKE $${i} OR COALESCE(i.serial_number,'') ILIKE $${i} OR COALESCE(i.part_name,'') ILIKE $${i})
      )
    )`);
  }
  if (status?.trim()) {
    params.push(status.trim());
    conditions.push(`d.status = $${params.length}`);
  }
  if (vendorId) {
    params.push(Number(vendorId));
    conditions.push(`d.vendor_id = $${params.length}`);
  }
  const dateClauses = appendDateRangeClauses({
    expr: 'COALESCE(d.dispatched_at, d.created_at)',
    dateFrom,
    dateTo,
    params,
  });
  if (dateClauses.length) conditions.push(...dateClauses);

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
            (SELECT COUNT(*)::int FROM vendor_repair_dc_part_items i WHERE i.dc_number = d.dc_number) AS item_count,
            (SELECT COUNT(*)::int FROM vendor_repair_dc_part_items i
              WHERE i.dc_number = d.dc_number AND i.item_status IN ('received', 'replacement_received')) AS received_count,
            (SELECT COUNT(*)::int FROM vendor_repair_dc_part_items i
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

async function listQcPendingPartInstances({ page = 1, limit = 50, search } = {}) {
  const params = [];
  const conditions = [`pi.status = 'qc_pending'`];
  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    const i = params.length;
    conditions.push(`(pi.prt_id ILIKE $${i} OR COALESCE(pi.serial_number,'') ILIKE $${i} OR p.part_name ILIKE $${i})`);
  }
  const where = conditions.join(' AND ');
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const offset = (safePage - 1) * safeLimit;

  const countR = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM part_instances pi
       JOIN parts p ON p.part_id = pi.part_id
      WHERE ${where}`,
    params
  );
  const listR = await pool.query(
    `SELECT pi.instance_id, pi.prt_id, pi.serial_number, pi.status, pi.unit_cost,
            pi.vendor_repair_dc_number, pi.notes, pi.updated_at,
            p.part_id, p.part_name, p.category
       FROM part_instances pi
       JOIN parts p ON p.part_id = pi.part_id
      WHERE ${where}
      ORDER BY pi.updated_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, safeLimit, offset]
  );
  const total = countR.rows[0]?.total || 0;
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

module.exports = {
  WAREHOUSE_ROLES,
  createPartVendorReturnDc,
  dispatchPartVendorReturnDc,
  receivePartsFromVendor,
  passPartVendorRepairQc,
  failPartVendorRepairQc,
  getPartVendorReturnDc,
  listPartVendorReturns,
  listQcPendingPartInstances,
  getPartMeta,
};
