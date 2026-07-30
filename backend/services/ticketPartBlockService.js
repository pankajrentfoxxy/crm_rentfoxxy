/**
 * Part-request stage blocking (Phase 16).
 * A ticket stays blocked from stage progression while any blocking part request
 * is pending approval or approved-but-not-yet attached.
 */

const BLOCKING_STATUSES = ['pending', 'escalated', 'ordered', 'received', 'approved'];

async function getTicketPartBlockStatus(db, ticketId) {
  const r = await db.query(
    `SELECT pr.request_id, pr.request_number, pr.status, pr.part_name, pr.blocks_stage,
            pr.old_part_expected
       FROM ticket_part_blocks tpb
       JOIN part_requests pr ON pr.request_id = tpb.request_id
      WHERE tpb.ticket_id = $1
        AND tpb.is_active = true
        AND COALESCE(pr.blocks_stage, true) = true
        AND pr.status = ANY($2::text[])`,
    [ticketId, BLOCKING_STATUSES]
  );

  if (!r.rows.length) {
    return { blocked: false, count: 0, awaitingApproval: [], awaitingAttach: [] };
  }

  const awaitingApproval = r.rows.filter((row) =>
    ['pending', 'escalated', 'ordered', 'received'].includes(row.status)
  );
  const awaitingAttach = r.rows.filter((row) => row.status === 'approved');

  let message;
  if (awaitingApproval.length && awaitingAttach.length) {
    message = 'Part requests are pending warehouse approval and approved parts must be attached before this ticket can move to the next stage.';
  } else if (awaitingApproval.length) {
    const names = awaitingApproval.map((row) => row.part_name || row.request_number).join(', ');
    message = `Part request(s) awaiting warehouse approval (${names}). The team cannot progress this ticket until approved.`;
  } else {
    const names = awaitingAttach.map((row) => row.part_name || row.request_number).join(', ');
    message = `Approved part(s) must be attached${awaitingAttach.some((row) => row.old_part_expected === 'yes') ? ' and the old part returned' : ''} before moving to the next stage (${names}).`;
  }

  return {
    blocked: true,
    count: r.rows.length,
    awaitingApproval,
    awaitingAttach,
    message,
  };
}

async function assertTicketNotPartBlocked(db, ticketId) {
  const status = await getTicketPartBlockStatus(db, ticketId);
  if (status.blocked) {
    throw Object.assign(new Error(status.message), { status: 409, partBlock: status });
  }
  return status;
}

module.exports = {
  BLOCKING_STATUSES,
  getTicketPartBlockStatus,
  assertTicketNotPartBlocked,
};
