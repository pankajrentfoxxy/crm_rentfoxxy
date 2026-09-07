/**
 * Return DC hardware config capture — mirrors vendorReturnCaptureService / QC2.
 * Expected config is inventory extra (vendor_serial_numbers), same as QC2.
 */
const crypto = require('crypto');
const pool = require('../config/db');
const {
  apiBaseUrl,
  frontendBaseUrl,
  resolvePublicFrontendUrl,
} = require('./grnSerialCaptureService');
const { verifyConfigurationAgainst } = require('./grnConfigService');
const { getInventoryExpectedConfig } = require('./productionAssetService');

function randomAccessNumber() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function expectedShape(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    brand: src.brand || null,
    model: src.model || null,
    processor: src.processor || null,
    generation: src.generation || null,
    ram: src.ram || null,
    ssd: src.ssd || src.storage || null,
    gpu: src.gpu || null,
  };
}

async function expectedConfigForPickupItem(db, item) {
  const inv = await getInventoryExpectedConfig(db, {
    serial_number: item.serial_number,
    ttspl_id: item.ttspl_id || item.unique_serial_number,
    vendor_serial_id: item.serial_id || null,
  });
  const expected = expectedShape(inv?.expected || {});
  return {
    brand: expected.brand || item.brand || null,
    model: expected.model || item.model || null,
    processor: expected.processor || item.processor || null,
    generation: expected.generation || item.generation || null,
    ram: expected.ram || item.ram || null,
    ssd: expected.ssd || item.storage || item.ssd || null,
    gpu: expected.gpu || null,
  };
}

async function expireStaleTokens(db = pool) {
  await db.query(
    `UPDATE rdc_capture_tokens
        SET status = 'expired'
      WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()`
  );
}

async function mintUniqueAccessNumber(db, maxAttempts = 12) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const access = randomAccessNumber();
    const clash = await db.query(
      `SELECT 1 FROM rdc_capture_tokens WHERE access_number = $1 AND status = 'pending' LIMIT 1`,
      [access]
    );
    if (!clash.rows.length) return access;
  }
  return String(Math.floor(10000000 + Math.random() * 90000000)).slice(0, 8);
}

async function mintTokensForItems(client, { rdcNumber, items, createdBy }) {
  const minted = [];
  for (const item of items || []) {
    if (!item?.id) continue;
    await client.query(
      `UPDATE rdc_capture_tokens SET status = 'expired'
        WHERE item_id = $1 AND status = 'pending'`,
      [item.id]
    );
    const tokenId = crypto.randomUUID();
    const accessNumber = await mintUniqueAccessNumber(client);
    const expected = expectedShape(item.expected_config || await expectedConfigForPickupItem(client, item));
    await client.query(
      `INSERT INTO rdc_capture_tokens
         (token_id, access_number, rdc_number, item_id, ticket_id,
          serial_id, ttspl_id, serial_number, expected_config, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'pending',$10)`,
      [
        tokenId,
        accessNumber,
        rdcNumber,
        item.id,
        item.ticket_id || null,
        item.serial_id || null,
        item.ttspl_id || item.unique_serial_number || null,
        item.serial_number || null,
        JSON.stringify(expected),
        createdBy || null,
      ]
    );
    await client.query(
      `UPDATE support_ticket_items SET return_config_token_id = $2, updated_at = NOW() WHERE id = $1`,
      [item.id, tokenId]
    );
    minted.push({ token_id: tokenId, access_number: accessNumber, item_id: item.id });
  }
  return minted;
}

async function loadPickupItemsForRdc(db, rdcNumber) {
  const r = await db.query(
    `SELECT sti.*,
            vsn.serial_id
       FROM support_ticket_items sti
       LEFT JOIN LATERAL (
         SELECT v.serial_id
           FROM vendor_serial_numbers v
          WHERE v.deleted_at IS NULL
            AND (
              v.inventory_asset_code = COALESCE(sti.ttspl_id, sti.unique_serial_number)
              OR v.serial_number = sti.serial_number
            )
          ORDER BY
            CASE WHEN v.inventory_asset_code = COALESCE(sti.ttspl_id, sti.unique_serial_number) THEN 0 ELSE 1 END,
            v.serial_id ASC
          LIMIT 1
       ) vsn ON TRUE
      WHERE sti.return_dc_number = $1
        AND sti.item_type = 'pickup'
        AND COALESCE(sti.status, '') NOT IN ('cancelled')
      ORDER BY sti.id ASC`,
    [rdcNumber]
  );
  return r.rows;
}

async function mintTokensForRdc(client, { rdcNumber, createdBy, itemIds = null }) {
  const items = await loadPickupItemsForRdc(client, rdcNumber);
  const need = [];
  for (const item of items) {
    if (itemIds && !itemIds.includes(item.id)) continue;
    if (!item.gate_inward_at) continue;
    if (item.warehouse_received_at && item.return_config_verified_at) continue;
    if (item.return_config_verified_at && item.return_captured_serial) continue;
    const latest = await latestTokenForItem(client, item.id);
    if (latest && (latest.status === 'pending' || latest.status === 'matched') && !itemIds) continue;
    item.expected_config = await expectedConfigForPickupItem(client, item);
    need.push(item);
  }
  if (!need.length) return [];
  return mintTokensForItems(client, { rdcNumber, items: need, createdBy });
}

async function getTokenRow(tokenId) {
  await expireStaleTokens();
  const r = await pool.query(
    `SELECT * FROM rdc_capture_tokens WHERE token_id = $1`,
    [tokenId]
  );
  return r.rows[0] || null;
}

async function latestTokenForItem(db, itemId) {
  const r = await db.query(
    `SELECT * FROM rdc_capture_tokens
      WHERE item_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [itemId]
  );
  return r.rows[0] || null;
}

async function listLatestTokensForRdc(db, rdcNumber) {
  const r = await db.query(
    `SELECT DISTINCT ON (item_id) *
       FROM rdc_capture_tokens
      WHERE rdc_number = $1
      ORDER BY item_id, created_at DESC`,
    [rdcNumber]
  );
  return r.rows;
}

async function resolveByAccessNumber(accessNumber) {
  await expireStaleTokens();
  const code = String(accessNumber || '').trim();
  if (!/^\d{4,8}$/.test(code)) {
    return { ok: false, code: 400, message: 'Enter a valid access number' };
  }
  const r = await pool.query(
    `SELECT * FROM rdc_capture_tokens
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
      `UPDATE rdc_capture_tokens SET status = 'expired' WHERE token_id = $1`,
      [row.token_id]
    );
    return { ok: false, code: 410, message: 'Access number expired — generate a new one from the Return DC' };
  }
  return {
    ok: true,
    token: row.token_id,
    expires_at: row.expires_at,
    ticket_id: row.ticket_id,
    dc_number: row.rdc_number,
    expected_config: expectedShape(row.expected_config),
    ttspl_id: row.ttspl_id || null,
    serial_number: row.serial_number || null,
  };
}

async function getPublicSession(tokenId) {
  const row = await getTokenRow(tokenId);
  if (!row) return null;
  const laptopCondition = row.match_result?.laptop_condition
    || (row.status === 'matched' && row.match_result?.skipped ? 'not_on' : null);
  return {
    token: row.token_id,
    status: row.status,
    expires_at: row.expires_at,
    ticket_id: row.ticket_id,
    dc_number: row.rdc_number,
    matched_at: row.matched_at,
    serial_number: row.serial_number,
    actual_config: row.actual_config,
    match_result: row.match_result,
    config_verified: row.status === 'matched',
    config_check: row.match_result,
    expected_config: expectedShape(row.expected_config),
    ttspl_id: row.ttspl_id || null,
    laptop_condition: laptopCondition,
  };
}

async function verifyRdcConfiguration(tokenId, actual, ip) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await expireStaleTokens(client);

    const tokRes = await client.query(
      `SELECT * FROM rdc_capture_tokens WHERE token_id = $1 FOR UPDATE`,
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
        `UPDATE rdc_capture_tokens SET status = 'expired' WHERE token_id = $1`,
        [tokenId]
      );
      await client.query('COMMIT');
      return { ok: false, code: 410, message: 'Access number expired — generate a new one from the Return DC' };
    }

    const expected = expectedShape(row.expected_config);
    const configResult = verifyConfigurationAgainst(expected, actual);
    const matchPayload = {
      configurationMatched: configResult.configurationMatched,
      laptop_condition: 'on',
      checks: configResult.checks || [],
      errors: configResult.errors || [],
      verified_at: new Date().toISOString(),
    };

    if (configResult.configurationMatched) {
      await client.query(
        `UPDATE rdc_capture_tokens
            SET status = 'matched',
                actual_config = $2::jsonb,
                match_result = $3::jsonb,
                matched_at = NOW(),
                verified_by_ip = $4
          WHERE token_id = $1`,
        [tokenId, JSON.stringify(actual), JSON.stringify(matchPayload), ip ? String(ip).slice(0, 64) : null]
      );
      await client.query(
        `UPDATE support_ticket_items
            SET return_config_verified_at = NOW(),
                return_config_result = $2::jsonb,
                return_config_token_id = $1,
                return_laptop_condition = 'on',
                updated_at = NOW()
          WHERE id = $3`,
        [tokenId, JSON.stringify(matchPayload), row.item_id]
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

    await client.query(
      `UPDATE rdc_capture_tokens
          SET status = 'failed',
              actual_config = $2::jsonb,
              match_result = $3::jsonb,
              verified_by_ip = $4
        WHERE token_id = $1`,
      [tokenId, JSON.stringify(actual), JSON.stringify(matchPayload), ip ? String(ip).slice(0, 64) : null]
    );
    await client.query(
      `UPDATE support_ticket_items
          SET return_config_result = $2::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [row.item_id, JSON.stringify(matchPayload)]
    );

    const retry = await mintTokensForItems(client, {
      rdcNumber: row.rdc_number,
      items: [{
        id: row.item_id,
        ticket_id: row.ticket_id,
        serial_id: row.serial_id,
        ttspl_id: row.ttspl_id,
        serial_number: row.serial_number,
        expected_config: expected,
      }],
      createdBy: row.created_by,
    });

    await client.query('COMMIT');
    return {
      ok: true,
      configurationMatched: false,
      checks: matchPayload.checks,
      errors: matchPayload.errors,
      expected,
      retry_access_number: retry[0]?.access_number || null,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function markRdcNotOn(tokenId, serialNumber, ip) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await expireStaleTokens(client);

    const tokRes = await client.query(
      `SELECT * FROM rdc_capture_tokens WHERE token_id = $1 FOR UPDATE`,
      [tokenId]
    );
    const row = tokRes.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { ok: false, code: 404, message: 'Capture link not found or expired' };
    }
    if (row.status === 'matched') {
      await client.query('ROLLBACK');
      return { ok: true, already: true, serial_number: row.serial_number };
    }
    if (row.status !== 'pending') {
      await client.query('ROLLBACK');
      return { ok: false, code: 409, message: 'This access number is no longer active' };
    }
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      await client.query(
        `UPDATE rdc_capture_tokens SET status = 'expired' WHERE token_id = $1`,
        [row.token_id]
      );
      await client.query('COMMIT');
      return { ok: false, code: 410, message: 'Access number expired — generate a new one from the Return DC' };
    }

    const serial = String(serialNumber || '').trim().toUpperCase();
    if (!serial || serial.length < 3) {
      await client.query('ROLLBACK');
      return { ok: false, code: 400, message: 'Type the serial number on the laptop' };
    }
    const expected = String(row.serial_number || '').trim().toUpperCase();
    if (expected && expected !== serial) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 400,
        message: `Serial does not match the laptop on this Return DC (expected ${expected})`,
      };
    }

    const matchPayload = {
      configurationMatched: true,
      skipped: true,
      laptop_condition: 'not_on',
      checks: [],
      errors: [],
      verified_at: new Date().toISOString(),
    };

    await client.query(
      `UPDATE rdc_capture_tokens
          SET status = 'matched',
              serial_number = $2,
              match_result = $3::jsonb,
              matched_at = NOW(),
              verified_by_ip = $4
        WHERE token_id = $1`,
      [tokenId, serial, JSON.stringify(matchPayload), ip ? String(ip).slice(0, 64) : null]
    );
    await client.query(
      `UPDATE support_ticket_items
          SET return_config_verified_at = NOW(),
              return_config_result = $2::jsonb,
              return_config_token_id = $1,
              return_captured_serial = $3,
              return_laptop_condition = 'not_on',
              updated_at = NOW()
        WHERE id = $4`,
      [tokenId, JSON.stringify(matchPayload), serial, row.item_id]
    );
    await client.query('COMMIT');
    return { ok: true, serial_number: serial, laptop_condition: 'not_on' };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function submitRdcSerial(tokenId, serialNumber) {
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

  const expected = String(row.serial_number || '').trim().toUpperCase();
  if (expected && expected !== serial) {
    return {
      ok: false,
      code: 400,
      message: `Serial does not match the laptop on this Return DC (expected ${expected})`,
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
    `UPDATE rdc_capture_tokens SET serial_number = $2 WHERE token_id = $1`,
    [tokenId, serial]
  );
  await pool.query(
    `UPDATE support_ticket_items
        SET return_captured_serial = $2,
            return_laptop_condition = COALESCE(return_laptop_condition, 'on'),
            updated_at = NOW()
      WHERE id = $1`,
    [row.item_id, serial]
  );
  return { ok: true, serial_number: serial };
}

module.exports = {
  expectedConfigForPickupItem,
  mintTokensForItems,
  mintTokensForRdc,
  getTokenRow,
  latestTokenForItem,
  listLatestTokensForRdc,
  resolveByAccessNumber,
  getPublicSession,
  verifyRdcConfiguration,
  markRdcNotOn,
  submitRdcSerial,
  apiBaseUrl,
  frontendBaseUrl,
  resolvePublicFrontendUrl,
};
