'use strict';

async function instantiateWoSteps(db, woId, woType) {
  await db.query(
    `INSERT INTO support_work_order_steps (
       wo_id, step_code, step_label, step_kind, is_mandatory, min_count, sort_order
     )
     SELECT $1, step_code, step_label, step_kind, is_mandatory, min_count, sort_order
       FROM support_work_order_type_config
      WHERE wo_type = $2
     ON CONFLICT (wo_id, step_code) DO NOTHING`,
    [woId, woType]
  );
}

async function markStepDone(db, woId, stepCode) {
  await db.query(
    `UPDATE support_work_order_steps
        SET status = 'DONE', completed_at = NOW()
      WHERE wo_id = $1 AND step_code = $2`,
    [woId, stepCode]
  );
}

module.exports = { instantiateWoSteps, markStepDone };
