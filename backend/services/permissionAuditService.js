const pool = require('../config/db');

async function logPermissionAudit({ actorUserId, targetType, targetId, action, payload }) {
  try {
    await pool.query(
      `INSERT INTO permission_audit_logs (actor_user_id, target_type, target_id, action, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        actorUserId || null,
        targetType,
        targetId != null ? String(targetId) : null,
        action,
        JSON.stringify(payload || {}),
      ]
    );
  } catch (error) {
    console.error('permission audit log failed:', error.message);
  }
}

module.exports = { logPermissionAudit };
