/**
 * Return Laptop to Vendor — one-way warehouse → original supplier.
 * Reuses dispatch helpers from vendorRepairDcShared; separate DC tables from repair VRDC.
 */
const pool = require('../config/db');
const { formatCompanyBlock } = require('../utils/companyDefaults');
const { logTtsplEvent } = require('./ttsplAuditService');
const { transitionAsset, STATUS } = require('./inventoryStateMachine');
const {
  currentFinancialYearLabel,
  dispatchPayloadFromBody,
  validateDispatchDetails,
} = require('./vendorRepairDcShared');

const WAREHOUSE_STATUSES = new Set(['in_stock', 'returned', 'qc_failed']);
const WAREHOUSE_ROLES = new Set(['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'procurement']);

function actorFromReq(req) {
  return {
    actorUserId: req.user?.user_id || req.user?.id || null,
    actorName: req.user?.name || req.user?.email || 'System',
    actorRole: req.user?.role || null,
  };
}

function requireWarehouseRole(role) {
  if (!role || !WAREHOUSE_ROLES.has(String(role).toLowerCase())) {
    const err = new Error('Warehouse or admin role required');
    err.status = 403;
    throw err;
  }
}

async function nextVendorReturnDcNumber(client) {
  const fy = currentFinancialYearLabel();
  const r = await client.query(
    `SELECT COALESCE(MAX((regexp_match(dc_number, '/([0-9]+)$'))[1]::int), 0) + 1 AS n
       FROM vendor_return_delivery_challans
      WHERE dc_number LIKE $1`,
    [`VRTDC/${fy}/%`]
  );
  const seq = String(r.rows[0]?.n || 1).padStart(4, '0');
  return `VRTDC/${fy}/${seq}`;
}

function buildConfig(vsn) {
  const ex = vsn.extra && typeof vsn.extra === 'object' ? vsn.extra : {};
  return [
    ex.brand || '',
    ex.model || ex.model_name || '',
    ex.processor || '',
    ex.ram || '',
    ex.storage || '',
  ].filter(Boolean).join(' / ');
}

async function assertSerialEligible(client, serialId, { vendorId, poId } = {}) {
  const r = await client.query(
    `SELECT vsn.*,
            vpo.po_id, vpo.purchase_order_number AS po_number, vpo.vendor_id,
            v.business_name AS vendor_name
       FROM vendor_serial_numbers vsn
       JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
       JOIN vendors v ON v.vendor_id = vpo.vendor_id AND v.deleted_at IS NULL
      WHERE vsn.serial_id = $1
        AND vsn.deleted_at IS NULL
      FOR UPDATE OF vsn`,
    [serialId]
  );
  const row = r.rows[0];
  if (!row) throw new Error(`Laptop serial #${serialId} not found`);
  if (!row.po_id) throw new Error(`${row.inventory_asset_code || row.serial_number}: no purchase order link`);
  if (!WAREHOUSE_STATUSES.has(String(row.inventory_status || ''))) {
    throw new Error(
      `${row.inventory_asset_code || row.serial_number}: not in warehouse (status: ${row.inventory_status})`
    );
  }
  if (vendorId && Number(row.vendor_id) !== Number(vendorId)) {
    throw new Error(`${row.inventory_asset_code || row.serial_number}: belongs to a different vendor`);
  }
  if (poId && Number(row.po_id) !== Number(poId)) {
    throw new Error(`${row.inventory_asset_code || row.serial_number}: belongs to a different PO`);
  }
  const block = await client.query(
    `SELECT d.dc_number, d.status
       FROM vendor_return_dc_items i
       JOIN vendor_return_delivery_challans d ON d.dc_number = i.dc_number
      WHERE i.serial_id = $1
        AND d.status NOT IN ('cancelled', 'completed')
      LIMIT 1`,
    [serialId]
  );
  if (block.rows.length) {
    throw new Error(
      `${row.inventory_asset_code || row.serial_number}: already on return DC ${block.rows[0].dc_number}`
    );
  }
  return row;
}

async function listEligibleLaptops({ vendorId, poId, search, page = 1, limit = 50 }) {
  const params = [];
  const where = [
    'vsn.deleted_at IS NULL',
    'vsn.po_id IS NOT NULL',
    `vsn.inventory_status IN ('in_stock', 'returned', 'qc_failed')`,
    `NOT EXISTS (
      SELECT 1 FROM vendor_return_dc_items i
      JOIN vendor_return_delivery_challans d ON d.dc_number = i.dc_number
      WHERE i.serial_id = vsn.serial_id
        AND d.status NOT IN ('cancelled', 'completed')
    )`,
  ];
  if (vendorId) {
    params.push(Number(vendorId));
    where.push(`vpo.vendor_id = $${params.length}`);
  }
  if (poId) {
    params.push(Number(poId));
    where.push(`vsn.po_id = $${params.length}`);
  }
  if (search && String(search).trim()) {
    params.push(`%${String(search).trim()}%`);
    const n = params.length;
    where.push(`(
      vsn.serial_number ILIKE $${n}
      OR vsn.inventory_asset_code ILIKE $${n}
      OR COALESCE(vsn.extra->>'ttspl_id', '') ILIKE $${n}
    )`);
  }
  const offset = (Math.max(1, page) - 1) * limit;
  params.push(limit, offset);

  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT vsn.serial_id,
              COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
              vsn.serial_number,
              vsn.inventory_status,
              vsn.qc_status,
              vsn.po_id,
              vsn.grn_id,
              vsn.rent_monthly_rate,
              vsn.warehouse_carret,
              vsn.warehouse_carret_slot,
              vpo.purchase_order_number AS po_number,
              vpo.vendor_id,
              v.business_name AS vendor_name,
              COALESCE(vsn.extra->>'brand', '') AS brand,
              COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', '') AS model
         FROM vendor_serial_numbers vsn
         JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
         JOIN vendors v ON v.vendor_id = vpo.vendor_id AND v.deleted_at IS NULL
        WHERE ${where.join(' AND ')}
        ORDER BY v.business_name, vpo.purchase_order_number, vsn.inventory_asset_code
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n
         FROM vendor_serial_numbers vsn
         JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
        WHERE ${where.join(' AND ')}`,
      params.slice(0, -2)
    ),
  ]);

  return {
    data: rows.rows,
    pagination: {
      page: Math.max(1, page),
      limit,
      total: count.rows[0]?.n || 0,
      totalPages: Math.max(1, Math.ceil((count.rows[0]?.n || 0) / limit)),
    },
  };
}

async function listReturnDcs({ status, vendorId, page = 1, limit = 25 }) {
  const params = [];
  const where = ['1=1'];
  if (status) {
    params.push(status);
    where.push(`d.status = $${params.length}`);
  }
  if (vendorId) {
    params.push(Number(vendorId));
    where.push(`d.vendor_id = $${params.length}`);
  }
  const offset = (Math.max(1, page) - 1) * limit;
  params.push(limit, offset);

  const [list, count] = await Promise.all([
    pool.query(
      `SELECT d.*,
              vpo.purchase_order_number AS po_number,
              (SELECT COUNT(*)::int FROM vendor_return_dc_items i WHERE i.dc_number = d.dc_number) AS item_count
         FROM vendor_return_delivery_challans d
         LEFT JOIN vendor_purchase_orders vpo ON vpo.po_id = d.po_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM vendor_return_delivery_challans d WHERE ${where.join(' AND ')}`,
      params.slice(0, -2)
    ),
  ]);

  return {
    data: list.rows,
    pagination: {
      page: Math.max(1, page),
      limit,
      total: count.rows[0]?.n || 0,
      totalPages: Math.max(1, Math.ceil((count.rows[0]?.n || 0) / limit)),
    },
  };
}

async function getReturnDc(dcNumber) {
  const head = await pool.query(
    `SELECT d.*, vpo.purchase_order_number AS po_number,
            v.business_name AS vendor_business_name,
            v.address AS vendor_reg_address,
            v.shipping_address AS vendor_ship_address,
            v.contact_person_name, v.contact_person_phone, v.phone
       FROM vendor_return_delivery_challans d
       LEFT JOIN vendor_purchase_orders vpo ON vpo.po_id = d.po_id
       LEFT JOIN vendors v ON v.vendor_id = d.vendor_id AND v.deleted_at IS NULL
      WHERE d.dc_number = $1`,
    [dcNumber]
  );
  if (!head.rows[0]) return null;
  const items = await pool.query(
    `SELECT i.*, vpo.purchase_order_number AS po_number
       FROM vendor_return_dc_items i
       LEFT JOIN vendor_purchase_orders vpo ON vpo.po_id = i.po_id
      WHERE i.dc_number = $1
      ORDER BY i.id`,
    [dcNumber]
  );
  return { ...head.rows[0], items: items.rows };
}

async function createReturnDc(client, {
  serialIds,
  vendorId,
  poId,
  returnReason,
  remarks,
  warehouseName,
  warehouseAddress,
  vendorName,
  vendorAddress,
  billingAddress,
  shippingAddress,
  contactPerson,
  contactMobile,
  itemReturnReasons = {},
  actorUserId,
  actorName,
}) {
  if (!Array.isArray(serialIds) || !serialIds.length) {
    throw new Error('Select at least one laptop');
  }
  const ids = [...new Set(serialIds.map((id) => Number(id)).filter((n) => Number.isFinite(n)))];
  if (!ids.length) throw new Error('Invalid serial selection');

  const serialRows = [];
  for (const sid of ids) {
    serialRows.push(await assertSerialEligible(client, sid, { vendorId, poId }));
  }

  const vendorIds = [...new Set(serialRows.map((r) => Number(r.vendor_id)))];
  const poIds = [...new Set(serialRows.map((r) => Number(r.po_id)))];
  if (vendorIds.length > 1) throw new Error('All laptops must belong to the same vendor');
  if (poIds.length > 1) throw new Error('All laptops must belong to the same purchase order');

  const resolvedVendorId = vendorIds[0];
  const resolvedPoId = poIds[0];
  const sample = serialRows[0];

  const vRes = await client.query(
    `SELECT * FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`,
    [resolvedVendorId]
  );
  const vendor = vRes.rows[0];
  if (!vendor) throw new Error('Vendor not found');

  const dcNumber = await nextVendorReturnDcNumber(client);
  const whName = warehouseName || 'Rentfoxxy Warehouse';
  const whAddr = warehouseAddress || formatCompanyBlock();
  const vName = (vendorName || vendor.business_name || '').trim();
  const vAddr = (vendorAddress || vendor.address || '').trim();
  const billAddr = billingAddress || formatCompanyBlock();
  const shipAddr = (shippingAddress || vendor.shipping_address || vAddr).trim();
  if (!vName) throw new Error('Vendor name is required');
  if (!shipAddr) throw new Error('Vendor shipping address is required');

  await client.query(
    `INSERT INTO vendor_return_delivery_challans (
       dc_number, vendor_id, po_id, vendor_name, vendor_address,
       billing_address, shipping_address, contact_person, contact_mobile,
       return_reason, remarks, warehouse_name, warehouse_address,
       status, return_date, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',CURRENT_DATE,$14)`,
    [
      dcNumber, resolvedVendorId, resolvedPoId, vName, vAddr,
      billAddr, shipAddr,
      contactPerson || vendor.contact_person_name || null,
      contactMobile || vendor.contact_person_phone || vendor.phone || null,
      returnReason || null, remarks || null, whName, whAddr,
      actorUserId || null,
    ]
  );

  for (const vsn of serialRows) {
    const ttspl = vsn.inventory_asset_code || vsn.extra?.ttspl_id;
    const itemReason = itemReturnReasons[vsn.serial_id]
      ?? itemReturnReasons[String(vsn.serial_id)]
      ?? returnReason
      ?? null;
    await client.query(
      `INSERT INTO vendor_return_dc_items (
         dc_number, serial_id, po_id, grn_id, original_vendor_id,
         ttspl_id, serial_number, brand, model, configuration,
         warehouse_carret, warehouse_carret_slot, return_reason, item_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft')`,
      [
        dcNumber, vsn.serial_id, vsn.po_id, vsn.grn_id, resolvedVendorId,
        ttspl, vsn.serial_number,
        vsn.extra?.brand || null,
        vsn.extra?.model || vsn.extra?.model_name || null,
        buildConfig(vsn),
        vsn.warehouse_carret || null,
        vsn.warehouse_carret_slot || null,
        itemReason,
      ]
    );
    await client.query(
      `UPDATE vendor_serial_numbers SET vendor_return_dc_number = $2, updated_at = NOW()
       WHERE serial_id = $1`,
      [vsn.serial_id, dcNumber]
    );
    await logTtsplEvent({
      db: client,
      vendorSerialId: vsn.serial_id,
      ttsplId: ttspl,
      eventType: 'vendor_return_dc_created',
      description: `Added to vendor return DC ${dcNumber}`,
      metadata: { dc_number: dcNumber },
      actorUserId,
      actorName,
    });
  }

  return { dc_number: dcNumber };
}

async function dispatchReturnDc(client, {
  dcNumber,
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
  const headRes = await client.query(
    `SELECT * FROM vendor_return_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Return DC not found');
  if (head.status !== 'draft') throw new Error(`Cannot dispatch — DC status is ${head.status}`);

  const dispatch = dispatchPayloadFromBody({
    ship_by: ship_by || shipBy || 'by_courier',
    dispatch_mode,
    courier_name,
    awb_number,
    courier_tracking_url,
    porter_tracking_id,
    porter_order_id,
    porter_booking_url,
    delivery_person_id,
  });
  validateDispatchDetails(dispatch);

  const items = await client.query(
    `SELECT * FROM vendor_return_dc_items WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );

  for (const item of items.rows) {
    await transitionAsset(client, {
      serialId: item.serial_id,
      toStatus: STATUS.SCRAPPED,
      reason: `Returned to vendor via ${dcNumber}`,
      dcNumber,
      actorUserId,
      actorName,
    });
    await client.query(
      `UPDATE vendor_serial_numbers SET
          qc_status = 'returned_to_vendor',
          current_customer_id = NULL,
          current_dc_number = $2,
          warehouse_carret = NULL,
          warehouse_carret_slot = NULL,
          updated_at = NOW()
       WHERE serial_id = $1`,
      [item.serial_id, dcNumber]
    );
    await client.query(
      `UPDATE vendor_return_dc_items SET item_status = 'dispatched' WHERE id = $1`,
      [item.id]
    );
    await logTtsplEvent({
      db: client,
      vendorSerialId: item.serial_id,
      ttsplId: item.ttspl_id,
      eventType: 'vendor_return_dispatched',
      description: `Dispatched to vendor on ${dcNumber}`,
      metadata: { dc_number: dcNumber },
      actorUserId,
      actorName,
    });
  }

  await client.query(
    `UPDATE vendor_return_delivery_challans SET
        status = 'dispatched',
        dispatched_at = NOW(),
        ship_by = $2,
        dispatch_mode = $3,
        courier_name = $4,
        awb_number = $5,
        courier_tracking_url = $6,
        porter_tracking_id = $7,
        delivery_person_id = $8,
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
      dispatch.delivery_person_id,
    ]
  );

  return getReturnDc(dcNumber);
}

async function completeVendorReturn(client, { dcNumber, actorUserId, actorName }) {
  const headRes = await client.query(
    `SELECT * FROM vendor_return_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Return DC not found');
  if (head.status === 'completed') return { already_completed: true, dc: await getReturnDc(dcNumber) };
  if (head.status !== 'dispatched') throw new Error('DC must be dispatched before marking vendor received');

  await client.query(
    `UPDATE vendor_return_delivery_challans SET
        status = 'completed',
        vendor_received_at = NOW(),
        vendor_received_by = $2,
        updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber, actorUserId || null]
  );

  const items = await client.query(
    `SELECT * FROM vendor_return_dc_items WHERE dc_number = $1`,
    [dcNumber]
  );
  for (const item of items.rows) {
    await client.query(
      `UPDATE vendor_return_dc_items SET item_status = 'vendor_received' WHERE id = $1`,
      [item.id]
    );
    await client.query(
      `UPDATE vendor_serial_numbers SET vendor_return_dc_number = $2, updated_at = NOW()
       WHERE serial_id = $1`,
      [item.serial_id, dcNumber]
    );
    await logTtsplEvent({
      db: client,
      vendorSerialId: item.serial_id,
      ttsplId: item.ttspl_id,
      eventType: 'vendor_return_completed',
      description: `Vendor confirmed receipt for ${dcNumber}`,
      metadata: { dc_number: dcNumber },
      actorUserId,
      actorName,
    });
  }

  return getReturnDc(dcNumber);
}

async function cancelReturnDc(client, { dcNumber, actorUserId, actorName }) {
  const headRes = await client.query(
    `SELECT * FROM vendor_return_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Return DC not found');
  if (head.status !== 'draft') throw new Error('Only draft return DCs can be cancelled');

  const items = await client.query(
    `SELECT serial_id, ttspl_id FROM vendor_return_dc_items WHERE dc_number = $1`,
    [dcNumber]
  );
  for (const item of items.rows) {
    await client.query(
      `UPDATE vendor_serial_numbers SET vendor_return_dc_number = NULL, updated_at = NOW()
       WHERE serial_id = $1`,
      [item.serial_id]
    );
  }
  await client.query(
    `UPDATE vendor_return_delivery_challans SET status = 'cancelled', updated_at = NOW()
     WHERE dc_number = $1`,
    [dcNumber]
  );
  return getReturnDc(dcNumber);
}

module.exports = {
  WAREHOUSE_ROLES,
  actorFromReq,
  requireWarehouseRole,
  listEligibleLaptops,
  listReturnDcs,
  getReturnDc,
  createReturnDc,
  dispatchReturnDc,
  completeVendorReturn,
  cancelReturnDc,
};
