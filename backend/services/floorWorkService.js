/**
 * Floor work counts for the Today page (migration 425).
 *
 *   floor_my_work    — the signed-in person's own counts
 *   floor_team_work  — the same counts for every floor team member
 *
 * Per person:
 *   assigned       open floor tickets assigned to them now, and by stage
 *   timer_running  of those, with their Start work timer running
 *   waiting_start  of those, at a work stage with no timer running (Start work
 *                  is the next thing to do)
 *   sent_back      of those, back with them after failing QC (the latest move
 *                  on the ticket is a QC failure)
 *   stages_done    stage work they finished on the day: Diagnosis, Chip Level,
 *                  Body & Paint, Assembly & Software or Final Testing moved on
 *                  (credited like technician performance: to the assignee)
 *   laptops_done   of those, Final Testing finished — the incentive "job"
 *   qc_checks      QC1 / QC2 / Dispatch QC decisions they made on the day
 *
 * "Right now" counts (assigned, timer, waiting, sent back) exist only for
 * today; for an earlier day they come back as unavailable.
 */
const pool = require('../config/db');

const WORK_STAGES = ['Diagnosis', 'Chip Level Repair', 'Body & Paint', 'Assembly & Software', 'Final Testing'];
const QC_STAGES = ['QC1', 'QC2', 'Dispatch QC'];
const TEAM_ROLES = ['team_member', 'team_lead', 'qc'];

/** "Right now" counts per user (only for today). userId null = everyone. */
async function liveCounts(db, userId = null) {
  const params = [WORK_STAGES, QC_STAGES];
  let who = '';
  if (userId) { params.push(Number(userId)); who = `AND t.assigned_user_id = $${params.length}`; }
  const { rows } = await db.query(
    `SELECT t.assigned_user_id AS user_id, s.stage_name,
            COUNT(*)::int AS assigned,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM work_logs w WHERE w.ticket_id = t.ticket_id AND w.user_id = t.assigned_user_id AND w.end_time IS NULL
            ))::int AS timer_running,
            COUNT(*) FILTER (WHERE s.stage_name = ANY($1::text[]) AND NOT EXISTS (
              SELECT 1 FROM work_logs w WHERE w.ticket_id = t.ticket_id AND w.user_id = t.assigned_user_id AND w.end_time IS NULL
            ))::int AS waiting_start,
            COUNT(*) FILTER (WHERE (
              SELECT h.previous_stage = ANY($2::text[]) AND h.action ILIKE '%failed%'
                FROM production_ticket_history h
               WHERE h.ticket_id = t.ticket_id
               ORDER BY h.created_at DESC, h.id DESC LIMIT 1
            ))::int AS sent_back
       FROM tickets t
       JOIN stages s ON s.stage_id = t.current_stage_id
      WHERE t.status IN ('in_progress', 'on_hold')
        AND t.assigned_user_id IS NOT NULL
        ${who}
      GROUP BY 1, 2`,
    params
  );
  const by = new Map();
  for (const r of rows) {
    const u = by.get(r.user_id) || { assigned: 0, timer_running: 0, waiting_start: 0, sent_back: 0, by_stage: [] };
    u.assigned += r.assigned;
    u.timer_running += r.timer_running;
    u.waiting_start += r.waiting_start;
    u.sent_back += r.sent_back;
    u.by_stage.push({ stage: r.stage_name, count: r.assigned });
    by.set(r.user_id, u);
  }
  return by;
}

/** What each person finished on an IST day. userId null = everyone. */
async function dayCounts(db, day, userId = null) {
  // Each query gets only the parameters it uses (Postgres refuses an unused one).
  const p1 = [day, WORK_STAGES];
  const p2 = [day, QC_STAGES];
  let who1 = '';
  let who2 = '';
  if (userId) {
    p1.push(Number(userId));
    p2.push(Number(userId));
    who1 = 'AND COALESCE(h.previous_technician_id, h.performed_by) = $3';
    who2 = 'AND h.performed_by = $3';
  }
  const work = await db.query(
    `SELECT COALESCE(h.previous_technician_id, h.performed_by) AS user_id,
            COUNT(DISTINCT (h.ticket_id, h.previous_stage))::int AS stages_done,
            COUNT(DISTINCT h.ticket_id) FILTER (WHERE h.previous_stage = 'Final Testing' AND h.current_stage = 'QC1')::int AS laptops_done
       FROM production_ticket_history h
      WHERE (h.created_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
        AND h.previous_stage = ANY($2::text[])
        AND h.current_stage IS DISTINCT FROM h.previous_stage
        AND h.current_stage <> 'Hold'
        AND h.action NOT ILIKE 'Technician Assigned%'
        ${who1}
      GROUP BY 1`,
    p1
  );
  const qc = await db.query(
    `SELECT h.performed_by AS user_id, COUNT(DISTINCT (h.ticket_id, h.previous_stage))::int AS qc_checks
       FROM production_ticket_history h
      WHERE (h.created_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
        AND h.previous_stage = ANY($2::text[])
        AND h.current_stage IS DISTINCT FROM h.previous_stage
        AND (h.action ILIKE '%failed%' OR h.action ILIKE '%passed%'
             OR (h.previous_stage = 'QC2' AND h.current_stage IN ('Pending Inventory', 'Inventory')))
        ${who2}
      GROUP BY 1`,
    p2
  );
  const by = new Map();
  for (const r of work.rows) if (r.user_id) by.set(Number(r.user_id), { stages_done: r.stages_done, laptops_done: r.laptops_done, qc_checks: 0 });
  for (const r of qc.rows) {
    if (!r.user_id) continue;
    const u = by.get(Number(r.user_id)) || { stages_done: 0, laptops_done: 0 };
    u.qc_checks = r.qc_checks;
    by.set(Number(r.user_id), u);
  }
  return by;
}

const NOT_KEPT = 'Only kept for today';
const zeroDay = { stages_done: 0, laptops_done: 0, qc_checks: 0 };
const zeroLive = { assigned: 0, timer_running: 0, waiting_start: 0, sent_back: 0, by_stage: [] };

function shape(live, day, isToday) {
  return {
    ...(isToday ? { ...zeroLive, ...live } : { assigned: null, timer_running: null, waiting_start: null, sent_back: null, by_stage: [], live_unavailable: NOT_KEPT }),
    ...zeroDay,
    ...day,
  };
}

async function myWork(db = pool, userId, { date, isToday }) {
  const [live, day] = await Promise.all([
    isToday ? liveCounts(db, userId) : Promise.resolve(new Map()),
    dayCounts(db, date, userId),
  ]);
  return shape(live.get(Number(userId)), day.get(Number(userId)), isToday);
}

async function teamWork(db = pool, { date, isToday }) {
  const [live, day] = await Promise.all([
    isToday ? liveCounts(db) : Promise.resolve(new Map()),
    dayCounts(db, date),
  ]);
  const ids = [...new Set([...live.keys(), ...day.keys()].map(Number))];
  const { rows: people } = await db.query(
    `SELECT u.user_id, u.name, u.role
       FROM users u
      WHERE u.user_id = ANY($1::int[])
         OR (COALESCE(u.active, TRUE) AND u.role = ANY($2::text[]))`,
    [ids, TEAM_ROLES]
  );
  return people
    .map((p) => ({ user_id: p.user_id, name: p.name, role: p.role, ...shape(live.get(Number(p.user_id)), day.get(Number(p.user_id)), isToday) }))
    .sort((a, b) => ((b.assigned || 0) + b.stages_done + b.qc_checks) - ((a.assigned || 0) + a.stages_done + a.qc_checks)
      || String(a.name).localeCompare(String(b.name)));
}

module.exports = { myWork, teamWork, WORK_STAGES, NOT_KEPT };
