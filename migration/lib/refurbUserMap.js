/**
 * Map source (refurb) user_id → target CRM user_id.
 *
 * Never maps by numeric user_id alone — old and new CRM user IDs diverge
 * (e.g. source #13 = Harshit, target #13 = Anikesh).
 */
const { normalizeEmail } = require('./helpers');

function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function buildUserIdMap(source, crm) {
  const [srcUsers] = await source.query(
    `SELECT user_id, name, email, role, mobile_no FROM users
      WHERE email IS NOT NULL AND TRIM(email) <> '' ORDER BY user_id`
  );
  const { rows: crmUsers } = await crm.query(
    `SELECT user_id, name, email, role, mobile_no FROM users ORDER BY user_id`
  );

  const crmByEmail = new Map();
  const crmByNameRole = new Map();

  for (const u of crmUsers) {
    const crmId = Number(u.user_id);
    const email = normalizeEmail(u.email);
    if (email) crmByEmail.set(email, crmId);
    const role = String(u.role || '').trim().toLowerCase();
    const name = normalizeName(u.name);
    if (role && name) crmByNameRole.set(`${role}:${name}`, crmId);
  }

  const map = new Map();
  const unmapped = [];

  for (const row of srcUsers) {
    const sourceId = Number(row.user_id);
    const email = normalizeEmail(row.email);
    let crmId = email ? crmByEmail.get(email) : null;

    if (!crmId) {
      const role = String(row.role || '').trim().toLowerCase();
      const name = normalizeName(row.name);
      if (role && name) crmId = crmByNameRole.get(`${role}:${name}`) ?? null;
    }

    if (crmId) map.set(sourceId, crmId);
    else unmapped.push({ sourceId, email, name: row.name, role: row.role });
  }

  map.unmappedUsers = unmapped;
  return map;
}

function mapUserId(userMap, sourceId) {
  if (sourceId == null) return null;
  const n = Number(sourceId);
  if (!Number.isFinite(n)) return null;
  return userMap.get(n) ?? null;
}

module.exports = { buildUserIdMap, mapUserId };
