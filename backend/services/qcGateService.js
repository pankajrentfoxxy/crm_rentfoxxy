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

/**
 * CT1 (27 Sep 2026): a manager by role (above) OR the floor_pipeline DELETE
 * grant in Roles & Permissions. Not edit — technicians hold floor_pipeline /
 * floor_tickets edit, and manager-only actions must not open to them.
 * Denies on lookup failure.
 */
async function isManagerOrGrant(user, cache) {
  if (isManager(user)) return true;
  if (!user) return false;
  const { userHasRoleOrSection } = require('../middleware/roleOrSection');
  try {
    return await userHasRoleOrSection(user, [], 'floor_pipeline', 'delete', cache);
  } catch (err) {
    console.error('isManagerOrGrant failed:', err.message);
    return false;
  }
}

/** A valid manager override: a manager (by role), and a real reason. */
function overrideFrom(user, reason) {
  const why = String(reason || '').trim();
  if (!why) return null;
  if (!isManager(user)) throw new QcGateError('Only a manager can override a QC check.');
  if (why.length < 10) throw new QcGateError('Give the override reason in a sentence (at least 10 characters).', 400);
  return { kind: 'override', reason: why };
}

/** CT1: as overrideFrom, but a manager by role OR the floor_pipeline delete grant. */
async function overrideFromAsync(user, reason, cache) {
  const why = String(reason || '').trim();
  if (!why) return null;
  if (!(await isManagerOrGrant(user, cache))) throw new QcGateError('Only a manager can override a QC check.');
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
  QcGateError, assertMayPassQc, assertQc2Matched, overrideFrom, overrideFromAsync, isManager, isManagerOrGrant, TECHNICIAN_ROLES,
};
