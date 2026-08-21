'use strict';

async function instantiateWoSteps(db, woId, woType) {
  const wo = (await db.query(
    'SELECT method FROM support_work_orders WHERE wo_id = $1',
    [woId]
  )).rows[0] || {};
  const method = String(wo.method || 'TECHNICIAN').toUpperCase();
  const lines = (await db.query(
    `SELECT a.line_id, a.serial_id
       FROM support_work_order_assets l
       JOIN support_ticket_assets a ON a.line_id = l.line_id
      WHERE l.wo_id = $1
      ORDER BY a.line_id`,
    [woId]
  )).rows;
  const cfg = (await db.query(
    `SELECT * FROM support_work_order_type_config
      WHERE wo_type = $1
      ORDER BY sort_order, step_code`,
    [woType]
  )).rows;
  for (const row of cfg) {
    const scope = row.method_scope ? String(row.method_scope).toUpperCase() : null;
    if (scope && scope !== method) continue;
    if (row.per_asset && lines.length) {
      for (let i = 0; i < lines.length; i += 1) {
        await db.query(
          `INSERT INTO support_work_order_steps (
             wo_id, step_code, step_label, step_kind, is_mandatory, min_count, sort_order,
             line_id, serial_id, asset_seq
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (wo_id, step_code, (COALESCE(line_id, 0))) DO NOTHING`,
          [
            woId, row.step_code, row.step_label, row.step_kind, row.is_mandatory,
            row.min_count, row.sort_order, lines[i].line_id, lines[i].serial_id, i + 1,
          ]
        );
      }
    } else {
      await db.query(
        `INSERT INTO support_work_order_steps (
           wo_id, step_code, step_label, step_kind, is_mandatory, min_count, sort_order
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (wo_id, step_code, (COALESCE(line_id, 0))) DO NOTHING`,
        [woId, row.step_code, row.step_label, row.step_kind, row.is_mandatory, row.min_count, row.sort_order]
      );
    }
  }
}

async function markStepDone(db, woId, stepCode, lineId) {
  await db.query(
    `UPDATE support_work_order_steps
        SET status = 'DONE', completed_at = NOW()
      WHERE wo_id = $1 AND step_code = $2
        AND ($3::int IS NULL OR line_id IS NOT DISTINCT FROM $3)`,
    [woId, stepCode, lineId || null]
  );
}

module.exports = { instantiateWoSteps, markStepDone };
