/**
 * Admin-visible password copy (remember_pass_plain) — set on create/reset,
 * or recovered by matching bcrypt hash against known candidate passwords.
 */
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

/** Passwords used in seeds / common defaults — matched without changing the hash. */
const CANDIDATE_PASSWORDS = [
  'Test@1234',
  'Test@123',
  'password',
  'Password@123',
  'Admin@123',
  'Rentfoxxy@123',
];

async function ensureRememberPassColumn() {
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS remember_pass_plain TEXT');
}

async function backfillRememberPassPlain({ userIds = null, limit = 1000 } = {}) {
  await ensureRememberPassColumn();

  const params = [];
  let userFilter = `u.role NOT IN ('vendor', 'customer')
    AND u.password_hash IS NOT NULL
    AND NULLIF(TRIM(u.remember_pass_plain), '') IS NULL`;

  if (Array.isArray(userIds) && userIds.length) {
    params.push(userIds.map((id) => Number(id)).filter((id) => id > 0));
    userFilter += ` AND u.user_id = ANY($${params.length}::int[])`;
  }

  params.push(Math.min(Math.max(limit, 1), 5000));
  const limitIdx = params.length;

  const { rows } = await pool.query(
    `SELECT u.user_id, u.password_hash
       FROM users u
      WHERE ${userFilter}
      ORDER BY u.user_id
      LIMIT $${limitIdx}`,
    params
  );

  let updated = 0;
  const recovered = [];

  for (const row of rows) {
    for (const candidate of CANDIDATE_PASSWORDS) {
      // eslint-disable-next-line no-await-in-loop
      const match = await bcrypt.compare(candidate, row.password_hash);
      if (!match) continue;
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        'UPDATE users SET remember_pass_plain = $1, updated_at = NOW() WHERE user_id = $2',
        [candidate, row.user_id]
      );
      updated += 1;
      recovered.push({ user_id: row.user_id, password: candidate });
      break;
    }
  }

  return {
    scanned: rows.length,
    updated,
    recovered,
    still_missing: rows.length - updated,
  };
}

module.exports = {
  ensureRememberPassColumn,
  backfillRememberPassPlain,
  CANDIDATE_PASSWORDS,
};
