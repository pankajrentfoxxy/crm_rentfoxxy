/**
 * Production Asset — mutable working config for the floor pipeline.
 * GRN / capture token config stays immutable; all production edits land here.
 */
const { configFromPlainObject } = require('./grnReceivedConfigService');
const { compareConfig } = require('./grnConfigService');
const { transitionAsset } = require('./inventoryStateMachine');
const { logProductionHistory } = require('./ticketWorkflowHistoryService');

// Lazy require to avoid cycle with grnTicketService
function markVendorSerialReadyForRent(...args) {
  return require('./grnTicketService').markVendorSerialReadyForRent(...args);
}

const CONFIG_FIELDS = [
  'brand', 'model', 'processor', 'generation', 'ram', 'ssd', 'gpu', 'screen_size',
];

const QC1_CHECK_FIELDS = ['brand', 'model', 'processor', 'generation', 'ram', 'ssd'];

function pick(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** Normalize any config-like object into production_assets working columns. */
function normalizeWorkingConfig(source = {}) {
  const storage = pick(source, 'ssd', 'storage', 'Storage');
  return {
    brand: pick(source, 'brand', 'Brand'),
    model: pick(source, 'model', 'Model', 'product_name', 'model_name'),
    processor: pick(source, 'processor', 'Processor'),
    generation: pick(source, 'generation', 'Generation'),
    ram: pick(source, 'ram', 'RAM'),
    ssd: storage,
    gpu: pick(source, 'gpu', 'GPU'),
    screen_size: pick(source, 'screen_size', 'screenSize', 'Screen size'),
  };
}

function workingToCompareShape(row) {
  if (!row) return {};
  return {
    brand: row.brand || '',
    model: row.model || '',
    processor: row.processor || '',
    generation: row.generation || '',
    ram: row.ram || '',
    ssd: row.ssd || row.storage || '',
    gpu: row.gpu || '',
    screen_size: row.screen_size || '',
  };
}

/**
 * Latest Inventory Asset configuration — used by QC2 / Dispatch QC verification.
 * Reads vendor_serial_numbers.extra (the current inventory record, where Super
 * Admin corrections and post-GRN updates land) and falls back to the Production
 * Asset working config for fields the inventory record does not carry.
 * The GRN snapshot (grn_config / grn_received_config) is intentionally NOT used.
 */
async function getInventoryExpectedConfig(db, pa) {
  const paShape = workingToCompareShape(pa || {});

  let serialRow = null;
  if (pa?.vendor_serial_id) {
    const r = await db.query(
      `SELECT extra FROM vendor_serial_numbers
        WHERE serial_id = $1 AND deleted_at IS NULL`,
      [pa.vendor_serial_id]
    );
    serialRow = r.rows[0] || null;
  }
  if (!serialRow && pa?.serial_number) {
    const r = await db.query(
      `SELECT extra FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND LOWER(serial_number) = LOWER($1)
        ORDER BY serial_id DESC LIMIT 1`,
      [String(pa.serial_number).trim()]
    );
    serialRow = r.rows[0] || null;
  }
  if (!serialRow && pa?.ttspl_id) {
    const r = await db.query(
      `SELECT extra FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND inventory_asset_code = $1
        ORDER BY serial_id DESC LIMIT 1`,
      [String(pa.ttspl_id).trim()]
    );
    serialRow = r.rows[0] || null;
  }
  if (!serialRow) return { expected: paShape, source: 'production_asset' };

  let extra = serialRow.extra;
  try {
    extra = typeof extra === 'string' ? JSON.parse(extra) : (extra || {});
  } catch {
    extra = {};
  }
  // Inventory screens (and super-admin edits) treat extra.storage as the truth,
  // so it must win over a stale extra.ssd left by older flows.
  const inv = normalizeWorkingConfig({
    ...extra,
    ssd: pick(extra, 'storage', 'ssd', 'Storage'),
  });
  const expected = {};
  for (const field of CONFIG_FIELDS) {
    expected[field] = inv[field] || paShape[field] || '';
  }
  return { expected, source: 'inventory_asset' };
}

function rowToDisplayConfig(row) {
  if (!row) return null;
  return {
    production_asset_id: row.production_asset_id,
    ticket_id: row.ticket_id,
    status: row.status,
    brand: row.brand || '',
    model: row.model || '',
    processor: row.processor || '',
    generation: row.generation || '',
    ram: row.ram || '',
    ssd: row.ssd || '',
    storage: row.ssd || '',
    gpu: row.gpu || '',
    screen_size: row.screen_size || '',
    serial_number: row.serial_number || '',
    ttspl_id: row.ttspl_id || '',
    grn_config: row.grn_config || null,
    qc1_checklist: row.qc1_checklist || null,
    qc2_verification: row.qc2_verification || null,
    qc2_completed_by: row.qc2_completed_by,
    qc2_completed_at: row.qc2_completed_at,
    received_by: row.received_by,
    received_at: row.received_at,
  };
}

async function ensureTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS production_assets (
      production_asset_id  SERIAL PRIMARY KEY,
      ticket_id            INT,
      grn_id               INT,
      grn_line_id          INT,
      po_id                INT,
      serial_number        VARCHAR(120),
      ttspl_id             VARCHAR(60),
      vendor_serial_id     INT,
      brand                VARCHAR(120),
      model                VARCHAR(160),
      processor            VARCHAR(160),
      generation           VARCHAR(80),
      ram                  VARCHAR(80),
      ssd                  VARCHAR(80),
      gpu                  VARCHAR(120),
      screen_size          VARCHAR(60),
      grn_config           JSONB,
      status               VARCHAR(40) NOT NULL DEFAULT 'in_production',
      qc1_checklist        JSONB,
      qc2_verification     JSONB,
      qc2_completed_by     INT,
      qc2_completed_at     TIMESTAMPTZ,
      received_by          INT,
      received_at          TIMESTAMPTZ,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS production_asset_changes (
      change_id           SERIAL PRIMARY KEY,
      production_asset_id INT NOT NULL REFERENCES production_assets(production_asset_id) ON DELETE CASCADE,
      field               VARCHAR(40) NOT NULL,
      old_value           TEXT,
      new_value           TEXT,
      changed_by          INT,
      changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      stage_name          VARCHAR(80)
    )
  `);
}

/**
 * Create Production Asset when GRN unit is accepted / ticket created.
 * Idempotent on vendor_serial_id + ticket_id.
 */
async function createFromGrn(db, {
  ticketId,
  grnId,
  grnLineId,
  poId,
  serialNumber,
  ttsplId,
  vendorSerialId,
  configSource,
}) {
  await ensureTables(db);
  const working = normalizeWorkingConfig(configSource || {});
  const grnSnapshot = {
    ...working,
    ...(configFromPlainObject(configSource) || {}),
  };

  if (vendorSerialId) {
    const existing = await db.query(
      `SELECT production_asset_id FROM production_assets
        WHERE vendor_serial_id = $1
          AND (ticket_id IS NULL OR ticket_id = $2)
        ORDER BY production_asset_id DESC LIMIT 1`,
      [vendorSerialId, ticketId || null]
    );
    if (existing.rows.length) {
      if (ticketId) {
        await db.query(
          `UPDATE production_assets SET ticket_id = COALESCE(ticket_id, $2), updated_at = NOW()
            WHERE production_asset_id = $1`,
          [existing.rows[0].production_asset_id, ticketId]
        );
      }
      return getById(db, existing.rows[0].production_asset_id);
    }
  }

  const ins = await db.query(
    `INSERT INTO production_assets (
       ticket_id, grn_id, grn_line_id, po_id, serial_number, ttspl_id, vendor_serial_id,
       brand, model, processor, generation, ram, ssd, gpu, screen_size,
       grn_config, status, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,
       $8,$9,$10,$11,$12,$13,$14,$15,
       $16::jsonb, 'in_production', NOW(), NOW()
     ) RETURNING *`,
    [
      ticketId || null,
      grnId || null,
      grnLineId || null,
      poId || null,
      serialNumber || null,
      ttsplId || null,
      vendorSerialId || null,
      working.brand || null,
      working.model || null,
      working.processor || null,
      working.generation || null,
      working.ram || null,
      working.ssd || null,
      working.gpu || null,
      working.screen_size || null,
      JSON.stringify(grnSnapshot),
    ]
  );
  return ins.rows[0];
}

async function getById(db, productionAssetId) {
  const r = await db.query(
    `SELECT * FROM production_assets WHERE production_asset_id = $1`,
    [productionAssetId]
  );
  return r.rows[0] || null;
}

async function getByTicket(db, ticketId) {
  if (!ticketId) return null;
  await ensureTables(db);
  const r = await db.query(
    `SELECT * FROM production_assets
      WHERE ticket_id = $1
      ORDER BY production_asset_id DESC LIMIT 1`,
    [ticketId]
  );
  return r.rows[0] || null;
}

async function getByVendorSerial(db, vendorSerialId) {
  if (!vendorSerialId) return null;
  const r = await db.query(
    `SELECT * FROM production_assets
      WHERE vendor_serial_id = $1
      ORDER BY production_asset_id DESC LIMIT 1`,
    [vendorSerialId]
  );
  return r.rows[0] || null;
}

/**
 * Resolve config for display: Production Asset → ticket/VSN/GRN fallback.
 */
async function getConfigForTicket(db, ticket) {
  if (!ticket) return { source: 'none', config: null, production_asset: null };
  let pa = null;
  try {
    pa = await getByTicket(db, ticket.ticket_id);
    if (!pa && ticket.vendor_serial_id) {
      pa = await getByVendorSerial(db, ticket.vendor_serial_id);
    }
  } catch {
    pa = null;
  }
  if (pa) {
    // Overlay the latest Inventory Asset configuration so QC screens always
    // show/verify against the current inventory record, not the GRN-era snapshot.
    let display = rowToDisplayConfig(pa);
    try {
      const { expected, source } = await getInventoryExpectedConfig(db, pa);
      display = {
        ...display,
        ...expected,
        storage: expected.ssd || display.storage,
        config_source: source,
      };
    } catch {
      // Keep PA working config if the inventory lookup fails
    }
    return { source: 'production_asset', config: display, production_asset: pa };
  }
  // Legacy fallback
  const fallback = normalizeWorkingConfig({
    brand: ticket.brand,
    model: ticket.model,
    processor: ticket.processor,
    generation: ticket.generation,
    ram: ticket.ram,
    storage: ticket.storage,
    ssd: ticket.storage,
  });
  return {
    source: 'ticket_fallback',
    config: { ...fallback, storage: fallback.ssd, production_asset_id: null },
    production_asset: null,
  };
}

async function updateConfig(db, productionAssetId, patch, userId, stageName) {
  await ensureTables(db);
  const current = await getById(db, productionAssetId);
  if (!current) throw new Error('Production asset not found');

  const next = normalizeWorkingConfig({ ...workingToCompareShape(current), ...patch, storage: patch.storage || patch.ssd });
  const changes = [];
  for (const field of CONFIG_FIELDS) {
    const oldVal = current[field] == null ? '' : String(current[field]);
    const newVal = next[field] == null ? '' : String(next[field]);
    if (oldVal !== newVal) {
      changes.push({ field, old_value: oldVal, new_value: newVal });
    }
  }

  const upd = await db.query(
    `UPDATE production_assets SET
       brand = $2, model = $3, processor = $4, generation = $5,
       ram = $6, ssd = $7, gpu = $8, screen_size = $9,
       updated_at = NOW()
     WHERE production_asset_id = $1
     RETURNING *`,
    [
      productionAssetId,
      next.brand || null,
      next.model || null,
      next.processor || null,
      next.generation || null,
      next.ram || null,
      next.ssd || null,
      next.gpu || null,
      next.screen_size || null,
    ]
  );

  for (const ch of changes) {
    await db.query(
      `INSERT INTO production_asset_changes
         (production_asset_id, field, old_value, new_value, changed_by, stage_name)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [productionAssetId, ch.field, ch.old_value, ch.new_value, userId || null, stageName || null]
    );
  }

  // Mirror to the Inventory Asset record (vendor_serial_numbers.extra) so QC2 /
  // Dispatch QC verification and inventory screens always see the latest config.
  if (changes.length) {
    let vendorSerialId = current.vendor_serial_id || null;
    if (!vendorSerialId && current.serial_number) {
      const vs = await db.query(
        `SELECT serial_id FROM vendor_serial_numbers
          WHERE deleted_at IS NULL AND LOWER(serial_number) = LOWER($1)
          ORDER BY serial_id DESC LIMIT 1`,
        [String(current.serial_number).trim()]
      );
      vendorSerialId = vs.rows[0]?.serial_id || null;
    }
    if (vendorSerialId) {
      await db.query(
        `UPDATE vendor_serial_numbers
            SET extra = COALESCE(extra, '{}'::jsonb) || $2::jsonb,
                updated_at = NOW()
          WHERE serial_id = $1 AND deleted_at IS NULL`,
        [
          vendorSerialId,
          JSON.stringify({
            brand: next.brand || undefined,
            model: next.model || undefined,
            model_name: next.model || undefined,
            processor: next.processor || undefined,
            generation: next.generation || undefined,
            ram: next.ram || undefined,
            storage: next.ssd || undefined,
            ssd: next.ssd || undefined,
            gpu: next.gpu || undefined,
            screen_size: next.screen_size || undefined,
          }),
        ]
      );
    }
  }

  // Mirror to ticket denorm columns for list/search (GRN untouched)
  if (current.ticket_id) {
    await db.query(
      `UPDATE tickets SET
         brand = COALESCE(NULLIF($2, ''), brand),
         model = COALESCE(NULLIF($3, ''), model),
         processor = COALESCE(NULLIF($4, ''), processor),
         ram = COALESCE(NULLIF($5, ''), ram),
         storage = COALESCE(NULLIF($6, ''), storage),
         updated_at = NOW()
       WHERE ticket_id = $1`,
      [
        current.ticket_id,
        next.brand,
        next.model,
        next.processor,
        next.ram,
        next.ssd,
      ]
    );
  }

  return { production_asset: upd.rows[0], changes };
}

async function saveQc1Checklist(db, productionAssetId, checklist, userId) {
  const payload = {
    fields: checklist?.fields || checklist || {},
    all_checked: !!checklist?.all_checked,
    checked_by: userId,
    checked_at: new Date().toISOString(),
  };
  const r = await db.query(
    `UPDATE production_assets
        SET qc1_checklist = $2::jsonb,
            status = CASE WHEN $3::boolean THEN 'qc1_passed' ELSE status END,
            updated_at = NOW()
      WHERE production_asset_id = $1
      RETURNING *`,
    [productionAssetId, JSON.stringify(payload), !!payload.all_checked]
  );
  return r.rows[0];
}

/**
 * QC2 spec verification — reuses compareConfig from grnConfigService.
 * `actual` may be technician-entered values, or same as expected when ticking match.
 */
async function verifyQc2Specs(db, productionAssetId, { actual, remarks, userId, matchedFlags }) {
  const pa = await getById(db, productionAssetId);
  if (!pa) throw new Error('Production asset not found');

  // Verify against the latest Inventory Asset configuration (not the GRN snapshot)
  const { expected } = await getInventoryExpectedConfig(db, pa);
  let result;

  if (matchedFlags && typeof matchedFlags === 'object') {
    // Manual tick path: each required field must be true
    const checks = QC1_CHECK_FIELDS.map((field) => ({
      field,
      label: field,
      required: true,
      matched: !!matchedFlags[field],
      expected: expected[field],
      actual: matchedFlags[field] ? expected[field] : (actual?.[field] || ''),
    }));
    const errors = checks.filter((c) => c.required && !c.matched);
    result = { configurationMatched: errors.length === 0, checks, errors };
  } else {
    const actualNorm = normalizeWorkingConfig(actual || {});
    result = compareConfig(expected, {
      manufacturer: actualNorm.brand,
      brand: actualNorm.brand,
      model: actualNorm.model,
      processor: actualNorm.processor,
      generation: actualNorm.generation,
      ram: actualNorm.ram,
      ssd: actualNorm.ssd,
      gpu: actualNorm.gpu,
    });
  }

  const verification = {
    ...result,
    remarks: remarks || null,
    verified_by: userId,
    verified_at: new Date().toISOString(),
  };

  const status = result.configurationMatched ? 'qc2_verifying' : 'qc2_failed';
  const upd = await db.query(
    `UPDATE production_assets
        SET qc2_verification = $2::jsonb,
            status = $3,
            updated_at = NOW()
      WHERE production_asset_id = $1
      RETURNING *`,
    [productionAssetId, JSON.stringify(verification), status]
  );

  return { production_asset: upd.rows[0], verification, ok: result.configurationMatched };
}

async function markPendingInventory(db, productionAssetId, userId, meta = {}) {
  const verification = {
    pending_at: new Date().toISOString(),
    source: meta.source || 'qc2',
    reason: meta.reason || 'qc2_passed',
    remarks: meta.remarks || null,
    ...meta,
  };
  const r = await db.query(
    `UPDATE production_assets
        SET status = 'pending_inventory',
            qc2_verification = COALESCE(qc2_verification, '{}'::jsonb) || $3::jsonb,
            qc2_completed_by = $2,
            qc2_completed_at = NOW(),
            updated_at = NOW()
      WHERE production_asset_id = $1
      RETURNING *`,
    [productionAssetId, userId || null, JSON.stringify(verification)]
  );
  return r.rows[0];
}

/**
 * Serial-verified receive → Inventory (in_stock) via inventoryStateMachine.
 */
async function receiveIntoInventory(db, productionAssetId, {
  serialNumber,
  actorUserId,
  actorName,
}) {
  await ensureTables(db);
  const pa = await getById(db, productionAssetId);
  if (!pa) {
    const err = new Error('Production asset not found');
    err.status = 404;
    throw err;
  }
  if (pa.status !== 'pending_inventory' && pa.status !== 'qc2_passed') {
    const err = new Error(`Cannot receive: status is ${pa.status}`);
    err.status = 400;
    throw err;
  }

  const expected = String(pa.serial_number || '').trim().toUpperCase();
  const entered = String(serialNumber || '').trim().toUpperCase();
  if (!expected || !entered || expected !== entered) {
    const err = new Error('Serial number does not match Production Asset');
    err.status = 400;
    throw err;
  }

  // Apply latest production config onto vendor serial extra (inventory reflects PA)
  if (pa.vendor_serial_id) {
    const cfg = workingToCompareShape(pa);
    await db.query(
      `UPDATE vendor_serial_numbers
          SET extra = COALESCE(extra, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE serial_id = $1 AND deleted_at IS NULL`,
      [
        pa.vendor_serial_id,
        JSON.stringify({
          brand: cfg.brand,
          model: cfg.model,
          processor: cfg.processor,
          generation: cfg.generation,
          ram: cfg.ram,
          storage: cfg.ssd,
          ssd: cfg.ssd,
          gpu: cfg.gpu,
          screen_size: cfg.screen_size,
        }),
      ]
    );

    // Prefer in_repair / returned / null → in_stock via state machine
    try {
      await transitionAsset(db, {
        serialId: pa.vendor_serial_id,
        toStatus: 'in_stock',
        reason: 'pending_inventory_receive',
        actorUserId,
        actorName,
        allowOverride: true,
      });
    } catch (e) {
      // Soft-deleted / missing serial should not block PA receive — fall back below
      if (!/not found/i.test(e.message || '')) throw e;
      console.warn(
        `receiveIntoInventory: transitionAsset skipped for serial ${pa.vendor_serial_id}: ${e.message}`
      );
      await db.query(
        `UPDATE vendor_serial_numbers
            SET inventory_status = 'in_stock',
                qc_status = COALESCE(qc_status, 'passed'),
                status_changed_at = NOW(),
                updated_at = NOW()
          WHERE serial_id = $1`,
        [pa.vendor_serial_id]
      );
    }
  }

  if (pa.ticket_id) {
    const ticketRes = await db.query(`SELECT * FROM tickets WHERE ticket_id = $1`, [pa.ticket_id]);
    const ticket = ticketRes.rows[0];
    if (ticket) {
      const ticketBefore = { ...ticket };
      const invStage = await db.query(
        `SELECT stage_id, team_id, stage_name FROM stages WHERE stage_name = 'Inventory' ORDER BY stage_order LIMIT 1`
      );
      if (invStage.rows.length) {
        await db.query(
          `UPDATE tickets
              SET current_stage_id = $2,
                  assigned_team_id = $3,
                  status = 'completed',
                  completed_at = NOW(),
                  updated_at = NOW()
            WHERE ticket_id = $1`,
          [pa.ticket_id, invStage.rows[0].stage_id, invStage.rows[0].team_id]
        );
      } else {
        await db.query(
          `UPDATE tickets SET status = 'completed', completed_at = NOW(), updated_at = NOW()
            WHERE ticket_id = $1`,
          [pa.ticket_id]
        );
      }

      await db.query(
        `UPDATE inventory SET status = 'In Stock', stock_type = 'Ready', stage = 'Inventory',
               brand = COALESCE(NULLIF($2, ''), brand),
               model = COALESCE(NULLIF($3, ''), model),
               processor = COALESCE(NULLIF($4, ''), processor),
               ram = COALESCE(NULLIF($5, ''), ram),
               storage = COALESCE(NULLIF($6, ''), storage),
               updated_at = CURRENT_TIMESTAMP
         WHERE serial_number = $1`,
        [pa.serial_number, pa.brand, pa.model, pa.processor, pa.ram, pa.ssd]
      );

      if (ticket.vendor_serial_id) {
        await markVendorSerialReadyForRent(db, ticket, actorUserId);
      }

      await logProductionHistory(db, {
        ticketBefore,
        ticketAfter: {
          ...ticket,
          status: 'completed',
          current_stage_id: invStage.rows[0]?.stage_id || ticket.current_stage_id,
          assigned_team_id: invStage.rows[0]?.team_id || ticket.assigned_team_id,
        },
        beforeStageName: null,
        afterStageName: 'Inventory',
        source: 'pendingInventoryReceive',
        remarks: `Received into inventory (serial verified: ${entered})`,
        actor: { user_id: actorUserId, name: actorName },
        assignmentType: 'receive',
      });
    }
  }

  const upd = await db.query(
    `UPDATE production_assets
        SET status = 'received',
            received_by = $2,
            received_at = NOW(),
            updated_at = NOW()
      WHERE production_asset_id = $1
      RETURNING *`,
    [productionAssetId, actorUserId || null]
  );

  return upd.rows[0];
}

/**
 * Backfill production_assets for open floor tickets that lack one.
 */
async function backfillOpenTickets(db, { limit = 500 } = {}) {
  await ensureTables(db);
  const open = await db.query(
    `SELECT t.ticket_id, t.serial_number, t.ttspl_id, t.vendor_serial_id,
            t.brand, t.model, t.processor, t.ram, t.storage,
            v.grn_id, v.po_id, v.extra
       FROM tickets t
       LEFT JOIN vendor_serial_numbers v ON v.serial_id = t.vendor_serial_id
       LEFT JOIN production_assets pa ON pa.ticket_id = t.ticket_id
      WHERE pa.production_asset_id IS NULL
        AND t.status IN ('in_progress', 'on_hold')
        AND t.ticket_type IN ('grn_qc', 'return_qc', 'repair')
      ORDER BY t.ticket_id DESC
      LIMIT $1`,
    [limit]
  );

  let created = 0;
  for (const t of open.rows) {
    let extra = {};
    try {
      extra = typeof t.extra === 'string' ? JSON.parse(t.extra) : (t.extra || {});
    } catch { extra = {}; }
    const source = {
      brand: t.brand || extra.brand,
      model: t.model || extra.model,
      processor: t.processor || extra.processor,
      generation: extra.generation,
      ram: t.ram || extra.ram,
      storage: t.storage || extra.storage || extra.ssd,
      ssd: extra.ssd || t.storage,
      gpu: extra.gpu,
      screen_size: extra.screen_size,
    };
    await createFromGrn(db, {
      ticketId: t.ticket_id,
      grnId: t.grn_id,
      poId: t.po_id,
      serialNumber: t.serial_number,
      ttsplId: t.ttspl_id,
      vendorSerialId: t.vendor_serial_id,
      configSource: source,
    });
    created += 1;
  }
  return { scanned: open.rows.length, created };
}

/**
 * Admin inventory spec edit → working production_assets (+ change log).
 * Creates a PA row if missing (legacy units). Never touches VPD / grn_received_config.
 */
async function syncWorkingConfigFromInventory(db, invRow, userId) {
  await ensureTables(db);
  if (!invRow) return null;

  const serial = invRow.serial_number ? String(invRow.serial_number).trim() : '';
  const machine = invRow.machine_number ? String(invRow.machine_number).trim() : '';

  let pa = null;
  if (serial) {
    const bySerial = await db.query(
      `SELECT * FROM production_assets
        WHERE LOWER(serial_number) = LOWER($1)
        ORDER BY production_asset_id DESC LIMIT 1`,
      [serial]
    );
    pa = bySerial.rows[0] || null;
  }
  if (!pa && machine) {
    const byTtspl = await db.query(
      `SELECT * FROM production_assets
        WHERE ttspl_id = $1
        ORDER BY production_asset_id DESC LIMIT 1`,
      [machine]
    );
    pa = byTtspl.rows[0] || null;
  }
  if (!pa && serial) {
    const vsn = await db.query(
      `SELECT serial_id, inventory_asset_code, grn_id, po_id, grn_received_config
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND LOWER(serial_number) = LOWER($1)
        ORDER BY serial_id DESC LIMIT 1`,
      [serial]
    );
    const vs = vsn.rows[0];
    pa = await createFromGrn(db, {
      ticketId: null,
      grnId: vs?.grn_id || null,
      poId: vs?.po_id || null,
      serialNumber: serial,
      ttsplId: machine || vs?.inventory_asset_code || null,
      vendorSerialId: vs?.serial_id || null,
      configSource: vs?.grn_received_config || invRow,
    });
  }
  if (!pa) return null;

  const patch = {
    brand: invRow.brand,
    model: invRow.model,
    processor: invRow.processor,
    generation: invRow.generation,
    ram: invRow.ram,
    storage: invRow.storage,
    ssd: invRow.storage,
    gpu: invRow.gpu,
    screen_size: invRow.screen_size,
  };
  return updateConfig(db, pa.production_asset_id, patch, userId, 'Inventory');
}

async function listPendingInventory(db) {
  await ensureTables(db);
  const r = await db.query(
    `SELECT pa.*,
            t.ticket_id AS ticket_ref,
            t.status AS ticket_status,
            u.name AS qc2_completed_by_name,
            s.stage_name
       FROM production_assets pa
       LEFT JOIN tickets t ON t.ticket_id = pa.ticket_id
       LEFT JOIN users u ON u.user_id = pa.qc2_completed_by
       LEFT JOIN stages s ON s.stage_id = t.current_stage_id
      WHERE pa.status = 'pending_inventory'
         OR (s.stage_name = 'Pending Inventory' AND t.status NOT IN ('completed', 'cancelled', 'qc_failed_return_vendor'))
      ORDER BY COALESCE(pa.qc2_completed_at, pa.updated_at) DESC NULLS LAST`
  );
  return r.rows.map((row) => ({
    ...rowToDisplayConfig(row),
    ticket_id: row.ticket_id || row.ticket_ref,
    qc2_completed_by_name: row.qc2_completed_by_name,
    ticket_status: row.ticket_status,
    stage_name: row.stage_name,
  }));
}

module.exports = {
  CONFIG_FIELDS,
  QC1_CHECK_FIELDS,
  normalizeWorkingConfig,
  workingToCompareShape,
  getInventoryExpectedConfig,
  rowToDisplayConfig,
  ensureTables,
  createFromGrn,
  getById,
  getByTicket,
  getByVendorSerial,
  getConfigForTicket,
  updateConfig,
  saveQc1Checklist,
  verifyQc2Specs,
  markPendingInventory,
  receiveIntoInventory,
  backfillOpenTickets,
  syncWorkingConfigFromInventory,
  listPendingInventory,
};
