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


// ── Finish a work stage (Chip, Body & Paint, Assembly, Final Testing) ──────
//
// POST /tickets/:id/stage-work { outcome, checklist, notes, reason, assign_to }
//
// One server action per stage outcome, in one transaction: the checklist is
// checked here against the stage's own list (it was only checked in the
// browser, and Body & Paint had no way out at all), then the laptop moves.
// "done" needs every item ticked and no part still waiting to be fitted; any
// other outcome needs a reason for the next person.
const floorChecklists = require('../services/floorChecklists');
const { isManager } = require('../services/qcGateService');
const { assertTicketNotPartBlocked } = require('../services/ticketPartBlockService');
const { syncWorkLogForTicketState } = require('../services/ticketWorkLogService');
const { fetchOrderedMemberIds } = require('../services/qcRoundRobinService');

const STAGE_OUTCOMES = {
  'Chip Level Repair': {
    done: { to: 'Diagnosis', condition: 'repair_completed', label: 'Repaired — back to Diagnosis for a re-check' },
    cannot_fix: { to: 'Floor Manager', condition: 'reentry', label: "Can't repair — floor manager to decide", needsReason: true },
  },
  'Body & Paint': {
    done: { to: 'Diagnosis', condition: 'repair_completed', label: 'Body work done — back to Diagnosis for a re-check' },
    cannot_fix: { to: 'Floor Manager', condition: 'reentry', label: "Can't fix the body — floor manager to decide", needsReason: true },
  },
  'Assembly & Software': {
    done: { to: 'Final Testing', condition: null, label: 'Assembled — go to final testing', keep: true },
    needs_chip: { to: 'Chip Level Repair', condition: 'chip_required', label: 'Needs chip-level repair', needsReason: true },
    needs_body: { to: 'Body & Paint', condition: 'body_required', label: 'Needs body / paint work', needsReason: true },
  },
  'Final Testing': {
    done: { to: 'QC1', condition: null, label: 'All tests pass — send to QC1' },
    failed: { to: 'Assembly & Software', condition: 'final_test_failed', label: 'A test failed — back to assembly', needsReason: true, keep: true },
  },
};
exports.STAGE_OUTCOMES = STAGE_OUTCOMES;

exports.completeStageWork = (req, res) => inTransaction(res, async (db, out) => {
  const t = await loadTicket(db, Number(req.params.id));
  if (!t) return fail(out, 404, 'Ticket not found');
  if (['completed', 'cancelled'].includes(t.status)) return fail(out, 409, `This ticket is ${t.status}.`);
  const outcomes = STAGE_OUTCOMES[t.stage_name];
  if (!outcomes) return fail(out, 409, `There is no work form to finish at ${t.stage_name || 'this stage'}.`);
  const outcome = outcomes[req.body?.outcome];
  if (!outcome) return fail(out, 400, 'Choose what happens next.');
  if (Number(t.assigned_user_id) !== Number(req.user.user_id) && !isManager(req.user)) {
    return fail(out, 403, 'Only the technician it is assigned to (or a floor manager) finishes this stage.');
  }

  const items = await floorChecklists.stageChecklistItems(db, t.stage_name);
  const checklist = req.body?.checklist && typeof req.body.checklist === 'object' ? req.body.checklist : {};
  const notes = String(req.body?.notes || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (req.body.outcome === 'done') {
    const open = items.filter((it) => checklist[it.key] !== true);
    if (open.length) return fail(out, 400, `Tick every item first — ${open.length} still open.`);
    try { await assertTicketNotPartBlocked(db, t.ticket_id); } catch (e) { return fail(out, e.status || 409, e.message); }
  }
  if (outcome.needsReason && reason.length < 5) return fail(out, 400, 'Say what is wrong (at least 5 characters).');

  // Who takes it next. Final Testing → QC1: an inspector from the QC1 team who
  // is not the person who repaired it (PD2); nobody named = the QC1 queue.
  let assignee = outcome.keep ? 'keep' : null;
  if (t.stage_name === 'Final Testing' && req.body.outcome === 'done' && req.body.assign_to) {
    const pick = Number(req.body.assign_to);
    const qc1 = (await db.query(`SELECT team_id FROM stages WHERE stage_name = 'QC1' LIMIT 1`)).rows[0];
    const members = qc1?.team_id ? await fetchOrderedMemberIds(db, qc1.team_id) : [];
    if (!members.includes(pick)) return fail(out, 400, 'That person is not on the QC1 team.');
    const worked = (await db.query(
      `SELECT 1 FROM production_ticket_history WHERE ticket_id = $1 AND performed_by = $2
          AND previous_stage = ANY($3::text[]) LIMIT 1`,
      [t.ticket_id, pick, ['Chip Level Repair', 'Body & Paint', 'Assembly & Software', 'Final Testing']]
    )).rows[0];
    if (worked || pick === Number(req.user.user_id)) return fail(out, 400, 'Pick an inspector who did not work on this laptop.');
    assignee = pick;
  }

  // Keep the checklist (same table the old task panel used).
  await db.query(
    `INSERT INTO ticket_checklist_progress (ticket_id, stage_id, checklist_data, completed_by, completed_at)
     VALUES ($1, $2, $3::jsonb, $4, NOW())`,
    [t.ticket_id, t.current_stage_id, JSON.stringify({ ...checklist, _outcome: req.body.outcome, _notes: notes || undefined }), req.user.user_id]
  );
  if (t.stage_name === 'Chip Level Repair') {
    const done = items.filter((it) => checklist[it.key] === true).map((it) => it.key);
    const upd = await db.query(
      `UPDATE chip_level_repairs SET status = $2, resolved_checks = $3, issue_notes = COALESCE($4, issue_notes),
              updated_by = $5, updated_at = NOW() WHERE ticket_id = $1 RETURNING repair_id`,
      [t.ticket_id, req.body.outcome === 'done' ? 'completed' : 'cannot_fix', done, notes || reason || null, req.user.user_id]
    );
    if (!upd.rows.length) {
      await db.query(
        `INSERT INTO chip_level_repairs (ticket_id, created_by, updated_by, status, issues, issue_notes, parts_required, resolved_checks)
         VALUES ($1, $2, $2, $3, $4, $5, false, $6)`,
        [t.ticket_id, req.user.user_id, req.body.outcome === 'done' ? 'completed' : 'cannot_fix',
          Array.isArray(req.body.issues) ? req.body.issues.map(String) : [], notes || reason || null, done]
      );
    }
  }

  const why = [reason, notes].filter(Boolean).join(' — ') || null;
  let moved;
  try {
    moved = await applyStageMove(db, {
      ticket: t,
      toStageName: outcome.to,
      conditionHint: outcome.condition,
      assignedUserId: assignee,
      status: 'in_progress',
      extraSets: outcome.to === 'Floor Manager' ? [`priority = 'high'`] : [],
      source: 'floorBoard.completeStageWork',
      actor: req.user,
      reason: why,
    });
  } catch (e) {
    if (e instanceof StageTransitionRefused) return fail(out, e.status || 409, e.message);
    throw e;
  }
  await syncWorkLogForTicketState(db, moved.ticket);
  await db.query(
    `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes) VALUES ($1, $2, $3, 'stage_work', $4)`,
    [t.ticket_id, moved.toStage.stage_id, req.user.user_id, `${t.stage_name}: ${outcome.label}${why ? ` | ${why}` : ''}`.slice(0, 2000)]
  );
  await logProductionHistory(db, {
    ticketBefore: t,
    ticketAfter: moved.ticket,
    beforeStageName: t.stage_name,
    afterStageName: outcome.to,
    source: 'completeStageWork',
    remarks: why,
    failureReason: outcome.needsReason ? reason : null,
    actor: req.user,
    metadata: { outcome: req.body.outcome },
  });
  out.json({ success: true, next_stage: outcome.to });
});
