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
async function syncWorkLogForTicketState(db, ticket) {
  if (!ticket?.ticket_id) return;
  await closeOpenWorkLogs(db, ticket.ticket_id);
  if (ticket.status === 'completed') return;
  if (ticket.assigned_user_id) {
    await startWorkLog(db, {
      ticketId: ticket.ticket_id,
      userId: ticket.assigned_user_id,
      stageId: ticket.current_stage_id
    });
  }
}

async function closeOpenWorkLogsForTickets(db, ticketIds) {
  if (!ticketIds?.length) return;
  await db.query(
    `UPDATE work_logs SET end_time = CURRENT_TIMESTAMP
     WHERE ticket_id = ANY($1::int[]) AND end_time IS NULL`,
    [ticketIds]
  );
}

module.exports = {
  closeOpenWorkLogs,
  startWorkLog,
  syncWorkLogForTicketState,
  closeOpenWorkLogsForTickets
};
