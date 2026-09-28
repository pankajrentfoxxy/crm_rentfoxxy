/**
 * Production safety A — who may pass QC, and what QC2 needs (PD2, PD3).
 *
 * PD2: the inspector is not the person who repaired the laptop, and technician
 * roles do not pass QC at all (one floor grant used to let a technician pass
 * their own ticket through QC1 and QC2).
 * PD3: QC2 passes only on a configuration check that matched, recorded on the
 * server by the capture script (the browser used to be the only gate). A
 * manager can override either with a reason, which is logged.
 */
const pool = require('../config/db');

const TECHNICIAN_ROLES = new Set(['technician', 'team_member', 'team_lead']);
const MANAGER_ROLES = new Set(['manager', 'admin', 'super_admin', 'floor_manager']);
// Stages where a laptop is actually worked on. Triage / routing moves by a
// floor manager are not "repairing it".
const REPAIR_STAGES = ['Chip Level Repair', 'Body & Paint', 'Assembly & Software', 'Final Testing'];

class QcGateError extends Error {
  constructor(message, status = 403, code = 'QC_GATE') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const isManager = (user) => user?.is_superadmin === true || MANAGER_ROLES.has(String(user?.role || '').toLowerCase());

/** A valid manager override: a manager, and a real reason. */
function overrideFrom(user, reason) {
  const why = String(reason || '').trim();
  if (!why) return null;
  if (!isManager(user)) throw new QcGateError('Only a manager can override a QC check.');
  if (why.length < 10) throw new QcGateError('Give the override reason in a sentence (at least 10 characters).', 400);
  return { kind: 'override', reason: why };
}

/** PD2 — refuses a technician, or anyone who repaired this laptop. */
async function assertMayPassQc(db, { ticketId, user, stageName }) {
  const role = String(user?.role || '').toLowerCase();
  if (TECHNICIAN_ROLES.has(role)) {
    throw new QcGateError(`Technicians can't pass ${stageName}. A QC inspector or floor manager does.`);
  }
  const worked = (await (db || pool).query(
    `SELECT 1 FROM production_ticket_history
      WHERE ticket_id = $1 AND performed_by = $2 AND previous_stage = ANY($3::text[])
      LIMIT 1`,
    [ticketId, user?.user_id || null, REPAIR_STAGES]
  )).rows[0];
  if (worked) {
    throw new QcGateError(`You worked on this laptop, so someone else must pass its ${stageName}.`);
  }
}

/** PD3 — the latest QC2 configuration check for this ticket must have matched. */
async function assertQc2Matched(db, { ticketId }) {
  const t = (await (db || pool).query(
    `SELECT status, matched_at FROM qc2_capture_tokens WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [ticketId]
  )).rows[0];
  if (!t) throw new QcGateError('Run the QC2 configuration check on the laptop first.', 409, 'QC2_NOT_CHECKED');
  if (t.status !== 'matched') {
    throw new QcGateError(
      t.status === 'failed'
        ? 'The QC2 configuration check did not match the order. Fix the laptop or send it back.'
        : 'The QC2 configuration check has not finished on the laptop yet.',
      409,
      'QC2_NOT_MATCHED'
    );
  }
}

module.exports = {
  QcGateError, assertMayPassQc, assertQc2Matched, overrideFrom, isManager, TECHNICIAN_ROLES,
};
