/**
 * QC2 hardware config capture — mirrors GRN serial capture, but expected
 * config comes from production_assets (not GRN/PO).
 */
const crypto = require('crypto');
const pool = require('../config/db');
const {
  apiBaseUrl,
  frontendBaseUrl,
  resolvePublicFrontendUrl,
} = require('./grnSerialCaptureService');
const { verifyConfigurationAgainst } = require('./grnConfigService');
const {
  ensureTables,
  getByTicket,
  getByVendorSerial,
  createFromGrn,
  getInventoryExpectedConfig,
  getById,
} = require('./productionAssetService');

const TOKEN_TTL_MINUTES = 30;

async function ensureQc2TokenTable(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS qc2_capture_tokens (
      token_id             UUID PRIMARY KEY,
      access_number        VARCHAR(8) NOT NULL,
      ticket_id            INT NOT NULL,
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_qc2_token_access_active
      ON qc2_capture_tokens(access_number)
      WHERE status = 'pending'
  `);
}

function randomAccessNumber() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function expireStaleTokens(db = pool) {
  await db.query(
    `UPDATE qc2_capture_tokens
        SET status = 'expired'
      WHERE status = 'pending' AND expires_at < NOW()`
  );
}

async function mintUniqueAccessNumber(db, maxAttempts = 12) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const access = randomAccessNumber();
    const clash = await db.query(
      `SELECT 1 FROM qc2_capture_tokens WHERE access_number = $1 AND status = 'pending' LIMIT 1`,
      [access]
    );
    if (!clash.rows.length) return access;
  }
  // Fall back to 8-digit
  return String(Math.floor(10000000 + Math.random() * 90000000)).slice(0, 8);
}

async function resolveProductionAssetForTicket(db, ticket) {
  await ensureTables(db);
  let pa = await getByTicket(db, ticket.ticket_id);
  if (!pa && ticket.vendor_serial_id) {
    pa = await getByVendorSerial(db, ticket.vendor_serial_id);
  }
  if (!pa) {
    pa = await createFromGrn(db, {
      ticketId: ticket.ticket_id,
      serialNumber: ticket.serial_number,
      ttsplId: ticket.ttspl_id,
      vendorSerialId: ticket.vendor_serial_id,
      configSource: ticket,
    });
  }
  return pa;
}

async function createQc2Token({ ticketId, createdBy, req }) {
  await ensureQc2TokenTable();
  await expireStaleTokens();

  const ticketRes = await pool.query(`SELECT * FROM tickets WHERE ticket_id = $1`, [ticketId]);
  if (!ticketRes.rows.length) {
    const err = new Error('Ticket not found');
    err.status = 404;
    throw err;
  }
  const ticket = ticketRes.rows[0];
  const stageRes = await pool.query(
    `SELECT stage_name FROM stages WHERE stage_id = $1`,
    [ticket.current_stage_id]
  );
  const stageName = stageRes.rows[0]?.stage_name;
  if (stageName !== 'QC2') {
    const err = new Error('Hardware verification is only available at the QC2 stage');
    err.status = 400;
    throw err;
  }

  const pa = await resolveProductionAssetForTicket(pool, ticket);
  if (!pa?.production_asset_id) {
    const err = new Error('Production Asset missing for this ticket');
    err.status = 400;
    throw err;
  }

  // Cancel other pending tokens for this ticket
  await pool.query(
    `UPDATE qc2_capture_tokens SET status = 'expired'
      WHERE ticket_id = $1 AND status = 'pending'`,
    [ticketId]
  );

  const tokenId = crypto.randomUUID();
  const accessNumber = await mintUniqueAccessNumber(pool);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  await pool.query(
    `INSERT INTO qc2_capture_tokens
       (token_id, access_number, ticket_id, production_asset_id, status, created_by, expires_at)
     VALUES ($1,$2,$3,$4,'pending',$5,$6)`,
    [tokenId, accessNumber, ticketId, pa.production_asset_id, createdBy || null, expiresAt]
  );

  const feBase = resolvePublicFrontendUrl(req) || frontendBaseUrl();
  return {
    token: tokenId,
    access_number: accessNumber,
    expires_at: expiresAt.toISOString(),
    match_url: `${feBase}/qc2-config-match`,
    production_asset_id: pa.production_asset_id,
    api_base_url: apiBaseUrl(req),
  };
}

async function getTokenRow(tokenId) {
  await expireStaleTokens();
  const r = await pool.query(
    `SELECT * FROM qc2_capture_tokens WHERE token_id = $1`,
    [tokenId]
  );
  return r.rows[0] || null;
}

async function getLatestTokenForTicket(ticketId) {
  await ensureQc2TokenTable();
  await expireStaleTokens();
  const r = await pool.query(
    `SELECT * FROM qc2_capture_tokens
      WHERE ticket_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [ticketId]
  );
  return r.rows[0] || null;
}

async function resolveByAccessNumber(accessNumber) {
  await ensureQc2TokenTable();
  await expireStaleTokens();
  const code = String(accessNumber || '').trim();
  if (!/^\d{4,8}$/.test(code)) {
    return { ok: false, code: 400, message: 'Enter a valid access number' };
  }
  const r = await pool.query(
    `SELECT * FROM qc2_capture_tokens
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
      `UPDATE qc2_capture_tokens SET status = 'expired' WHERE token_id = $1`,
      [row.token_id]
    );
    return { ok: false, code: 410, message: 'Access number expired — generate a new one on the QC2 screen' };
  }

  const pa = await getById(pool, row.production_asset_id);
  // Expected config = latest Inventory Asset configuration (not the GRN snapshot)
  const { expected } = await getInventoryExpectedConfig(pool, pa || {});
  return {
    ok: true,
    token: row.token_id,
    expires_at: row.expires_at,
    ticket_id: row.ticket_id,
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
  const { expected } = await getInventoryExpectedConfig(pool, pa || {});
  return {
    token: row.token_id,
    status: row.status,
    expires_at: row.expires_at,
    ticket_id: row.ticket_id,
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

/**
 * Script POSTs detected hardware config — verify against Production Asset.
 */
async function verifyQc2Configuration(tokenId, actual, ip) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await expireStaleTokens(client);

    const tokRes = await client.query(
      `SELECT * FROM qc2_capture_tokens WHERE token_id = $1 FOR UPDATE`,
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
        `UPDATE qc2_capture_tokens SET status = 'expired' WHERE token_id = $1`,
        [tokenId]
      );
      await client.query('COMMIT');
      return { ok: false, code: 410, message: 'Access number expired — generate a new one on QC2' };
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

    // Compare against the latest Inventory Asset configuration, not the GRN snapshot
    const { expected } = await getInventoryExpectedConfig(client, pa);
    const result = verifyConfigurationAgainst(expected, actual);
    const matchPayload = {
      configurationMatched: result.configurationMatched,
      checks: result.checks,
      errors: result.errors,
      verified_at: new Date().toISOString(),
    };

    if (result.configurationMatched) {
      await client.query(
        `UPDATE qc2_capture_tokens
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
            SET status = 'qc2_verifying',
                qc2_verification = $2::jsonb,
                updated_at = NOW()
          WHERE production_asset_id = $1`,
        [
          pa.production_asset_id,
          JSON.stringify({
            ...matchPayload,
            source: 'qc2_script',
            token_id: tokenId,
          }),
        ]
      );
      await client.query('COMMIT');
      return {
        ok: true,
        configurationMatched: true,
        checks: result.checks,
        errors: result.errors,
        expected,
      };
    }

    // Mismatch → QC2 failed
    const remarkParts = (result.errors || []).map(
      (e) => `${e.field}: expected "${e.expected ?? ''}", found "${e.actual ?? ''}"`
    );
    const remarks = remarkParts.length
      ? `QC2 config mismatch — ${remarkParts.join('; ')}`
      : 'QC2 config mismatch';

    await client.query(
      `UPDATE qc2_capture_tokens
          SET status = 'failed',
              actual_config = $2::jsonb,
              match_result = $3::jsonb,
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
          SET status = 'qc2_failed',
              qc2_verification = $2::jsonb,
              updated_at = NOW()
        WHERE production_asset_id = $1`,
      [
        pa.production_asset_id,
        JSON.stringify({
          ...matchPayload,
          remarks,
          source: 'qc2_script',
          token_id: tokenId,
        }),
      ]
    );
    await client.query(
      `UPDATE tickets
          SET qc2_failed_at = NOW(),
              qc2_fail_reason = $2,
              highlighted = TRUE,
              highlighted_reason = $3,
              updated_at = NOW()
        WHERE ticket_id = $1`,
      [row.ticket_id, remarks.slice(0, 2000), `QC2 failed: ${remarks}`.slice(0, 500)]
    );

    await client.query('COMMIT');
    return {
      ok: true,
      configurationMatched: false,
      checks: result.checks,
      errors: result.errors,
      expected,
      remarks,
      qc2_failed: true,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Optional serial submit — must match Production Asset serial.
 */
async function submitQc2Serial(tokenId, serialNumber) {
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
    `UPDATE qc2_capture_tokens SET serial_number = $2 WHERE token_id = $1`,
    [tokenId, serial]
  );

  return { ok: true, serial_number: serial };
}

module.exports = {
  ensureQc2TokenTable,
  createQc2Token,
  getTokenRow,
  getLatestTokenForTicket,
  resolveByAccessNumber,
  getPublicSession,
  verifyQc2Configuration,
  submitQc2Serial,
  apiBaseUrl,
};
