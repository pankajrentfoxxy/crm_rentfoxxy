'use strict';

/** Single source of truth for "who is this technician". Fixes D22. */

async function resolveTechnicianUserId(db, { userId, technicianId } = {}) {
  if (userId) {
    const r = await db.query('SELECT user_id FROM users WHERE user_id = $1', [userId]);
    return r.rows[0] ? r.rows[0].user_id : null;
  }
  if (technicianId) {
    const r = await db.query(
      'SELECT user_id FROM delivery_technicians WHERE technician_id = $1',
      [technicianId]
    );
    return r.rows[0] ? r.rows[0].user_id : null;
  }
  return null;
}

async function resolveTechnicianIds(db, userId) {
  if (!userId) return { user_id: null, technician_id: null };
  const r = await db.query(
    `SELECT u.user_id, dt.technician_id
       FROM users u
       LEFT JOIN delivery_technicians dt ON dt.user_id = u.user_id
      WHERE u.user_id = $1
      LIMIT 1`,
    [userId]
  );
  if (!r.rows[0]) return { user_id: userId, technician_id: null };
  return { user_id: r.rows[0].user_id, technician_id: r.rows[0].technician_id };
}

module.exports = { resolveTechnicianUserId, resolveTechnicianIds };
