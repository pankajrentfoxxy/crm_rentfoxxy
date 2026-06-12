const pool = require('../config/db');

async function logTtsplEvent({
  ttsplId,
  vendorSerialId,
  eventType,
  description,
  metadata = {},
  actorUserId,
  actorName,
  db
}) {
  if (!ttsplId) return;
  const client = db || pool;
  await client.query(
    `INSERT INTO ttspl_audit_log
      (ttspl_id, vendor_serial_id, event_type, description, metadata,
       actor_user_id, actor_name)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
    [
      ttsplId,
      vendorSerialId || null,
      eventType,
      description,
      JSON.stringify(metadata),
      actorUserId || null,
      actorName || null
    ]
  );
}

async function logConfigChange({
  ttsplId,
  vendorSerialId,
  ticketId,
  changedBy,
  changeType,
  fieldName,
  oldValue,
  newValue,
  notes,
  partUsedId,
  partCost = 0,
  db
}) {
  if (!ttsplId) return;
  const client = db || pool;
  await client.query(
    `INSERT INTO ttspl_config_history
      (ttspl_id, vendor_serial_id, ticket_id, changed_by, change_type,
       field_name, old_value, new_value, notes, part_used_id, part_cost)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      ttsplId,
      vendorSerialId || null,
      ticketId || null,
      changedBy || null,
      changeType,
      fieldName,
      oldValue || null,
      newValue || null,
      notes || null,
      partUsedId || null,
      partCost
    ]
  );
}

async function getTtsplHistory(ttsplId) {
  const [auditRes, configRes] = await Promise.all([
    pool.query(
      `SELECT l.*, COALESCE(l.actor_name, u.name) AS actor_name_resolved
       FROM ttspl_audit_log l
       LEFT JOIN users u ON u.user_id = l.actor_user_id
       WHERE l.ttspl_id = $1
       ORDER BY l.created_at ASC`,
      [ttsplId]
    ),
    pool.query(
      `SELECT h.*, u.name AS changed_by_name
       FROM ttspl_config_history h
       LEFT JOIN users u ON u.user_id = h.changed_by
       WHERE h.ttspl_id = $1
       ORDER BY h.created_at ASC`,
      [ttsplId]
    )
  ]);
  return {
    auditLog: auditRes.rows,
    configHistory: configRes.rows
  };
}

module.exports = { logTtsplEvent, logConfigChange, getTtsplHistory };
