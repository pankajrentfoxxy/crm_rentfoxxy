/**
 * Customer refused delivery → mark rejected → warehouse receives the units back
 * (OTP or e-sign inward) → QC re-entry. Only after the warehouse receipt is the
 * sales order allowed to be cancelled.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const inventorySM = require('./inventoryStateMachine');
const { createTicketFromReturn } = require('./grnTicketService');
const { emailDocument } = require('./salesManagementPdfService');
const { getDeliveryChallanLines } = require('./salesManagementService');
const { LEGACY_OTP_ROLES } = require('./deliveryOtpAccess');
const { ACTIVITY_TYPES, safeLogSalesOrderActivity } = require('./salesOrderActivityService');

const REJECTABLE_STATUSES = new Set(['in_transit', 'reached', 'shipped', 'processing', 'pending']);

const { userCanViewDeliveryRegisterOtp } = require('../services/deliveryOtpAccess');

function canViewWarehouseOtp(user) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (user.effective_permissions?.delivery_register_otp?.can_view) return true;
  return LEGACY_OTP_ROLES.has(user.role);
}

const MIGRATIONS = [
  '120_delivery_rejection_flow.sql',
  '203_delivery_refusal_warehouse_receive.sql',
];

let schemaEnsured = false;
async function ensureDeliveryRejectionSchema() {
  if (schemaEnsured) return;
  for (const file of MIGRATIONS) {
    const migrationPath = path.join(__dirname, '../migrations', file);
    if (fs.existsSync(migrationPath)) {
      await pool.query(fs.readFileSync(migrationPath, 'utf8'));
    }
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
            sales_order_number, movement_type, dc_purpose, delivery_person_id,
            rejection_reason, rejection_remarks, rejection_source, rejected_at, rejected_by,
            return_to_warehouse_at, warehouse_received_at, warehouse_received_by,
            warehouse_receiver_name, warehouse_esign_url, warehouse_receive_remarks
       FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
    [dcNumber]
  );
  return r.rows[0] || null;
}

/** Distinct sales orders behind a DC — the refusal timeline is written onto each. */
async function dcSalesOrderNumbers(client, dcNumber) {
  const r = await client.query(
    `SELECT DISTINCT sales_order_number FROM delivery_challan_lines
      WHERE dc_number = $1 AND sales_order_number IS NOT NULL`,
    [dcNumber]
  );
  return r.rows.map((row) => row.sales_order_number);
}

/**
 * Append one refusal-branch event to every sales order on the DC.
 * Called after COMMIT and after the response has been sent, so it must never throw:
 * a failed audit write cannot be allowed to trigger a rollback of committed work or a
 * second response.
 */
async function logRefusalActivity(soNumbers, { action, description, remarks, metadata, user }) {
  try {
    await Promise.all((soNumbers || []).filter(Boolean).map((salesOrderNumber) =>
      safeLogSalesOrderActivity({
        salesOrderNumber,
        activityType: ACTIVITY_TYPES.DELIVERY_CHALLAN,
        action,
        description,
        remarks: remarks || null,
        metadata: metadata || {},
        user,
      })));
  } catch (err) {
    console.warn('Refusal activity log failed:', err.message);
  }
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

/** Normalise a TTSPL / serial code for comparison — warehouse staff type these by hand. */
function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

/**
 * Units on a refused DC, with the config the warehouse checks against the physical
 * laptop before signing the inward.
 */
async function listRefusedReturnUnits(client, dcNumber) {
  const entries = await collectDcSerials(dcNumber, client);
  const units = [];
  for (const entry of entries) {
    const serialId = await resolveSerialId(client, entry);
    const specRes = serialId
      ? await client.query(
        `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code, vsn.inventory_status,
                COALESCE(vsn.extra->>'brand', vpd.brand) AS brand,
                COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', vpd.model) AS model,
                COALESCE(vsn.extra->>'processor', vpd.processor) AS processor,
                COALESCE(vsn.extra->>'generation', vpd.generation) AS generation,
                COALESCE(vsn.extra->>'ram', vpd.ram) AS ram,
                COALESCE(vsn.extra->>'storage', vpd.storage) AS storage,
                COALESCE(vsn.extra->>'gpu', vpd.gpu) AS gpu,
                COALESCE(vsn.extra->>'screen_size', vpd.screen_size) AS screen_size
           FROM vendor_serial_numbers vsn
           LEFT JOIN vendor_product_details vpd
             ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id','')::int
          WHERE vsn.serial_id = $1`,
        [serialId]
      )
      : { rows: [] };
    const spec = specRes.rows[0] || {};
    units.push({
      serial_id: serialId,
      line_id: entry.line_id,
      sales_order_number: entry.sales_order_number,
      ttspl: spec.inventory_asset_code || entry.ttsplId || null,
      serial_number: spec.serial_number || entry.serialNumber || null,
      inventory_status: spec.inventory_status || null,
      brand: spec.brand || null,
      model: spec.model || null,
      processor: spec.processor || null,
      generation: spec.generation || null,
      ram: spec.ram || null,
      storage: spec.storage || null,
      gpu: spec.gpu || null,
      screen_size: spec.screen_size || null,
    });
  }
  return units;
}

/**
 * Warehouse must confirm the TTSPL + serial of every unit physically coming back.
 * `submitted` is [{ ttspl, serial_number }] from the receive screen; each entry has
 * to match a unit still expected on the DC, and every unit has to be accounted for.
 */
function assertRefusedUnitsVerified(units, submitted) {
  if (!Array.isArray(submitted) || !submitted.length) {
    throw new Error('Verify the TTSPL ID and serial number of every unit before receiving');
  }

  const pending = units.map((u) => ({ ...u, matched: false }));
  for (const entry of submitted) {
    const ttspl = normalizeCode(entry?.ttspl ?? entry?.ttspl_id ?? entry?.inventory_asset_code);
    const serial = normalizeCode(entry?.serial_number ?? entry?.serial);
    if (!ttspl && !serial) {
      throw new Error('Each unit needs a TTSPL ID and a serial number');
    }
    const unit = pending.find((u) => {
      if (u.matched) return false;
      const ttsplOk = !ttspl || normalizeCode(u.ttspl) === ttspl;
      const serialOk = !serial || normalizeCode(u.serial_number) === serial;
      // Require a hit on whichever identifiers the DC actually carries.
      const ttsplKnown = Boolean(normalizeCode(u.ttspl));
      const serialKnown = Boolean(normalizeCode(u.serial_number));
      if (ttsplKnown && !ttspl) return false;
      if (serialKnown && !serial) return false;
      return ttsplOk && serialOk;
    });
    if (!unit) {
      throw new Error(
        `TTSPL ${entry?.ttspl || '—'} / serial ${entry?.serial_number || '—'} is not an unreceived unit on this delivery challan`
      );
    }
    unit.matched = true;
  }

  const missed = pending.filter((u) => !u.matched);
  if (missed.length) {
    const labels = missed.map((u) => u.ttspl || u.serial_number || `#${u.line_id}`).join(', ');
    throw new Error(`All units must be verified before receiving. Still unverified: ${labels}`);
  }

  return pending.map(({ matched, ...unit }) => unit);
}

const warehouseEsignDir = path.join(__dirname, '..', 'uploads', 'pod');

/**
 * Persist the warehouse receiver's signature next to the DC's own POD assets and
 * return the relative path stored in warehouse_esign_url (same convention as esign_url).
 */
function saveWarehouseEsign(dcNumber, dataUrl) {
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) throw new Error('Warehouse e-sign is required');
  fs.mkdirSync(warehouseEsignDir, { recursive: true });
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const safeDc = String(dcNumber || 'dc').replace(/[^\w-]+/g, '_');
  const filename = `wh_esign_${safeDc}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(warehouseEsignDir, filename), Buffer.from(m[2], 'base64'));
  return `pod/${filename}`;
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
    return { already_rejected: true, sales_order_numbers: await dcSalesOrderNumbers(client, dcNumber) };
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

  // No customer asset is created on refusal: the delivered->RENTED/SOLD/ON_DEMO
  // transition (finalizeDeliveryInventory) never runs on this path, so the unit keeps
  // its in_transit state and its current_customer_id is left untouched. It only moves
  // once the warehouse physically receives it back.
  await releaseSoAllocationOnReject(client, dcNumber);

  const units = await listRefusedReturnUnits(client, dcNumber);
  return {
    rejected: true,
    sales_order_numbers: await dcSalesOrderNumbers(client, dcNumber),
    units,
    warehouse_return_pending: true,
  };
}

async function completeRejectedReturnToWarehouse(client, {
  dcNumber,
  actorUserId,
  actorName,
  warehouse = null,
}) {
  const head = await getDcHead(client, dcNumber);
  if (!head) throw new Error('Delivery challan not found');
  if (head.status !== 'rejected') throw new Error('DC is not in rejected status');
  if (head.return_to_warehouse_at) {
    return { already_completed: true, sales_order_numbers: await dcSalesOrderNumbers(client, dcNumber) };
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
        warehouse_received_at = NOW(),
        warehouse_received_by = $1,
        warehouse_receiver_name = COALESCE($3, warehouse_receiver_name),
        warehouse_esign_url = COALESCE($4, warehouse_esign_url),
        warehouse_receive_remarks = COALESCE($5, warehouse_receive_remarks),
        updated_at = NOW()
      WHERE dc_number = $2`,
    [
      actorUserId,
      dcNumber,
      warehouse?.receiverName || null,
      warehouse?.esignUrl || null,
      warehouse?.remarks || null,
    ]
  );

  return {
    serial_results: serialResults,
    sales_order_numbers: await dcSalesOrderNumbers(client, dcNumber),
    warehouse_esign_url: warehouse?.esignUrl || head.warehouse_esign_url || null,
    warehouse_receiver_name: warehouse?.receiverName || head.warehouse_receiver_name || null,
    rejection_reason: reason,
  };
}

/**
 * "Receive Back" — the warehouse e-sign inward for a refused delivery.
 * Verifies TTSPL + serial of every unit, stores the receiver + signature + remarks,
 * then hands off to the shared return-to-warehouse completion (state machine back to
 * stock + QC re-entry tickets). Mirrors the support Return DC warehouse-confirm path.
 */
async function receiveRefusedReturnWithEsign(client, {
  dcNumber,
  esignData,
  receiverName,
  remarks,
  verifiedUnits,
  actorUserId,
  actorName,
}) {
  const head = await getDcHead(client, dcNumber);
  if (!head) throw new Error('Delivery challan not found');
  if (head.status !== 'rejected') {
    throw new Error('Only a customer-refused delivery challan can be received back');
  }
  if (head.return_to_warehouse_at) {
    return { already_completed: true, sales_order_numbers: await dcSalesOrderNumbers(client, dcNumber) };
  }
  if (!receiverName?.trim()) throw new Error('Warehouse receiver name is required');

  const units = await listRefusedReturnUnits(client, dcNumber);
  const verified = assertRefusedUnitsVerified(units, verifiedUnits);
  const esignUrl = saveWarehouseEsign(dcNumber, esignData);

  const result = await completeRejectedReturnToWarehouse(client, {
    dcNumber,
    actorUserId,
    actorName,
    warehouse: { esignUrl, receiverName: receiverName.trim(), remarks: remarks?.trim() || null },
  });

  return { ...result, verified_units: verified, warehouse_esign_url: esignUrl };
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

/**
 * Can a DC'd sales order be cancelled?
 *
 * A challan on an SO normally locks cancellation for good. The single exception is the
 * refusal branch: if every challan line the SO ever produced was refused by the customer
 * AND received back at the warehouse, nothing is out with a customer or a delivery person,
 * so the order can be cancelled. Anything else (delivered, still in transit, refused but
 * not yet received) keeps the original lock.
 */
async function getSoCancelDcEligibility(client, soNumber) {
  const r = await client.query(
    `SELECT COUNT(DISTINCT dc_number)::int AS dc_count,
            COUNT(*)::int AS line_count,
            COUNT(*) FILTER (
              WHERE status = 'rejected'
                AND COALESCE(return_to_warehouse_at, warehouse_received_at) IS NOT NULL
            )::int AS refused_received_count,
            COUNT(*) FILTER (
              WHERE status = 'rejected' AND return_to_warehouse_at IS NULL
                AND warehouse_received_at IS NULL
            )::int AS awaiting_warehouse_count
       FROM delivery_challan_lines
      WHERE sales_order_number = $1`,
    [soNumber]
  );
  const row = r.rows[0] || {};
  const dcCount = Number(row.dc_count || 0);
  const lineCount = Number(row.line_count || 0);
  const refusedReceived = Number(row.refused_received_count || 0);
  const awaitingWarehouse = Number(row.awaiting_warehouse_count || 0);

  return {
    has_dc: dcCount > 0,
    dc_count: dcCount,
    dc_line_count: lineCount,
    refused_received_count: refusedReceived,
    awaiting_warehouse_count: awaitingWarehouse,
    // Every line refused + warehouse-received is the only way past the DC lock.
    all_refused_and_received: lineCount > 0 && refusedReceived === lineCount,
    can_cancel: dcCount === 0 || (lineCount > 0 && refusedReceived === lineCount),
  };
}

module.exports = {
  ensureDeliveryRejectionSchema,
  collectDcSerials,
  markDeliveryRejectedByCustomer,
  completeRejectedReturnToWarehouse,
  receiveRefusedReturnWithEsign,
  listRefusedReturnUnits,
  assertRefusedUnitsVerified,
  saveWarehouseEsign,
  getSoCancelDcEligibility,
  dcSalesOrderNumbers,
  logRefusalActivity,
  rejectCourierAndComplete,
  sendWarehouseReturnOtp,
  verifyWarehouseReturnOtp,
  releaseSoAllocationOnReject,
  REJECTABLE_STATUSES,
  canViewWarehouseOtp,
};
