/**
 * Tracks per-technician work segments on tickets (work_logs).
 * On assign / claim / stage change: close open segments, then open one for the current assignee (if any).
 */

async function closeOpenWorkLogs(db, ticketId) {
  await db.query(
    `UPDATE work_logs SET end_time = CURRENT_TIMESTAMP WHERE ticket_id = $1 AND end_time IS NULL`,
    [ticketId]
  );
}

async function startWorkLog(db, { ticketId, userId, stageId }) {
  if (!userId) return;
  await db.query(
    `INSERT INTO work_logs (ticket_id, user_id, stage_id, start_time)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
    [ticketId, userId, stageId || null]
  );
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ ticket_id: number, status?: string, assigned_user_id: number|null, current_stage_id: number|null }} ticket
 */
// Closes any open work segment for the ticket. We intentionally do NOT auto-open
// a new segment here: a newly-assigned worker (or QC inspector after a handoff)
// must explicitly verify the machine and start their own timer (scan-to-start).
// Same-technician stage continuity is handled by the caller (moveToStage).
async function syncWorkLogForTicketState(db, ticket) {
  if (!ticket?.ticket_id) return;
  await closeOpenWorkLogs(db, ticket.ticket_id);
}

async function closeOpenWorkLogsForTickets(db, ticketIds) {
  if (!ticketIds?.length) return;
  await db.query(
    `UPDATE work_logs SET end_time = CURRENT_TIMESTAMP
     WHERE ticket_id = ANY($1::int[]) AND end_time IS NULL`,
    [ticketIds]
  );
}

/**
 * 29 Sep 2026: the technician a ticket is assigned to finishes a stage only
 * after "Start work" — the scan of TTSPL + serial that opens their timer. A
 * floor manager finishing it for them is the logged exception.
 * @returns {string|null} why not, or null when fine
 */
async function workNotStartedReason(db, ticket, user) {
  if (!ticket?.ticket_id || !user?.user_id) return null;
  if (Number(ticket.assigned_user_id) !== Number(user.user_id)) return null;
  const r = await db.query(
    `SELECT 1 FROM work_logs WHERE ticket_id = $1 AND user_id = $2 AND end_time IS NULL LIMIT 1`,
    [ticket.ticket_id, user.user_id]
  );
  return r.rows.length ? null : 'Start work first — scan the TTSPL and serial to start the timer, then finish the stage.';
}

module.exports = {
  workNotStartedReason,
  closeOpenWorkLogs,
  startWorkLog,
  syncWorkLogForTicketState,
  closeOpenWorkLogsForTickets
};
