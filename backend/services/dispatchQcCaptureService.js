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
const { verifyConfigurationAgainst } = require('./grnConfigService');
const { serialMatchesSoLine, configMismatchMessage } = require('../utils/soInventorySpecMatch');
const { getSalesOrderLines } = require('./salesManagementService');
const {
  ensureTables,
  getByVendorSerial,
  createFromGrn,
  workingToCompareShape,
  getById,
  markPendingInventory,
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

async function routeMismatchToPendingInventory(client, {
  tokenRow,
  pa,
  remarks,
  matchPayload,
  actorUserId,
}) {
  const allocRes = await client.query(
    `SELECT * FROM sales_order_serials WHERE allocation_id = $1 FOR UPDATE`,
    [tokenRow.allocation_id]
  );
  const alloc = allocRes.rows[0];
  if (!alloc) return;

  await markPendingInventory(client, pa.production_asset_id, actorUserId, {
    source: 'dispatch_qc',
    reason: 'config_mismatch',
    remarks,
    configurationMatched: false,
    checks: matchPayload.checks,
    errors: matchPayload.errors,
    sales_order_number: alloc.sales_order_number,
    allocation_id: alloc.allocation_id,
    token_id: tokenRow.token_id,
    verified_at: matchPayload.verified_at,
  });

  if (alloc.qc_ticket_id) {
    const failReason = remarks.slice(0, 2000);
    await client.query(
      `UPDATE tickets
          SET status = 'cancelled',
              highlighted = TRUE,
              highlighted_reason = $2,
              updated_at = NOW()
        WHERE ticket_id = $1
          AND status NOT IN ('completed', 'cancelled')`,
      [alloc.qc_ticket_id, `Dispatch QC failed: ${failReason}`.slice(0, 500)]
    );
  }

  await client.query(
    `UPDATE sales_order_serials
        SET status = 'removed',
            qc_status = 'failed',
            updated_at = NOW()
      WHERE allocation_id = $1`,
    [alloc.allocation_id]
  );

  // Detach must free the shelf reservation — otherwise the unit stays
  // inventory_status=reserved and disappears from SO attach search.
  if (alloc.serial_id) {
    try {
      const inventorySM = require('./inventoryStateMachine');
      await inventorySM.backToStock(client, alloc.serial_id, {
        reason: `Released after Dispatch QC fail on ${alloc.sales_order_number}`,
        actorUserId: actorUserId || null,
      });
    } catch (releaseErr) {
      console.warn(
        `routeMismatchToPendingInventory: backToStock failed for serial ${alloc.serial_id}: ${releaseErr.message}`
      );
      await client.query(
        `UPDATE vendor_serial_numbers
            SET inventory_status = 'in_stock',
                current_customer_id = NULL,
                current_dc_number = NULL,
                status_changed_at = NOW(),
                updated_at = NOW()
          WHERE serial_id = $1 AND deleted_at IS NULL`,
        [alloc.serial_id]
      );
    }
  }
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
  const expected = workingToCompareShape(pa || {});
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
  const expected = workingToCompareShape(pa || {});
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

    const expected = workingToCompareShape(pa);
    const configResult = verifyConfigurationAgainst(expected, actual);
    const soLine = await getSoLineForAllocation(row);
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
      routed_to_pending_inventory: true,
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
  routeMismatchToPendingInventory,
  apiBaseUrl,
};
