const pool = require('../config/db');

/**
 * GRN Access Numbers — short numeric codes that map to a GRN capture URL.
 * The access number itself is the auth key; there is no separate password.
 */

async function expireStale(db = pool) {
  await db.query(
    `UPDATE grn_access_numbers
        SET status = 'expired'
      WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()`
  );
}

/** Random 6-digit code (100000–999999). */
function random6Digit() {
  return Math.floor(100000 + Math.random() * 900000);
}

/**
 * Create a new access number for a capture URL.
 * The code is a random, unique 6-digit number. Uniqueness is enforced by the
 * UNIQUE constraint — we retry on collision rather than pre-checking, so it is
 * race-safe even with concurrent receives.
 */
async function createAccessNumber({ captureUrl, captureToken, poId, createdBy, expiresAt }) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const accessNumber = random6Digit();
    try {
      const r = await pool.query(
        `INSERT INTO grn_access_numbers
           (access_number, capture_url, capture_token, po_id, created_by, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, access_number, expires_at`,
        [accessNumber, captureUrl, captureToken || null, poId || null, createdBy || null, expiresAt || null]
      );
      return r.rows[0];
    } catch (e) {
      if (e.code === '23505') continue; // unique_violation — try another number
      throw e;
    }
  }
  throw new Error('Could not allocate a unique access number');
}

async function logAttempt({ accessNumber, accessId, success, result, ip, userAgent }) {
  try {
    await pool.query(
      `INSERT INTO grn_access_attempts (access_number, access_id, success, result, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        Number.isFinite(accessNumber) ? accessNumber : null,
        accessId || null,
        Boolean(success),
        result || null,
        ip ? String(ip).slice(0, 64) : null,
        userAgent ? String(userAgent).slice(0, 1000) : null,
      ]
    );
  } catch (_) {
    /* audit logging must never break the resolve flow */
  }
}

/**
 * Validate an entered access number.
 * Returns { ok, code, capture_url? } where code ∈ ok|invalid|used|expired.
 */
async function resolveAccessNumber(rawNumber, meta = {}) {
  const accessNumber = parseInt(String(rawNumber).trim(), 10);
  if (!Number.isFinite(accessNumber)) {
    await logAttempt({ accessNumber: NaN, success: false, result: 'invalid', ...meta });
    return { ok: false, code: 'invalid' };
  }

  await expireStale();

  const r = await pool.query(
    `SELECT * FROM grn_access_numbers WHERE access_number = $1`,
    [accessNumber]
  );
  const row = r.rows[0];
  if (!row) {
    await logAttempt({ accessNumber, success: false, result: 'invalid', ...meta });
    return { ok: false, code: 'invalid' };
  }
  if (row.status === 'used') {
    await logAttempt({ accessNumber, accessId: row.id, success: false, result: 'used', ...meta });
    return { ok: false, code: 'used' };
  }
  if (row.status === 'expired' || (row.expires_at && new Date(row.expires_at) < new Date())) {
    if (row.status !== 'expired') {
      await pool.query(`UPDATE grn_access_numbers SET status = 'expired' WHERE id = $1`, [row.id]);
    }
    await logAttempt({ accessNumber, accessId: row.id, success: false, result: 'expired', ...meta });
    return { ok: false, code: 'expired' };
  }

  // One-time use: burn the number the moment it is successfully resolved
  // (clicked). Re-entering it afterwards returns "Already Used".
  await pool.query(
    `UPDATE grn_access_numbers SET status = 'used', used_at = NOW() WHERE id = $1`,
    [row.id]
  );

  await logAttempt({ accessNumber, accessId: row.id, success: true, result: 'ok', ...meta });
  return {
    ok: true,
    code: 'ok',
    access_number: row.access_number,
    capture_url: row.capture_url,
    po_id: row.po_id,
    expires_at: row.expires_at,
  };
}

/** Mark the access number tied to a capture token as USED (idempotent). */
async function markUsedByToken(captureToken, db = pool) {
  if (!captureToken) return;
  await db.query(
    `UPDATE grn_access_numbers
        SET status = 'used', used_at = NOW()
      WHERE capture_token = $1 AND status <> 'used'`,
    [captureToken]
  );
}

// ── Admin ────────────────────────────────────────────────────────
async function listAccessNumbers({ status } = {}) {
  await expireStale();
  const params = [];
  let where = '';
  if (status) { params.push(status); where = `WHERE a.status = $1`; }
  const r = await pool.query(
    `SELECT a.*, u.name AS created_by_name, p.purchase_order_number
       FROM grn_access_numbers a
       LEFT JOIN users u ON u.user_id = a.created_by
       LEFT JOIN vendor_purchase_orders p ON p.po_id = a.po_id
       ${where}
      ORDER BY a.created_at DESC
      LIMIT 500`,
    params
  );
  return r.rows;
}

async function expireAccessNumber(id) {
  const r = await pool.query(
    `UPDATE grn_access_numbers
        SET status = 'expired'
      WHERE id = $1 AND status = 'pending'
      RETURNING id`,
    [id]
  );
  return r.rows.length > 0;
}

async function removeAccessNumber(id) {
  await pool.query(`DELETE FROM grn_access_numbers WHERE id = $1`, [id]);
}

async function listAttempts({ limit = 100 } = {}) {
  const r = await pool.query(
    `SELECT * FROM grn_access_attempts ORDER BY created_at DESC LIMIT $1`,
    [Math.min(Number(limit) || 100, 500)]
  );
  return r.rows;
}

module.exports = {
  createAccessNumber,
  resolveAccessNumber,
  markUsedByToken,
  listAccessNumbers,
  expireAccessNumber,
  removeAccessNumber,
  listAttempts,
};
