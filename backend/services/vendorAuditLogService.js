const pool = require('../config/db');

async function logVendorAudit({ actorUserId, vendorId, entityType, entityId, action, payload }) {
  try {
    await pool.query(
      `INSERT INTO vendor_audit_logs (actor_user_id, vendor_id, entity_type, entity_id, action, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        actorUserId || null,
        vendorId || null,
        entityType,
        entityId != null ? String(entityId) : null,
        action,
        JSON.stringify(payload || {})
      ]
    );
  } catch (e) {
    console.error('vendor audit log failed:', e.message);
  }
}

module.exports = { logVendorAudit };
