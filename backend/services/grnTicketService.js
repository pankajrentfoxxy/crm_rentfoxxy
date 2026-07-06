/**
 * GRN receive → repair ticket (Floor Manager) → ticket completion → vendor QC passed.
 */
const { startWorkLog } = require('./ticketWorkLogService');
const { logTtsplEvent } = require('./ttsplAuditService');
const { invalidateInventoryListCachesFireAndForget } = require('./inventoryListCache');
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

async function resolveStageByName(db, stageName) {
  const r = await db.query(
    `SELECT stage_id, team_id, stage_name FROM stages WHERE stage_name = $1 ORDER BY stage_order ASC LIMIT 1`,
    [stageName]
  );
  return r.rows[0] || null;
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
  actorUserId,
  initialConditionOverride
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

  const initialCondition =
    initialConditionOverride ||
    (poLabel ? `GRN receive — PO ${poLabel}` : 'GRN receive — vendor purchase order');

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
    `SELECT qc_status, inventory_status FROM vendor_serial_numbers WHERE serial_id = $1 AND deleted_at IS NULL`,
    [vendorSerialId]
  );
  if (!cur.rows.length) return { applied: false, reason: 'vendor_serial_missing' };
  const row = cur.rows[0];
  if (String(row.qc_status || '').toLowerCase() === 'passed'
    && String(row.inventory_status || '').toLowerCase() === 'in_stock') {
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
    `UPDATE vendor_serial_numbers SET inventory_status = 'in_stock', qc_status = 'passed', updated_at = NOW() WHERE serial_id = $1`,
    [vendorSerialId]
  );

  invalidateInventoryListCachesFireAndForget();
  return { applied: true, serial_id: vendorSerialId };
}

/**
 * After QC2 / Inventory completion — always flip vendor serial to passed + in_stock,
 * then run GRN allocation extras when product details exist.
 */
async function markVendorSerialReadyForRent(db, ticket, userId) {
  const vendorSerialId = ticket?.vendor_serial_id;
  if (!vendorSerialId) return { applied: false, reason: 'no_vendor_serial' };

  await db.query(
    `UPDATE vendor_serial_numbers
        SET qc_status = 'passed',
            inventory_status = 'in_stock',
            updated_at = NOW()
      WHERE serial_id = $1 AND deleted_at IS NULL`,
    [vendorSerialId]
  );

  let grn = { applied: false };
  try {
    grn = await applyGrnVendorQcPassOnTicketComplete(db, ticket, userId);
  } catch (e) {
    console.error('GRN vendor QC pass extras failed:', e.message);
  }

  if (ticket.ttspl_id) {
    await logTtsplEvent({
      ttsplId: ticket.ttspl_id,
      vendorSerialId,
      eventType: 'qc2_passed',
      description: 'QC2 passed — ready for inventory',
      actorUserId: userId,
      db,
    });
    await logTtsplEvent({
      ttsplId: ticket.ttspl_id,
      vendorSerialId,
      eventType: 'inventory_ready',
      description: 'Ticket completed — moved to Ready to Rent/Sell',
      actorUserId: userId,
      db,
    });
  }

  invalidateInventoryListCachesFireAndForget();
  return { applied: true, grn_extras: grn.applied };
}

/** Reset a returned unit into QC Process (pending) when it re-enters the warehouse. */
async function resetVendorSerialForQcReentry(db, serialId) {
  if (!serialId) return;
  await db.query(
    `UPDATE vendor_serial_numbers SET
        qc_status = 'pending',
        extra = COALESCE(extra, '{}'::jsonb) || '{"status":"pending"}'::jsonb,
        updated_at = NOW()
      WHERE serial_id = $1 AND deleted_at IS NULL`,
    [serialId]
  );
  invalidateInventoryListCachesFireAndForget();
}

/**
 * Create a QC re-entry ticket for a serial returned by a customer (Floor Manager
 * stage), mirroring the GRN-receive flow. The unit re-enters the floor pipeline;
 * on ticket completion `applyGrnVendorQcPassOnTicketComplete` flips it back to
 * QC-passed + in_stock (it keys on vendor_serial_id, so it works for returns too).
 * @returns {{ ok:boolean, skipped?:boolean, reason?:string, ticket_id?:number }}
 */
async function createTicketFromReturn(db, {
  serialId,
  serialNumber,
  inventoryAssetCode,
  customerLabel,
  dcNumber,
  reason,
  specs,
  actorUserId,
}) {
  const open = await db.query(
    `SELECT ticket_id FROM tickets WHERE serial_number = $1 AND status IN ('in_progress', 'on_hold')`,
    [serialNumber]
  );
  if (open.rows.length) {
    return { ok: false, skipped: true, reason: 'open_ticket', ticket_id: open.rows[0].ticket_id };
  }

  const stage = await resolveFloorManagerStage(db);
  if (!stage) {
    return { ok: false, skipped: true, reason: 'no_stage' };
  }

  const floorManagerUserId = await pickFloorManagerUser(db);
  const s = specs || {};
  const ttspl = inventoryAssetCode || null;

  await ensureLegacyInventoryRow(db, {
    serialNumber,
    machineNumber: ttspl,
    brand: s.brand,
    model: s.model,
    processor: s.processor,
    ram: s.ram,
    storage: s.storage,
    stageName: stage.stage_name,
  });

  const initialCondition = `Customer return${customerLabel ? ` — ${customerLabel}` : ''}`
    + `${dcNumber ? ` (DC ${dcNumber})` : ''}${reason ? ` · ${reason}` : ''}`;

  const ins = await db.query(
    `INSERT INTO tickets (
       serial_number, ttspl_id, machine_number, brand, model, processor, ram, storage,
       initial_condition, priority, ticket_type, current_stage_id, assigned_team_id, assigned_user_id,
       initial_cost, vendor_serial_id, highlighted, highlighted_reason
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'high','return_qc',$10,$11,$12,0,$13,TRUE,'Customer Return')
     RETURNING ticket_id`,
    [
      serialNumber,
      ttspl,
      ttspl,
      s.brand || null,
      s.model || null,
      s.processor || null,
      s.ram || null,
      s.storage || null,
      initialCondition,
      stage.stage_id,
      stage.team_id,
      floorManagerUserId,
      serialId,
    ]
  );

  const ticketId = ins.rows[0].ticket_id;

  await db.query(
    `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes)
     VALUES ($1, $2, $3, 'created', $4)`,
    [ticketId, stage.stage_id, actorUserId, `QC ticket auto-created from customer return (serial: ${serialNumber})`]
  );

  if (floorManagerUserId) {
    await startWorkLog(db, { ticketId, userId: floorManagerUserId, stageId: stage.stage_id });
  }

  if (ttspl) {
    await logTtsplEvent({
      ttsplId: ttspl,
      vendorSerialId: serialId,
      eventType: 'ticket_created',
      description: 'QC re-entry ticket created from customer return',
      metadata: { ticket_id: ticketId, dc_number: dcNumber || null, reason: reason || null },
      actorUserId,
      db,
    });
  }

  return { ok: true, ticket_id: ticketId };
}

/**
 * Priority pre-dispatch QC ticket for a serial on a Sales Order / DC.
 */
async function createSalesOrderQcTicket(db, {
  serialId,
  ttsplId,
  serialNumber,
  brand,
  model,
  processor,
  generation,
  ram,
  storage,
  salesOrderNumber,
  dcNumber,
  createdByUserId,
}) {
  const open = await db.query(
    `SELECT ticket_id FROM tickets WHERE serial_number = $1 AND status IN ('in_progress', 'on_hold')`,
    [serialNumber]
  );
  if (open.rows.length) {
    return { ok: false, skipped: true, reason: 'open_ticket', ticket_id: open.rows[0].ticket_id };
  }

  // Pre-dispatch QC for sales-order laptops goes to the dedicated "Dispatch QC"
  // stage (the unit is already GRN-QC-passed) with High priority and a bold
  // "Sales Order" tag — no full refurb pipeline. Falls back to QC2/QC1 only if
  // the Dispatch QC stage hasn't been seeded.
  const stage = (await resolveStageByName(db, 'Dispatch QC'))
    || (await resolveStageByName(db, 'QC2'))
    || (await resolveStageByName(db, 'QC1'))
    || (await resolveFloorManagerStage(db));
  if (!stage) {
    return { ok: false, skipped: true, reason: 'no_stage' };
  }

  const initialCondition = `Pre-dispatch QC for SO ${salesOrderNumber || ''} / DC ${dcNumber || ''}`.trim();

  const ins = await db.query(
    `INSERT INTO tickets (
       serial_number, ttspl_id, machine_number, brand, model, processor, ram, storage,
       initial_condition, priority, ticket_type, current_stage_id, assigned_team_id, assigned_user_id,
       initial_cost, vendor_serial_id, sales_order_number, highlighted, highlighted_reason
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'high','sales_order_qc',$10,$11,NULL,0,$12,$13,TRUE,'Sales Order')
     RETURNING ticket_id`,
    [
      serialNumber,
      ttsplId,
      ttsplId || serialNumber,
      brand || null,
      model || null,
      processor || null,
      ram || null,
      storage || null,
      initialCondition,
      stage.stage_id,
      stage.team_id,
      serialId,
      salesOrderNumber || null,
    ]
  );

  const ticketId = ins.rows[0].ticket_id;

  await db.query(
    `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes)
     VALUES ($1, $2, $3, 'created', $4)`,
    [ticketId, stage.stage_id, createdByUserId, `Pre-dispatch QC ticket for DC ${dcNumber}`]
  );

  if (ttsplId) {
    await logTtsplEvent({
      ttsplId,
      vendorSerialId: serialId,
      eventType: 'ticket_created',
      description: `Pre-dispatch QC ticket created for SO ${salesOrderNumber}`,
      metadata: { ticket_id: ticketId, dc_number: dcNumber, sales_order_number: salesOrderNumber },
      actorUserId: createdByUserId,
      db,
    });
  }

  return { ok: true, ticket_id: ticketId };
}

/**
 * Recovery for GRN serials that never got a floor ticket (e.g. the post-commit
 * ticket creation failed). Finds received serials with no ticket at all and
 * creates the missing Floor Manager ticket for each. Idempotent.
 * @returns {{ scanned:number, created:number, errors:Array }}
 */
async function recoverOrphanGrnTickets(db) {
  const client = db || require('../config/db');
  const orphans = await client.query(
    `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code, vsn.po_id,
            vpo.purchase_order_number, vpo.line_items
       FROM vendor_serial_numbers vsn
       JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
      WHERE vsn.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM tickets t WHERE t.vendor_serial_id = vsn.serial_id
        )
        AND COALESCE(vsn.inventory_status, 'in_stock') NOT IN ('rented','on_demo','sold')`
  );

  let created = 0;
  const errors = [];
  for (const row of orphans.rows) {
    try {
      let line = {};
      try {
        const items = typeof row.line_items === 'string' ? JSON.parse(row.line_items) : row.line_items;
        if (Array.isArray(items) && items.length) line = items[0];
      } catch { /* ignore */ }
      const result = await createTicketFromGrnReceive(client, {
        serialId: row.serial_id,
        serialNumber: row.serial_number,
        inventoryAssetCode: row.inventory_asset_code,
        po: { po_id: row.po_id, purchase_order_number: row.purchase_order_number },
        line,
        actorUserId: null,
      });
      if (result.ok) created += 1;
    } catch (err) {
      errors.push({ serial_id: row.serial_id, error: err.message });
    }
  }
  return { scanned: orphans.rows.length, created, errors };
}

/** Create a floor repair ticket when a support pickup arrives at the warehouse. */
async function createFloorTicketFromSupportPickup(db, item, actorUserId) {
  if (item.floor_ticket_id) {
    return { ok: true, ticket_id: item.floor_ticket_id, skipped: true, reason: 'already_linked' };
  }

  const codes = [item.ttspl_id, item.unique_serial_number, item.serial_number].filter(Boolean);
  let vsn = null;
  for (const code of codes) {
    const r = await db.query(
      `SELECT serial_id, serial_number, inventory_asset_code, extra
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND (inventory_asset_code = $1 OR serial_number = $1 OR extra->>'ttspl_id' = $1)
        LIMIT 1`,
      [code]
    );
    if (r.rows.length) { vsn = r.rows[0]; break; }
  }
  if (!vsn) return { ok: false, skipped: true, reason: 'no_vsn' };

  const open = await db.query(
    `SELECT ticket_id FROM tickets
      WHERE serial_number = $1 AND status IN ('in_progress', 'on_hold')
      LIMIT 1`,
    [vsn.serial_number]
  );
  if (open.rows.length) {
    return { ok: true, ticket_id: open.rows[0].ticket_id, skipped: true, reason: 'open_ticket' };
  }

  const stage = await resolveFloorManagerStage(db);
  if (!stage) return { ok: false, skipped: true, reason: 'no_stage' };

  const floorManagerUserId = await pickFloorManagerUser(db);
  const extra = vsn.extra || {};
  const brand = item.brand || extra.brand || null;
  const model = item.model || extra.model || extra.model_name || null;
  const processor = extra.processor || null;
  const ram = item.ram || extra.ram || null;
  const storage = item.storage || extra.storage || null;
  const ttspl = vsn.inventory_asset_code || item.ttspl_id || item.unique_serial_number;

  await ensureLegacyInventoryRow(db, {
    serialNumber: vsn.serial_number,
    machineNumber: ttspl,
    brand, model, processor, ram, storage,
    stageName: stage.stage_name,
  });

  const ins = await db.query(
    `INSERT INTO tickets (
       serial_number, ttspl_id, machine_number, brand, model, processor, ram, storage,
       initial_condition, priority, ticket_type, current_stage_id, assigned_team_id, assigned_user_id,
       vendor_serial_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'normal','grn_qc',$10,$11,$12,$13)
     RETURNING ticket_id`,
    [
      vsn.serial_number,
      ttspl,
      ttspl,
      brand, model, processor, ram, storage,
      item.pickup_type === 'repair'
        ? 'Returned from customer via support pickup for repair'
        : 'Returned from customer via support pickup',
      stage.stage_id,
      stage.team_id,
      floorManagerUserId,
      vsn.serial_id,
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
      `Auto-created from support pickup item #${item.id} (ticket #${item.ticket_id})`,
    ]
  );

  if (floorManagerUserId) {
    await startWorkLog(db, { ticketId, userId: floorManagerUserId, stageId: stage.stage_id });
  }

  if (ttspl) {
    await logTtsplEvent({
      ttsplId: ttspl,
      vendorSerialId: vsn.serial_id,
      eventType: 'ticket_created',
      description: 'Floor repair ticket from support pickup warehouse receipt',
      metadata: { ticket_id: ticketId, support_item_id: item.id, support_ticket_id: item.ticket_id },
      actorUserId,
      db,
    });
  }

  return { ok: true, ticket_id: ticketId };
}

module.exports = {
  lineItemSpecs,
  createTicketFromGrnReceive,
  createTicketFromReturn,
  createFloorTicketFromSupportPickup,
  applyGrnVendorQcPassOnTicketComplete,
  markVendorSerialReadyForRent,
  resetVendorSerialForQcReentry,
  createSalesOrderQcTicket,
  recoverOrphanGrnTickets,
};
