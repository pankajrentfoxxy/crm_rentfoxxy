const pool = require('../config/db');

const HW_SW_STAGES = new Set([
  'Diagnosis',
  'Assembly & Software',
  'Final Testing',
  'Chip Level Repair',
  'Body & Paint',
]);

function actorFromUser(user = {}) {
  return {
    userId: user.user_id || user.userId || null,
    userName: user.name || user.userName || 'System',
    userRole: user.role || user.userRole || 'system',
  };
}

function normalizeTtspl(ticket = {}) {
  return ticket.ttspl_id || ticket.ttspl || null;
}

async function lookupNames(client, { stageIds = [], teamIds = [], userIds = [] } = {}) {
  const stageMap = new Map();
  const teamMap = new Map();
  const userMap = new Map();

  const sIds = [...new Set(stageIds.filter(Boolean))];
  const tIds = [...new Set(teamIds.filter(Boolean))];
  const uIds = [...new Set(userIds.filter(Boolean))];

  if (sIds.length) {
    const r = await client.query(
      'SELECT stage_id, stage_name FROM stages WHERE stage_id = ANY($1::int[])',
      [sIds]
    );
    r.rows.forEach((row) => stageMap.set(row.stage_id, row.stage_name));
  }
  if (tIds.length) {
    const r = await client.query(
      'SELECT team_id, team_name FROM teams WHERE team_id = ANY($1::int[])',
      [tIds]
    );
    r.rows.forEach((row) => teamMap.set(row.team_id, row.team_name));
  }
  if (uIds.length) {
    const r = await client.query(
      'SELECT user_id, name FROM users WHERE user_id = ANY($1::int[])',
      [uIds]
    );
    r.rows.forEach((row) => userMap.set(row.user_id, row.name));
  }

  return { stageMap, teamMap, userMap };
}

async function buildSnapshot(client, ticket = {}, stageNameOverride = null) {
  if (!ticket || !ticket.ticket_id) return null;
  const { stageMap, teamMap, userMap } = await lookupNames(client, {
    stageIds: [ticket.current_stage_id],
    teamIds: [ticket.assigned_team_id],
    userIds: [ticket.assigned_user_id],
  });
  const stageName = stageNameOverride
    || stageMap.get(ticket.current_stage_id)
    || ticket.stage_name
    || null;
  return {
    ticket_id: ticket.ticket_id,
    ttspl_id: normalizeTtspl(ticket),
    stage_id: ticket.current_stage_id || null,
    stage_name: stageName,
    team_id: ticket.assigned_team_id || null,
    team_name: teamMap.get(ticket.assigned_team_id) || ticket.team_name || null,
    technician_id: ticket.assigned_user_id || null,
    technician_name: userMap.get(ticket.assigned_user_id) || ticket.technician_name || null,
    status: ticket.status || null,
  };
}

function deriveAction({
  source,
  hint,
  before,
  after,
  failureReason,
  explicitAction,
}) {
  if (explicitAction) return explicitAction;

  const from = before?.stage_name || null;
  const to = after?.stage_name || null;

  if (source === 'createTicket') return 'Ticket Created';
  if (source === 'claimTicket') return 'Ticket Claimed';
  if (source === 'startWork' && from) return `${from} Started`;
  if (source === 'assignTicket' && from === 'Floor Manager') return 'Assigned by Floor Manager';
  if (source === 'assignTicket') return 'Technician Assigned';

  if (hint === 'qc1_failed' || (from === 'QC1' && to === 'Assembly & Software')) return 'QC1 Failed';
  if (hint === 'qc2_failed' || (from === 'QC2' && to === 'QC1')) return 'QC2 Failed';
  if (hint === 'qc1_passed' && to === 'QC2') return 'QC1 Passed';
  if (hint === 'qc1_passed_so' && to === 'Dispatch QC') return 'QC1 Passed';
  if (hint === 'qc2_passed' && to === 'Inventory') return 'QC2 Passed';
  if (hint === 'dispatch_qc_passed' && to === 'Inventory') return 'Dispatch QC Passed';
  if (hint === 'dispatch_qc_failed') return 'Dispatch QC Failed';
  if (source === 'submitQC' && failureReason) {
    if (from === 'QC1') return 'QC1 Failed';
    if (from === 'QC2') return 'QC2 Failed';
    if (from === 'Dispatch QC') return 'Dispatch QC Failed';
  }
  if (source === 'submitQC' && to === 'QC2') return 'QC1 Passed';
  if (source === 'submitQC' && to === 'Inventory') return 'QC2 Passed';
  if (source === 'submitQC' && to === 'QC1') return 'QC2 Failed';
  if (source === 'submitQC' && to === 'Assembly & Software') return 'QC1 Failed';

  if (source === 'markDiagnosisFailed') return 'Diagnosis Failed';
  if (source === 'markQcFailed') return 'QC Failed Return to Vendor';

  if (source === 'submitDiagnosis') {
    if (to === 'Body & Paint') return 'Sent to Body & Paint';
    if (to === 'Chip Level Repair') return 'Sent to Chip Level Repair';
    if (to === 'Assembly & Software') return 'Diagnosis Completed';
    if (to === 'Procurement') return 'Sent to Procurement';
    return 'Diagnosis Completed';
  }

  if (source === 'submitChipRepair') return 'Chip Level Repair Completed';

  if (from && to && from !== to) {
    if (HW_SW_STAGES.has(from) && HW_SW_STAGES.has(to)) {
      if (to === 'Assembly & Software') return 'Entered Assembly & Software';
      if (to === 'Final Testing') return 'Entered Final Testing';
      if (to === 'Diagnosis') return 'Entered Diagnosis';
      if (to === 'Body & Paint') return 'Entered Body & Paint';
      if (to === 'Chip Level Repair') return 'Entered Chip Level Repair';
    }
    if (to === 'QC1') return 'QC1 Assigned';
    if (to === 'QC2') return 'QC2 Assigned';
    if (to === 'Inventory') return 'Moved to Inventory';
    return `Stage Changed: ${from} → ${to}`;
  }

  if (before?.technician_id !== after?.technician_id && after?.technician_id) {
    return 'Technician Assigned';
  }
  if (before?.technician_id && !after?.technician_id) {
    return 'Technician Unassigned';
  }
  if (before?.status !== after?.status && after?.status) {
    return `Status Changed: ${before.status || '—'} → ${after.status}`;
  }

  return source ? source.replace(/_/g, ' ') : 'Workflow Updated';
}

async function closeOpenAssignments(client, ticketId, technicianId = null) {
  if (technicianId) {
    await client.query(
      `UPDATE production_assignment_history
          SET unassigned_at = NOW()
        WHERE ticket_id = $1
          AND technician_id = $2
          AND unassigned_at IS NULL`,
      [ticketId, technicianId]
    );
    return;
  }
  await client.query(
    `UPDATE production_assignment_history
        SET unassigned_at = NOW()
      WHERE ticket_id = $1
        AND unassigned_at IS NULL`,
    [ticketId]
  );
}

async function logAssignmentHistory(client, {
  ticketId,
  technicianId,
  technicianName,
  teamId,
  teamName,
  assignedBy,
  assignedByName,
  assignmentType,
  stageName,
  remarks,
  metadata = {},
}) {
  if (!technicianId) {
    await closeOpenAssignments(client, ticketId);
    return;
  }

  await closeOpenAssignments(client, ticketId);

  await client.query(
    `INSERT INTO production_assignment_history (
       ticket_id, technician_id, technician_name, team_id, team_name,
       assigned_by, assigned_by_name, assignment_type, stage_name, remarks, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [
      ticketId,
      technicianId,
      technicianName || null,
      teamId || null,
      teamName || null,
      assignedBy || null,
      assignedByName || null,
      assignmentType || null,
      stageName || null,
      remarks || null,
      JSON.stringify(metadata || {}),
    ]
  );
}

async function logProductionHistory(client, {
  ticketBefore,
  ticketAfter,
  beforeStageName = null,
  afterStageName = null,
  source,
  hint = null,
  action = null,
  remarks = null,
  failureReason = null,
  actor = null,
  metadata = {},
  assignmentType = null,
}) {
  const db = client || pool;
  const before = ticketBefore
    ? await buildSnapshot(db, ticketBefore, beforeStageName)
    : null;
  const after = ticketAfter
    ? await buildSnapshot(db, ticketAfter, afterStageName)
    : null;

  if (!after?.ticket_id && !before?.ticket_id) return null;

  const ticketId = after?.ticket_id || before?.ticket_id;
  const actorInfo = actorFromUser(actor);
  const resolvedAction = deriveAction({
    source,
    hint,
    before,
    after,
    failureReason,
    explicitAction: action,
  });

  const insertRes = await db.query(
    `INSERT INTO production_ticket_history (
       ticket_id, ttspl_id,
       previous_stage, current_stage,
       previous_team, current_team,
       previous_technician_id, current_technician_id,
       previous_technician, current_technician,
       previous_status, current_status,
       action, remarks, failure_reason,
       performed_by, performed_by_name, performed_by_role,
       source, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb
     ) RETURNING id`,
    [
      ticketId,
      after?.ttspl_id || before?.ttspl_id || null,
      before?.stage_name || null,
      after?.stage_name || before?.stage_name || null,
      before?.team_name || null,
      after?.team_name || before?.team_name || null,
      before?.technician_id || null,
      after?.technician_id || null,
      before?.technician_name || null,
      after?.technician_name || null,
      before?.status || null,
      after?.status || before?.status || null,
      resolvedAction,
      remarks || null,
      failureReason || null,
      actorInfo.userId,
      actorInfo.userName,
      actorInfo.userRole,
      source || null,
      JSON.stringify({
        hint,
        returned_stage: after?.stage_name || null,
        returned_technician: after?.technician_name || null,
        ...(metadata || {}),
      }),
    ]
  );

  const techChanged = (before?.technician_id || null) !== (after?.technician_id || null);
  if (techChanged) {
    await logAssignmentHistory(db, {
      ticketId,
      technicianId: after?.technician_id || null,
      technicianName: after?.technician_name || null,
      teamId: after?.team_id || null,
      teamName: after?.team_name || null,
      assignedBy: actorInfo.userId,
      assignedByName: actorInfo.userName,
      assignmentType: assignmentType || source || 'assignment',
      stageName: after?.stage_name || null,
      remarks,
      metadata: { hint, action: resolvedAction, ...(metadata || {}) },
    });
  }

  return insertRes.rows[0]?.id || null;
}

async function logWorkStarted(client, { ticketId, stageId, actor }) {
  const ticketRes = await client.query(
    `SELECT t.*, s.stage_name
       FROM tickets t
       LEFT JOIN stages s ON s.stage_id = t.current_stage_id
      WHERE t.ticket_id = $1`,
    [ticketId]
  );
  if (!ticketRes.rows.length) return null;
  const ticket = ticketRes.rows[0];
  return logProductionHistory(client, {
    ticketBefore: ticket,
    ticketAfter: ticket,
    beforeStageName: ticket.stage_name,
    afterStageName: ticket.stage_name,
    source: 'startWork',
    action: ticket.stage_name ? `${ticket.stage_name} Started` : 'Work Started',
    remarks: 'Technician verified machine and started work timer',
    actor,
    metadata: { stage_id: stageId || ticket.current_stage_id },
  });
}

async function getTicketProductionHistory(ticketId, { limit = 200 } = {}) {
  const [historyRes, assignmentRes] = await Promise.all([
    pool.query(
      `SELECT *
         FROM production_ticket_history
        WHERE ticket_id = $1
        ORDER BY created_at ASC, id ASC
        LIMIT $2`,
      [ticketId, limit]
    ),
    pool.query(
      `SELECT *
         FROM production_assignment_history
        WHERE ticket_id = $1
        ORDER BY assigned_at ASC, id ASC
        LIMIT $2`,
      [ticketId, limit]
    ),
  ]);
  return {
    ticket_id: Number(ticketId),
    history: historyRes.rows,
    assignments: assignmentRes.rows,
  };
}

async function getTtsplProductionHistory(ttsplId, { limit = 300 } = {}) {
  const historyRes = await pool.query(
    `SELECT *
       FROM production_ticket_history
      WHERE ttspl_id = $1
      ORDER BY created_at ASC, id ASC
      LIMIT $2`,
    [ttsplId, limit]
  );
  return { ttspl_id: ttsplId, history: historyRes.rows };
}

module.exports = {
  logProductionHistory,
  logWorkStarted,
  getTicketProductionHistory,
  getTtsplProductionHistory,
  deriveAction,
  buildSnapshot,
};
