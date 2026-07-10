/**
 * Admin QC Process intake — add laptop to pending QC + ensure linked floor ticket.
 */
const { getTotalAmountOfPurchaseOrder } = require('../utils/purchaseOrderGst');
const { allocatePurchaseOrderNumber } = require('./vendorNumberService');
const { allocateTtsplCodes } = require('./vendorInventoryAssetCodeService');
const { createTicketFromGrnReceive } = require('./grnTicketService');
const { logGrnReceive, logTtsplEvent } = require('./ttsplAuditService');
const { logProductionHistory } = require('./ticketWorkflowHistoryService');
const { startWorkLog } = require('./ticketWorkLogService');
const { findBlockingTicket, blockingTicketMessage } = require('../utils/floorTicketSerialGuard');
const {
  parseExtra,
  resolveItemDescription,
  buildSerialSpecContext
} = require('./qcManagementService');

const PO_TYPES = ['rental_purchase', 'rent_to_own', 'direct_purchase'];
const DEFAULT_PO_STATE = 'Maharashtra';

function normalizeStateValue(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildConfigExtra(fields) {
  const config = {
    brand: fields.brand,
    model: fields.model,
    processor: fields.processor,
    generation: fields.generation,
    ram: fields.ram,
    storage: fields.storage || fields.ssd,
    gpu: fields.gpu,
    screen_size: fields.screen_size,
    os: fields.os
  };
  return Object.fromEntries(
    Object.entries(config).filter(([, v]) => v != null && String(v).trim() !== '')
  );
}

function mergeConfigIntoExtra(extra, itemDesc) {
  const merged = { ...(extra || {}) };
  for (const [key, value] of Object.entries(itemDesc || {})) {
    if (value != null && String(value).trim() !== '') merged[key] = value;
  }
  return merged;
}

function itemDescToGrnLine(itemDesc) {
  if (!itemDesc) return {};
  return {
    brand: itemDesc.brand,
    model: itemDesc.model,
    product_name: itemDesc.model,
    processor: itemDesc.processor,
    ram: itemDesc.ram,
    storage: itemDesc.storage,
    generation: itemDesc.generation,
    gpu: itemDesc.gpu,
    screen_size: itemDesc.screen_size,
    os: itemDesc.os
  };
}

/** Persist resolved hardware specs on ticket + vendor serial extra (generation/gpu/etc.). */
async function syncTicketHardwareConfig(db, { ticketId, serialId, itemDesc }) {
  if (!ticketId || !itemDesc) return;

  const brand = String(itemDesc.brand || '').trim();
  const model = String(itemDesc.model || '').trim();
  const processor = String(itemDesc.processor || '').trim();
  const ram = itemDesc.ram != null ? String(itemDesc.ram).trim() : '';
  const storage = itemDesc.storage != null ? String(itemDesc.storage).trim() : '';
  const hasAny = [brand, model, processor, ram, storage].some(Boolean);
  if (!hasAny) return;

  await db.query(
    `UPDATE tickets
        SET brand = COALESCE(NULLIF($1, ''), brand),
            model = COALESCE(NULLIF($2, ''), model),
            processor = COALESCE(NULLIF($3, ''), processor),
            ram = COALESCE(NULLIF($4, ''), ram),
            storage = COALESCE(NULLIF($5, ''), storage),
            updated_at = NOW()
      WHERE ticket_id = $6`,
    [brand, model, processor, ram, storage, ticketId]
  );

  if (serialId) {
    const cur = await db.query(
      `SELECT extra FROM vendor_serial_numbers WHERE serial_id = $1`,
      [serialId]
    );
    const extra = mergeConfigIntoExtra(parseExtra(cur.rows[0]?.extra), itemDesc);
    await db.query(
      `UPDATE vendor_serial_numbers SET extra = $1::jsonb, updated_at = NOW() WHERE serial_id = $2`,
      [JSON.stringify(extra), serialId]
    );
  }
}

async function findActiveFloorTicket(db, { serialId, serialNumber }) {
  const r = await db.query(
    `SELECT ticket_id, status
       FROM tickets
      WHERE status IN ('in_progress', 'on_hold')
        AND (vendor_serial_id = $1 OR serial_number = $2)
      ORDER BY created_at DESC
      LIMIT 1`,
    [serialId, serialNumber]
  );
  return r.rows[0] || null;
}

async function resolveFloorManagerStage(db) {
  const r = await db.query(
    `SELECT stage_id, team_id, stage_name
       FROM stages
      WHERE stage_name = 'Floor Manager'
      ORDER BY stage_order ASC
      LIMIT 1`
  );
  if (r.rows.length) return r.rows[0];
  const fallback = await db.query(
    `SELECT stage_id, team_id, stage_name FROM stages ORDER BY stage_order ASC LIMIT 1`
  );
  return fallback.rows[0] || null;
}

async function pickFloorManagerUser(db) {
  const r = await db.query(
    `SELECT user_id FROM users WHERE role = 'floor_manager' AND active = TRUE ORDER BY user_id ASC LIMIT 1`
  );
  return r.rows[0]?.user_id ?? null;
}

async function reopenDiagnosisFailedTicketForQcProcess(db, ticketId, {
  actorUserId,
  sourceNote,
  inventoryAssetCode,
  serialId,
}) {
  const stage = await resolveFloorManagerStage(db);
  if (!stage) {
    return { ok: false, status: 500, message: 'Floor Manager stage is not configured.' };
  }

  const floorManagerUserId = await pickFloorManagerUser(db);
  const beforeRes = await db.query(
    `SELECT t.*, s.stage_name
       FROM tickets t
       LEFT JOIN stages s ON s.stage_id = t.current_stage_id
      WHERE t.ticket_id = $1`,
    [ticketId]
  );
  const ticketBefore = beforeRes.rows[0];
  if (!ticketBefore) {
    return { ok: false, status: 404, message: 'Ticket not found' };
  }

  await db.query(
    `UPDATE tickets
        SET status = 'in_progress',
            current_stage_id = $1,
            assigned_team_id = $2,
            assigned_user_id = $3,
            updated_at = NOW()
      WHERE ticket_id = $4`,
    [stage.stage_id, stage.team_id, floorManagerUserId, ticketId]
  );

  const afterRes = await db.query('SELECT * FROM tickets WHERE ticket_id = $1', [ticketId]);
  const ticketAfter = afterRes.rows[0];
  const note = sourceNote || 'Reopened from QC Process for production';

  await logProductionHistory(db, {
    ticketBefore,
    ticketAfter,
    beforeStageName: ticketBefore.stage_name,
    afterStageName: stage.stage_name,
    source: 'qcProcessReopen',
    remarks: note,
    actor: { user_id: actorUserId },
    assignmentType: 'qc_process_reopen',
  });

  await db.query(
    `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes)
     VALUES ($1, $2, $3, 'reopened', $4)`,
    [ticketId, stage.stage_id, actorUserId, note]
  );

  if (floorManagerUserId) {
    await startWorkLog(db, {
      ticketId,
      userId: floorManagerUserId,
      stageId: stage.stage_id,
    });
  }

  if (inventoryAssetCode && serialId) {
    await logTtsplEvent({
      ttsplId: inventoryAssetCode,
      vendorSerialId: serialId,
      eventType: 'ticket_reopened',
      description: note,
      metadata: { ticket_id: ticketId, source: 'qc_process' },
      actorUserId,
      db,
    }).catch(() => {});
  }

  return { ok: true, ticket_id: ticketId, reopened: true, serial_number: ticketBefore.serial_number };
}

/**
 * Create a floor ticket for QC unless an active one already exists for this serial.
 */
async function ensureFloorTicketForQcSerial(db, {
  serialId,
  serialNumber,
  inventoryAssetCode,
  po,
  line,
  actorUserId,
  sourceNote = 'QC Process intake'
}) {
  const existing = await findActiveFloorTicket(db, { serialId, serialNumber });
  if (existing) {
    return {
      ok: true,
      skipped: true,
      reason: 'existing_ticket',
      ticket_id: existing.ticket_id,
      serial_number: serialNumber
    };
  }

  return createTicketFromGrnReceive(db, {
    serialId,
    serialNumber,
    inventoryAssetCode,
    po,
    line,
    actorUserId,
    initialConditionOverride: sourceNote
  });
}

function buildIntakeLineItem(body) {
  const unitPrice = Number(body.unit_price ?? body.purchase_amount ?? 0) || 0;
  const config = buildConfigExtra(body);
  return {
    quantity: 1,
    receivedQty: 1,
    brand: config.brand || body.brand,
    model: config.model || body.model,
    product_name: config.model || body.model,
    processor: config.processor,
    generation: config.generation,
    ram: config.ram,
    storage: config.storage,
    gpu: config.gpu,
    screen_size: config.screen_size,
    os: config.os,
    unit_price: unitPrice,
    price: unitPrice,
    vendor_locking_period: body.vendor_locking_period ?? null,
    warranty: body.warranty ?? null
  };
}

/**
 * Admin-only: create PO + GRN + pending serial and ensure floor ticket.
 */
async function addLaptopToQcProcess(db, body, actorUserId) {
  const serialNumber = String(body.serial_number || '').trim().toUpperCase();
  if (!serialNumber) {
    return { ok: false, status: 400, message: 'Serial number is required' };
  }

  const vendorId = Number(body.vendor_id);
  if (!Number.isFinite(vendorId) || vendorId < 1) {
    return { ok: false, status: 400, message: 'Vendor is required' };
  }

  const purchaseOrderType = String(body.purchase_order_type || 'rental_purchase').trim();
  if (!PO_TYPES.includes(purchaseOrderType)) {
    return { ok: false, status: 400, message: 'Invalid purchase order type' };
  }

  for (const field of ['brand', 'model', 'processor', 'ram']) {
    if (!String(body[field] || '').trim()) {
      return { ok: false, status: 400, message: `${field.replace(/_/g, ' ')} is required` };
    }
  }
  if (!String(body.storage || body.ssd || '').trim()) {
    return { ok: false, status: 400, message: 'SSD / storage is required' };
  }

  const rentalStartDate = String(body.rental_start_date || new Date().toISOString().slice(0, 10)).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rentalStartDate)) {
    return { ok: false, status: 400, message: 'rental_start_date must be YYYY-MM-DD' };
  }

  const purchaseOrderDate = String(body.purchase_order_date || rentalStartDate).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseOrderDate)) {
    return { ok: false, status: 400, message: 'purchase_order_date must be YYYY-MM-DD' };
  }

  const vendorR = await db.query(
    `SELECT vendor_id, state, business_name, first_name
       FROM vendors
      WHERE vendor_id = $1 AND deleted_at IS NULL`,
    [vendorId]
  );
  if (!vendorR.rows.length) {
    return { ok: false, status: 404, message: 'Vendor not found' };
  }
  const vendor = vendorR.rows[0];

  const poState = String(body.po_state || vendor.state || DEFAULT_PO_STATE).trim() || DEFAULT_PO_STATE;
  const isSameState =
    typeof body.is_same_state === 'boolean'
      ? body.is_same_state
      : normalizeStateValue(vendor.state) === normalizeStateValue(poState);

  const line = buildIntakeLineItem(body);
  const subTotal = Number(body.sub_total_amount ?? line.unit_price ?? 0) || 0;
  const totalAmount = Number(body.total_amount) || getTotalAmountOfPurchaseOrder(subTotal, !!isSameState);

  const preferredAssetCode = body.inventory_asset_code
    ? String(body.inventory_asset_code).trim().toUpperCase()
    : body.asset_tag
      ? String(body.asset_tag).trim().toUpperCase()
      : null;

  const client = await db.connect();
  let poId;
  let grnId;
  let serialId;
  let inventoryAssetCode;
  let purchaseOrderNumber;

  try {
    await client.query('BEGIN');

    const dupSerial = await client.query(
      `SELECT serial_id FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND LOWER(serial_number) = LOWER($1)
        LIMIT 1`,
      [serialNumber]
    );
    if (dupSerial.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, message: 'Serial number already exists in inventory' };
    }

    if (preferredAssetCode) {
      const dupAsset = await client.query(
        `SELECT serial_id FROM vendor_serial_numbers
          WHERE deleted_at IS NULL AND UPPER(inventory_asset_code) = $1
          LIMIT 1`,
        [preferredAssetCode]
      );
      if (dupAsset.rows.length) {
        await client.query('ROLLBACK');
        return { ok: false, status: 409, message: 'Asset tag (TTSPL) already exists' };
      }
      inventoryAssetCode = preferredAssetCode;
    } else {
      [inventoryAssetCode] = await allocateTtsplCodes(client, 1);
    }

    purchaseOrderNumber = await allocatePurchaseOrderNumber(
      client,
      body.purchase_order_number ? String(body.purchase_order_number).trim() : null
    );

    const poIns = await client.query(
      `INSERT INTO vendor_purchase_orders (
         purchase_order_number, purchase_order_date, purchase_order_type, vendor_id,
         po_state, is_same_state, sub_total_amount, total_amount,
         line_items, assets_details, product_details_legacy_ids, remarks,
         status, invoice_created, status_updated_by_admin_id, status_updated_by_name
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,TRUE,$14,$15)
       RETURNING po_id, purchase_order_number, purchase_order_type, vendor_id`,
      [
        purchaseOrderNumber,
        purchaseOrderDate,
        purchaseOrderType,
        vendorId,
        poState,
        isSameState,
        subTotal,
        totalAmount,
        JSON.stringify([line]),
        JSON.stringify({ intake: true, lines: [line] }),
        JSON.stringify([]),
        body.remarks || 'QC Process — admin laptop intake',
        'approved',
        actorUserId || null,
        body.status_updated_by_name || 'Admin'
      ]
    );
    poId = poIns.rows[0].po_id;

    const grnIns = await client.query(
      `INSERT INTO vendor_goods_received_notes (po_id, meta, bill_status)
       VALUES ($1, $2::jsonb, 'pending')
       RETURNING grn_id`,
      [poId, JSON.stringify({ intake_source: 'qc_process_add' })]
    );
    grnId = grnIns.rows[0].grn_id;

    const extra = {
      line_index: 0,
      rental_start_date: rentalStartDate,
      unique_product_serial: inventoryAssetCode,
      intake_source: 'qc_process_add',
      ...buildConfigExtra(body)
    };
    if (body.remarks) extra.intake_remarks = String(body.remarks).trim();

    const serialIns = await client.query(
      `INSERT INTO vendor_serial_numbers (
         po_id, grn_id, serial_number, inventory_asset_code, rental_start_date,
         qc_status, inventory_status, extra
       ) VALUES ($1,$2,$3,$4,$5::date,'pending','in_stock',$6::jsonb)
       RETURNING serial_id, serial_number, inventory_asset_code`,
      [poId, grnId, serialNumber, inventoryAssetCode, rentalStartDate, JSON.stringify(extra)]
    );
    serialId = serialIns.rows[0].serial_id;

    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    if (String(e.code) === '23505') {
      return { ok: false, status: 409, message: 'Serial number or asset tag already exists' };
    }
    throw e;
  } finally {
    client.release();
  }

  const po = {
    po_id: poId,
    purchase_order_number: purchaseOrderNumber,
    purchase_order_type: purchaseOrderType,
    vendor_id: vendorId
  };

  try {
    await logGrnReceive({
      ttsplId: inventoryAssetCode || serialNumber,
      vendorSerialId: serialId,
      serialNumber,
      poLabel: purchaseOrderNumber,
      actorUserId
    });
  } catch (auditErr) {
    console.error('QC intake GRN audit failed:', auditErr);
  }

  const ticketResult = await ensureFloorTicketForQcSerial(db, {
    serialId,
    serialNumber,
    inventoryAssetCode,
    po,
    line,
    actorUserId,
    sourceNote: `QC Process intake — PO ${purchaseOrderNumber}`
  });

  return {
    ok: true,
    data: {
      serial_id: serialId,
      serial_number: serialNumber,
      inventory_asset_code: inventoryAssetCode,
      po_id: poId,
      purchase_order_number: purchaseOrderNumber,
      grn_id: grnId,
      ticket: ticketResult
    }
  };
}

/**
 * Admin-only: move QC-passed serial back to pending QC and ensure floor ticket.
 */
async function movePassedSerialToQcProcess(db, { serialId, serialNumber }, actorUserId) {
  const client = await db.connect();
  let row;
  let po;
  let itemDesc;

  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT s.serial_id, s.serial_number, s.inventory_asset_code, s.extra, s.qc_status, s.po_id,
              p.purchase_order_number, p.purchase_order_type, p.vendor_id, p.line_items,
              p.product_details_legacy_ids
         FROM vendor_serial_numbers s
         INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
        WHERE s.serial_id = $1
          AND s.serial_number = $2
          AND s.deleted_at IS NULL
          AND s.po_id IS NOT NULL
        FOR UPDATE`,
      [serialId, serialNumber]
    );
    if (!cur.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, message: 'Serial not found' };
    }

    row = cur.rows[0];
    po = {
      po_id: row.po_id,
      purchase_order_number: row.purchase_order_number,
      purchase_order_type: row.purchase_order_type,
      vendor_id: row.vendor_id
    };

    const effectiveQc = String(row.qc_status || parseExtra(row.extra).status || 'pending').trim();
    if (effectiveQc !== 'passed') {
      await client.query('ROLLBACK');
      return {
        ok: false,
        status: 400,
        message: 'Only QC passed serials can be moved back to QC Process'
      };
    }

    const specCtx = await buildSerialSpecContext(client, [row]);
    itemDesc = resolveItemDescription(row, specCtx);

    const extra = mergeConfigIntoExtra(parseExtra(row.extra), itemDesc);
    delete extra.status2;
    extra.status = 'pending';

    await client.query(
      `UPDATE vendor_serial_numbers
          SET qc_status = 'pending',
              extra = $1::jsonb,
              inventory_status = CASE
                WHEN inventory_status IS NULL
                  OR inventory_status NOT IN (
                    'reserved','in_transit','rented','on_demo','sold',
                    'returned','in_repair','qc_failed','scrapped'
                  )
                THEN 'in_stock'
                ELSE inventory_status
              END,
              updated_at = NOW()
        WHERE serial_id = $2`,
      [JSON.stringify(extra), serialId]
    );

    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }

  const line = itemDescToGrnLine(itemDesc);

  const ticketResult = await ensureFloorTicketForQcSerial(db, {
    serialId: row.serial_id,
    serialNumber: row.serial_number,
    inventoryAssetCode: row.inventory_asset_code,
    po,
    line,
    actorUserId,
    sourceNote: `Moved from Ready to Rent/Sale to QC Process — PO ${po.purchase_order_number || po.po_id}`
  });

  const ticketId = ticketResult.ticket_id;
  if (ticketId) {
    await syncTicketHardwareConfig(db, {
      ticketId,
      serialId: row.serial_id,
      itemDesc
    });
  }
  const ticketNote = ticketId
    ? (ticketResult.skipped ? ` Linked to floor ticket #${ticketId}.` : ` Floor ticket #${ticketId} created.`)
    : '';

  return {
    ok: true,
    message: `Moved to QC Process.${ticketNote}`.trim(),
    data: {
      serial_id: row.serial_id,
      serial_number: row.serial_number,
      inventory_asset_code: row.inventory_asset_code,
      qc_status: 'pending',
      ticket: ticketResult
    }
  };
}

/**
 * Create a Production/Floor ticket for a serial already in QC Process (pending).
 * Rejects when an active floor ticket already exists for the serial.
 */
async function createProductionTicketForQcSerial(db, { serialId, serialNumber }, actorUserId) {
  const r = await db.query(
    `SELECT s.serial_id, s.serial_number, s.inventory_asset_code, s.extra, s.qc_status, s.po_id,
            p.purchase_order_number, p.purchase_order_type, p.vendor_id, p.line_items,
            p.product_details_legacy_ids
       FROM vendor_serial_numbers s
       INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
      WHERE s.serial_id = $1
        AND s.serial_number = $2
        AND s.deleted_at IS NULL
        AND s.po_id IS NOT NULL`,
    [serialId, serialNumber]
  );

  if (!r.rows.length) {
    return { ok: false, status: 404, message: 'Serial not found' };
  }

  const row = r.rows[0];
  const effectiveQc = String(row.qc_status || parseExtra(row.extra).status || 'pending').trim();
  if (effectiveQc !== 'pending') {
    return {
      ok: false,
      status: 400,
      message: 'Production tickets can only be created for laptops in QC Process (pending status)'
    };
  }

  const existing = await findActiveFloorTicket(db, {
    serialId: row.serial_id,
    serialNumber: row.serial_number
  });
  if (existing) {
    return {
      ok: false,
      status: 409,
      message: `A Production ticket already exists (#${existing.ticket_id}).`,
      data: { ticket_id: existing.ticket_id, serial_id: row.serial_id }
    };
  }

  const ttspl = row.inventory_asset_code || parseExtra(row.extra).unique_product_serial || null;
  const blocked = await findBlockingTicket(db, {
    serialNumber: row.serial_number,
    ttsplId: ttspl,
    vendorSerialId: row.serial_id,
  });
  if (blocked?.status === 'out_for_repair') {
    return {
      ok: false,
      status: 409,
      message: blockingTicketMessage(blocked),
      data: { ticket_id: blocked.ticket_id, serial_id: row.serial_id }
    };
  }

  const specCtx = await buildSerialSpecContext(db, [row]);
  const itemDesc = resolveItemDescription(row, specCtx);
  const line = itemDescToGrnLine(itemDesc);
  const po = {
    po_id: row.po_id,
    purchase_order_number: row.purchase_order_number,
    purchase_order_type: row.purchase_order_type,
    vendor_id: row.vendor_id
  };
  const poLabel = po.purchase_order_number || po.po_id || '';

  const mergedExtra = mergeConfigIntoExtra(parseExtra(row.extra), itemDesc);
  await db.query(
    `UPDATE vendor_serial_numbers SET extra = $1::jsonb, updated_at = NOW() WHERE serial_id = $2`,
    [JSON.stringify(mergedExtra), row.serial_id]
  );

  if (blocked?.status === 'diagnosis_failed') {
    const reopenResult = await reopenDiagnosisFailedTicketForQcProcess(db, blocked.ticket_id, {
      actorUserId,
      sourceNote: `QC Process — reopened for production (PO ${poLabel})`,
      inventoryAssetCode: ttspl,
      serialId: row.serial_id,
    });
    if (!reopenResult.ok || !reopenResult.ticket_id) {
      return {
        ok: false,
        status: reopenResult.status || 500,
        message: reopenResult.message || 'Failed to reopen Production ticket.'
      };
    }
    await syncTicketHardwareConfig(db, {
      ticketId: reopenResult.ticket_id,
      serialId: row.serial_id,
      itemDesc
    });
    return {
      ok: true,
      message: `Production ticket #${reopenResult.ticket_id} reopened for QC Process.`,
      data: {
        serial_id: row.serial_id,
        serial_number: row.serial_number,
        inventory_asset_code: ttspl,
        ticket_id: reopenResult.ticket_id,
        reopened: true
      }
    };
  }

  const ticketResult = await createTicketFromGrnReceive(db, {
    serialId: row.serial_id,
    serialNumber: row.serial_number,
    inventoryAssetCode: ttspl,
    po,
    line,
    actorUserId,
    initialConditionOverride: `QC Process — PO ${poLabel}`
  });

  if (!ticketResult.ok || !ticketResult.ticket_id) {
    const reason = ticketResult.reason || 'unknown';
    const msg =
      ticketResult.message
      || (reason === 'open_ticket'
        ? 'A Production ticket already exists for this serial.'
        : reason === 'no_stage'
          ? 'Floor Manager stage is not configured.'
          : blockingTicketMessage({ ticket_id: ticketResult.ticket_id, status: reason })
            || 'Failed to create Production ticket.');
    return {
      ok: false,
      status: reason === 'open_ticket' || reason === 'in_progress' || reason === 'on_hold' ? 409 : 500,
      message: msg,
      data: ticketResult.ticket_id ? { ticket_id: ticketResult.ticket_id, serial_id: row.serial_id } : undefined
    };
  }

  await syncTicketHardwareConfig(db, {
    ticketId: ticketResult.ticket_id,
    serialId: row.serial_id,
    itemDesc
  });

  return {
    ok: true,
    message: `Production ticket #${ticketResult.ticket_id} created.`,
    data: {
      serial_id: row.serial_id,
      serial_number: row.serial_number,
      inventory_asset_code: ttspl,
      ticket_id: ticketResult.ticket_id
    }
  };
}

module.exports = {
  PO_TYPES,
  addLaptopToQcProcess,
  movePassedSerialToQcProcess,
  createProductionTicketForQcSerial,
  ensureFloorTicketForQcSerial,
  findActiveFloorTicket,
  syncTicketHardwareConfig,
  resolveItemDescription,
  buildSerialSpecContext,
  itemDescToGrnLine
};
