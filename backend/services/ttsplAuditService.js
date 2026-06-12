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
  const costRes = await pool.query(
    `SELECT
       COALESCE(SUM(tp.quantity_used * COALESCE(tp.unit_cost, p.cost, 0)), 0)::numeric AS parts_cost,
       COALESCE((
         SELECT MAX(vpd.rate)
         FROM tickets t2
         JOIN vendor_serial_numbers vsn2 ON vsn2.serial_id = t2.vendor_serial_id
         LEFT JOIN vendor_product_details vpd ON vpd.po_id = vsn2.po_id
         WHERE t2.ttspl_id = $1
       ), 0)::numeric AS base_cost
     FROM tickets t
     LEFT JOIN ticket_parts tp ON tp.ticket_id = t.ticket_id
     LEFT JOIN parts p ON p.part_id = tp.part_id
     WHERE t.ttspl_id = $1`,
    [ttsplId]
  );

  const costRow = costRes.rows[0] || { parts_cost: 0, base_cost: 0 };
  const partsCost = parseFloat(costRow.parts_cost) || 0;
  const baseCost = parseFloat(costRow.base_cost) || 0;

  return {
    auditLog: auditRes.rows,
    configHistory: configRes.rows,
    costSummary: {
      parts_cost: partsCost,
      base_cost: baseCost,
      total_cost: partsCost + baseCost
    }
  };
}

module.exports = { logTtsplEvent, logConfigChange, getTtsplHistory };
