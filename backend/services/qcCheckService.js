/**
 * Laravel helpers.php parity for QualityCheckController@qcCheck
 */
const { parseExtra, resolveLineItem } = require('./qcManagementService');

function uniqueDisplay(row, extra) {
  if (row.inventory_asset_code) return String(row.inventory_asset_code);
  const ex = extra || parseExtra(row.extra);
  return ex.unique_product_serial || ex.unique_number || '';
}

async function getProductDetailsBySerialNumber(client, serialNumber) {
  const r = await client.query(
    `SELECT
       s.serial_id,
       s.serial_number,
       s.inventory_asset_code,
       s.po_id,
       s.grn_id,
       s.qc_status,
       s.inventory_status,
       s.remark,
       s.extra,
       s.rental_start_date,
       p.po_id AS purchase_order_id,
       p.purchase_order_number,
       p.purchase_order_type,
       p.vendor_id,
       p.line_items,
       g.grn_id AS grn_id_join
     FROM vendor_serial_numbers s
     INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
     LEFT JOIN vendor_goods_received_notes g ON g.grn_id = s.grn_id AND g.deleted_at IS NULL
     WHERE s.deleted_at IS NULL
       AND s.serial_number = $1
     ORDER BY s.serial_id DESC
     LIMIT 1`,
    [serialNumber]
  );
  if (!r.rows.length) return null;

  const row = r.rows[0];
  const extra = parseExtra(row.extra);
  const line = resolveLineItem(row.line_items, row.extra);
  const productId =
    extra.product_id ??
    extra.product_detail_id ??
    extra.pro_id ??
    line?.product_detail_id ??
    line?.product_id ??
    line?.pro_id ??
    null;

  return {
    ...row,
    product_id: productId,
    product_warranty: line?.warranty_months ?? line?.product_warranty ?? extra.product_warranty ?? null,
    rental_period: row.rental_start_date ?? line?.rental_period ?? extra.rental_period ?? null,
    vendor_locking_period: line?.vendor_locking_period ?? line?.locking_period ?? null,
    model_name: line?.product_name ?? line?.model ?? extra.model ?? '',
    unique_product_serial: uniqueDisplay(row, extra),
    line_item: line,
    extra_parsed: extra
  };
}

async function getProductDetailsBySerialId(client, serialId) {
  const r = await client.query(
    `SELECT serial_number FROM vendor_serial_numbers
     WHERE serial_id = $1 AND deleted_at IS NULL`,
    [serialId]
  );
  if (!r.rows.length) return null;
  return getProductDetailsBySerialNumber(client, r.rows[0].serial_number);
}

async function getVendorDetailsById(client, vendorId) {
  const r = await client.query(
    `SELECT vendor_id AS id, first_name AS f_name, business_name, email, phone
     FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`,
    [vendorId]
  );
  return r.rows[0] || null;
}

async function getPurchasedOrderDetails(client, poId) {
  const r = await client.query(
    `SELECT po_id AS id, purchase_order_number, purchase_order_type, vendor_id
     FROM vendor_purchase_orders WHERE po_id = $1 AND deleted_at IS NULL`,
    [poId]
  );
  return r.rows[0] || null;
}

async function saveRepairLogIfNotExists(client, data) {
  await client.query(
    `INSERT INTO repair_logs (
       serial_number_id, serial_number, unique_number,
       repair_start_date, repair_end_date, type, remarks
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      data.serial_number_id,
      data.serial_number,
      data.unique_number,
      data.repair_start_date,
      data.repair_end_date ?? null,
      data.type,
      data.remarks ?? null
    ]
  );
}

async function updateRentEndDateIfRepaired(client, serialId, amount) {
  const r = await client.query(
    `SELECT * FROM rent_devices WHERE serial_id = $1 ORDER BY id DESC LIMIT 1`,
    [serialId]
  );
  const latest = r.rows[0];
  if (!latest) return null;

  const rentStartDate = latest.rent_start_date;
  const currentDate = new Date();
  const start = rentStartDate ? new Date(rentStartDate) : currentDate;
  const daysDifference = Math.round((currentDate - start) / (24 * 60 * 60 * 1000));
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const monthlyRent = Number(amount) || 0;
  const rentAmount = Math.round((monthlyRent / daysInMonth) * daysDifference * 100) / 100;
  const gstAmount = Math.round(rentAmount * 0.18 * 100) / 100;
  const totalAmount = Math.round((rentAmount + gstAmount) * 100) / 100;

  const today = currentDate.toISOString().slice(0, 10);
  await client.query(
    `UPDATE rent_devices SET
       rent_end_date = $1,
       rent_amount = $2,
       month_rent = $3,
       rent_with_gst = $4,
       total_amount = $5,
       updated_at = NOW()
     WHERE id = $6`,
    [today, amount, rentAmount, rentAmount + gstAmount, totalAmount, latest.id]
  );
  return latest;
}

async function insertAllocationLog(client, data) {
  await client.query(
    `INSERT INTO allocation_logs (
       user_id, vendor_id, vendor_name, product_id, model_name,
       serial_number, unique_id, action_taken, remarks,
       po_type, purchase_type, qc_status, locking_period, added_date,
       failure_reason, checked_by, assigned_to,
       warranty_status, rental_status, extra_details,
       in_ward, out_ward, file_path, require_parts, log_type
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9,
       $10, $11, $12, $13, $14,
       $15, $16, $17,
       $18, $19, $20::jsonb,
       $21, $22, $23, $24, $25
     )`,
    [
      data.user_id ?? null,
      data.vendor_id ?? null,
      data.vendor_name ?? null,
      data.product_id ?? null,
      data.model_name ?? null,
      data.serial_number ?? null,
      data.unique_id ?? null,
      data.action_taken ?? null,
      data.remarks ?? null,
      data.po_type ?? null,
      data.purchase_type ?? null,
      data.qc_status ?? null,
      data.locking_period ?? null,
      data.added_date ?? new Date(),
      data.failure_reason ?? null,
      data.checked_by ?? null,
      data.assigned_to ?? null,
      data.warranty_status ?? null,
      data.rental_status ?? null,
      JSON.stringify(data.extra_details ?? {}),
      data.in_ward ?? null,
      data.out_ward ?? null,
      data.file_path ?? null,
      data.require_parts ?? null,
      data.logType ?? data.log_type ?? null
    ]
  );
}

async function addToInventory(client, serialId, serialNumber, productId, productModelName, status = 'in_stock', logUniqueId = null) {
  const existing = await client.query(
    `SELECT id FROM vendor_product_inventory
     WHERE serial_id = $1 OR LOWER(serial_number) = LOWER($2)
     LIMIT 1`,
    [serialId, serialNumber]
  );
  if (existing.rows.length) return existing.rows[0];

  const r = await client.query(
    `INSERT INTO vendor_product_inventory (
       product_id, serial_id, serial_number, unique_product_serial, product_model_name, status
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [productId, serialId, serialNumber, logUniqueId, productModelName, status]
  );
  return r.rows[0];
}

async function applySerialQcUpdate(client, { serialId, serialNumber, selected, remark, sparePartsIds }) {
  const cur = await client.query(
    `SELECT serial_id, extra, qc_status, inventory_status, inventory_asset_code
     FROM vendor_serial_numbers
     WHERE serial_id = $1 AND serial_number = $2 AND deleted_at IS NULL
     FOR UPDATE`,
    [serialId, serialNumber]
  );
  if (!cur.rows.length) {
    return { ok: false, status: 404, message: 'Serial not found' };
  }

  const row = cur.rows[0];
  const extra = parseExtra(row.extra);
  let qcStatus = selected;
  let inventoryStatus = row.inventory_status ?? extra.status2 ?? null;

  if (selected === 'failed') {
    const details = await getProductDetailsBySerialNumber(client, serialNumber);
    if (!details) {
      return { ok: false, status: 400, message: 'Asset serial & configuration details not found.' };
    }

    await updateRentEndDateIfRepaired(client, serialId, 0);
    await saveRepairLogIfNotExists(client, {
      serial_number_id: serialId,
      serial_number: serialNumber,
      unique_number: details.unique_product_serial,
      repair_start_date: new Date().toISOString().slice(0, 10),
      repair_end_date: null,
      type: selected,
      remarks: remark
    });

    qcStatus = selected;
  } else if (selected === 'require_for_parts') {
    extra.status2 = selected;
    extra.require_parts = sparePartsIds ?? '';
    inventoryStatus = selected;
    qcStatus = selected;
  } else if (selected === 'send_to_qc_check') {
    qcStatus = 'pending';
    extra.status2 = selected;
    inventoryStatus = selected;
  } else {
    qcStatus = selected;
  }

  await client.query(
    `UPDATE vendor_serial_numbers
     SET qc_status = $1,
         remark = $2,
         inventory_status = COALESCE($3, inventory_status),
         extra = $4::jsonb,
         updated_at = NOW()
     WHERE serial_id = $5`,
    [qcStatus, remark, inventoryStatus, JSON.stringify(extra), serialId]
  );

  return { ok: true, row, extra };
}

async function buildAllocationLogPayload(client, details, selected, remark, sparePartsIds, userId) {
  const poDetails = details.po_id ? await getPurchasedOrderDetails(client, details.po_id) : null;
  const vendorDetails = poDetails?.vendor_id
    ? await getVendorDetailsById(client, poDetails.vendor_id)
    : null;

  const requireParts = selected === 'require_for_parts' ? (sparePartsIds ?? null) : null;
  const lockingPeriod = details.vendor_locking_period ?? details.line_item?.vendor_locking_period ?? null;

  return {
    user_id: userId ?? 1,
    vendor_id: vendorDetails?.id ?? poDetails?.vendor_id ?? null,
    vendor_name: vendorDetails?.f_name ?? vendorDetails?.business_name ?? null,
    product_id: details.product_id ?? null,
    model_name: details.model_name ?? '',
    serial_number: details.serial_number,
    unique_id: details.unique_product_serial,
    action_taken: selected,
    remarks: remark || null,
    po_type: null,
    purchase_type: poDetails?.purchase_order_type ?? null,
    qc_status: selected,
    locking_period: lockingPeriod,
    added_date: new Date(),
    failure_reason: null,
    checked_by: null,
    assigned_to: null,
    warranty_status: details.product_warranty ?? null,
    rental_status: details.rental_period ?? null,
    extra_details: null,
    in_ward: selected === 'passed' ? 'active' : null,
    out_ward: null,
    file_path: null,
    require_parts: requireParts
  };
}

module.exports = {
  getProductDetailsBySerialNumber,
  getProductDetailsBySerialId,
  getVendorDetailsById,
  getPurchasedOrderDetails,
  saveRepairLogIfNotExists,
  updateRentEndDateIfRepaired,
  insertAllocationLog,
  addToInventory,
  applySerialQcUpdate,
  buildAllocationLogPayload
};
