/**
 * Production screens — floor board, hold / release (PD11), finish dismantling
 * (PD14). Stage moves go through applyStageMove like every other mover.
 */
const { listBoard } = require('../services/floorBoardService');
const { applyStageMove, StageTransitionRefused } = require('../services/stageTransitionService');
const { transitionAsset } = require('../services/inventoryStateMachine');
const { createReturnedPartInstance } = require('../services/partInventoryService');
const { logProductionHistory } = require('../services/ticketWorkflowHistoryService');
const { closeOpenWorkLogs } = require('../services/ticketWorkLogService');
const { inTransaction } = require('../utils/txHandler');

const fail = (res, status, message) => res.status(status).json({ success: false, message });

exports.board = async (req, res) => {
  try {
    const data = await listBoard(req, {
      stage: req.query.stage || null,
      view: req.query.view || 'queue',
      search: req.query.search || null,
    });
    res.json({ success: true, ...data });
  } catch (e) {
    console.error('floor board:', e);
    res.status(500).json({ success: false, message: 'Could not load the floor board' });
  }
};

async function loadTicket(db, id) {
  return (await db.query(
    `SELECT t.*, s.stage_name FROM tickets t LEFT JOIN stages s ON s.stage_id = t.current_stage_id
      WHERE t.ticket_id = $1 FOR UPDATE OF t`,
    [id]
  )).rows[0];
}

/** POST /tickets/:id/hold { reason } — PD11. */
exports.hold = (req, res) => inTransaction(res, async (db, out) => {
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) return fail(out, 400, 'Say why the laptop is on hold.');
  const t = await loadTicket(db, Number(req.params.id));
  if (!t) return fail(out, 404, 'Ticket not found');
  if (t.stage_name === 'Hold') return fail(out, 409, 'This ticket is already on hold.');
  if (['completed', 'cancelled'].includes(t.status)) return fail(out, 409, `This ticket is ${t.status}.`);
  try {
    await applyStageMove(db, {
      ticket: t,
      toStageName: 'Hold',
      conditionHint: 'hold',
      assignedUserId: null,
      status: 'in_progress',
      extraSets: ['hold_from_stage_name = $1', 'held_at = NOW()', 'held_by = $2', 'hold_reason = $3'],
      extraParams: [t.stage_name, req.user.user_id, reason],
      source: 'floorBoard.hold',
      actor: req.user,
      reason,
    });
  } catch (e) {
    if (e instanceof StageTransitionRefused) return fail(out, e.status || 409, e.message);
    throw e;
  }
  await closeOpenWorkLogs(db, t.ticket_id);
  await db.query(
    `INSERT INTO activities (ticket_id, user_id, action, notes) VALUES ($1, $2, 'put_on_hold', $3)`,
    [t.ticket_id, req.user.user_id, `On hold at ${t.stage_name}: ${reason}`]
  );
  await logProductionHistory(db, {
    ticketBefore: t, ticketAfter: { ...t, stage_name: 'Hold' }, beforeStageName: t.stage_name, afterStageName: 'Hold',
    source: 'floorHold', remarks: reason, actor: req.user,
  });
  return out.json({ success: true, message: `On hold — ${reason}` });
});

/** POST /tickets/:id/release { reason } — PD11: back to the stage it was held at. */
exports.release = (req, res) => inTransaction(res, async (db, out) => {
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) return fail(out, 400, 'Say why the hold is released.');
  const t = await loadTicket(db, Number(req.params.id));
  if (!t) return fail(out, 404, 'Ticket not found');
  if (t.stage_name !== 'Hold') return fail(out, 409, 'This ticket is not on hold.');
  const back = t.hold_from_stage_name || 'Floor Manager';
  try {
    await applyStageMove(db, {
      ticket: t,
      toStageName: back,
      conditionHint: 'hold_released',
      assignedUserId: null,
      status: 'in_progress',
      extraSets: ['hold_from_stage_name = NULL', 'held_at = NULL', 'held_by = NULL', 'hold_reason = NULL'],
      source: 'floorBoard.release',
      actor: req.user,
      reason,
    });
  } catch (e) {
    if (e instanceof StageTransitionRefused) return fail(out, e.status || 409, e.message);
    throw e;
  }
  await db.query(
    `INSERT INTO activities (ticket_id, user_id, action, notes) VALUES ($1, $2, 'hold_released', $3)`,
    [t.ticket_id, req.user.user_id, `Released to ${back}: ${reason}`]
  );
  await logProductionHistory(db, {
    ticketBefore: t, ticketAfter: { ...t, stage_name: back }, beforeStageName: 'Hold', afterStageName: back,
    source: 'floorRelease', remarks: reason, actor: req.user,
  });
  return out.json({ success: true, message: `Released back to ${back}` });
});

/**
 * POST /tickets/:id/dismantle { reason, parts: [{ part_id, condition: 'good'|'defective', quantity }] }
 * PD14: a laptop broken for parts. Harvested parts go into parts stock (good
 * ones sellable, defective ones tracked), the laptop is scrapped and the
 * ticket closes. It never goes into stock (Dismantle -> Inventory did that).
 */
exports.dismantle = (req, res) => inTransaction(res, async (db, out) => {
  const reason = String(req.body?.reason || '').trim();
  const parts = Array.isArray(req.body?.parts) ? req.body.parts : [];
  if (reason.length < 5) return fail(out, 400, 'Say why the laptop is being broken for parts.');
  const t = await loadTicket(db, Number(req.params.id));
  if (!t) return fail(out, 404, 'Ticket not found');
  if (t.stage_name !== 'Dismantle') return fail(out, 409, 'Send the ticket to Dismantle first (a floor manager decision).');
  if (!t.vendor_serial_id) return fail(out, 400, 'This ticket has no laptop record linked.');

  const made = [];
  for (const p of parts) {
    const qty = Math.min(Math.max(Number(p.quantity) || 1, 1), 20);
    for (let i = 0; i < qty; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const unit = await createReturnedPartInstance(db, {
        partId: Number(p.part_id),
        condition: p.condition === 'good' ? 'good' : 'defective',
        ttsplId: t.ttspl_id,
        ticketId: t.ticket_id,
        notes: `Harvested from ${t.ttspl_id} (dismantled): ${reason}`,
        actorUserId: req.user.user_id,
        actorName: req.user.name,
      });
      made.push(unit.prt_id);
    }
  }

  await transitionAsset(db, {
    serialId: t.vendor_serial_id,
    toStatus: 'scrapped',
    reason: `Dismantled for parts: ${reason}`,
    actorUserId: req.user.user_id,
    actorName: req.user.name,
    caller: 'floorBoard.dismantle',
  });
  await db.query(
    `UPDATE vendor_serial_numbers SET qc_status = 'require_for_parts', updated_at = NOW() WHERE serial_id = $1`,
    [t.vendor_serial_id]
  );
  await db.query(
    `UPDATE tickets SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE ticket_id = $1`,
    [t.ticket_id]
  );
  await closeOpenWorkLogs(db, t.ticket_id);
  await db.query(
    `INSERT INTO activities (ticket_id, user_id, action, notes) VALUES ($1, $2, 'dismantled', $3)`,
    [t.ticket_id, req.user.user_id, `Dismantled for parts (${made.length} part unit(s): ${made.join(', ') || 'none'}): ${reason}`]
  );
  await logProductionHistory(db, {
    ticketBefore: t, ticketAfter: { ...t, status: 'completed' }, beforeStageName: 'Dismantle', afterStageName: 'Dismantle',
    source: 'floorDismantle', remarks: reason, actor: req.user,
  });
  return out.json({ success: true, message: `Dismantled — ${made.length} part unit(s) added, laptop scrapped`, parts: made });
});

