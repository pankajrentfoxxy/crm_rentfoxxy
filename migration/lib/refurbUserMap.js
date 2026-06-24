/**
 * Map source (refurb) user_id → target CRM user_id by email.
 */
const { normalizeEmail } = require('./helpers');

async function buildUserIdMap(source, crm) {
  const [srcUsers] = await source.query(
    `SELECT user_id, email FROM users WHERE email IS NOT NULL AND TRIM(email) <> '' ORDER BY user_id`
  );
  const map = new Map();

  for (const row of srcUsers) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    const { rows } = await crm.query(
      `SELECT user_id FROM users WHERE LOWER(TRIM(email)) = $1 ORDER BY user_id LIMIT 1`,
      [email]
    );
    if (rows.length) map.set(Number(row.user_id), Number(rows[0].user_id));
  }

  return map;
}

function mapUserId(userMap, sourceId) {
  if (sourceId == null) return null;
  const n = Number(sourceId);
  if (!Number.isFinite(n)) return null;
  return userMap.get(n) ?? null;
}

module.exports = { buildUserIdMap, mapUserId };
