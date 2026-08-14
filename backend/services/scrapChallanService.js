/**
 * Scrap Challan — one-way disposal of discarded part_instances to a scrap buyer.
 * Reuses vendorRepairDcShared helpers; does not extend vendor_repair_delivery_challans.
 */
const pool = require('../config/db');
const { appendDateRangeClauses } = require('../utils/dateRangeFilter');
const {
  currentFinancialYearLabel,
  validateEwayForConsignment,
  saveEsign,
  dispatchPayloadFromBody,
} = require('./vendorRepairDcShared');
const { recordMovement, MOVEMENT } = require('./partMovementService');

const WAREHOUSE_ROLES = new Set([
  'warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead', 'procurement',
]);

function mapById(map, id) {
  if (!map || typeof map !== 'object') return undefined;
  return map[id] ?? map[String(id)];
}

async function nextScrapChallanNumber(client) {
  const fy = currentFinancialYearLabel();
  const r = await client.query(
    `SELECT COALESCE(MAX((regexp_match(challan_number, '/([0-9]+)$'))[1]::int), 0) + 1 AS n
       FROM scrap_challans
      WHERE challan_number LIKE $1`,
    [`SCRAP/${fy}/%`]
  );
  const seq = String(r.rows[0]?.n || 1).padStart(4, '0');
  return `SCRAP/${fy}/${seq}`;
}

async function createScrapChallan(client, {
  instanceIds,
  recipientVendorId,
  recipientName,
  recipientAddress,
  contactPerson,
  contactMobile,
  billingAddress,
  remarks,
  itemRemarks = {},
  actorUserId,
}) {
  if (!Array.isArray(instanceIds) || !instanceIds.length) {
    throw new Error('Select at least one discarded part');
  }

  const ids = instanceIds.map((id) => Number(id)).filter((n) => Number.isFinite(n));
  if (!ids.length) throw new Error('Select at least one discarded part');

  const name = String(recipientName || '').trim();
  const address = String(recipientAddress || '').trim();
  if (!name) throw new Error('Recipient name is required');
  if (!address) throw new Error('Recipient address is required');

  const instRes = await client.query(
    `SELECT pi.*, p.part_name, p.category
       FROM part_instances pi
       JOIN parts p ON p.part_id = pi.part_id
      WHERE pi.instance_id = ANY($1::int[])
      FOR UPDATE OF pi`,
    [ids]
  );
  if (instRes.rows.length !== ids.length) {
    throw new Error('One or more part instances were not found');
  }

  for (const inst of instRes.rows) {
    if (inst.status !== 'discarded') {
      throw new Error(
        `Part ${inst.prt_id || `#${inst.instance_id}`} must be discarded (current: ${inst.status})`
      );
    }
    if (inst.scrap_challan_number) {
      throw new Error(
        `Part ${inst.prt_id || `#${inst.instance_id}`} is already on scrap challan ${inst.scrap_challan_number}`
      );
    }
  }

  const challanNumber = await nextScrapChallanNumber(client);
  const vendorId = recipientVendorId != null && String(recipientVendorId).trim() !== ''
    ? Number(recipientVendorId)
    : null;

  await client.query(
    `INSERT INTO scrap_challans (
        challan_number, recipient_vendor_id, recipient_name, recipient_address,
        contact_person, contact_mobile, billing_address, remarks, status, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9)`,
    [
      challanNumber,
      Number.isFinite(vendorId) ? vendorId : null,
      name,
      address,
      String(contactPerson || '').trim() || null,
      String(contactMobile || '').trim() || null,
      String(billingAddress || '').trim() || null,
      String(remarks || '').trim() || null,
      actorUserId || null,
    ]
  );

  for (const inst of instRes.rows) {
    const itemRemark = mapById(itemRemarks, inst.instance_id)
      ?? mapById(itemRemarks, inst.prt_id)
      ?? inst.notes
      ?? null;
    await client.query(
      `INSERT INTO scrap_challan_items (
          challan_number, instance_id, prt_id, part_id, part_name, serial_number, unit_cost, item_remarks
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        challanNumber,
        inst.instance_id,
        inst.prt_id,
        inst.part_id,
        inst.part_name,
        inst.serial_number,
        inst.unit_cost,
        itemRemark ? String(itemRemark).trim() || null : null,
      ]
    );
    await client.query(
      `UPDATE part_instances
          SET scrap_challan_number = $2,
              updated_at = NOW()
        WHERE instance_id = $1`,
      [inst.instance_id, challanNumber]
    );
  }

  return { challan_number: challanNumber, item_count: instRes.rows.length };
}

async function dispatchScrapChallan(client, {
  challanNumber,
  warehouseEsign,
  recipientEsign,
  dispatchBody,
  actorUserId,
  actorName,
}) {
  const headRes = await client.query(
    `SELECT * FROM scrap_challans WHERE challan_number = $1 FOR UPDATE`,
    [challanNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Scrap challan not found');
  if (head.status === 'dispatched') return { already_dispatched: true, challan_number: challanNumber };
  if (head.status !== 'draft') throw new Error('Scrap challan must be in draft to dispatch');

  const body = dispatchBody || {};
  let dispatch;
  if (body.ship_by || body.shipBy || body.dispatch_mode) {
    dispatch = dispatchPayloadFromBody(body);
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

  const whUrl = warehouseEsign
    ? saveEsign('scrap_dispatch', challanNumber, warehouseEsign)
    : head.warehouse_dispatch_esign_url;
  if (!whUrl) throw new Error('Warehouse dispatch e-signature is required');

  const recipientUrl = recipientEsign
    ? saveEsign('scrap_recipient', challanNumber, recipientEsign)
    : head.recipient_esign_url || null;

  const whSignerName = (body.warehouse_signer_name || body.warehouseSignerName || '').trim() || null;
  const recipientSignerName = (body.recipient_signer_name || body.recipientSignerName || '').trim() || null;

  const valueRes = await client.query(
    `SELECT COALESCE(SUM(unit_cost), 0)::float AS total
       FROM scrap_challan_items WHERE challan_number = $1`,
    [challanNumber]
  );
  const eway = validateEwayForConsignment({
    totalValue: valueRes.rows[0]?.total || 0,
    ewayBillNumber: body.eway_bill_number || body.ewayBillNumber || head.eway_bill_number,
    ewayBillDate: body.eway_bill_date || body.ewayBillDate || head.eway_bill_date,
  });

  await client.query(
    `UPDATE scrap_challans SET
        warehouse_dispatch_esign_url = $2,
        recipient_esign_url = COALESCE($3, recipient_esign_url),
        warehouse_dispatch_signer_name = COALESCE($4, warehouse_dispatch_signer_name),
        recipient_signer_name = COALESCE($5, recipient_signer_name),
        ship_by = $6,
        dispatch_mode = $7,
        courier_name = $8,
        awb_number = $9,
        courier_tracking_url = $10,
        porter_tracking_id = $11,
        porter_order_id = $12,
        porter_booking_url = $13,
        delivery_person_id = $14,
        eway_bill_number = $15,
        eway_bill_date = $16,
        status = 'dispatched',
        dispatched_at = NOW(),
        updated_at = NOW()
      WHERE challan_number = $1`,
    [
      challanNumber,
      whUrl,
      recipientUrl,
      whSignerName,
      recipientSignerName,
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

  const itemsRes = await client.query(
    `SELECT i.*, pi.status AS instance_status, p.category
       FROM scrap_challan_items i
       JOIN part_instances pi ON pi.instance_id = i.instance_id
       LEFT JOIN parts p ON p.part_id = i.part_id
      WHERE i.challan_number = $1
      FOR UPDATE OF pi`,
    [challanNumber]
  );

  for (const item of itemsRes.rows) {
    if (item.instance_status !== 'discarded') {
      throw new Error(
        `Part ${item.prt_id || `#${item.instance_id}`} is no longer discarded (current: ${item.instance_status})`
      );
    }
    await client.query(
      `UPDATE part_instances
          SET status = 'scrapped',
              updated_at = NOW()
        WHERE instance_id = $1`,
      [item.instance_id]
    );
    await recordMovement(client, {
      type: MOVEMENT.SCRAPPED,
      partId: item.part_id,
      instanceId: item.instance_id,
      prtId: item.prt_id,
      serialNumber: item.serial_number,
      category: item.category,
      partName: item.part_name,
      unitCost: item.unit_cost,
      vendorId: head.recipient_vendor_id,
      notes: `Scrapped via ${challanNumber}`,
      actorUserId,
      actorName,
    });
  }

  return { challan_number: challanNumber, status: 'dispatched', item_count: itemsRes.rows.length };
}

async function cancelDraftScrapChallan(client, { challanNumber }) {
  const headRes = await client.query(
    `SELECT * FROM scrap_challans WHERE challan_number = $1 FOR UPDATE`,
    [challanNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Scrap challan not found');
  if (head.status !== 'draft') {
    throw new Error('Only draft scrap challans can be cancelled');
  }

  await client.query(
    `UPDATE part_instances
        SET scrap_challan_number = NULL,
            updated_at = NOW()
      WHERE scrap_challan_number = $1`,
    [challanNumber]
  );
  // Hard delete — scrap_challans has no deleted_at (same as VRDC part items cleanup style)
  await client.query(`DELETE FROM scrap_challans WHERE challan_number = $1`, [challanNumber]);

  return { challan_number: challanNumber, cancelled: true };
}

async function getScrapChallan(challanNumber) {
  const head = await pool.query(
    `SELECT d.*,
            v.business_name AS recipient_vendor_name
       FROM scrap_challans d
       LEFT JOIN vendors v ON v.vendor_id = d.recipient_vendor_id AND v.deleted_at IS NULL
      WHERE d.challan_number = $1`,
    [challanNumber]
  );
  if (!head.rows[0]) return null;
  const items = await pool.query(
    `SELECT i.*,
            pi.status AS instance_status,
            p.category
       FROM scrap_challan_items i
       LEFT JOIN part_instances pi ON pi.instance_id = i.instance_id
       LEFT JOIN parts p ON p.part_id = COALESCE(i.part_id, pi.part_id)
      WHERE i.challan_number = $1
      ORDER BY i.id ASC`,
    [challanNumber]
  );
  return { ...head.rows[0], items: items.rows };
}

async function listScrapChallans({
  search,
  status,
  page = 1,
  limit = 50,
  dateFrom,
  dateTo,
} = {}) {
  const params = [];
  const conditions = ['TRUE'];

  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    const i = params.length;
    conditions.push(`(
      d.challan_number ILIKE $${i}
      OR d.recipient_name ILIKE $${i}
      OR COALESCE(d.contact_person, '') ILIKE $${i}
      OR EXISTS (
        SELECT 1 FROM scrap_challan_items i
         WHERE i.challan_number = d.challan_number
           AND (i.prt_id ILIKE $${i} OR COALESCE(i.serial_number,'') ILIKE $${i} OR COALESCE(i.part_name,'') ILIKE $${i})
      )
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
  if (dateClauses.length) conditions.push(...dateClauses);

  const where = conditions.join(' AND ');
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const offset = (safePage - 1) * safeLimit;

  const countR = await pool.query(
    `SELECT COUNT(*)::int AS total FROM scrap_challans d WHERE ${where}`,
    params
  );
  const total = countR.rows[0]?.total || 0;

  const listR = await pool.query(
    `SELECT d.*,
            (SELECT COUNT(*)::int FROM scrap_challan_items i WHERE i.challan_number = d.challan_number) AS item_count
       FROM scrap_challans d
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

module.exports = {
  WAREHOUSE_ROLES,
  nextScrapChallanNumber,
  createScrapChallan,
  dispatchScrapChallan,
  cancelDraftScrapChallan,
  getScrapChallan,
  listScrapChallans,
};
