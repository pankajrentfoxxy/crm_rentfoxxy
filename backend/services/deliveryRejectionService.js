/**
 * Customer refused delivery → mark rejected → warehouse confirms return (OTP) → QC re-entry.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const inventorySM = require('./inventoryStateMachine');
const { createTicketFromReturn } = require('./grnTicketService');
const { emailDocument } = require('./salesManagementPdfService');
const { getDeliveryChallanLines } = require('./salesManagementService');
const { LEGACY_OTP_ROLES } = require('./deliveryOtpAccess');

const REJECTABLE_STATUSES = new Set(['in_transit', 'reached', 'shipped', 'processing', 'pending']);

const { userCanViewDeliveryRegisterOtp } = require('../services/deliveryOtpAccess');

function canViewWarehouseOtp(user) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (user.effective_permissions?.delivery_register_otp?.can_view) return true;
  return LEGACY_OTP_ROLES.has(user.role);
}

let schemaEnsured = false;
async function ensureDeliveryRejectionSchema() {
  if (schemaEnsured) return;
  const migrationPath = path.join(__dirname, '../migrations/120_delivery_rejection_flow.sql');
  if (fs.existsSync(migrationPath)) {
    await pool.query(fs.readFileSync(migrationPath, 'utf8'));
  }
  schemaEnsured = true;
}

function parseSerialEntry(entry) {
  const parts = String(entry).split('|');
  const serialId = /^\d+$/.test(parts[0]) ? parseInt(parts[0], 10) : null;
  return { serialId, serialNumber: parts[1] || parts[0], ttsplId: parts[2] || null, raw: entry };
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function collectDcSerials(dcNumber, client = pool) {
  const lines = await getDeliveryChallanLines(dcNumber);
  const serials = [];
  for (const line of lines) {
    const parsed = parseJson(line.serial_number, []);
    const list = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    for (const entry of list.filter(Boolean)) {
      serials.push({ ...parseSerialEntry(entry), line_id: line.id, sales_order_number: line.sales_order_number });
    }
  }
  return serials;
}

async function resolveSerialId(client, s) {
  if (s.serialId) return s.serialId;
  const key = s.serialNumber || s.ttsplId;
  if (!key) return null;
  const r = await client.query(
    `SELECT serial_id FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (serial_number = $1 OR inventory_asset_code = $1 OR extra->>'ttspl_id' = $1)
      LIMIT 1`,
    [key]
  );
  return r.rows[0]?.serial_id || null;
}

/** Move serial back to QC-eligible stock after delivery rejection (any deploy state). */
async function resetSerialForDeliveryRejection(client, serialId, {
  reason, actorUserId, actorName,
}) {
  const r = await client.query(
    `SELECT inventory_status FROM vendor_serial_numbers WHERE serial_id = $1 AND deleted_at IS NULL`,
    [serialId]
  );
  const st = r.rows[0]?.inventory_status || null;
  const opts = { reason, actorUserId, actorName };

  if (!st || st === inventorySM.STATUS.IN_STOCK) return;

  if (st === inventorySM.STATUS.IN_TRANSIT || st === inventorySM.STATUS.RESERVED) {
    await inventorySM.backToStock(client, serialId, opts);
    return;
  }

  if ([inventorySM.STATUS.RENTED, inventorySM.STATUS.ON_DEMO, inventorySM.STATUS.SOLD].includes(st)) {
    await inventorySM.markReturned(client, serialId, opts);
    await inventorySM.backToStock(client, serialId, opts);
    return;
  }

  if (st === inventorySM.STATUS.RETURNED) {
    await inventorySM.backToStock(client, serialId, opts);
    return;
  }

  await inventorySM.transitionAsset(client, {
    serialId,
    toStatus: inventorySM.STATUS.IN_STOCK,
    dcNumber: null,
    customerId: null,
    ...opts,
  });
}

async function getDcHead(client, dcNumber) {
  const r = await client.query(
    `SELECT dc_number, status, dispatch_mode, ship_by, customer_id, customer_name,
            rejection_reason, rejected_at, return_to_warehouse_at
       FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
    [dcNumber]
  );
  return r.rows[0] || null;
}

async function resetSoSerialForReject(client, { serialId, salesOrderNumber, newQcTicketId }) {
  if (!serialId || !salesOrderNumber) return;
  const r = await client.query(
    `SELECT allocation_id, qc_ticket_id, status FROM sales_order_serials
      WHERE serial_id = $1 AND sales_order_number = $2 AND status IN ('attached', 'dispatched')
      ORDER BY allocation_id DESC LIMIT 1`,
    [serialId, salesOrderNumber]
  );
  const alloc = r.rows[0];
  if (!alloc) return;

  if (alloc.qc_ticket_id && alloc.qc_ticket_id !== newQcTicketId) {
    await client.query(
      `UPDATE tickets SET status = 'cancelled', updated_at = NOW()
        WHERE ticket_id = $1 AND status NOT IN ('completed', 'cancelled')`,
      [alloc.qc_ticket_id]
    );
  }

  // Keep the SO allocation alive so the same line can get a new DC after QC re-pass.
  await client.query(
    `UPDATE sales_order_serials SET
        status = 'attached',
        qc_status = 'pending',
        qc_ticket_id = COALESCE($2, qc_ticket_id),
        dc_number = NULL,
        updated_at = NOW()
      WHERE allocation_id = $1`,
    [alloc.allocation_id, newQcTicketId || null]
  );
}

/** On reject only — release the SO line from this DC without touching inventory (still in_transit). */
async function releaseSoAllocationOnReject(client, dcNumber) {
  await client.query(
    `UPDATE sales_order_serials SET
        status = 'attached',
        dc_number = NULL,
        updated_at = NOW()
      WHERE dc_number = $1 AND status = 'dispatched'`,
    [dcNumber]
  );
}

async function processSerialsToQc(client, {
  dcNumber, actorUserId, actorName, customerLabel, reason,
}) {
  const serials = await collectDcSerials(dcNumber, client);
  const results = [];

  for (const s of serials) {
    const serialId = await resolveSerialId(client, s);
    if (!serialId) {
      results.push({ serial: s.serialNumber || s.ttsplId, skipped: true, reason: 'serial_not_found' });
      continue;
    }

    const specRes = await client.query(
      `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code, vsn.inventory_status, vsn.extra,
              COALESCE(vsn.extra->>'brand', vpd.brand) AS brand,
              COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', vpd.model) AS model,
              COALESCE(vsn.extra->>'processor', vpd.processor) AS processor,
              COALESCE(vsn.extra->>'ram', vpd.ram) AS ram,
              COALESCE(vsn.extra->>'storage', vpd.storage) AS storage
         FROM vendor_serial_numbers vsn
         LEFT JOIN vendor_product_details vpd
           ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id','')::int
        WHERE vsn.serial_id = $1`,
      [serialId]
    );
    const spec = specRes.rows[0];
    if (!spec) continue;

    await resetSerialForDeliveryRejection(client, serialId, {
      reason: `DC ${dcNumber} delivery rejected: ${reason}`,
      actorUserId,
      actorName,
    });

    await client.query(
      `UPDATE vendor_serial_numbers
          SET qc_status = 'pending', current_dc_number = NULL, updated_at = NOW()
        WHERE serial_id = $1`,
      [serialId]
    );

    const tk = await createTicketFromReturn(client, {
      serialId,
      serialNumber: spec.serial_number,
      inventoryAssetCode: spec.inventory_asset_code || spec.extra?.ttspl_id,
      customerLabel,
      dcNumber,
      reason: reason || 'Delivery rejected by customer',
      specs: {
        brand: spec.brand,
        model: spec.model,
        processor: spec.processor,
        ram: spec.ram,
        storage: spec.storage,
      },
      actorUserId,
    });

    await resetSoSerialForReject(client, {
      serialId,
      salesOrderNumber: s.sales_order_number,
      newQcTicketId: tk.ok ? tk.ticket_id : null,
    });

    results.push({
      serial_id: serialId,
      ttspl: spec.inventory_asset_code,
      return_ticket_id: tk.ok ? tk.ticket_id : null,
    });
  }

  return results;
}

async function markDeliveryRejectedByCustomer(client, {
  dcNumber,
  reason,
  remarks,
  source,
  actorUserId,
}) {
  const head = await getDcHead(client, dcNumber);
  if (!head) throw new Error('Delivery challan not found');
  if (head.status === 'rejected' && !head.return_to_warehouse_at) {
    return { already_rejected: true };
  }
  if (head.status === 'delivered') throw new Error('Cannot reject a delivered challan');
  if (!REJECTABLE_STATUSES.has(head.status)) {
    throw new Error(`DC cannot be rejected from status "${head.status}"`);
  }
  if (!reason?.trim()) throw new Error('rejection_reason is required');

  await client.query(
    `UPDATE delivery_challan_lines SET
        status = 'rejected',
        rejection_reason = $1,
        rejection_remarks = $2,
        rejection_source = $3,
        rejected_at = NOW(),
        rejected_by = $4,
        otp_code = NULL,
        otp_sent_at = NULL,
        otp_verified_at = NULL,
        updated_at = NOW()
      WHERE dc_number = $5`,
    [reason.trim(), remarks?.trim() || null, source || 'technician', actorUserId, dcNumber]
  );

  // Inventory stays in_transit until warehouse OTP confirms physical return.
  await releaseSoAllocationOnReject(client, dcNumber);

  return { rejected: true };
}

async function completeRejectedReturnToWarehouse(client, {
  dcNumber,
  actorUserId,
  actorName,
}) {
  const head = await getDcHead(client, dcNumber);
  if (!head) throw new Error('Delivery challan not found');
  if (head.status !== 'rejected') throw new Error('DC is not in rejected status');
  if (head.return_to_warehouse_at) {
    return { already_completed: true };
  }

  const reason = head.rejection_reason || 'Customer refused delivery';
  const serialResults = await processSerialsToQc(client, {
    dcNumber,
    actorUserId,
    actorName,
    customerLabel: head.customer_name,
    reason,
  });

  await client.query(
    `UPDATE delivery_challan_lines SET
        return_to_warehouse_at = NOW(),
        warehouse_return_verified_by = $1,
        warehouse_return_otp_verified_at = COALESCE(warehouse_return_otp_verified_at, NOW()),
        updated_at = NOW()
      WHERE dc_number = $2`,
    [actorUserId, dcNumber]
  );

  return { serial_results: serialResults };
}

async function rejectCourierAndComplete(client, {
  dcNumber,
  reason,
  remarks,
  actorUserId,
  actorName,
}) {
  await markDeliveryRejectedByCustomer(client, {
    dcNumber,
    reason,
    remarks,
    source: 'warehouse',
    actorUserId,
  });
  return completeRejectedReturnToWarehouse(client, {
    dcNumber,
    actorUserId,
    actorName,
  });
}

async function sendWarehouseReturnOtp(dcNumber, { user } = {}) {
  const head = await getDcHead(pool, dcNumber);
  if (!head) throw new Error('Delivery challan not found');
  if (head.status !== 'rejected') throw new Error('DC must be marked rejected first');
  if (head.return_to_warehouse_at) throw new Error('Return to warehouse already completed');

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  await pool.query(
    `UPDATE delivery_challan_lines SET
        warehouse_return_otp = $1,
        warehouse_return_otp_sent_at = NOW(),
        updated_at = NOW()
      WHERE dc_number = $2`,
    [otp, dcNumber]
  );

  const warehouseEmail = process.env.WAREHOUSE_LEAD_EMAIL
    || process.env.OPS_ALERT_EMAIL
    || process.env.SMTP_FROM
    || process.env.SMTP_USER;

  let emailed = false;
  if (warehouseEmail) {
    try {
      await emailDocument({
        to: warehouseEmail,
        subject: `Warehouse return OTP — ${dcNumber}`,
        text:
          `Delivery rejected — return to warehouse confirmation\n\n`
          + `DC: ${dcNumber}\n`
          + `Customer: ${head.customer_name || '—'}\n`
          + `Reason: ${head.rejection_reason || '—'}\n\n`
          + `Warehouse Return OTP: ${otp}\n\n`
          + `(Share this OTP with the technician when they return the laptops to warehouse.)`,
        pdfRelativePath: null,
      });
      emailed = true;
    } catch (err) {
      console.error('Warehouse return OTP email failed:', err.message);
    }
  }

  const showOtp = canViewWarehouseOtp(user);
  return {
    otp_sent: true,
    otp_visible: showOtp ? otp : undefined,
    message: emailed
      ? 'Warehouse return OTP sent to warehouse lead email.'
      : (showOtp
        ? 'OTP generated — share with technician when laptops are returned (email not configured).'
        : 'OTP generated — ask warehouse lead to open this DC for the code (email not configured).'),
  };
}

async function verifyWarehouseReturnOtp(client, {
  dcNumber,
  otp,
  actorUserId,
  actorName,
}) {
  const headRes = await client.query(
    `SELECT status, warehouse_return_otp, return_to_warehouse_at, rejection_reason
       FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Delivery challan not found');
  if (head.status !== 'rejected') throw new Error('DC is not rejected');
  if (head.return_to_warehouse_at) return { already_completed: true };
  if (!head.warehouse_return_otp) throw new Error('Request warehouse return OTP first');
  if (String(otp || '').trim() !== String(head.warehouse_return_otp)) {
    throw new Error('Invalid warehouse return OTP');
  }

  await client.query(
    `UPDATE delivery_challan_lines SET warehouse_return_otp_verified_at = NOW(), updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber]
  );

  return completeRejectedReturnToWarehouse(client, {
    dcNumber,
    actorUserId,
    actorName,
  });
}

module.exports = {
  ensureDeliveryRejectionSchema,
  collectDcSerials,
  markDeliveryRejectedByCustomer,
  completeRejectedReturnToWarehouse,
  rejectCourierAndComplete,
  sendWarehouseReturnOtp,
  verifyWarehouseReturnOtp,
  releaseSoAllocationOnReject,
  REJECTABLE_STATUSES,
  canViewWarehouseOtp,
};
