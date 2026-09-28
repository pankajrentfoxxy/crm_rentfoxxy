/**
 * Part 5.3 (findings R1, R2, R3) — the single authority for a ticket's stage.
 *
 * Before this file there were eight independent stage movers and exactly one of
 * them consulted stage_transition_rules:
 *
 *   ticketPhase2Controller.moveToStage          (consulted the rules, then
 *                                                bypassed them for admin,
 *                                                floor_manager, manager and
 *                                                super_admin — which is every
 *                                                role that moves tickets)
 *   qcController.submitQC
 *   ticketController.updateTicketStage
 *   ticketController.bulkMoveStage
 *   chipLevelController.submitChipRepair
 *   diagnosisController.submitDiagnosis
 *   productionAssetService.receiveIntoInventory
 *   dispatchQcCaptureService.applyDispatchQcFailure
 *
 * The audit counted five. It is eight.
 *
 * Every one of them now goes through applyStageMove(). The rules table is the
 * map, and there is no role that is exempt from the map — if a transition is
 * legitimate it is a row in stage_transition_rules (migration 271 transcribed
 * the ones the code was already performing). That is the whole point of R1: a
 * rule everybody can skip is documentation, not a rule.
 *
 * `extraSets` lets a caller write its own columns in the SAME update — QC fail
 * counters, hold reasons, highlight flags — so collapsing the movers did not
 * mean flattening what each of them legitimately records.
 */
const pool = require('../config/db');
const { recordEvent, ENTITY } = require('./eventService');

class StageTransitionRefused extends Error {
  constructor({ from, to, ticketId, reason }) {
    super(reason || `Transition from "${from || '(none)'}" to "${to}" is not allowed`);
    this.name = 'StageTransitionRefused';
    this.status = 400;
    this.from = from;
    this.to = to;
    this.ticketId = ticketId;
  }
}

/** Resolve a stage row by exact name. Never ILIKE — '%Hold%' matching nothing
 *  silently is precisely the bug Part 5.4 is fixing. */
async function getStageByName(db, stageName) {
  const { rows } = await (db || pool).query(
    `SELECT stage_id, stage_name, stage_order, team_id, stage_category
       FROM stages
      WHERE stage_name = $1
      ORDER BY (team_id IS NULL), stage_id ASC
      LIMIT 1`,
    [stageName]
  );
  return rows[0] || null;
}

async function getStageById(db, stageId) {
  if (stageId == null) return null;
  const { rows } = await (db || pool).query(
    `SELECT stage_id, stage_name, stage_order, team_id, stage_category
       FROM stages WHERE stage_id = $1`,
    [stageId]
  );
  return rows[0] || null;
}

/**
 * Is this transition in the map?
 *
 * A move to the stage the ticket is already on is a no-op, not a transition,
 * and is allowed — several callers re-save a ticket without moving it.
 * A ticket with no current stage at all (a fresh row) can enter anywhere.
 */
async function checkTransition(db, { fromStageName, toStageName, conditionHint = null }) {
  if (!toStageName) return { ok: false, message: 'A target stage is required' };
  if (!fromStageName) return { ok: true, rule: null };
  if (fromStageName === toStageName) return { ok: true, rule: null };

  const { rows } = await (db || pool).query(
    `SELECT * FROM stage_transition_rules
      WHERE from_stage_name = $1 AND to_stage_name = $2
      LIMIT 1`,
    [fromStageName, toStageName]
  );
  if (!rows.length) {
    return {
      ok: false,
      message: `Transition from "${fromStageName}" to "${toStageName}" is not allowed`,
    };
  }
  const rule = rows[0];
  if (conditionHint && rule.condition && rule.condition !== conditionHint) {
    return { ok: false, message: `Transition requires condition "${rule.condition}"` };
  }
  return { ok: true, rule };
}

/** Throwing form, for callers that want to fail before doing their own work. */
async function assertTransitionAllowed(db, { fromStageName, toStageName, conditionHint = null, ticketId = null }) {
  const verdict = await checkTransition(db, { fromStageName, toStageName, conditionHint });
  if (!verdict.ok) {
    throw new StageTransitionRefused({
      from: fromStageName, to: toStageName, ticketId, reason: verdict.message,
    });
  }
  return verdict.rule;
}

/**
 * Move one ticket, or refuse.
 *
 * `ticket` may be a full row or just { ticket_id }. When only an id is given the
 * row is read here, so a caller cannot move a ticket on a stale copy of it.
 *
 * Returns the updated ticket row plus the from/to stage rows, so callers keep
 * the before/after pair they need for their own history writes.
 */
async function applyStageMove(db, {
  ticket,
  toStageName,
  conditionHint = null,
  // null   → clear the assignee (the default: a new stage means a new owner)
  // number → assign this user
  // 'keep' → the same technician continues
  assignedUserId = null,
  status = null,              // 'in_progress' | 'completed' | null (leave alone)
  extraSets = [],             // e.g. ['qc2_failed_at = NOW()']
  extraParams = [],           // parameters for $N placeholders inside extraSets
  source,                     // which code path asked — recorded on the event
  actor = null,               // req.user, or an { actor_type, ... } shape
  correlationId = null,
  reason = null,
  // Production safety A: how a QC pass / stock entry was earned.
  //   { kind: 'checklist' }         QC passed through the saved checklist
  //   { kind: 'override', reason }  a manager passed it without one (logged)
  //   { kind: 'receive' }           serial-verified receive into a carret slot
  qcGate = null,
}) {
  const client = db || pool;
  if (!source) throw new Error('applyStageMove requires a source');

  const ticketId = Number(ticket?.ticket_id ?? ticket);
  if (!Number.isFinite(ticketId)) throw new Error('applyStageMove requires a ticket');

  const { rows: tRows } = await client.query(
    `SELECT * FROM tickets WHERE ticket_id = $1`,
    [ticketId]
  );
  const current = tRows[0];
  if (!current) {
    const err = new Error('Ticket not found');
    err.status = 404;
    throw err;
  }

  const fromStage = await getStageById(client, current.current_stage_id);
  const toStage = await getStageByName(client, toStageName);
  if (!toStage) {
    const err = new Error(`Target stage "${toStageName}" is not configured`);
    err.status = 400;
    throw err;
  }

  await assertTransitionAllowed(client, {
    fromStageName: fromStage?.stage_name || null,
    toStageName: toStage.stage_name,
    conditionHint,
    ticketId,
  });

  assertQcGate({
    from: fromStage?.stage_name || null, to: toStage.stage_name, qcGate, ticketId,
  });
  await assertStageWorkDone(client, {
    ticketId, from: fromStage, to: toStage.stage_name, actor, reason,
  });

  const sets = ['current_stage_id = $2', 'assigned_team_id = $3', 'updated_at = NOW()'];
  const params = [ticketId, toStage.stage_id, toStage.team_id];
  let p = 4;

  if (assignedUserId === 'keep') {
    // leave assigned_user_id alone
  } else if (assignedUserId == null) {
    sets.push('assigned_user_id = NULL');
  } else {
    sets.push(`assigned_user_id = $${p}`);
    params.push(Number(assignedUserId));
    p += 1;
  }

  if (status === 'completed') {
    sets.push(`status = 'completed'`, 'completed_at = CURRENT_TIMESTAMP');
  } else if (status === 'in_progress') {
    sets.push(`status = 'in_progress'`, 'completed_at = NULL');
  }

  // Caller columns. Their $N placeholders are renumbered onto the end of this
  // statement's parameter list so callers can write them positionally.
  for (const frag of extraSets) {
    sets.push(String(frag).replace(/\$(\d+)/g, (_m, n) => `$${p + Number(n) - 1}`));
  }
  params.push(...extraParams);

  const { rows: updated } = await client.query(
    `UPDATE tickets SET ${sets.join(', ')} WHERE ticket_id = $1 RETURNING *`,
    params
  );

  await recordEvent(client, {
    entityType: ENTITY.TICKET,
    entityId: ticketId,
    entityRef: current.ttspl_id || null,
    eventType: 'ticket_stage_changed',
    fromState: fromStage?.stage_name || null,
    toState: toStage.stage_name,
    payload: {
      condition: conditionHint,
      reason,
      serial_number: current.serial_number || null,
      ttspl_id: current.ttspl_id || null,
    },
    correlationId,
    source,
    actor,
  });

  return { ticket: updated[0], fromStage, toStage };
}

/**
 * Production safety A (Q1, Q2, Q3, F3, F4) — enforced here because every
 * mover (move-stage, next-stage, bulk-move, assign, QC submit, receive) comes
 * through applyStageMove, so no side door can skip it:
 *   - passing QC1 / QC2 needs the saved QC checklist, or a manager's override
 *     with a reason (the pass buttons used to skip both);
 *   - a laptop reaches Inventory only by the serial-scan receive into a carret
 *     slot (or as a sales-order laptop passing Dispatch QC). "Move to
 *     Inventory", bulk-move and Dismantle -> Inventory put laptops in stock
 *     unchecked.
 */
const QC_PASS_MOVES = new Set(['QC1→QC2', 'QC1→Dispatch QC', 'QC2→Pending Inventory', 'QC2→Inventory']);
function assertQcGate({ from, to, qcGate, ticketId }) {
  const kind = qcGate?.kind || null;
  const refuse = (why) => {
    const err = new StageTransitionRefused({ from, to, ticketId, reason: why });
    err.status = 409;
    err.code = 'QC_GATE';
    throw err;
  };
  if (QC_PASS_MOVES.has(`${from}→${to}`) || to === 'Pending Inventory') {
    if (kind === 'checklist') return;
    if (kind === 'override' && String(qcGate.reason || '').trim().length >= 10) return;
    refuse(`${from || 'This stage'} is passed through the QC checklist (QC tab), not by moving the ticket. A manager can override with a reason.`);
  }
  if (to === 'Inventory' && from !== 'Dispatch QC' && kind !== 'receive') {
    refuse('A laptop goes into stock only by scanning its serial into a carret slot from Pending Inventory.');
  }
}

/**
 * Production: Assembly and Final Testing are finished through their checklist.
 * Moving forward out of them (to Final Testing / QC1) needs that stage's
 * checklist completed since the laptop last entered the stage — the "tick
 * every item" rule used to live only in the browser, so move-stage skipped it.
 * A floor manager can still move it with a written reason (logged on the event).
 */
const CHECKLIST_EXITS = new Set(['Assembly & Software→Final Testing', 'Final Testing→QC1']);
async function assertStageWorkDone(db, { ticketId, from, to, actor, reason }) {
  if (!from || !CHECKLIST_EXITS.has(`${from.stage_name}→${to}`)) return;
  const { isManager } = require('./qcGateService');
  if (actor && isManager(actor) && String(reason || '').trim().length >= 10) return;
  const { rows } = await db.query(
    `SELECT 1 FROM ticket_checklist_progress p
      WHERE p.ticket_id = $1 AND p.stage_id = $2 AND p.completed_at IS NOT NULL
        AND p.completed_at >= COALESCE((
              SELECT MAX(e.occurred_at) FROM events e
               WHERE e.entity_type = 'ticket' AND e.entity_id = $1::text
                 AND e.event_type = 'ticket_stage_changed' AND e.to_state = $3), 'epoch'::timestamptz)
      LIMIT 1`,
    [ticketId, from.stage_id, from.stage_name]
  );
  if (!rows.length) {
    const err = new StageTransitionRefused({
      from: from.stage_name, to, ticketId,
      reason: `Finish the ${from.stage_name} checklist first (Work tab). A floor manager can move it with a reason.`,
    });
    err.status = 409;
    err.code = 'STAGE_CHECKLIST';
    throw err;
  }
}

module.exports = {
  assertStageWorkDone,
  assertQcGate,
  QC_PASS_MOVES,
  StageTransitionRefused,
  getStageByName,
  getStageById,
  checkTransition,
  assertTransitionAllowed,
  applyStageMove,
};
