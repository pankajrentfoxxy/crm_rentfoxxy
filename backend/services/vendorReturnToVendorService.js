/**
 * Return Laptop to Vendor — one-way warehouse → original supplier.
 * Reuses dispatch helpers from vendorRepairDcShared; separate DC tables from repair VRDC.
 */
const pool = require('../config/db');
const { formatCompanyBlock } = require('../utils/companyDefaults');
const {
  formatVendorBillingFromRow,
  formatVendorShippingFromRow,
} = require('./vendorRepairPdfService');
const { logTtsplEvent } = require('./ttsplAuditService');
const { transitionAsset, STATUS } = require('./inventoryStateMachine');
const {
  currentFinancialYearLabel,
  normalizeShipBy,
  shipByToDispatchMode,
  normalizeVehicleNumber,
} = require('./vendorRepairDcShared');
const { parseIndianMobile } = require('../utils/phoneValidation');

const WAREHOUSE_STATUSES = new Set(['in_stock', 'returned', 'qc_failed']);
// D10: a rented laptop in good condition, rent still running, goes back only
// through a return request (the vendor gets the mail + PDF and rent stops on a
// chosen date). Direct challans are for QC-failed / rejected-at-door units.
const RENTAL_PO_TYPES = ['rental_purchase', 'rent_to_own'];
const REQUEST_ONLY_STATUSES = ['in_stock', 'returned'];
const NEEDS_RETURN_REQUEST_SQL = `(
  vpo.purchase_order_type = ANY(ARRAY['rental_purchase','rent_to_own'])
  AND vsn.inventory_status IN ('in_stock','returned')
  AND vsn.vendor_rent_end_date IS NULL
)`;
const WAREHOUSE_ROLES = new Set(['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'procurement']);

// Two different meanings of "returned" were being conflated. A unit whose
// inventory_status is 'returned' came back from a CUSTOMER and is sitting in our
// warehouse — the single most common reason to send a rented machine back to its
// vendor and stop paying rent on it. A unit already sent back to the vendor is a
// separate thing, and ALREADY_RETURNED_TO_VENDOR_SQL below excludes those from
// every query here regardless of the filter. So 'returned' belongs in the default
// set; 'hide_returned' stays available as an explicit opt-out.
const INVENTORY_STATUS_FILTERS = {
  all: [...WAREHOUSE_STATUSES],
  hide_returned: ['in_stock', 'qc_failed'],
  in_stock: ['in_stock'],
  returned: ['returned'],
  qc_failed: ['qc_failed'],
};

function resolveInventoryStatuses(filter) {
  const key = String(filter || 'all').trim().toLowerCase();
  return INVENTORY_STATUS_FILTERS[key] || INVENTORY_STATUS_FILTERS.all;
}

/** Already sent back to vendor (any open or completed VRTDC). Cancelled DCs do not block. */
const ALREADY_RETURNED_TO_VENDOR_SQL = `
  (
    vsn.vendor_return_dc_number IS NOT NULL
    OR COALESCE(vsn.qc_status, '') = 'returned_to_vendor'
    OR EXISTS (
      SELECT 1 FROM vendor_return_dc_items i
      JOIN vendor_return_delivery_challans d ON d.dc_number = i.dc_number
      WHERE i.serial_id = vsn.serial_id
        AND d.status <> 'cancelled'
    )
  )
`;

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
  // Serialised for the caller's transaction: plain MAX()+1 let two concurrent
  // creates take the same VRTDC number (the second failed on the unique key).
  await client.query('SELECT pg_advisory_xact_lock($1)', [840011]);
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

async function assertSerialEligible(client, serialId, { vendorId, poId, viaReturnRequest = false } = {}) {
  const r = await client.query(
    `SELECT vsn.*,
            vpo.po_id, vpo.purchase_order_number AS po_number, vpo.vendor_id,
            vpo.purchase_order_type,
            vpo.line_items -> COALESCE(NULLIF(vsn.extra->>'line_index', '')::int, 0) ->> 'asset_value' AS line_asset_value,
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
        AND d.status <> 'cancelled'
      LIMIT 1`,
    [serialId]
  );
  if (block.rows.length) {
    throw new Error(
      `${row.inventory_asset_code || row.serial_number}: already returned on DC ${block.rows[0].dc_number}`
    );
  }
  if (row.vendor_return_dc_number || String(row.qc_status || '') === 'returned_to_vendor') {
    throw new Error(
      `${row.inventory_asset_code || row.serial_number}: already returned to vendor`
    );
  }
  if (!viaReturnRequest
      && RENTAL_PO_TYPES.includes(String(row.purchase_order_type || ''))
      && REQUEST_ONLY_STATUSES.includes(String(row.inventory_status || ''))
      && !row.vendor_rent_end_date) {
    const err = new Error(
      `${row.inventory_asset_code || row.serial_number}: a rented laptop in good condition goes back through a return request `
      + '(Vendor returns → Rental returns), so the vendor is told and rent stops on a set date'
    );
    err.status = 409;
    throw err;
  }
  return row;
}

async function listEligibleLaptops({ vendorId, poId, search, inventoryStatus, page = 1, limit = 50 }) {
  const statuses = resolveInventoryStatuses(inventoryStatus);
  const params = [];
  const where = [
    'vsn.deleted_at IS NULL',
    'vsn.po_id IS NOT NULL',
    `vsn.inventory_status = ANY($${params.push(statuses)}::text[])`,
    `NOT ${ALREADY_RETURNED_TO_VENDOR_SQL}`,
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
      OR v.business_name ILIKE $${n}
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
              COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', '') AS model,
              COALESCE(vsn.rejected_at_receipt, FALSE) AS rejected_at_receipt,
              ${NEEDS_RETURN_REQUEST_SQL} AS needs_return_request,
              vsn.receipt_rejection_reason,
              (SELECT t.floor_manager_qc_fail_reason FROM tickets t
                WHERE t.vendor_serial_id = vsn.serial_id AND t.floor_manager_qc_failed
                ORDER BY t.floor_manager_qc_failed_at DESC NULLS LAST LIMIT 1) AS qc_fail_reason
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
         JOIN vendors v ON v.vendor_id = vpo.vendor_id AND v.deleted_at IS NULL
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

/**
 * Vendors that currently have inward / warehouse laptops eligible to return.
 *
 * Counts every warehouse status the DC itself accepts, 'returned' included. It
 * previously counted only in_stock and qc_failed, which made this a dead end:
 * a vendor whose returnable units had all come back from customers scored zero,
 * dropped out of the step-1 dropdown, and could never be reached — even though
 * step 2 had a "Returned only" filter and createReturnDc would have accepted
 * every one of those units.
 *
 * The per-status breakdown rides along so the dropdown can say what the count is
 * made of instead of just "N inward".
 */
async function listEligibleVendors() {
  const { rows } = await pool.query(
    `SELECT v.vendor_id,
            v.business_name,
            v.first_name,
            COUNT(*)::int AS inward_count,
            COUNT(*) FILTER (WHERE vsn.inventory_status = 'in_stock')::int AS in_stock_count,
            COUNT(*) FILTER (WHERE vsn.inventory_status = 'returned')::int AS returned_count,
            COUNT(*) FILTER (WHERE vsn.inventory_status = 'qc_failed')::int AS qc_failed_count
       FROM vendor_serial_numbers vsn
       JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
       JOIN vendors v ON v.vendor_id = vpo.vendor_id AND v.deleted_at IS NULL
      WHERE vsn.deleted_at IS NULL
        AND vsn.po_id IS NOT NULL
        AND vsn.inventory_status = ANY($1::text[])
        AND NOT ${ALREADY_RETURNED_TO_VENDOR_SQL}
      GROUP BY v.vendor_id, v.business_name, v.first_name
      ORDER BY v.business_name NULLS LAST, v.first_name NULLS LAST`,
    [[...WAREHOUSE_STATUSES]]
  );
  return rows;
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
            v.contact_person_name, v.contact_person_phone, v.phone,
            v.gst_number AS vendor_gst_number
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
  viaReturnRequest = false,
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
    serialRows.push(await assertSerialEligible(client, sid, { vendorId, poId, viaReturnRequest }));
  }

  const vendorIds = [...new Set(serialRows.map((r) => Number(r.vendor_id)))];
  const poIds = [...new Set(serialRows.map((r) => Number(r.po_id)))];
  if (vendorIds.length > 1) throw new Error('All laptops must belong to the same vendor');

  const resolvedVendorId = vendorIds[0];
  const resolvedPoId = poIds.length === 1 ? poIds[0] : null;
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
  // Bill to = the VENDOR. This defaulted to formatCompanyBlock(), which is our
  // own TrueTech block and identical to warehouse_address — so every return DC
  // carried our address in the vendor's "Bill to" box, and the PDF printed the
  // vendor's name above our address and GSTIN. On a return the vendor is the
  // counterparty being billed, so it is their registered address and their
  // GSTIN that belong here.
  const billAddr = (billingAddress || formatVendorBillingFromRow(vendor) || vAddr).trim();
  // Ship to honours shipping_same: a vendor with shipping_same true has no
  // shipping_address row at all, so falling through to the registered address is
  // the correct behaviour, not a fallback.
  const shipAddr = (shippingAddress || formatVendorShippingFromRow(vendor) || vAddr).trim();
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
         warehouse_carret, warehouse_carret_slot, return_reason, item_status, declared_value
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',$14)`,
      [
        dcNumber, vsn.serial_id, vsn.po_id, vsn.grn_id, resolvedVendorId,
        ttspl, vsn.serial_number,
        vsn.extra?.brand || null,
        vsn.extra?.model || vsn.extra?.model_name || null,
        buildConfig(vsn),
        vsn.warehouse_carret || null,
        vsn.warehouse_carret_slot || null,
        itemReason,
        // Pre-filled from the PO line's asset value when there is one; the
        // warehouse still confirms every value before the gate.
        Number(vsn.line_asset_value) > 0 ? Number(vsn.line_asset_value) : null,
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

function badTransport(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function requiredText(value, message) {
  const v = String(value || '').trim();
  if (!v) throw badTransport(message);
  return v;
}

function requiredMobile(value, label) {
  const r = parseIndianMobile(value, { required: true, label });
  if (!r.ok) throw badTransport(r.error);
  return r.value;
}

function requiredVehicle(value, label) {
  const v = normalizeVehicleNumber(value);
  if (!v) throw badTransport(`${label} is required`);
  return v;
}

/**
 * How a return challan travels (VRTDC only — the repair challan keeps its own
 * rules in vendorRepairDcShared). Every mode names who carries it:
 *   Courier       courier name + tracking ID (AWB)
 *   Porter        person, phone, vehicle (bike) number; booking ID optional
 *   Vendor pickup person, phone, vehicle number
 *   In-house      our delivery person (whose technician bucket it lands in once
 *                 the guard scans it out), phone, vehicle number
 */
async function vrtdcTransportFromBody(db, body = {}) {
  const shipBy = normalizeShipBy(body.ship_by, body.dispatch_mode);
  if (!shipBy) throw badTransport('Choose how it travels: Courier, Porter, In-house or Vendor pickup');
  const out = {
    ship_by: shipBy,
    dispatch_mode: shipByToDispatchMode(shipBy),
    courier_name: null,
    awb_number: null,
    courier_tracking_url: null,
    porter_tracking_id: null,
    porter_order_id: null,
    porter_booking_url: null,
    porter_person_name: null,
    porter_person_phone: null,
    delivery_person_id: null,
    delivery_person_name: null,
    delivery_person_phone: null,
    vehicle_number: null,
    vendor_pickup_person: null,
    vendor_pickup_mobile: null,
  };
  const opt = (v) => String(v || '').trim() || null;
  if (shipBy === 'by_courier') {
    out.courier_name = requiredText(body.courier_name, 'Courier name is required');
    out.awb_number = requiredText(body.awb_number, 'Courier tracking ID (AWB) is required');
    out.courier_tracking_url = opt(body.courier_tracking_url);
  } else if (shipBy === 'by_porter') {
    out.porter_person_name = requiredText(body.porter_person_name, 'Porter person name is required');
    out.porter_person_phone = requiredMobile(body.porter_person_phone, 'Porter person phone');
    out.vehicle_number = requiredVehicle(body.vehicle_number, 'Porter bike / vehicle number');
    out.porter_tracking_id = opt(body.porter_tracking_id);
    out.porter_order_id = opt(body.porter_order_id);
    out.porter_booking_url = opt(body.porter_booking_url);
  } else if (shipBy === 'by_vendor_pickup') {
    out.vendor_pickup_person = requiredText(body.vendor_pickup_person, 'Vendor pickup person name is required');
    out.vendor_pickup_mobile = requiredMobile(body.vendor_pickup_mobile, 'Vendor pickup phone');
    out.vehicle_number = requiredVehicle(body.vehicle_number, 'Vendor pickup bike / vehicle number');
  } else if (shipBy === 'by_hand') {
    const id = Number(body.delivery_person_id);
    if (!Number.isFinite(id) || id <= 0) throw badTransport('Choose our delivery person for In-house');
    const t = (await db.query(
      `SELECT technician_id, first_name, last_name, phone, is_active
         FROM delivery_technicians WHERE technician_id = $1`,
      [id]
    )).rows[0];
    if (!t) throw badTransport('That delivery person was not found');
    if (t.is_active === false) throw badTransport('That delivery person is inactive');
    out.delivery_person_id = t.technician_id;
    out.delivery_person_name = [t.first_name, t.last_name].filter(Boolean).join(' ').trim() || null;
    out.delivery_person_phone = requiredMobile(body.delivery_person_phone || t.phone, 'Delivery person phone');
    out.vehicle_number = requiredVehicle(body.vehicle_number, 'In-house bike / vehicle number');
  }
  return out;
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
  vehicle_number,
  vendor_pickup_person,
  vendor_pickup_mobile,
  porter_person_name,
  porter_person_phone,
  delivery_person_phone,
  declared_values,
  declaredValues,
  actorUserId,
  actorName,
}) {
  const headRes = await client.query(
    `SELECT * FROM vendor_return_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Return DC not found');
  if (head.status !== 'draft') throw new Error(`Cannot send to gate — DC status is ${head.status}`);

  // Declared value per laptop, entered alongside the delivery partner. This is
  // what the Rs 50,000 e-way threshold is measured against, so it is captured
  // here rather than asked for later — by the time Accounts sees the request the
  // dispatcher has gone.
  const { saveDeclaredValues } = require('./vrtdcEwayComplianceService');
  await saveDeclaredValues(client, dcNumber, declared_values || declaredValues || {});

  // Every laptop needs a value before it goes to the gate. A blank counted as
  // Rs 0, so a DC with no values never needed an e-way bill and walked
  // through the gate check.
  const missing = await client.query(
    `SELECT COALESCE(ttspl_id, serial_number) AS unit FROM vendor_return_dc_items
      WHERE dc_number = $1 AND COALESCE(declared_value, 0) <= 0`,
    [dcNumber]
  );
  if (missing.rows.length) {
    const err = new Error(
      `Enter the declared value for every laptop before sending to the gate (missing: ${missing.rows.map((r) => r.unit).join(', ')}).`
    );
    err.status = 400;
    throw err;
  }

  const dispatch = await vrtdcTransportFromBody(client, {
    ship_by: ship_by || shipBy,
    dispatch_mode,
    courier_name,
    awb_number,
    courier_tracking_url,
    porter_tracking_id,
    porter_order_id,
    porter_booking_url,
    porter_person_name,
    porter_person_phone,
    delivery_person_id,
    delivery_person_phone,
    vehicle_number,
    vendor_pickup_person,
    vendor_pickup_mobile,
  });

  await client.query(
    `UPDATE vendor_return_delivery_challans SET
        status = 'dispatch_ready',
        ship_by = $2,
        dispatch_mode = $3,
        courier_name = $4,
        awb_number = $5,
        courier_tracking_url = $6,
        porter_tracking_id = $7,
        delivery_person_id = $8,
        vehicle_number = $9,
        vendor_pickup_person = $10,
        vendor_pickup_mobile = $11,
        -- B13: accepted at dispatch and then dropped before migration 335.
        porter_order_id = $12,
        porter_booking_url = $13,
        porter_person_name = $14,
        porter_person_phone = $15,
        delivery_person_name = $16,
        delivery_person_phone = $17,
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
      dispatch.vehicle_number,
      dispatch.vendor_pickup_person,
      dispatch.vendor_pickup_mobile,
      dispatch.porter_order_id,
      dispatch.porter_booking_url,
      dispatch.porter_person_name,
      dispatch.porter_person_phone,
      dispatch.delivery_person_name,
      dispatch.delivery_person_phone,
    ]
  );

  return getReturnDc(dcNumber);
}

/** Guard outward confirm — the laptops are the vendor's again (D9); DC dispatched. */
async function confirmGateOutwardVrtdc(client, { dcNumber, actorUserId, actorName }) {
  const headRes = await client.query(
    `SELECT * FROM vendor_return_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Return DC not found');
  if (head.status === 'dispatched' || head.status === 'completed') {
    return { already_dispatched: true, dc: await getReturnDc(dcNumber) };
  }
  if (head.status !== 'dispatch_ready') {
    throw new Error(`Cannot confirm gate outward — DC status is ${head.status}`);
  }

  // The gate is where the e-way bill is enforced, not DC creation: a return is
  // picked and packed before anyone knows the transporter, and blocking creation
  // would stop the warehouse working. What must not happen without an e-way bill
  // is the consignment physically leaving.
  const { assertVrtdcCanLeaveGate } = require('./vrtdcEwayComplianceService');
  await assertVrtdcCanLeaveGate(dcNumber, client);

  const items = await client.query(
    `SELECT * FROM vendor_return_dc_items WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );

  for (const item of items.rows) {
    await transitionAsset(client, {
      serialId: item.serial_id,
      // D9: a returned laptop is the vendor's again, not scrap (it used to be
      // recorded as scrapped, which dropped its last part-month of rent).
      toStatus: STATUS.RETURNED_TO_VENDOR,
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
          vendor_rent_end_date = COALESCE(vendor_rent_end_date, CURRENT_DATE),
          updated_at = NOW()
       WHERE serial_id = $1`,
      [item.serial_id, dcNumber]
    );
    await client.query(
      `UPDATE vendor_return_dc_items SET item_status = 'dispatched' WHERE id = $1`,
      [item.id]
    );
    // D12: every laptop that goes back gets a draft debit note (skipped when
    // it already has a pending one, e.g. from floor QC fail).
    await require('./vendorDebitNoteService').draftForReturn(client, {
      serialId: item.serial_id, source: 'return_challan', sourceRef: dcNumber, actorUserId,
    });
    await logTtsplEvent({
      db: client,
      vendorSerialId: item.serial_id,
      ttsplId: item.ttspl_id,
      eventType: 'vendor_return_dispatched',
      description: `Dispatched to vendor on ${dcNumber} (guard outward)`,
      metadata: { dc_number: dcNumber },
      actorUserId,
      actorName,
    });
  }

  await client.query(
    `UPDATE vendor_return_delivery_challans SET
        status = 'dispatched',
        dispatched_at = NOW(),
        updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber]
  );

  if (head.return_ticket_number) {
    const ticketSvc = require('./vendorReturnTicketService');
    await ticketSvc.syncFromDc(client, { dcNumber, phase: 'dispatched' });
  }

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

  if (head.return_ticket_number) {
    const ticketSvc = require('./vendorReturnTicketService');
    await ticketSvc.syncFromDc(client, { dcNumber, phase: 'completed' });
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
  if (!['draft', 'dispatch_ready'].includes(head.status)) {
    throw new Error('Only draft or dispatch-ready return DCs can be cancelled');
  }

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
  // B14: the items are cancelled too (migration 336 allows it).
  await client.query(
    `UPDATE vendor_return_dc_items SET item_status = 'cancelled' WHERE dc_number = $1 AND item_status = 'draft'`,
    [dcNumber]
  );
  if (head.return_ticket_number) {
    const ticketSvc = require('./vendorReturnTicketService');
    await ticketSvc.syncFromDc(client, { dcNumber, phase: 'cancelled' });
  }
  return getReturnDc(dcNumber);
}

module.exports = {
  nextVendorReturnDcNumber,
  WAREHOUSE_ROLES,
  INVENTORY_STATUS_FILTERS,
  actorFromReq,
  requireWarehouseRole,
  listEligibleLaptops,
  listEligibleVendors,
  listReturnDcs,
  getReturnDc,
  createReturnDc,
  dispatchReturnDc,
  confirmGateOutwardVrtdc,
  completeVendorReturn,
  vrtdcTransportFromBody,
  cancelReturnDc,
};
