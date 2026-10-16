/**
 * What the repair technician needs before starting (16 Oct 2026): why the
 * laptop was sent to this stage, and the faults Diagnosis found. Shown on the
 * Chip Level Repair and Body & Paint work forms.
 */
const floorChecklists = require('./floorChecklists');

const REPAIR_STAGES = ['Chip Level Repair', 'Body & Paint'];

async function getRepairBrief(db, ticket) {
  if (!ticket || !REPAIR_STAGES.includes(ticket.stage_name)) return null;
  const id = ticket.ticket_id;

  // The move that brought it here (Diagnosis, Assembly "needs chip", …).
  const sentRes = await db.query(
    `SELECT h.previous_stage, h.remarks, h.failure_reason, COALESCE(u.name, h.performed_by_name) AS performed_by_name,
            h.created_at, h.source
       FROM production_ticket_history h LEFT JOIN users u ON u.user_id = h.performed_by
      WHERE h.ticket_id = $1 AND h.current_stage = $2 AND COALESCE(h.previous_stage, '') <> $2
      ORDER BY h.created_at DESC LIMIT 1`,
    [id, ticket.stage_name]
  );
  const sent = sentRes.rows[0] || null;

  const dxRes = await db.query(
    `SELECT answers, outcome, remarks, diagnosed_at, updated_at FROM diagnosis_results WHERE ticket_id = $1`,
    [id]
  );
  const dx = dxRes.rows[0] || null;
  const answers = dx?.answers && typeof dx.answers === 'object' ? dx.answers : {};
  const faults = floorChecklists.badAnswers(floorChecklists.DIAGNOSIS_ITEMS, answers).map((it) => ({
    key: it.key,
    q: it.q,
    answer: (it.options.find((o) => o.value === answers[it.key]) || {}).label || answers[it.key],
    section: (floorChecklists.DIAGNOSIS_SECTIONS.find((s) => s.key === it.section) || {}).title || null,
  }));
  const outcome = floorChecklists.DIAGNOSIS_OUTCOMES.find((o) => o.value === dx?.outcome);

  // Diagnosis's own note when it sent it here; otherwise the reason given by
  // whoever did (e.g. Assembly: "needs chip-level repair — …").
  const fromDiagnosis = sent?.source === 'submitDiagnosis';
  const reason = fromDiagnosis
    ? (dx?.remarks || null)
    : (sent?.failure_reason || sent?.remarks || null);

  return {
    stage: ticket.stage_name,
    from_stage: sent?.previous_stage || null,
    sent_by: sent?.performed_by_name || null,
    sent_at: sent?.created_at || null,
    reason,
    diagnosis: dx ? {
      outcome_label: outcome?.label || null,
      remarks: dx.remarks || null,
      at: dx.diagnosed_at || dx.updated_at || null,
      faults,
    } : null,
  };
}

module.exports = { REPAIR_STAGES, getRepairBrief };
