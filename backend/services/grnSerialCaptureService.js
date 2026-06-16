const crypto = require('crypto');
const pool = require('../config/db');

const TOKEN_TTL_MINUTES = 30;

function frontendBaseUrl() {
  const raw = process.env.FRONTEND_URL || 'http://localhost:3000';
  return String(raw).split(',')[0].trim().replace(/\/$/, '');
}

function apiBaseUrl(req) {
  if (process.env.PUBLIC_API_URL) return String(process.env.PUBLIC_API_URL).replace(/\/$/, '');
  if (req) {
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('x-forwarded-host') || req.get('host');
    if (host) return `${proto}://${host}/api`.replace(/\/api\/api$/, '/api');
  }
  const port = process.env.PORT || 5001;
  return `http://localhost:${port}/api`;
}

async function createCaptureToken({
  poId,
  lineIndex,
  unitIndex,
  totalUnits,
  createdBy,
}) {
  const tokenId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);
  await pool.query(
    `INSERT INTO grn_serial_capture_tokens
       (token_id, po_id, line_index, unit_index, total_units, created_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [tokenId, poId, lineIndex, unitIndex, totalUnits, createdBy || null, expiresAt]
  );
  const captureUrl = `${frontendBaseUrl()}/grn-capture/${tokenId}`;
  return { token: tokenId, capture_url: captureUrl, expires_at: expiresAt.toISOString() };
}

async function getTokenRow(tokenId) {
  const r = await pool.query(
    `SELECT t.*, p.purchase_order_number
     FROM grn_serial_capture_tokens t
     JOIN vendor_purchase_orders p ON p.po_id = t.po_id
     WHERE t.token_id = $1`,
    [tokenId]
  );
  return r.rows[0] || null;
}

async function expireStaleTokens() {
  await pool.query(
    `UPDATE grn_serial_capture_tokens
     SET status = 'expired'
     WHERE status = 'pending' AND expires_at < NOW()`
  );
}

async function getTokenStatus(tokenId) {
  await expireStaleTokens();
  const row = await getTokenRow(tokenId);
  if (!row) return null;
  return {
    token: row.token_id,
    status: row.status,
    serial_number: row.serial_number,
    unit_index: row.unit_index,
    total_units: row.total_units,
    po_id: row.po_id,
    line_index: row.line_index,
    expires_at: row.expires_at,
    captured_at: row.captured_at,
  };
}

async function submitCapturedSerial(tokenId, serialNumber) {
  await expireStaleTokens();
  const row = await getTokenRow(tokenId);
  if (!row) return { ok: false, code: 404, message: 'Capture link not found or expired' };
  if (row.status !== 'pending') {
    return {
      ok: false,
      code: 409,
      message: row.status === 'captured' || row.status === 'used'
        ? 'Serial already captured for this link'
        : 'This capture link is no longer active',
    };
  }
  if (new Date(row.expires_at) < new Date()) {
    await pool.query(
      `UPDATE grn_serial_capture_tokens SET status = 'expired' WHERE token_id = $1`,
      [tokenId]
    );
    return { ok: false, code: 410, message: 'Capture link expired — ask the receiver to generate a new link' };
  }

  const serial = String(serialNumber || '').trim().toUpperCase();
  if (!serial || serial.length < 3) {
    return { ok: false, code: 400, message: 'Invalid serial number' };
  }

  const dup = await pool.query(
    `SELECT serial_number FROM vendor_serial_numbers
     WHERE deleted_at IS NULL AND LOWER(serial_number) = LOWER($1)`,
    [serial]
  );
  if (dup.rows.length) {
    return {
      ok: false,
      code: 409,
      message: `Serial ${serial} already exists in inventory`,
    };
  }

  await pool.query(
    `UPDATE grn_serial_capture_tokens
     SET serial_number = $2, status = 'captured', captured_at = NOW()
     WHERE token_id = $1`,
    [tokenId, serial]
  );

  return {
    ok: true,
    serial_number: serial,
    unit_index: row.unit_index,
    total_units: row.total_units,
  };
}

async function markTokenUsed(tokenId) {
  await pool.query(
    `UPDATE grn_serial_capture_tokens
     SET status = 'used', used_at = NOW()
     WHERE token_id = $1 AND status IN ('pending', 'captured')`,
    [tokenId]
  );
}

async function cancelPendingTokensForSlot(poId, lineIndex, unitIndex) {
  await pool.query(
    `UPDATE grn_serial_capture_tokens
     SET status = 'cancelled'
     WHERE po_id = $1 AND line_index = $2 AND unit_index = $3 AND status = 'pending'`,
    [poId, lineIndex, unitIndex]
  );
}

module.exports = {
  createCaptureToken,
  getTokenStatus,
  getTokenRow,
  submitCapturedSerial,
  markTokenUsed,
  cancelPendingTokensForSlot,
  frontendBaseUrl,
  apiBaseUrl,
};
