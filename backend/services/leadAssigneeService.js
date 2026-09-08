const pool = require('../config/db');

/** Active sales users who may receive lead ownership. */
const LEAD_ASSIGNEE_SQL = `
  SELECT user_id, name, email, role
    FROM users
   WHERE role = 'sales'
     AND COALESCE(active, true) = true
     AND COALESCE(status, 'active') = 'active'
   ORDER BY name ASC
`;

async function listLeadAssigneeUsers() {
  const { rows } = await pool.query(LEAD_ASSIGNEE_SQL);
  return rows;
}

async function filterEligibleAssigneeIds(userIds = []) {
  const ids = [...new Set(userIds.map((id) => parseInt(id, 10)).filter(Number.isFinite))];
  if (!ids.length) return [];
  const allowed = await listLeadAssigneeUsers();
  const allowedSet = new Set(allowed.map((u) => u.user_id));
  return ids.filter((id) => allowedSet.has(id));
}

module.exports = {
  listLeadAssigneeUsers,
  filterEligibleAssigneeIds,
};
