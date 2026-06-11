/**
 * GRN receive → repair ticket (Floor Manager) → ticket completion → vendor QC passed.
 */
const { startWorkLog } = require('./ticketWorkLogService');
const { logTtsplEvent } = require('./ttsplAuditService');
const {
  applySerialQcUpdate,
  getProductDetailsBySerialId,
  buildAllocationLogPayload,
  insertAllocationLog,
  addToInventory
} = require('./qcCheckService');

function lineItemSpecs(line) {
  if (!line) {
    return { brand: '', model: '', processor: '', ram: '', storage: '' };
  }
  return {
    brand: String(line.brand || line.Brand || '').trim(),
    model: String(line.product_name || line.model || line.Model || '').trim(),
    processor: String(line.processor || line.Processor || '').trim(),
    ram: String(line.ram || line.RAM || '').trim(),
    storage: String(line.storage || line.Storage || '').trim()
  };
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

async function ensureLegacyInventoryRow(db, {
  serialNumber,
  machineNumber,
  brand,
  model,
  processor,
  ram,
  storage,
  stageName
}) {
  const machine = machineNumber || serialNumber;
  const existing = await db.query(
    `SELECT inventory_id FROM inventory WHERE serial_number = $1 OR machine_number = $2 LIMIT 1`,
    [serialNumber, machine]
  );

  if (existing.rows.length) {
    await db.query(
      `UPDATE inventory
       SET status = 'Floor',
           stage = $2,
           brand = COALESCE(NULLIF($3, ''), brand),
           model = COALESCE(NULLIF($4, ''), model),
           processor = COALESCE(NULLIF($5, ''), processor),
           ram = COALESCE(NULLIF($6, ''), ram),
           storage = COALESCE(NULLIF($7, ''), storage),
           updated_at = CURRENT_TIMESTAMP
       WHERE inventory_id = $1`,
      [
        existing.rows[0].inventory_id,
        stageName,
        brand,
        model,
        processor,
        ram,
        storage
      ]
    );
    return;
  }

  await db.query(
    `INSERT INTO inventory (
       stock_type, device_type, machine_number, serial_number,
       brand, model, processor, ram, storage, status, stage
     ) VALUES ('Cooling Period', 'Laptop', $1, $2, $3, $4, $5, $6, $7, 'Floor', $8)`,
    [
      machine,
      serialNumber,
      brand || 'Unknown',
      model || 'Unknown',
      processor || null,
      ram || null,
      storage || null,
      stageName
    ]
  );
}

/**
 * Create a repair ticket for a GRN-received serial (Floor Manager stage).
 * @returns {{ ok: boolean, skipped?: boolean, reason?: string, ticket_id?: number, serial_number?: string }}
 */
async function createTicketFromGrnReceive(db, {
  serialId,
  serialNumber,
  inventoryAssetCode,
  po,
  line,
  actorUserId
}) {
  const open = await db.query(
    `SELECT ticket_id FROM tickets WHERE serial_number = $1 AND status IN ('in_progress', 'on_hold')`,
    [serialNumber]
  );
  if (open.rows.length) {
    return { ok: false, skipped: true, reason: 'open_ticket', serial_number: serialNumber };
  }

  const stage = await resolveFloorManagerStage(db);
  if (!stage) {
    return { ok: false, skipped: true, reason: 'no_stage', serial_number: serialNumber };
  }

  const floorManagerUserId = await pickFloorManagerUser(db);
  const specs = lineItemSpecs(line);
  const ttspl = inventoryAssetCode || null;
  const poLabel = po?.purchase_order_number || po?.po_id || '';

  await ensureLegacyInventoryRow(db, {
    serialNumber,
    machineNumber: ttspl,
    ...specs,
    stageName: stage.stage_name
  });

  const initialCondition = poLabel
    ? `GRN receive — PO ${poLabel}`
    : 'GRN receive — vendor purchase order';

  const ins = await db.query(
    `INSERT INTO tickets (
       serial_number, ttspl_id, machine_number, brand, model, processor, ram, storage,
       initial_condition, priority, ticket_type, current_stage_id, assigned_team_id, assigned_user_id,
       initial_cost, vendor_serial_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'normal','grn_qc',$10,$11,$12,0,$13)
     RETURNING ticket_id`,
    [
      serialNumber,
      ttspl,
      ttspl,
      specs.brand || null,
      specs.model || null,
      specs.processor || null,
      specs.ram || null,
      specs.storage || null,
      initialCondition,
      stage.stage_id,
      stage.team_id,
      floorManagerUserId,
      serialId
    ]
  );

  const ticketId = ins.rows[0].ticket_id;

  await db.query(
    `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes)
     VALUES ($1, $2, $3, 'created', $4)`,
    [
      ticketId,
      stage.stage_id,
      actorUserId,
      `Ticket auto-created from GRN receive (serial: ${serialNumber})`
    ]
  );

  if (floorManagerUserId) {
    await startWorkLog(db, {
      ticketId,
      userId: floorManagerUserId,
      stageId: stage.stage_id
    });
  }

  if (ttspl) {
    await logTtsplEvent({
      ttsplId: ttspl,
      vendorSerialId: serialId,
      eventType: 'ticket_created',
      description: 'QC ticket created from GRN receive',
      metadata: { ticket_id: ticketId, po: poLabel, serial_number: serialNumber },
      actorUserId: actorUserId,
      db
    });
  }

  return { ok: true, ticket_id: ticketId, serial_number: serialNumber };
}

/**
 * When a GRN-linked ticket completes, mark vendor serial QC passed (inventory parity).
 */
async function applyGrnVendorQcPassOnTicketComplete(db, ticket, userId) {
  const vendorSerialId = ticket?.vendor_serial_id;
  if (!vendorSerialId) return { applied: false, reason: 'not_grn_ticket' };

  const cur = await db.query(
    `SELECT qc_status FROM vendor_serial_numbers WHERE serial_id = $1 AND deleted_at IS NULL`,
    [vendorSerialId]
  );
  if (!cur.rows.length) return { applied: false, reason: 'vendor_serial_missing' };
  if (String(cur.rows[0].qc_status || '').toLowerCase() === 'passed') {
    return { applied: false, reason: 'already_passed' };
  }

  const details = await getProductDetailsBySerialId(db, vendorSerialId);
  if (!details) return { applied: false, reason: 'vendor_details_missing' };

  const remark = 'QC passed via ticket completion (GRN flow)';
  const updateResult = await applySerialQcUpdate(db, {
    serialId: vendorSerialId,
    serialNumber: ticket.serial_number,
    selected: 'passed',
    remark,
    sparePartsIds: ''
  });
  if (!updateResult.ok) {
    throw new Error(updateResult.message || 'Vendor QC update failed');
  }

  const logPayload = await buildAllocationLogPayload(db, details, 'passed', remark, '', userId);
  await insertAllocationLog(db, logPayload);
  await addToInventory(
    db,
    vendorSerialId,
    ticket.serial_number,
    details.product_id,
    details.model_name,
    'in_stock',
    details.unique_product_serial
  );
  await db.query(
    `UPDATE vendor_serial_numbers SET inventory_status = 'in_stock', updated_at = NOW() WHERE serial_id = $1`,
    [vendorSerialId]
  );

  return { applied: true, serial_id: vendorSerialId };
}

module.exports = {
  lineItemSpecs,
  createTicketFromGrnReceive,
  applyGrnVendorQcPassOnTicketComplete
};
