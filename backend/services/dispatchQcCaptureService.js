/**
 * Dispatch QC hardware config capture — mirrors qc2CaptureService, but expected
 * config comes from production_assets and must also match the SO line.
 */
const crypto = require('crypto');
const pool = require('../config/db');
const {
  apiBaseUrl,
  frontendBaseUrl,
  resolvePublicFrontendUrl,
} = require('./grnSerialCaptureService');
const { verifyConfigurationAgainst, sizeNum } = require('./grnConfigService');
const { serialMatchesSoLine, configMismatchMessage } = require('../utils/soInventorySpecMatch');
const { getSalesOrderLines } = require('./salesManagementService');
const {
  ensureTables,
  getByVendorSerial,
  createFromGrn,
  getInventoryExpectedConfig,
  getById,
} = require('./productionAssetService');

const TOKEN_TTL_MINUTES = 30;

async function ensureDispatchQcTokenTable(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS dispatch_qc_capture_tokens (
      token_id             UUID PRIMARY KEY,
      access_number        VARCHAR(8) NOT NULL,
      ticket_id            INT NOT NULL,
      allocation_id        INT NOT NULL,
      serial_id            INT,
      line_id              INT,
      sales_order_number   VARCHAR(60),
      production_asset_id  INT NOT NULL,
      status               VARCHAR(20) NOT NULL DEFAULT 'pending',
      actual_config        JSONB,
      match_result         JSONB,
      serial_number        VARCHAR(120),
      verified_by_ip       VARCHAR(64),
      created_by           INT,
      expires_at           TIMESTAMPTZ,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      matched_at           TIMESTAMPTZ
    )
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_qc_token_access_active
      ON dispatch_qc_capture_tokens(access_number)
      WHERE status = 'pending'
  `);
}

function randomAccessNumber() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function expireStaleTokens(db = pool) {
  await db.query(
    `UPDATE dispatch_qc_capture_tokens
        SET status = 'expired'
      WHERE status = 'pending' AND expires_at < NOW()`
  );
}

async function mintUniqueAccessNumber(db, maxAttempts = 12) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const access = randomAccessNumber();
    const clash = await db.query(
      `SELECT 1 FROM dispatch_qc_capture_tokens WHERE access_number = $1 AND status = 'pending' LIMIT 1`,
      [access]
    );
    if (!clash.rows.length) return access;
  }
  return String(Math.floor(10000000 + Math.random() * 90000000)).slice(0, 8);
}

async function resolveAllocationForTicket(db, ticketId) {
  const r = await db.query(
    `SELECT sos.*,
            vsn.serial_number AS vsn_serial,
            vsn.inventory_asset_code AS vsn_ttspl
       FROM sales_order_serials sos
       LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = sos.serial_id
      WHERE sos.qc_ticket_id = $1
        AND sos.status = 'attached'
      ORDER BY sos.allocation_id DESC
      LIMIT 1`,
    [ticketId]
  );
  return r.rows[0] || null;
}

async function resolveProductionAssetForDispatch(db, ticket, alloc) {
  await ensureTables(db);
  let pa = null;
  if (alloc?.serial_id) {
    pa = await getByVendorSerial(db, alloc.serial_id);
  }
  if (!pa && ticket.vendor_serial_id) {
    pa = await getByVendorSerial(db, ticket.vendor_serial_id);
  }
  if (!pa) {
    pa = await createFromGrn(db, {
      ticketId: ticket.ticket_id,
      serialNumber: alloc?.serial_number || ticket.serial_number,
      ttsplId: alloc?.ttspl_id || ticket.ttspl_id,
      vendorSerialId: alloc?.serial_id || ticket.vendor_serial_id,
      configSource: ticket,
    });
  }
  return pa;
}

function actualToSoLineShape(actual = {}, expected = {}) {
  return {
    processor: actual.processor || expected.processor || '',
    generation: actual.generation || expected.generation || '',
    ram: actual.ram || expected.ram || '',
    storage: actual.ssd || actual.storage || expected.ssd || '',
  };
}

async function getSoLineForAllocation(alloc) {
  if (!alloc?.sales_order_number || !alloc?.line_id) return null;
  const lines = await getSalesOrderLines(alloc.sales_order_number);
  return lines.find((l) => Number(l.line_id) === Number(alloc.line_id)) || null;
}

/**
 * Dispatch QC expected config: latest Inventory Asset configuration (not the
 * GRN snapshot), overlaid with the SO line when present. Order storage/RAM/
 * processor are the sales truth and must win over a stale ssd value.
 */
async function expectedConfigForDispatchQc(db, pa, soLine = null) {
  const { expected: base } = await getInventoryExpectedConfig(db, pa || {});
  if (!soLine) return base;
  const overlay = {};
  if (soLine.processor) overlay.processor = soLine.processor;
  if (soLine.generation && String(soLine.generation).trim() !== '-') {
    overlay.generation = soLine.generation;
  }
  if (soLine.ram) overlay.ram = soLine.ram;
  if (soLine.storage) overlay.ssd = soLine.storage;
  if (soLine.brand) overlay.brand = soLine.brand;
  if (soLine.model_name || soLine.model) overlay.model = soLine.model_name || soLine.model;
  return { ...base, ...overlay };
}

/**
 * Unified "Dispatch QC failed" flow. Runs inside the CALLER's transaction
 * (pass an open pg client) so every step commits or rolls back together:
 *
 *   1. Remove the asset from the Sales Order (allocation status = removed).
 *   2. Recalculate stored SO totals (one-month-rental security amount; line
 *      totals themselves are always derived from quantity × rate at render).
 *   3. Move the linked QC ticket to Diagnosis (unless the caller moves the
 *      ticket itself, e.g. the manual moveToStage path).
 *   4. Mark the asset failed: inventory_status = qc_failed + qc_status =
 *      failed — this removes it from Ready to Rent/Sell (which requires
 *      effective QC status "passed") and lists it under QC Failed instead.
 *   5. Audit entries for the asset (ttspl_audit_log + status transition),
 *      the ticket (activities + production_ticket_history) and the sales
 *      order (sales_order_activities).
 */
async function applyDispatchQcFailure(client, {
  allocationId,
  pa = null,
  remarks,
  matchPayload = null,
  tokenId = null,
  actorUserId = null,
  actorName = null,
  moveTicketToDiagnosis = true,
}) {
  const { logTtsplEvent } = require('./ttsplAuditService');
  const { logSalesOrderActivity, ACTIVITY_TYPES } = require('./salesOrderActivityService');
  const { logProductionHistory } = require('./ticketWorkflowHistoryService');
  const inventorySM = require('./inventoryStateMachine');

  const allocRes = await client.query(
    `SELECT * FROM sales_order_serials WHERE allocation_id = $1 FOR UPDATE`,
    [allocationId]
  );
  const alloc = allocRes.rows[0];
  if (!alloc) return null;

  const soNumber = alloc.sales_order_number;
  const label = alloc.ttspl_id || alloc.serial_number || `serial ${alloc.serial_id}`;
  const failReason = String(remarks || 'Dispatch QC failed').slice(0, 2000);

  // 1. Remove the asset from the Sales Order.
  await client.query(
    `UPDATE sales_order_serials
        SET status = 'removed',
            qc_status = 'failed',
            updated_at = NOW()
      WHERE allocation_id = $1`,
    [alloc.allocation_id]
  );

  // 2. Recalculate stored SO totals (security amount for one_month_rental SOs).
  const secTypeRes = await client.query(
    `SELECT security_type FROM sales_order_lines WHERE sales_order_number = $1 LIMIT 1`,
    [soNumber]
  );
  if (String(secTypeRes.rows[0]?.security_type || '').toLowerCase() === 'one_month_rental') {
    await client.query(
      `UPDATE sales_order_lines sol
          SET security_amount = t.one_month
         FROM (
           SELECT COALESCE(SUM(COALESCE(rate, 0) * COALESCE(quantity, 1)), 0) AS one_month
             FROM sales_order_lines WHERE sales_order_number = $1
         ) t
        WHERE sol.sales_order_number = $1`,
      [soNumber]
    );
  }

  // 3. Move the linked QC ticket to Diagnosis.
  if (alloc.qc_ticket_id && moveTicketToDiagnosis) {
    const tRes = await client.query(
      `SELECT * FROM tickets WHERE ticket_id = $1 FOR UPDATE`,
      [alloc.qc_ticket_id]
    );
    const ticket = tRes.rows[0];
    if (ticket && !['completed', 'cancelled'].includes(ticket.status)) {
      const stRes = await client.query(
        `SELECT stage_id, stage_name, team_id FROM stages WHERE stage_name = 'Diagnosis' LIMIT 1`
      );
      const diag = stRes.rows[0];
      if (diag) {
        const highlightedReason = `Dispatch QC failed: ${failReason}`.slice(0, 500);
        const updRes = await client.query(
          `UPDATE tickets
              SET current_stage_id = $2,
                  assigned_team_id = $3,
                  assigned_user_id = NULL,
                  status = 'in_progress',
                  qc_fail_count = COALESCE(qc_fail_count, 0) + 1,
                  highlighted = TRUE,
                  highlighted_reason = $4,
                  updated_at = NOW()
            WHERE ticket_id = $1
            RETURNING *`,
          [ticket.ticket_id, diag.stage_id, diag.team_id, highlightedReason]
        );
        const newTicket = updRes.rows[0];

        if (ticket.serial_number) {
          await client.query(
            `UPDATE inventory SET stage = 'Diagnosis' WHERE serial_number = $1`,
            [ticket.serial_number]
          );
        }

        await client.query(
          `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes)
           VALUES ($1, $2, $3, 'stage_changed', $4)`,
          [ticket.ticket_id, diag.stage_id, actorUserId, `Dispatch QC failed — moved to Diagnosis. ${failReason}`.slice(0, 500)]
        );

        await logTtsplEvent({
          ttsplId: ticket.ttspl_id,
          vendorSerialId: ticket.vendor_serial_id,
          eventType: 'stage_changed',
          description: 'Dispatch QC → Diagnosis (Dispatch QC failed)',
          metadata: { from: 'Dispatch QC', to: 'Diagnosis', reason: failReason, sales_order_number: soNumber },
          actorUserId,
          actorName,
          db: client,
        });

        try {
          await logProductionHistory(client, {
            ticketBefore: ticket,
            ticketAfter: newTicket,
            beforeStageName: 'Dispatch QC',
            afterStageName: 'Diagnosis',
            source: 'dispatch_qc_fail',
            hint: 'dispatch_qc_failed',
            remarks: failReason,
            failureReason: failReason,
            actor: actorUserId ? { user_id: actorUserId, name: actorName } : null,
            assignmentType: 'dispatch_qc_failed',
          });
        } catch (histErr) {
          console.warn(`applyDispatchQcFailure: production history log failed: ${histErr.message}`);
        }
      }
    }
  }

  if (alloc.sales_order_number) {
    try {
      const dispatchWf = require('./dispatchWorkflowService');
      await dispatchWf.onQcFailed(client, {
        salesOrderNumber: alloc.sales_order_number,
        reason: remarks,
        user: actorUserId ? { user_id: actorUserId } : null,
      });
    } catch (wfErr) {
      console.error('dispatch QC fail notification:', wfErr.message);
    }
  }
  // 4. Asset status → qc_failed / Dispatch QC Failed (off Ready to Rent/Sell).
  if (alloc.serial_id) {
    await inventorySM.transitionAsset(client, {
      serialId: alloc.serial_id,
      toStatus: 'qc_failed',
      reason: `Dispatch QC failed on ${soNumber}: ${failReason}`.slice(0, 500),
      actorUserId: actorUserId || null,
      actorName: actorName || null,
      allowOverride: true, // reserved → qc_failed is a deliberate exception
    });
    await client.query(
      `UPDATE vendor_serial_numbers
          SET qc_status = 'failed',
              current_customer_id = NULL,
              current_dc_number = NULL,
              extra = (COALESCE(extra, '{}'::jsonb) - 'awaiting_inventory_receive')
                      || jsonb_build_object('status', 'failed', 'dispatch_qc_failed_at', NOW()::text),
              updated_at = NOW()
        WHERE serial_id = $1 AND deleted_at IS NULL`,
      [alloc.serial_id]
    );
  }

  // Production asset mirrors the failure (kept out of pending-inventory receive).
  const paId = pa?.production_asset_id || null;
  if (paId) {
    await client.query(
      `UPDATE production_assets
          SET status = 'dispatch_qc_failed',
              qc2_verification = COALESCE(qc2_verification, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE production_asset_id = $1`,
      [
        paId,
        JSON.stringify({
          source: 'dispatch_qc',
          reason: 'dispatch_qc_failed',
          remarks: failReason,
          configurationMatched: false,
          checks: matchPayload?.checks || [],
          errors: matchPayload?.errors || [],
          sales_order_number: soNumber,
          allocation_id: alloc.allocation_id,
          token_id: tokenId,
          failed_at: new Date().toISOString(),
        }),
      ]
    );
  }

  // 5. Audit trail — asset + sales order (ticket audited above).
  await logTtsplEvent({
    ttsplId: alloc.ttspl_id || null,
    vendorSerialId: alloc.serial_id || null,
    eventType: 'dispatch_qc_failed',
    description: `Dispatch QC failed on ${soNumber} — removed from SO, sent to Diagnosis. ${failReason}`.slice(0, 1000),
    metadata: {
      sales_order_number: soNumber,
      allocation_id: alloc.allocation_id,
      ticket_id: alloc.qc_ticket_id || null,
      reason: failReason,
      errors: matchPayload?.errors || [],
    },
    actorUserId,
    actorName,
    db: client,
  });

  await logSalesOrderActivity({
    client,
    salesOrderNumber: soNumber,
    activityType: ACTIVITY_TYPES.LAPTOP,
    action: 'laptop_removed',
    title: 'Laptop Removed — Dispatch QC Failed',
    description: `${label} failed Dispatch QC and was removed from this Sales Order. Ticket moved to Diagnosis.`,
    remarks: failReason,
    metadata: {
      allocation_id: alloc.allocation_id,
      serial_id: alloc.serial_id,
      ttspl_id: alloc.ttspl_id,
      serial_number: alloc.serial_number,
      ticket_id: alloc.qc_ticket_id || null,
      dispatch_qc_failed: true,
    },
    user: actorUserId ? { user_id: actorUserId, name: actorName } : null,
  });

  return alloc;
}

/** Back-compat wrapper — the config-mismatch capture path calls this name. */
async function routeMismatchToPendingInventory(client, {
  tokenRow,
  pa,
  remarks,
  matchPayload,
  actorUserId,
}) {
  return applyDispatchQcFailure(client, {
    allocationId: tokenRow.allocation_id,
    pa,
    remarks,
    matchPayload,
    tokenId: tokenRow.token_id,
    actorUserId,
  });
}

async function createDispatchQcToken({ ticketId, createdBy, req }) {
  await ensureDispatchQcTokenTable();
  await expireStaleTokens();

  const ticketRes = await pool.query(`SELECT * FROM tickets WHERE ticket_id = $1`, [ticketId]);
  if (!ticketRes.rows.length) {
    const err = new Error('Ticket not found');
    err.status = 404;
    throw err;
  }
  const ticket = ticketRes.rows[0];
  if (ticket.ticket_type !== 'sales_order_qc') {
    const err = new Error('Hardware verification is only available for Dispatch QC tickets');
    err.status = 400;
    throw err;
  }

  const stageRes = await pool.query(
    `SELECT stage_name FROM stages WHERE stage_id = $1`,
    [ticket.current_stage_id]
  );
  const stageName = stageRes.rows[0]?.stage_name;
  if (stageName !== 'Dispatch QC') {
    const err = new Error('Hardware verification is only available at the Dispatch QC stage');
    err.status = 400;
    throw err;
  }

  const alloc = await resolveAllocationForTicket(pool, ticketId);
  if (!alloc) {
    const err = new Error('No active SO allocation found for this Dispatch QC ticket');
    err.status = 400;
    throw err;
  }

  const pa = await resolveProductionAssetForDispatch(pool, ticket, alloc);
  if (!pa?.production_asset_id) {
    const err = new Error('Production Asset missing for this serial');
    err.status = 400;
    throw err;
  }

  await pool.query(
    `UPDATE dispatch_qc_capture_tokens SET status = 'expired'
      WHERE ticket_id = $1 AND status = 'pending'`,
    [ticketId]
  );

  const tokenId = crypto.randomUUID();
  const accessNumber = await mintUniqueAccessNumber(pool);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  await pool.query(
    `INSERT INTO dispatch_qc_capture_tokens
       (token_id, access_number, ticket_id, allocation_id, serial_id, line_id,
        sales_order_number, production_asset_id, status, created_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10)`,
    [
      tokenId,
      accessNumber,
      ticketId,
      alloc.allocation_id,
      alloc.serial_id || null,
      alloc.line_id || null,
      alloc.sales_order_number || null,
      pa.production_asset_id,
      createdBy || null,
      expiresAt,
    ]
  );

  const feBase = resolvePublicFrontendUrl(req) || frontendBaseUrl();
  return {
    token: tokenId,
    access_number: accessNumber,
    expires_at: expiresAt.toISOString(),
    match_url: `${feBase}/dispatch-qc-config-match`,
    production_asset_id: pa.production_asset_id,
    allocation_id: alloc.allocation_id,
    sales_order_number: alloc.sales_order_number,
    api_base_url: apiBaseUrl(req),
  };
}

async function getTokenRow(tokenId) {
  await expireStaleTokens();
  const r = await pool.query(
    `SELECT * FROM dispatch_qc_capture_tokens WHERE token_id = $1`,
    [tokenId]
  );
  return r.rows[0] || null;
}

async function getLatestTokenForTicket(ticketId) {
  await ensureDispatchQcTokenTable();
  await expireStaleTokens();
  const r = await pool.query(
    `SELECT * FROM dispatch_qc_capture_tokens
      WHERE ticket_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [ticketId]
  );
  return r.rows[0] || null;
}

async function getLatestMatchedTokenForAllocation(db, allocationId) {
  await ensureDispatchQcTokenTable();
  const r = await db.query(
    `SELECT * FROM dispatch_qc_capture_tokens
      WHERE allocation_id = $1 AND status = 'matched'
      ORDER BY matched_at DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [allocationId]
  );
  return r.rows[0] || null;
}

async function allocationHasSpecVerification(db, allocationId) {
  const row = await getLatestMatchedTokenForAllocation(db, allocationId);
  return !!row;
}

async function resolveByAccessNumber(accessNumber) {
  await ensureDispatchQcTokenTable();
  await expireStaleTokens();
  const code = String(accessNumber || '').trim();
  if (!/^\d{4,8}$/.test(code)) {
    return { ok: false, code: 400, message: 'Enter a valid access number' };
  }
  const r = await pool.query(
    `SELECT * FROM dispatch_qc_capture_tokens
      WHERE access_number = $1 AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1`,
    [code]
  );
  const row = r.rows[0];
  if (!row) {
    return { ok: false, code: 404, message: 'Access number not found or expired' };
  }
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    await pool.query(
      `UPDATE dispatch_qc_capture_tokens SET status = 'expired' WHERE token_id = $1`,
      [row.token_id]
    );
    return { ok: false, code: 410, message: 'Access number expired — generate a new one on the Dispatch QC screen' };
  }

  const pa = await getById(pool, row.production_asset_id);
  // Expected config = latest Inventory Asset configuration + SO line overlay
  const soLine = await getSoLineForAllocation(row);
  const expected = await expectedConfigForDispatchQc(pool, pa, soLine);
  return {
    ok: true,
    token: row.token_id,
    expires_at: row.expires_at,
    ticket_id: row.ticket_id,
    sales_order_number: row.sales_order_number,
    expected_config: {
      brand: expected.brand,
      model: expected.model,
      processor: expected.processor,
      generation: expected.generation,
      ram: expected.ram,
      ssd: expected.ssd,
      gpu: expected.gpu,
      screen_size: expected.screen_size,
    },
    ttspl_id: pa?.ttspl_id || null,
    serial_number: pa?.serial_number || null,
  };
}

async function getPublicSession(tokenId) {
  const row = await getTokenRow(tokenId);
  if (!row) return null;
  const pa = await getById(pool, row.production_asset_id);
  const soLine = await getSoLineForAllocation(row);
  const expected = await expectedConfigForDispatchQc(pool, pa, soLine);
  return {
    token: row.token_id,
    status: row.status,
    expires_at: row.expires_at,
    ticket_id: row.ticket_id,
    sales_order_number: row.sales_order_number,
    matched_at: row.matched_at,
    serial_number: row.serial_number,
    actual_config: row.actual_config,
    match_result: row.match_result,
    config_verified: row.status === 'matched',
    config_check: row.match_result,
    expected_config: {
      brand: expected.brand,
      model: expected.model,
      processor: expected.processor,
      generation: expected.generation,
      ram: expected.ram,
      ssd: expected.ssd,
      gpu: expected.gpu,
    },
    ttspl_id: pa?.ttspl_id || null,
  };
}

async function verifyDispatchQcConfiguration(tokenId, actual, ip) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await expireStaleTokens(client);

    const tokRes = await client.query(
      `SELECT * FROM dispatch_qc_capture_tokens WHERE token_id = $1 FOR UPDATE`,
      [tokenId]
    );
    const row = tokRes.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { ok: false, code: 404, message: 'Capture link not found or expired' };
    }
    if (row.status !== 'pending') {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 409,
        message: row.status === 'matched'
          ? 'Already verified'
          : 'This access number is no longer active',
      };
    }
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      await client.query(
        `UPDATE dispatch_qc_capture_tokens SET status = 'expired' WHERE token_id = $1`,
        [tokenId]
      );
      await client.query('COMMIT');
      return { ok: false, code: 410, message: 'Access number expired — generate a new one on Dispatch QC' };
    }

    const paRes = await client.query(
      `SELECT * FROM production_assets WHERE production_asset_id = $1 FOR UPDATE`,
      [row.production_asset_id]
    );
    const pa = paRes.rows[0];
    if (!pa) {
      await client.query('ROLLBACK');
      return { ok: false, code: 404, message: 'Production Asset not found' };
    }

    // Compare against the latest Inventory Asset configuration (not the GRN
    // snapshot), with SO line values overlaid as the sales truth.
    const soLine = await getSoLineForAllocation(row);
    const expected = await expectedConfigForDispatchQc(client, pa, soLine);
    // Keep PA working SSD in sync when SO line storage differs from stale PA.ssd.
    if (soLine?.storage) {
      const lineGb = sizeNum(soLine.storage);
      const paGb = sizeNum(pa.ssd);
      if (lineGb != null && (paGb == null || lineGb !== paGb)) {
        await client.query(
          `UPDATE production_assets
              SET ssd = $2, updated_at = NOW()
            WHERE production_asset_id = $1`,
          [pa.production_asset_id, soLine.storage]
        );
        pa.ssd = soLine.storage;
      }
    }
    const configResult = verifyConfigurationAgainst(expected, actual);
    const detectedSpec = actualToSoLineShape(actual, expected);
    const soLineMatched = soLine ? serialMatchesSoLine(soLine, detectedSpec) : true;

    const soLineErrors = [];
    if (soLine && !soLineMatched) {
      soLineErrors.push({
        field: 'so_line',
        label: 'Sales order line',
        expected: [soLine.processor, soLine.generation, soLine.ram, soLine.storage].filter(Boolean).join(' / '),
        actual: [detectedSpec.processor, detectedSpec.generation, detectedSpec.ram, detectedSpec.storage].filter(Boolean).join(' / '),
        matched: false,
        required: true,
        message: configMismatchMessage(soLine, detectedSpec),
      });
    }

    const configurationMatched = configResult.configurationMatched && soLineMatched;
    const matchPayload = {
      configurationMatched,
      checks: [...(configResult.checks || []), ...(soLineErrors.length ? soLineErrors : [])],
      errors: [
        ...(configResult.errors || []),
        ...(soLineErrors.length ? soLineErrors : []),
      ],
      so_line_matched: soLineMatched,
      verified_at: new Date().toISOString(),
    };

    if (configurationMatched) {
      await client.query(
        `UPDATE dispatch_qc_capture_tokens
            SET status = 'matched',
                actual_config = $2::jsonb,
                match_result = $3::jsonb,
                matched_at = NOW(),
                verified_by_ip = $4
          WHERE token_id = $1`,
        [
          tokenId,
          JSON.stringify(actual),
          JSON.stringify(matchPayload),
          ip ? String(ip).slice(0, 64) : null,
        ]
      );
      await client.query(
        `UPDATE production_assets
            SET qc2_verification = $2::jsonb,
                updated_at = NOW()
          WHERE production_asset_id = $1`,
        [
          pa.production_asset_id,
          JSON.stringify({
            ...matchPayload,
            source: 'dispatch_qc_script',
            token_id: tokenId,
            sales_order_number: row.sales_order_number,
          }),
        ]
      );
      await client.query('COMMIT');
      return {
        ok: true,
        configurationMatched: true,
        checks: matchPayload.checks,
        errors: matchPayload.errors,
        expected,
      };
    }

    const remarkParts = (matchPayload.errors || []).map(
      (e) => `${e.field}: expected "${e.expected ?? ''}", found "${e.actual ?? ''}"`
    );
    const remarks = remarkParts.length
      ? `Dispatch QC config mismatch — ${remarkParts.join('; ')}`
      : 'Dispatch QC config mismatch';

    await client.query(
      `UPDATE dispatch_qc_capture_tokens
          SET status = 'failed',
              actual_config = $2::jsonb,
              match_result = $3::jsonb,
              verified_by_ip = $4
        WHERE token_id = $1`,
      [
        tokenId,
        JSON.stringify(actual),
        JSON.stringify({ ...matchPayload, remarks }),
        ip ? String(ip).slice(0, 64) : null,
      ]
    );

    await routeMismatchToPendingInventory(client, {
      tokenRow: row,
      pa,
      remarks,
      matchPayload: { ...matchPayload, remarks },
      actorUserId: null,
    });

    await client.query('COMMIT');
    return {
      ok: true,
      configurationMatched: false,
      checks: matchPayload.checks,
      errors: matchPayload.errors,
      expected,
      remarks,
      dispatch_qc_failed: true,
      routed_to_pending_inventory: true, // legacy field name kept for capture clients
      routed_to_diagnosis: true,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function submitDispatchQcSerial(tokenId, serialNumber) {
  await expireStaleTokens();
  const row = await getTokenRow(tokenId);
  if (!row) return { ok: false, code: 404, message: 'Capture link not found or expired' };
  if (row.status !== 'matched' && row.status !== 'pending') {
    return { ok: false, code: 409, message: 'This capture link is no longer active' };
  }

  const serial = String(serialNumber || '').trim().toUpperCase();
  if (!serial || serial.length < 3) {
    return { ok: false, code: 400, message: 'Invalid serial number' };
  }

  const pa = await getById(pool, row.production_asset_id);
  const expected = String(pa?.serial_number || '').trim().toUpperCase();
  if (expected && expected !== serial) {
    return {
      ok: false,
      code: 400,
      message: `Serial does not match Production Asset (expected ${expected})`,
    };
  }

  if (row.status !== 'matched') {
    return {
      ok: false,
      code: 428,
      message: 'Verify configuration before submitting the serial number',
    };
  }

  await pool.query(
    `UPDATE dispatch_qc_capture_tokens SET serial_number = $2 WHERE token_id = $1`,
    [tokenId, serial]
  );

  return { ok: true, serial_number: serial };
}

module.exports = {
  ensureDispatchQcTokenTable,
  createDispatchQcToken,
  getTokenRow,
  getLatestTokenForTicket,
  getLatestMatchedTokenForAllocation,
  allocationHasSpecVerification,
  resolveByAccessNumber,
  getPublicSession,
  verifyDispatchQcConfiguration,
  submitDispatchQcSerial,
  applyDispatchQcFailure,
  routeMismatchToPendingInventory,
  apiBaseUrl,
};
