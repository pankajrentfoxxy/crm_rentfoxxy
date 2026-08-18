'use strict';

const pool = require('../config/db');
const engine = require('../services/supportAssignmentEngine');
const { assignWorkOrder } = require('../services/supportWorkOrderService');
const { logEvent } = require('../services/supportTicketStateService');

function bad(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error('supportV2 attendance:', e);
  return res.status(status).json({ success: false, message: e.message });
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function reassignPriorityJobs(client, fromUserId, date, actorId) {
  const jobs = (await client.query(
    `SELECT w.wo_id, w.ticket_id, w.wo_type, COALESCE(w.priority, t.priority) AS priority
       FROM support_work_orders w
       JOIN support_tickets_v2 t ON t.ticket_id = w.ticket_id
      WHERE w.assigned_to = $1
        AND w.status NOT IN ('COMPLETED','CANCELLED','FAILED')
        AND COALESCE(w.priority, t.priority) IN (1, 2)`,
    [fromUserId]
  )).rows;

  const techs = (await engine.loadTechnicians(client, { date }))
    .filter((t) => Number(t.user_id) !== Number(fromUserId));
  const moved = [];
  const failed = [];

  for (const job of jobs) {
    const { pick, considered } = engine.pickAssignee(techs, { ticket: { priority: job.priority } });
    if (!pick) {
      await assignWorkOrder(client, job.wo_id, { userId: null }, actorId);
      await logEvent(client, {
        ticketId: job.ticket_id,
        woId: job.wo_id,
        eventType: 'REASSIGN_FAILED',
        actorId,
        actorKind: 'SYSTEM',
        summary: 'P1/P2 job unassigned — no one with bandwidth after absence',
        detail: { from: fromUserId, considered },
      });
      failed.push({ wo_id: job.wo_id, reason: 'no available technician' });
      continue;
    }
    await assignWorkOrder(client, job.wo_id, { userId: pick.user_id }, actorId);
    const hit = techs.find((t) => Number(t.user_id) === Number(pick.user_id));
    if (hit) hit.jobs_today = Number(hit.jobs_today || 0) + 1;
    await logEvent(client, {
      ticketId: job.ticket_id,
      woId: job.wo_id,
      eventType: 'TICKET_REASSIGNED',
      actorId,
      summary: `Moved P${job.priority} job to ${pick.name} after absence`,
      detail: { from: fromUserId, to: pick.user_id },
    });
    moved.push({ wo_id: job.wo_id, ticket_id: job.ticket_id, to: pick.user_id, name: pick.name });
  }

  const tickets = (await client.query(
    `SELECT ticket_id FROM support_tickets_v2
      WHERE assigned_to = $1
        AND status NOT IN ('RESOLVED','CLOSED','CANCELLED')
        AND priority IN (1, 2)`,
    [fromUserId]
  )).rows;
  for (const t of tickets) {
    const dest = moved.find((m) => Number(m.ticket_id) === Number(t.ticket_id));
    await client.query(
      `UPDATE support_tickets_v2
          SET assigned_to = $2, updated_at = NOW()
        WHERE ticket_id = $1`,
      [t.ticket_id, dest ? dest.to : null]
    );
  }

  return { moved, failed };
}

exports.list = async (req, res) => {
  try {
    const date = engine.istDateStr(req.query.date);
    const techs = await engine.loadTechnicians(pool, { date });
    const marks = (await pool.query(
      `SELECT user_id, status, reason, marked_by, marked_at
         FROM support_technician_attendance WHERE work_date = $1`,
      [date]
    )).rows;
    const byUser = new Map(marks.map((m) => [Number(m.user_id), m]));
    res.json({
      success: true,
      date,
      rows: techs.map((t) => {
        const mark = byUser.get(Number(t.user_id));
        return {
          user_id: t.user_id,
          name: t.name,
          role: t.role,
          jobs_today: t.jobs_today,
          max_jobs_per_day: t.max_jobs_per_day,
          on_shift: t.on_shift,
          on_leave: t.on_leave,
          status: mark ? mark.status : (t.marked_absent || t.on_leave ? 'ABSENT' : 'PRESENT'),
          reason: mark ? mark.reason : null,
          marked_at: mark ? mark.marked_at : null,
        };
      }),
    });
  } catch (e) { bad(res, e); }
};

exports.upsert = async (req, res) => {
  try {
    const userId = Number(req.body.user_id);
    const date = engine.istDateStr(req.body.date);
    const status = String(req.body.status || '').toUpperCase();
    const reason = req.body.reason || null;
    if (!userId || !['PRESENT', 'ABSENT'].includes(status)) {
      return res.status(400).json({ success: false, message: 'user_id, date and status (PRESENT|ABSENT) required' });
    }
    const result = await tx(async (client) => {
      await client.query(
        `INSERT INTO support_technician_attendance (user_id, work_date, status, reason, marked_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, work_date) DO UPDATE
           SET status = EXCLUDED.status,
               reason = EXCLUDED.reason,
               marked_by = EXCLUDED.marked_by,
               marked_at = NOW()`,
        [userId, date, status, reason, req.user.user_id]
      );
      let reassigned = { moved: [], failed: [] };
      if (status === 'ABSENT') {
        reassigned = await reassignPriorityJobs(client, userId, date, req.user.user_id);
      }
      return reassigned;
    });
    res.json({ success: true, date, user_id: userId, status, ...result });
  } catch (e) { bad(res, e); }
};
